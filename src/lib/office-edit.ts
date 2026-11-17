import "server-only";
import type { PoolClient } from "pg";
import { q, tx } from "./db";
import type { User } from "./auth";
import { audit } from "./audit";
import { claimEditLock, claimedLiftPercent, loadClaim, priceClaim, ClaimError, type ClaimRow } from "./claims";
import { repriceMemberSplits, writeMemberSplits, type SplitRequest } from "./members";
import { fromPence, toPence } from "./money";

function assertOffice(user: User) {
  if (user.role !== "management" && user.role !== "admin") throw new ClaimError("Management only.");
}

async function note(db: PoolClient, userId: string, claimId: string, field: string, oldValue: string, newValue: string, reason: string) {
  if (oldValue === newValue) return;
  await db.query(
    `INSERT INTO ops.claim_field_edits (claim_id, user_id, field, old_value, new_value, reason)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [claimId, userId, field.slice(0, 80), oldValue.slice(0, 500), newValue.slice(0, 500), reason.trim().slice(0, 500)]);
  await db.query(
    `INSERT INTO ops.claim_flags (claim_id, kind, message) VALUES ($1, 'office_change', $2)`,
    [claimId, `K-S changed ${field} from "${oldValue || "blank"}" to "${newValue || "blank"}".`]);
}

async function guard(user: User, claimId: string, db: PoolClient): Promise<ClaimRow> {
  assertOffice(user);
  const c = (await db.query<ClaimRow>(
    `SELECT id, ref, gang_id, client_id, site_id, job_number_id, plot_id, claim_type::text AS claim_type, stage,
            to_char(work_date, 'YYYY-MM-DD') AS work_date, to_char(week_ending, 'YYYY-MM-DD') AS week_ending,
            pay_run_id, rolled_to_next_run, status::text AS status, notes, submitted_at, created_at
     FROM ops.claims WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [claimId])).rows[0];
  if (!c) throw new ClaimError("Claim not found.");
  const block = await claimEditLock(c);
  if (block) throw new ClaimError(block);
  return c;
}

export async function unapproveClaim(user: User, claimId: string, reason: string) {
  assertOffice(user);
  const c = await loadClaim(user, claimId);
  if (c.status === "paid") throw new ClaimError("This claim has been paid, so it is locked.");
  if (c.pay_run_id) {
    const run = await q<{ status: string }>("SELECT status FROM ops.pay_runs WHERE id = $1", [c.pay_run_id]);
    if (run[0] && run[0].status !== "open") throw new ClaimError("This pay run has been closed or paid, so the claim is locked.");
  }
  if (c.status !== "approved") throw new ClaimError("Only an approved claim can be un-approved.");
  await tx(async (db) => {
    await db.query("UPDATE ops.claims SET status = 'awaiting_management' WHERE id = $1", [claimId]);
    await note(db, user.id, claimId, "status", "approved", "awaiting_management", reason);
    await audit(user.id, "claim", claimId, "unapproved", { reason }, db);
  });
}

export async function officeUpdateDetails(user: User, claimId: string, input: {
  siteId: string; jobNumberId: string; plotId: string | null; notes: string; reason: string;
}) {
  await tx(async (db) => {
    const c = await guard(user, claimId, db);
    const site = (await db.query<{ id: string; name: string; client_id: string | null }>(
      "SELECT id, name, client_id FROM ops.sites WHERE id = $1 AND active", [input.siteId])).rows[0];
    if (!site?.client_id) throw new ClaimError("Choose a site that has a client.");
    const job = (await db.query("SELECT 1 FROM ops.job_numbers WHERE id = $1 AND site_id = $2 AND active", [input.jobNumberId, site.id])).rowCount;
    if (!job) throw new ClaimError("Choose a job number for this site.");
    if (input.plotId) {
      const plot = (await db.query("SELECT 1 FROM ops.plots WHERE id = $1 AND site_id = $2 AND job_number_id = $3", [input.plotId, site.id, input.jobNumberId])).rowCount;
      if (!plot) throw new ClaimError("That plot is not on this job number.");
    }
    const oldSite = (await db.query<{ name: string }>("SELECT name FROM ops.sites WHERE id = $1", [c.site_id])).rows[0]?.name ?? "";
    const oldJob = (await db.query<{ code: string }>("SELECT code FROM ops.job_numbers WHERE id = $1", [c.job_number_id])).rows[0]?.code ?? "";
    const newJob = (await db.query<{ code: string }>("SELECT code FROM ops.job_numbers WHERE id = $1", [input.jobNumberId])).rows[0]?.code ?? "";
    await note(db, user.id, claimId, "site", oldSite, site.name, input.reason);
    await note(db, user.id, claimId, "job", oldJob, newJob, input.reason);
    await note(db, user.id, claimId, "notes", c.notes, input.notes.slice(0, 2000), input.reason);
    const before = toPence((await db.query<{ t: string }>("SELECT coalesce(sum(gang_value), 0)::text AS t FROM ops.claim_lines WHERE claim_id = $1", [claimId])).rows[0].t);
    await db.query(
      "UPDATE ops.claims SET site_id = $2, client_id = $3, job_number_id = $4, plot_id = $5, notes = $6 WHERE id = $1",
      [claimId, site.id, site.client_id, input.jobNumberId, input.plotId, input.notes.slice(0, 2000)]);
    const priced = await priceClaim(db, { ...c, site_id: site.id, client_id: site.client_id, job_number_id: input.jobNumberId, plot_id: input.plotId });
    if (priced.totalPence !== before) await repriceMemberSplits(db, claimId, priced.totalPence, user.id);
    await audit(user.id, "claim", claimId, "office_edit", { fields: ["site", "job", "notes"] }, db);
  });
}

export async function officeSetQuantity(user: User, claimId: string, lineId: string, quantity: number, reason: string) {
  if (!(quantity >= 0)) throw new ClaimError("Enter a quantity.");
  await tx(async (db) => {
    const c = await guard(user, claimId, db);
    const line = (await db.query<{ description: string; quantity: string; lift_id: string | null; unit: string }>(
      "SELECT description, quantity::text, lift_id, unit FROM ops.claim_lines WHERE id = $1 AND claim_id = $2 FOR UPDATE",
      [lineId, claimId])).rows[0];
    if (!line) throw new ClaimError("Line not found.");
    if (line.lift_id) {
      if (quantity > 100) throw new ClaimError("A lift cannot be claimed above 100%.");
      const used = c.plot_id ? await claimedLiftPercent(c.plot_id, line.lift_id, claimId, db) : 0;
      if (used + quantity > 100) throw new ClaimError(`Only ${Math.max(0, 100 - used)}% of this lift is left to claim.`);
    }
    const before = toPence((await db.query<{ t: string }>("SELECT coalesce(sum(gang_value), 0)::text AS t FROM ops.claim_lines WHERE claim_id = $1", [claimId])).rows[0].t);
    await db.query("UPDATE ops.claim_lines SET quantity = $2 WHERE id = $1", [lineId, quantity]);
    await note(db, user.id, claimId, line.description, String(Number(line.quantity)), String(quantity), reason);
    const priced = await priceClaim(db, c);
    if (priced.problems.length) throw new ClaimError(priced.problems[0]);
    if (priced.totalPence !== before) await repriceMemberSplits(db, claimId, priced.totalPence, user.id);
    await audit(user.id, "claim", claimId, "office_edit", { field: line.description, quantity }, db);
  });
}

export async function officeSaveSplits(user: User, claimId: string, rows: SplitRequest[], reason: string) {
  await tx(async (db) => {
    const c = await guard(user, claimId, db);
    const total = toPence((await db.query<{ t: string }>("SELECT coalesce(sum(gang_value), 0)::text AS t FROM ops.claim_lines WHERE claim_id = $1", [claimId])).rows[0].t);
    const before = (await db.query<{ name: string; amount: string }>(
      `SELECT m.name, s.amount::text FROM ops.member_splits s JOIN ops.gang_members m ON m.id = s.member_id WHERE s.claim_id = $1 ORDER BY m.name`,
      [claimId])).rows.map((r) => `${r.name} ${r.amount}`).join(", ");
    await writeMemberSplits(db, user.id, c, total, rows);
    const after = rows.map((r) => `${r.memberId} ${r.value}`).join(", ");
    await note(db, user.id, claimId, "split", before, after, reason);
  });
}

export async function claimFieldEdits(claimId: string) {
  return q<{ at: string; field: string; old_value: string; new_value: string; reason: string; who: string }>(
    `SELECT e.at, e.field, e.old_value, e.new_value, e.reason, u.name AS who
     FROM ops.claim_field_edits e JOIN ops.users u ON u.id = e.user_id
     WHERE e.claim_id = $1 ORDER BY e.at`, [claimId]);
}

export { fromPence };
