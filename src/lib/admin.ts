import "server-only";
import { q, q1 } from "./db";
import type { User } from "./auth";
import { audit } from "./audit";
import { hashPassword } from "./auth";
import { normaliseEmail, normaliseUsername } from "./usernames";

export class AdminError extends Error {}

export function assertManager(user: User) {
  if (user.role !== "management" && user.role !== "admin") throw new AdminError("Management only.");
}

const isoOk = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

export async function addGangRate(user: User, setId: string, itemId: string, rate: number, effectiveFrom: string) {
  assertManager(user);
  if (!(rate >= 0) || !isoOk(effectiveFrom)) throw new AdminError("Enter a rate and an effective date.");
  await q(`INSERT INTO ops.gang_rates (rate_set_id, item_id, rate, effective_from, created_by) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (rate_set_id, item_id, effective_from) DO UPDATE SET rate = EXCLUDED.rate, created_by = EXCLUDED.created_by, created_at = now()`,
    [setId, itemId, rate, effectiveFrom, user.id]);
  await audit(user.id, "rate_set", setId, "gang_rate_set", { item: itemId, rate, effectiveFrom });
}

export async function addRateSet(user: User, name: string, kind: string, clientId: string | null) {
  assertManager(user);
  if (!name || !["standard", "north", "client", "individual"].includes(kind)) throw new AdminError("Enter a name and type.");
  if (kind === "client" && !clientId) throw new AdminError("Choose the client for a client rate set.");
  const r = await q1<{ id: string }>("INSERT INTO ops.rate_sets (name, kind, client_id) VALUES ($1, $2, $3) RETURNING id", [name, kind, kind === "client" ? clientId : null]);
  await audit(user.id, "rate_set", r!.id, "created", { name, kind });
}

export async function addRateItem(user: User, input: { code: string; name: string; unit: string; claimType: string; needsCourses: boolean }) {
  assertManager(user);
  if (!input.code || !input.name || !input.unit) throw new AdminError("Enter a code, name and unit.");
  await q("INSERT INTO ops.rate_items (code, name, unit, claim_type, needs_courses) VALUES ($1, $2, $3, $4, $5)",
    [input.code.toUpperCase(), input.name, input.unit, input.claimType, input.needsCourses]);
  await audit(user.id, "rate_item", input.code, "created", input);
}

export async function setGangRateSets(user: User, gangId: string, baseId: string | null, individualId: string | null) {
  assertManager(user);
  await q("UPDATE ops.gangs SET base_rate_set_id = $2, individual_rate_set_id = $3 WHERE id = $1", [gangId, baseId, individualId]);
  await audit(user.id, "gang", gangId, "rate_sets_changed", { baseId, individualId });
}

export async function createUser(user: User, input: { email: string; username: string; name: string; role: string; gangId: string | null; password: string }) {
  if (user.role !== "admin" && user.role !== "management") throw new AdminError("Management only.");
  const email = input.email.trim() ? normaliseEmail(input.email) : null;
  const username = input.username.trim() ? normaliseUsername(input.username) : null;
  if (input.email.trim() && !email) throw new AdminError("Enter a valid email, or leave it blank.");
  if (input.username.trim() && !username) throw new AdminError("Usernames use lowercase letters, digits, dots and hyphens.");
  if (!email && !username) throw new AdminError("Enter an email or a username.");
  if (input.name.trim().length < 2) throw new AdminError("Enter a name.");
  if (input.password.length < 10) throw new AdminError("Passwords must be at least 10 characters.");
  if (!["gang", "contracts_manager", "management", "admin"].includes(input.role)) throw new AdminError("Choose a role.");
  if (input.role === "admin" && user.role !== "admin") throw new AdminError("Only an administrator can create administrators.");
  if (input.role === "gang" && !input.gangId) throw new AdminError("Choose the gang for a gang account. Pick an existing gang lead to give them a login.");
  if (email && await q1("SELECT 1 FROM ops.users WHERE lower(email) = $1", [email])) throw new AdminError("A user with that email already exists.");
  if (username && await q1("SELECT 1 FROM ops.users WHERE lower(username) = $1", [username])) throw new AdminError("A user with that username already exists.");
  const r = await q1<{ id: string }>(
    `INSERT INTO ops.users (email, username, name, password_hash, role, gang_id, must_change_password)
     VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING id`,
    [email, username, input.name.trim(), await hashPassword(input.password), input.role, input.role === "gang" ? input.gangId : null]);
  await audit(user.id, "user", r!.id, "created", { email, username, role: input.role });
}

export async function resetPassword(user: User, userId: string, password: string) {
  if (user.role !== "admin" && user.role !== "management") throw new AdminError("Management only.");
  if (password.length < 10) throw new AdminError("Passwords must be at least 10 characters.");
  const target = await q1<{ role: string }>("SELECT role FROM ops.users WHERE id = $1", [userId]);
  if (target?.role === "admin" && user.role !== "admin") throw new AdminError("Only an administrator can reset an administrator.");
  await q("UPDATE ops.users SET password_hash = $2, must_change_password = true WHERE id = $1", [userId, await hashPassword(password)]);
  await q("DELETE FROM ops.sessions WHERE user_id = $1", [userId]);
  await audit(user.id, "user", userId, "password_reset");
}

export async function setUserActive(user: User, userId: string, active: boolean) {
  if (user.role !== "admin" && user.role !== "management") throw new AdminError("Management only.");
  if (userId === user.id) throw new AdminError("You cannot deactivate yourself.");
  await q("UPDATE ops.users SET active = $2 WHERE id = $1", [userId, active]);
  if (!active) await q("DELETE FROM ops.sessions WHERE user_id = $1", [userId]);
  await audit(user.id, "user", userId, active ? "activated" : "deactivated");
}

/**
 * Eligibility import from the payment company's export (CSV text).
 * Expects a header row with columns "payment_ref" and "eligible" (yes/no, true/false, 1/0).
 * Matches on payment_ref only. Unmatched rows are reported, never created.
 */
export async function importEligibility(user: User, csv: string): Promise<{ updated: number; unmatched: string[] }> {
  assertManager(user);
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new AdminError("The file has no rows.");
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/"/g, ""));
  const refCol = header.indexOf("payment_ref");
  const okCol = header.indexOf("eligible");
  if (refCol < 0 || okCol < 0) throw new AdminError("The file needs columns named payment_ref and eligible.");
  let updated = 0;
  const unmatched: string[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const ref = cells[refCol];
    if (!ref) continue;
    const eligible = /^(yes|y|true|1|cleared|approved)$/i.test(cells[okCol] ?? "");
    const r = await q("UPDATE ops.payees SET eligible = $2, eligibility_source = 'import', eligibility_updated_at = now() WHERE payment_ref = $1 RETURNING id", [ref, eligible]);
    if (r.length) updated++; else unmatched.push(ref);
  }
  await audit(user.id, "payees", "eligibility", "imported", { updated, unmatched: unmatched.length });
  return { updated, unmatched };
}

export async function changeLogin(user: User, userId: string, emailRaw: string, usernameRaw: string, name: string) {
  if (user.role !== "admin" && user.role !== "management") throw new AdminError("Management only.");
  const email = emailRaw.trim() ? normaliseEmail(emailRaw) : null;
  const username = usernameRaw.trim() ? normaliseUsername(usernameRaw) : null;
  if (emailRaw.trim() && !email) throw new AdminError("Enter a valid email, or leave it blank.");
  if (usernameRaw.trim() && !username) throw new AdminError("Usernames use lowercase letters, digits, dots and hyphens.");
  if (!email && !username) throw new AdminError("Keep an email or a username.");
  if (name.trim().length < 2) throw new AdminError("Enter a name.");
  const target = await q1<{ role: string }>("SELECT role FROM ops.users WHERE id = $1", [userId]);
  if (target?.role === "admin" && user.role !== "admin") throw new AdminError("Only an administrator can change an administrator.");
  if (email && await q1("SELECT 1 FROM ops.users WHERE lower(email) = $1 AND id <> $2", [email, userId])) throw new AdminError("Another user already has that email.");
  if (username && await q1("SELECT 1 FROM ops.users WHERE lower(username) = $1 AND id <> $2", [username, userId])) throw new AdminError("Another user already has that username.");
  await q("UPDATE ops.users SET email = $2, username = $3, name = $4 WHERE id = $1", [userId, email, username, name.trim()]);
  await audit(user.id, "user", userId, "login_changed", { email, username });
}
