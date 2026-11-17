import "server-only";
import type { PoolClient } from "pg";
import { q, q1, tx } from "./db";
import type { User } from "./auth";
import { audit } from "./audit";
import { fromPence, rescale, toPence } from "./money";
import { assertSafetyCleared } from "./safety";

export class MemberSplitError extends Error {}

export type SplitBasis = "amount" | "percent";

export interface SplitRequest {
  memberId: string;
  basis: SplitBasis;
  /** Pence when the basis is amount, or a percentage from 0 to 100. */
  value: number;
}

export interface ResolvedSplit {
  memberId: string;
  basis: SplitBasis;
  percent: string | null;
  amountPence: number;
}

/** Amounts must equal the claim total. Percentages must equal 100, then convert to that total. */
export function resolveMemberSplit(totalPence: number, rows: SplitRequest[]): ResolvedSplit[] {
  if (!Number.isInteger(totalPence) || totalPence < 0) throw new MemberSplitError("This claim cannot be split.");
  const used = rows.filter((r) => r.value > 0);
  if (totalPence === 0) {
    if (used.length) throw new MemberSplitError("This claim has no value to split.");
    return [];
  }
  if (!used.length) throw new MemberSplitError("Allocate the claim between the people in your gang.");
  const basis = used[0].basis;
  if (used.some((r) => r.basis !== basis)) throw new MemberSplitError("Use either amounts or percentages for the whole split.");
  if (basis === "percent") {
    const hundredths = used.map((r) => {
      if (!Number.isFinite(r.value) || r.value <= 0 || r.value > 100) throw new MemberSplitError("Enter a percentage between 0 and 100.");
      const h = Math.round(r.value * 100);
      if (Math.abs(h - r.value * 100) > 0.001) throw new MemberSplitError("Percentages can have at most two decimal places.");
      return h;
    });
    const sum = hundredths.reduce((a, b) => a + b, 0);
    if (sum !== 10000) throw new MemberSplitError(`Percentages must add up to 100. They add up to ${(sum / 100).toFixed(2)}.`);
    const amounts = rescale(hundredths, totalPence);
    return used.map((r, i) => ({ memberId: r.memberId, basis, percent: (hundredths[i] / 100).toFixed(2), amountPence: amounts[i] }));
  }
  const pence = used.map((r) => {
    if (!Number.isInteger(r.value) || r.value < 0) throw new MemberSplitError("Split amounts must be in pounds and pence.");
    return r.value;
  });
  const sum = pence.reduce((a, b) => a + b, 0);
  if (sum !== totalPence) {
    const gap = (Math.abs(totalPence - sum) / 100).toLocaleString("en-GB", { style: "currency", currency: "GBP" });
    throw new MemberSplitError(sum < totalPence
      ? `${gap} is still to allocate. The split must equal the claim total.`
      : `The split is over by ${gap}. It must equal the claim total.`);
  }
  return used.map((r, i) => ({ memberId: r.memberId, basis, percent: null, amountPence: pence[i] }));
}

const NAME = /^[\p{L}][\p{L} .'-]{1,78}$/u;

/** A gang lead adds a person by name. No user account is created. */
export async function addGangMember(user: User, name: string): Promise<string> {
  await assertSafetyCleared(user);
  if (user.role !== "gang" || !user.gang_id) throw new MemberSplitError("Only a gang lead can add people to a gang.");
  const clean = name.trim().replace(/\s+/g, " ");
  if (!NAME.test(clean)) throw new MemberSplitError("Enter the person's name. They do not get a login.");
  const row = await q1<{ id: string }>(
    `INSERT INTO ops.gang_members (gang_id, name, created_by) VALUES ($1, $2, $3)
     ON CONFLICT (gang_id, (lower(name))) DO UPDATE SET active = true, name = EXCLUDED.name
     RETURNING id`,
    [user.gang_id, clean, user.id]);
  await audit(user.id, "gang", user.gang_id, "member_added", { name: clean, member: row!.id });
  return row!.id;
}

export async function gangMembers(gangId: string) {
  return q<{ id: string; name: string }>(
    "SELECT id, name FROM ops.gang_members WHERE gang_id = $1 AND active ORDER BY name", [gangId]);
}

export interface MemberSplitRow {
  member_id: string;
  name: string;
  basis: SplitBasis;
  percent: string | null;
  amount: string;
  needs_confirm: boolean;
}

/** Owning gang, management and admin. Another gang gets nothing. */
export async function memberSplitsFor(user: User, claimId: string): Promise<MemberSplitRow[]> {
  const c = await q1<{ gang_id: string; deleted_at: string | null }>(
    "SELECT gang_id, deleted_at FROM ops.claims WHERE id = $1", [claimId]);
  if (!c || c.deleted_at) throw new MemberSplitError("Claim not found.");
  const office = user.role === "management" || user.role === "admin";
  if (user.role === "gang" && user.gang_id !== c.gang_id) throw new MemberSplitError("Claim not found.");
  if (!office && user.role !== "gang") return [];
  return q<MemberSplitRow>(
    `SELECT s.member_id, m.name, s.basis, s.percent::text, s.amount::text, s.needs_confirm
     FROM ops.member_splits s JOIN ops.gang_members m ON m.id = s.member_id
     WHERE s.claim_id = $1 ORDER BY m.name`, [claimId]);
}

export async function writeMemberSplits(
  db: PoolClient, userId: string, claim: { id: string; gang_id: string; status: string }, totalPence: number, rows: SplitRequest[],
) {
  if (claim.status === "approved" || claim.status === "paid") {
    throw new MemberSplitError("This split is locked because the claim has been confirmed.");
  }
  const resolved = resolveMemberSplit(totalPence, rows);
  if (resolved.length) {
    const found = await db.query<{ id: string }>(
      "SELECT id FROM ops.gang_members WHERE gang_id = $1 AND active AND id = ANY($2::uuid[])",
      [claim.gang_id, resolved.map((r) => r.memberId)]);
    if (found.rows.length !== new Set(resolved.map((r) => r.memberId)).size) {
      throw new MemberSplitError("That person is not in your gang.");
    }
  }
  const before = (await db.query("SELECT member_id, basis, percent, amount FROM ops.member_splits WHERE claim_id = $1 ORDER BY member_id", [claim.id])).rows;
  await db.query("DELETE FROM ops.member_splits WHERE claim_id = $1", [claim.id]);
  for (const r of resolved) {
    await db.query(
      `INSERT INTO ops.member_splits (claim_id, member_id, basis, percent, amount, needs_confirm)
       VALUES ($1, $2, $3, $4, $5, false)`,
      [claim.id, r.memberId, r.basis, r.percent, fromPence(r.amountPence)]);
  }
  await db.query("DELETE FROM ops.claim_flags WHERE claim_id = $1 AND kind = 'split_reconfirm'", [claim.id]);
  await audit(userId, "claim", claim.id, "member_split_saved", {
    before,
    after: resolved.map((r) => ({ member: r.memberId, basis: r.basis, percent: r.percent, amount: fromPence(r.amountPence) })),
  }, db);
}

/** Percent splits follow the new total. Amount splits stay put and must be confirmed again. */
export async function repriceMemberSplits(db: PoolClient, claimId: string, newTotalPence: number, userId: string) {
  const rows = (await db.query<{ member_id: string; basis: string; percent: string | null }>(
    "SELECT member_id, basis, percent::text FROM ops.member_splits WHERE claim_id = $1 ORDER BY member_id", [claimId])).rows;
  if (!rows.length) return;
  if (rows.every((r) => r.basis === "percent")) {
    const weights = rows.map((r) => Math.round(Number(r.percent) * 100));
    const amounts = rescale(weights, newTotalPence);
    for (let i = 0; i < rows.length; i++) {
      await db.query(
        "UPDATE ops.member_splits SET amount = $3, needs_confirm = false WHERE claim_id = $1 AND member_id = $2",
        [claimId, rows[i].member_id, fromPence(amounts[i])]);
    }
    await audit(userId, "claim", claimId, "member_split_repriced", { total: fromPence(newTotalPence) }, db);
    return;
  }
  await db.query("UPDATE ops.member_splits SET needs_confirm = true WHERE claim_id = $1", [claimId]);
  await db.query(
    `INSERT INTO ops.claim_flags (claim_id, kind, message)
     SELECT $1, 'split_reconfirm', 'The claim value changed. The gang lead needs to confirm the split.'
     WHERE NOT EXISTS (SELECT 1 FROM ops.claim_flags WHERE claim_id = $1 AND kind = 'split_reconfirm')`,
    [claimId]);
  await audit(userId, "claim", claimId, "member_split_needs_confirm", { total: fromPence(newTotalPence) }, db);
}

export async function updateMemberSplit(user: User, claimId: string, rows: SplitRequest[]) {
  await assertSafetyCleared(user);
  if (user.role !== "gang" || !user.gang_id) throw new MemberSplitError("Only the gang lead can change this split.");
  await tx(async (db) => {
    const c = (await db.query<{ id: string; gang_id: string; status: string; deleted_at: string | null }>(
      "SELECT id, gang_id, status::text, deleted_at FROM ops.claims WHERE id = $1 FOR UPDATE", [claimId])).rows[0];
    if (!c || c.deleted_at || c.gang_id !== user.gang_id) throw new MemberSplitError("Claim not found.");
    const total = toPence((await db.query<{ t: string }>(
      "SELECT coalesce(sum(gang_value), 0)::text AS t FROM ops.claim_lines WHERE claim_id = $1", [claimId])).rows[0].t);
    await writeMemberSplits(db, user.id, c, total, rows);
  });
}

export async function runMemberSplits(runId: string) {
  return q<{ claim: string; gang: string; member: string; basis: string; percent: string | null; amount: string; needs_confirm: boolean }>(
    `SELECT c.ref AS claim, g.name AS gang, m.name AS member, s.basis, s.percent::text, s.amount::text, s.needs_confirm
     FROM ops.member_splits s
     JOIN ops.gang_members m ON m.id = s.member_id
     JOIN ops.claims c ON c.id = s.claim_id
     JOIN ops.gangs g ON g.id = c.gang_id
     WHERE c.pay_run_id = $1 AND c.deleted_at IS NULL AND c.status IN ('approved', 'paid')
     ORDER BY g.name, c.ref, m.name`, [runId]);
}
