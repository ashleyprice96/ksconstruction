import "server-only";
import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { q, q1 } from "./db";
import { hashPassword, type User } from "./auth";
import { emailResetRequest } from "./mail";
import { AdminError, resetPassword } from "./admin";

const HOUR = "1 hour";
const IP_LIMIT = 5;
const ACCOUNT_LIMIT = 3;

export function temporaryPassword(): string {
  const body = randomBytes(12).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
  return `Temp-${body}`;
}

async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (fwd || h.get("x-real-ip") || "unknown").slice(0, 64);
}

/**
 * Record a reset request and, when SMTP is configured, email the office.
 * Always succeeds from the caller's point of view. Unknown accounts and
 * over-the-limit requests are not distinguished.
 */
export async function requestPasswordReset(identifier: string): Promise<void> {
  const id = identifier.trim().toLowerCase().slice(0, 200);
  const ip = await clientIp();
  if (!id) return;
  const recentIp = await q1<{ n: string }>(
    `SELECT count(*)::text AS n FROM ops.password_reset_requests WHERE ip = $1 AND created_at > now() - $2::interval`,
    [ip, HOUR]);
  const recentId = await q1<{ n: string }>(
    `SELECT count(*)::text AS n FROM ops.password_reset_requests WHERE lower(identifier) = $1 AND created_at > now() - $2::interval`,
    [id, HOUR]);
  if (Number(recentIp?.n ?? 0) >= IP_LIMIT || Number(recentId?.n ?? 0) >= ACCOUNT_LIMIT) {
    console.log("password reset request rate-limited");
    return;
  }
  const user = await q1<{ id: string }>(
    `SELECT id FROM ops.users WHERE active AND (lower(email) = $1 OR lower(username) = $1)`, [id]);
  await q(
    `INSERT INTO ops.password_reset_requests (user_id, identifier, ip) VALUES ($1, $2, $3)`,
    [user?.id ?? null, id, ip]);
  if (user) await emailResetRequest(id);
}

export async function setOwnPassword(user: User, password: string, confirm: string) {
  if (password.length < 10) throw new AdminError("Passwords must be at least 10 characters.");
  if (password !== confirm) throw new AdminError("The two passwords do not match.");
  await q("UPDATE ops.users SET password_hash = $2, must_change_password = false WHERE id = $1", [user.id, await hashPassword(password)]);
}

/** One click in Setup: a temporary password, which must be changed at the next sign-in. */
export async function fulfilResetRequest(actor: User, requestId: string): Promise<string> {
  const row = await q1<{ user_id: string | null; name: string | null }>(
    `SELECT r.user_id, u.name FROM ops.password_reset_requests r
     LEFT JOIN ops.users u ON u.id = r.user_id
     WHERE r.id = $1 AND r.status = 'pending'`, [requestId]);
  if (!row?.user_id || !row.name) throw new AdminError("That request is no longer pending.");
  const password = temporaryPassword();
  await resetPassword(actor, row.user_id, password);
  await q(
    `UPDATE ops.password_reset_requests SET status = 'done', resolved_at = now(), resolved_by = $2
     WHERE user_id = $1 AND status = 'pending'`,
    [row.user_id, actor.id]);
  return `Temporary password for ${row.name}: ${password}. They must choose a new one at the next sign-in.`;
}
