import "server-only";
import type { PoolClient } from "pg";
import { q, q1, tx } from "./db";
import type { User } from "./auth";
import { audit } from "./audit";
import { settings } from "./settings";
import { weekEndingFor } from "./dates";
import { fromPence, lineValuePence, percentOfPence, rescale, toPence } from "./money";
import { resolveGangRate, resolveLiftValue } from "./rates";
import { assertSafetyCleared } from "./safety";
import { checkFile, saveFile } from "./files";
import { TOP_SHEET_MAX_PAGES, checkTopSheet, topSheetCount } from "./attachments";
import { repriceMemberSplits, writeMemberSplits, MemberSplitError, type SplitRequest } from "./members";
import { assertRamsCleared } from "./rams";

export class ClaimError extends Error {}

export type ClaimType = "substructure" | "superstructure" | "daywork" | "supervision";

export interface ClaimRow {
  id: string; ref: string; gang_id: string; client_id: string; site_id: string; job_number_id: string;
  plot_id: string | null; claim_type: ClaimType; stage: string; work_date: string; week_ending: string | null;
  pay_run_id: string | null; rolled_to_next_run: boolean; status: string; notes: string;
  submitted_at: string | null; created_at: string;
}

const CLAIM_COLS = `c.id, c.ref, c.gang_id, c.client_id, c.site_id, c.job_number_id, c.plot_id, c.claim_type, c.stage,
  to_char(c.work_date, 'YYYY-MM-DD') AS work_date, to_char(c.week_ending, 'YYYY-MM-DD') AS week_ending,
  c.pay_run_id, c.rolled_to_next_run, c.status, c.notes, c.submitted_at, c.created_at`;

/** Load a claim the user may see. Deleted claims and another gang's claims are hidden. */
export async function loadClaim(user: User, id: string): Promise<ClaimRow> {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new ClaimError("Claim not found.");
  const c = await q1<ClaimRow>(`SELECT ${CLAIM_COLS} FROM ops.claims c WHERE c.id = $1 AND c.deleted_at IS NULL`, [id]);
  if (!c || (user.role === "gang" && c.gang_id !== user.gang_id)) throw new ClaimError("Claim not found.");
  return c;
}

/** Lift percent already claimed on a plot, ignoring deleted claims. */
export async function claimedLiftPercent(plotId: string, liftId: string, exceptClaimId: string | null, db?: PoolClient): Promise<number> {
  const sql = `SELECT coalesce(sum(o.quantity), 0)::text AS claimed
     FROM ops.claim_lines o JOIN ops.claims oc ON oc.id = o.claim_id
     WHERE o.lift_id = $1 AND oc.plot_id = $2 AND oc.deleted_at IS NULL
       AND oc.status IN ('awaiting_management', 'approved', 'paid')
       AND ($3::uuid IS NULL OR oc.id <> $3)`;
  const params = [liftId, plotId, exceptClaimId];
  const row = db
    ? (await db.query<{ claimed: string }>(sql, params)).rows[0]
    : await q1<{ claimed: string }>(sql, params);
  return Number(row?.claimed ?? 0);
}

function assertGangEditable(user: User, c: ClaimRow) {
  if (user.role !== "gang" || c.gang_id !== user.gang_id) throw new ClaimError("Only the gang can edit this claim.");
  if (c.status !== "draft" && c.status !== "returned") throw new ClaimError("This claim has been submitted and can no longer be edited.");
}

// Step 1: job and work ---------------------------------------------------------

export async function createDraft(user: User, input: {
  siteId: string; jobNumberId: string; plotId: string | null; claimType: ClaimType; workDate: string; stage: string;
}): Promise<string> {
  await assertSafetyCleared(user);
  await assertRamsCleared(user, input.siteId);
  if (user.role !== "gang" || !user.gang_id) throw new ClaimError("Only gang accounts create claims.");
  const site = await q1<{ client_id: string | null; active: boolean }>("SELECT client_id, active FROM ops.sites WHERE id = $1", [input.siteId]);
  if (!site || !site.active) throw new ClaimError("Choose a site from the list.");
  if (!site.client_id) throw new ClaimError("This site has no client set up yet. Ask the office.");
  const job = await q1("SELECT 1 FROM ops.job_numbers WHERE id = $1 AND site_id = $2 AND active", [input.jobNumberId, input.siteId]);
  if (!job) throw new ClaimError("Choose a job number for this site.");
  const needsPlot = input.claimType === "substructure" || input.claimType === "superstructure";
  if (needsPlot && !input.plotId) throw new ClaimError("Choose a plot.");
  if (input.plotId) {
    const plot = await q1("SELECT 1 FROM ops.plots WHERE id = $1 AND site_id = $2 AND job_number_id = $3",
      [input.plotId, input.siteId, input.jobNumberId]);
    if (!plot) throw new ClaimError("That plot is not on this job number.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.workDate)) throw new ClaimError("Enter the work date.");
  const row = await q1<{ id: string; ref: string }>(
    `INSERT INTO ops.claims (gang_id, client_id, site_id, job_number_id, plot_id, claim_type, stage, work_date, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, ref`,
    [user.gang_id, site.client_id, input.siteId, input.jobNumberId, input.plotId, input.claimType, input.stage.slice(0, 80), input.workDate, user.id]);
  await audit(user.id, "claim", row!.id, "created", { ref: row!.ref, type: input.claimType });
  return row!.id;
}

// Step 2: quantities (no money involved) ------------------------------------------

export interface QuantityInput {
  items: { itemId: string; quantity: number }[];
  lifts: { liftId: string; percent: number }[];
  supervision: { assignmentId: string; weeks: number }[];
  walls: { wallRef: string; courses: number }[];
  notes: string;
}

export async function saveQuantities(user: User, claimId: string, input: QuantityInput) {
  const c = await loadClaim(user, claimId);
  assertGangEditable(user, c);
  await tx(async (db) => {
    await db.query("DELETE FROM ops.claim_lines WHERE claim_id = $1", [claimId]);
    await db.query("DELETE FROM ops.wall_measures WHERE claim_id = $1", [claimId]);
    for (const it of input.items.filter((i) => i.quantity > 0)) {
      const item = await db.query<{ name: string; unit: string }>(
        "SELECT name, unit FROM ops.rate_items WHERE id = $1 AND claim_type = $2 AND active", [it.itemId, c.claim_type]);
      if (!item.rows[0]) throw new ClaimError("Unknown item.");
      await db.query(`INSERT INTO ops.claim_lines (claim_id, item_id, description, unit, quantity) VALUES ($1, $2, $3, $4, $5)`,
        [claimId, it.itemId, item.rows[0].name, item.rows[0].unit, it.quantity]);
    }
    for (const l of input.lifts.filter((x) => x.percent > 0)) {
      if (l.percent > 100) throw new ClaimError("A lift cannot be claimed above 100%.");
      const lift = await db.query<{ name: string }>(
        `SELECT l.name FROM ops.lifts l JOIN ops.plots p ON p.house_type_id = l.house_type_id WHERE l.id = $1 AND p.id = $2`,
        [l.liftId, c.plot_id]);
      if (!lift.rows[0]) throw new ClaimError("That lift does not belong to this plot's house type.");
      await db.query(`INSERT INTO ops.claim_lines (claim_id, lift_id, description, unit, quantity) VALUES ($1, $2, $3, '%', $4)`,
        [claimId, l.liftId, lift.rows[0].name, l.percent]);
    }
    for (const s of input.supervision.filter((x) => x.weeks > 0)) {
      const a = await db.query<{ name: string }>(
        `SELECT p.name FROM ops.supervision_assignments a JOIN ops.payees p ON p.id = a.payee_id
         WHERE a.id = $1 AND a.site_id = $2 AND p.gang_id = $3`, [s.assignmentId, c.site_id, c.gang_id]);
      if (!a.rows[0]) throw new ClaimError("That supervisor is not assigned to this site.");
      await db.query(`INSERT INTO ops.claim_lines (claim_id, supervision_assignment_id, description, unit, quantity) VALUES ($1, $2, $3, 'week', $4)`,
        [claimId, s.assignmentId, `Supervision: ${a.rows[0].name}`, s.weeks]);
    }
    for (const w of input.walls.filter((x) => x.wallRef.trim())) {
      if (!Number.isInteger(w.courses) || w.courses < 0 || w.courses > 200) throw new ClaimError("Courses must be a whole number.");
      await db.query("INSERT INTO ops.wall_measures (claim_id, wall_ref, courses) VALUES ($1, $2, $3)", [claimId, w.wallRef.trim().slice(0, 40), w.courses]);
    }
    await db.query("UPDATE ops.claims SET notes = $2 WHERE id = $1", [claimId, input.notes.slice(0, 2000)]);
    // Any change to the measures invalidates an earlier foreman signature.
    await db.query("DELETE FROM ops.foreman_signatures WHERE claim_id = $1", [claimId]);
    await audit(user.id, "claim", claimId, "quantities_saved", { lines: input.items.length + input.lifts.length + input.supervision.length }, db);
  });
}

// Step 3: evidence ------------------------------------------------------------------

export async function addAttachment(user: User, claimId: string, kind: string, file: File) {
  const c = await loadClaim(user, claimId);
  assertGangEditable(user, c);
  if (!["photo", "drawing", "daywork_sheet", "client_form"].includes(kind)) throw new ClaimError("Unknown upload type.");
  const err = checkFile(file, kind !== "photo");
  if (err) throw new ClaimError(err);
  const key = await saveFile(Buffer.from(await file.arrayBuffer()), file.type);
  const row = await q1<{ id: string }>(
    `INSERT INTO ops.attachments (claim_id, kind, storage_key, original_name, mime, size_bytes, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [claimId, kind, key, file.name.slice(0, 200), file.type, file.size, user.id]);
  await audit(user.id, "claim", claimId, "attachment_added", { kind, attachment: row!.id });
}

/** Paper or PDF top sheet. Bytes are stored in Postgres, not on the server disk. */
export async function addTopSheets(user: User, claimId: string, files: File[]) {
  const c = await loadClaim(user, claimId);
  if (user.role === "gang") {
    await assertSafetyCleared(user);
    assertGangEditable(user, c);
  } else if (user.role === "management" || user.role === "admin") {
    const block = await claimEditLock(c);
    if (block) throw new ClaimError(block);
  } else {
    throw new ClaimError("Only the gang or the office can add a top sheet.");
  }
  const pages = files.filter((f) => f && f.size > 0);
  if (!pages.length) throw new ClaimError("Choose a page or a PDF.");
  if (await topSheetCount(claimId) + pages.length > TOP_SHEET_MAX_PAGES) {
    throw new ClaimError(`A claim can hold ${TOP_SHEET_MAX_PAGES} top sheet pages.`);
  }
  for (const file of pages) {
    const err = checkTopSheet(file);
    if (err) throw new ClaimError(err);
    const bytes = Buffer.from(await file.arrayBuffer());
    const row = await q1<{ id: string }>(
      `INSERT INTO ops.attachments (claim_id, kind, storage_key, original_name, mime, size_bytes, uploaded_by, content)
       VALUES ($1, 'top_sheet', 'pg/' || gen_random_uuid()::text, $2, $3, $4, $5, $6) RETURNING id`,
      [claimId, file.name.slice(0, 200), file.type, bytes.length, user.id, bytes]);
    await audit(user.id, "claim", claimId, "top_sheet_added", { attachment: row!.id, bytes: bytes.length });
  }
}

export async function removeAttachment(user: User, claimId: string, attachmentId: string) {
  const c = await loadClaim(user, claimId);
  assertGangEditable(user, c);
  await q("DELETE FROM ops.attachments WHERE id = $1 AND claim_id = $2 AND kind <> 'signature'", [attachmentId, claimId]);
  await audit(user.id, "claim", claimId, "attachment_removed", { attachment: attachmentId });
}

// Step 4: foreman signature (shows measures and photos only, never money) -------------

export async function signForeman(user: User, claimId: string, foremanName: string, pngDataUrl: string) {
  const c = await loadClaim(user, claimId);
  assertGangEditable(user, c);
  const name = foremanName.trim();
  if (name.length < 3) throw new ClaimError("The foreman must type their full name.");
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(pngDataUrl);
  if (!m) throw new ClaimError("The foreman must sign in the box.");
  const png = Buffer.from(m[1], "base64");
  if (png.length < 1500 || png.length > 2_000_000) throw new ClaimError("The signature is empty. Please sign in the box.");
  const lines = await q1<{ n: string }>("SELECT count(*) AS n FROM ops.claim_lines WHERE claim_id = $1", [claimId]);
  if (Number(lines?.n) === 0) throw new ClaimError("Enter the work before the foreman signs.");
  const key = await saveFile(png, "image/png");
  await tx(async (db) => {
    const a = await db.query<{ id: string }>(
      `INSERT INTO ops.attachments (claim_id, kind, storage_key, original_name, mime, size_bytes, uploaded_by)
       VALUES ($1, 'signature', $2, 'signature.png', 'image/png', $3, $4) RETURNING id`, [claimId, key, png.length, user.id]);
    await db.query("DELETE FROM ops.foreman_signatures WHERE claim_id = $1", [claimId]);
    await db.query("INSERT INTO ops.foreman_signatures (claim_id, foreman_name, attachment_id) VALUES ($1, $2, $3)",
      [claimId, name.slice(0, 120), a.rows[0].id]);
    await audit(user.id, "claim", claimId, "foreman_signed", { foreman_name: name }, db);
  });
}

// Pricing (gang values only) -------------------------------------------------------------

export interface PricedLine {
  id: string; description: string; unit: string; quantity: string;
  gang_rate: string | null; gang_value_pence: number | null; problem: string | null;
}

/** Prices every line at gang rates. Lines with no rate are reported, never guessed. */
export async function priceClaim(db: PoolClient, c: ClaimRow): Promise<{ lines: PricedLine[]; totalPence: number; problems: string[] }> {
  const lines = (await db.query<{ id: string; item_id: string | null; lift_id: string | null; supervision_assignment_id: string | null;
    description: string; unit: string; quantity: string }>(
    "SELECT id, item_id, lift_id, supervision_assignment_id, description, unit, quantity FROM ops.claim_lines WHERE claim_id = $1 ORDER BY description", [c.id])).rows;
  const out: PricedLine[] = [];
  const problems: string[] = [];
  let total = 0;
  for (const l of lines) {
    let rate: string | null = null; let source: string | null = null; let value: number | null = null; let problem: string | null = null;
    if (l.item_id) {
      const r = await resolveGangRate(db, c.gang_id, c.site_id, l.item_id, c.work_date);
      if (r) { rate = r.rate; source = r.source; value = lineValuePence(l.quantity, r.rate); }
      else problem = `No agreed rate is set for ${l.description}. The office has been flagged.`;
    } else if (l.lift_id) {
      const v = await resolveLiftValue(db, c.site_id, l.lift_id, c.work_date);
      if (v) { rate = v.value; source = v.source; value = percentOfPence(l.quantity, toPence(v.value)); }
      else problem = `No value is set for ${l.description}. The office has been flagged.`;
    } else if (l.supervision_assignment_id) {
      const a = await db.query<{ weekly_amount: string }>("SELECT weekly_amount FROM ops.supervision_assignments WHERE id = $1", [l.supervision_assignment_id]);
      rate = a.rows[0]?.weekly_amount ?? null; source = "Supervision assignment";
      value = rate ? lineValuePence(l.quantity, rate) : null;
      if (!rate) problem = "No supervision amount is set.";
    }
    await db.query("UPDATE ops.claim_lines SET gang_rate = $2, rate_source = $3, gang_value = $4 WHERE id = $1",
      [l.id, rate, source, value === null ? null : fromPence(value)]);
    if (problem) problems.push(problem);
    total += value ?? 0;
    out.push({ id: l.id, description: l.description, unit: l.unit, quantity: l.quantity, gang_rate: rate, gang_value_pence: value, problem });
  }
  return { lines: out, totalPence: total, problems };
}

/** For the split screen: prices the claim and returns eligible payees. Gang only. */
export async function splitScreen(user: User, claimId: string) {
  const c = await loadClaim(user, claimId);
  assertGangEditable(user, c);
  const priced = await tx((db) => priceClaim(db, c));
  const payees = await q<{ id: string; name: string; legal_name: string; entity_type: string; eligible: boolean }>(
    "SELECT id, name, legal_name, entity_type, eligible FROM ops.payees WHERE gang_id = $1 AND active ORDER BY name", [c.gang_id]);
  const existing = await q<{ payee_id: string; amount: string }>("SELECT payee_id, amount FROM ops.splits WHERE claim_id = $1", [claimId]);
  return { claim: c, ...priced, payees, existing };
}

// Submission: enforces everything Jordan checks by hand ------------------------------------

export async function submitClaim(user: User, claimId: string, split: SplitRequest[]) {
  await assertSafetyCleared(user);
  const c = await loadClaim(user, claimId);
  await assertRamsCleared(user, c.site_id);
  assertGangEditable(user, c);
  const [minPhotos, sigRequired, cutoff] = await Promise.all([settings.minPhotos(), settings.signatureRequired(), settings.cutoff()]);

  await tx(async (db) => {
    const errors: string[] = [];
    const lines = (await db.query<{ n: string }>("SELECT count(*) AS n FROM ops.claim_lines WHERE claim_id = $1", [claimId])).rows[0];
    if (Number(lines.n) === 0) errors.push("Enter at least one quantity.");

    const att = (await db.query<{ kind: string; n: string }>(
      "SELECT kind, count(*) AS n FROM ops.attachments WHERE claim_id = $1 GROUP BY kind", [claimId])).rows;
    const count = (k: string) => Number(att.find((a) => a.kind === k)?.n ?? 0);
    const needPhotos = Math.max(1, minPhotos[c.claim_type] ?? 1);
    if (count("photo") < needPhotos) errors.push(`Add at least ${needPhotos} work photo${needPhotos > 1 ? "s" : ""}.`);
    if (c.claim_type === "substructure") {
      if (count("drawing") === 0) errors.push("Upload a photo or scan of the foundation drawing.");
      const needsCourses = (await db.query(
        `SELECT 1 FROM ops.claim_lines l JOIN ops.rate_items i ON i.id = l.item_id WHERE l.claim_id = $1 AND i.needs_courses LIMIT 1`, [claimId])).rowCount;
      const walls = (await db.query("SELECT 1 FROM ops.wall_measures WHERE claim_id = $1", [claimId])).rowCount;
      if (needsCourses && !walls) errors.push("Record the course count for each wall.");
    }
    if (c.claim_type === "daywork" && count("daywork_sheet") === 0) errors.push("Upload the signed client daywork sheet.");
    if (sigRequired[c.claim_type] !== false) {
      const sig = (await db.query("SELECT 1 FROM ops.foreman_signatures WHERE claim_id = $1", [claimId])).rowCount;
      if (!sig) errors.push("The client foreman must sign this stage.");
    }

    const priced = await priceClaim(db, c);
    errors.push(...priced.problems);

    // Lifts: the cumulative claim against a lift can never exceed 100% of its value.
    // A deleted claim does not use up that allowance.
    const liftLines = (await db.query<{ description: string; quantity: string; lift_id: string }>(
      "SELECT description, quantity::text, lift_id FROM ops.claim_lines WHERE claim_id = $1 AND lift_id IS NOT NULL", [claimId])).rows;
    for (const o of liftLines) {
      const claimed = c.plot_id ? await claimedLiftPercent(c.plot_id, o.lift_id, claimId, db) : 0;
      if (claimed + Number(o.quantity) > 100) {
        errors.push(`${o.description}: only ${Math.max(0, 100 - claimed)}% of this lift is left to claim.`);
      }
    }

    const members = (await db.query<{ id: string }>("SELECT id FROM ops.gang_members WHERE gang_id = $1 AND active", [c.gang_id])).rows;
    if (!members.length && priced.totalPence > 0) errors.push("Add the people in your gang before you split the claim. They do not get a login.");
    try {
      if (!errors.length) await writeMemberSplits(db, user.id, c, priced.totalPence, split);
    } catch (e) {
      if (e instanceof MemberSplitError) errors.push(e.message);
      else throw e;
    }

    if (errors.length) throw new ClaimError(errors.join("\n"));

    // Week ending from the cut-off; pay run from the week ending.
    const now = new Date();
    const weekEnding = weekEndingFor(now, cutoff);
    let run = (await db.query<{ id: string; open: boolean }>(
      `SELECT id, (status = 'open' AND payless_closes_at > now()) AS open FROM ops.pay_runs
       WHERE $1::date BETWEEN first_week_ending AND last_week_ending`, [weekEnding])).rows[0];
    let rolled = false;
    if (run && !run.open) {
      rolled = true;
      run = (await db.query<{ id: string; open: boolean }>(
        `SELECT id, true AS open FROM ops.pay_runs WHERE status = 'open' AND payless_closes_at > now() AND first_week_ending > $1::date
         ORDER BY first_week_ending LIMIT 1`, [weekEnding])).rows[0];
    }

    await db.query("DELETE FROM ops.claim_flags WHERE claim_id = $1 AND kind <> 'split_reconfirm'", [claimId]);
    const flag = (kind: string, message: string) =>
      db.query("INSERT INTO ops.claim_flags (claim_id, kind, message) VALUES ($1, $2, $3)", [claimId, kind, message]);
    if (!run) await flag("no_pay_run", `No open pay run covers week ending ${weekEnding}. Assign one before payment.`);
    if (rolled) await flag("late", "Submitted after the cut-off for its pay run. Rolled to the next pay run.");
    // Over agreed quantity (where agreed quantities are held for the plot).
    const overQty = (await db.query<{ description: string; claimed: string; agreed: string }>(
      `SELECT l.description, (SELECT coalesce(sum(o.quantity), 0) FROM ops.claim_lines o JOIN ops.claims oc ON oc.id = o.claim_id
          WHERE o.item_id = l.item_id AND oc.plot_id = $2 AND oc.deleted_at IS NULL AND (oc.status IN ('awaiting_management', 'approved', 'paid') OR oc.id = $1)) AS claimed,
          a.quantity AS agreed
       FROM ops.claim_lines l JOIN ops.agreed_quantities a ON a.item_id = l.item_id AND a.plot_id = $2
       WHERE l.claim_id = $1`, [claimId, c.plot_id])).rows;
    for (const o of overQty) {
      if (Number(o.claimed) > Number(o.agreed)) await flag("over_quantity", `${o.description}: ${o.claimed} claimed in total against ${o.agreed} agreed for this plot.`);
    }

    await db.query(
      `UPDATE ops.claims SET status = 'awaiting_management', submitted_at = now(), week_ending = $2, pay_run_id = $3, rolled_to_next_run = $4 WHERE id = $1`,
      [claimId, weekEnding, run?.id ?? null, rolled]);
    await audit(user.id, "claim", claimId, "submitted", { week_ending: weekEnding, total: fromPence(priced.totalPence), split }, db);
  });
}

// Management ---------------------------------------------------------------------------

function assertManager(user: User) {
  if (user.role !== "management" && user.role !== "admin") throw new ClaimError("Management only.");
}

export async function approveClaim(user: User, claimId: string, comment: string) {
  assertManager(user);
  const c = await loadClaim(user, claimId);
  if (c.status !== "awaiting_management") throw new ClaimError("Only submitted claims can be approved.");
  if (!c.pay_run_id) throw new ClaimError("Assign a pay run before approving.");
  await tx(async (db) => {
    await db.query("UPDATE ops.claims SET status = 'approved' WHERE id = $1", [claimId]);
    await db.query("INSERT INTO ops.approvals (claim_id, user_id, action, comment) VALUES ($1, $2, 'approve', $3)", [claimId, user.id, comment.slice(0, 1000)]);
    await audit(user.id, "claim", claimId, "approved", { comment }, db);
  });
}

export async function returnClaim(user: User, claimId: string, comment: string) {
  assertManager(user);
  const c = await loadClaim(user, claimId);
  if (c.status !== "awaiting_management") throw new ClaimError("Only submitted claims can be returned.");
  if (comment.trim().length < 3) throw new ClaimError("Say why the claim is being returned.");
  await tx(async (db) => {
    await db.query("UPDATE ops.claims SET status = 'returned' WHERE id = $1", [claimId]);
    await db.query("INSERT INTO ops.approvals (claim_id, user_id, action, comment) VALUES ($1, $2, 'return', $3)", [claimId, user.id, comment.slice(0, 1000)]);
    await audit(user.id, "claim", claimId, "returned", { comment }, db);
  });
}

export async function assignPayRun(user: User, claimId: string, payRunId: string) {
  assertManager(user);
  const c = await loadClaim(user, claimId);
  if (c.status === "paid") throw new ClaimError("This claim has been paid.");
  const run = await q1("SELECT 1 FROM ops.pay_runs WHERE id = $1 AND status = 'open'", [payRunId]);
  if (!run) throw new ClaimError("Choose an open pay run.");
  await q("UPDATE ops.claims SET pay_run_id = $2 WHERE id = $1", [claimId, payRunId]);
  await q("DELETE FROM ops.claim_flags WHERE claim_id = $1 AND kind = 'no_pay_run'", [claimId]);
  await audit(user.id, "claim", claimId, "pay_run_assigned", { pay_run: payRunId });
}

/**
 * Pay-less reduction of one line. Allowed until the pay run's pay-less window closes.
 * The original figures, every change, who made it and why are kept; splits are
 * rescaled in proportion so they still add up to the claim value.
 */
export async function reduceLine(user: User, claimId: string, lineId: string, newQuantity: number, reason: string, note: string) {
  assertManager(user);
  const c = await loadClaim(user, claimId);
  if (c.status !== "awaiting_management" && c.status !== "approved") throw new ClaimError("This claim cannot be reduced now.");
  const reasons = await settings.paylessReasons();
  if (!reasons.includes(reason)) throw new ClaimError("Choose a reason.");
  if (note.trim().length < 5) throw new ClaimError("Explain the reduction in the note.");
  if (!(newQuantity >= 0)) throw new ClaimError("Enter the reduced quantity.");
  if (c.pay_run_id) {
    const open = await q1("SELECT 1 FROM ops.pay_runs WHERE id = $1 AND status = 'open' AND payless_closes_at > now()", [c.pay_run_id]);
    if (!open) throw new ClaimError("The pay-less window for this pay run has closed.");
  }
  await tx(async (db) => {
    const l = (await db.query<{ quantity: string; gang_value: string | null; gang_rate: string | null; lift_id: string | null;
      original_quantity: string | null }>(
      "SELECT quantity, gang_value, gang_rate, lift_id, original_quantity FROM ops.claim_lines WHERE id = $1 AND claim_id = $2 FOR UPDATE", [lineId, claimId])).rows[0];
    if (!l || l.gang_value === null || l.gang_rate === null) throw new ClaimError("Line not found.");
    if (newQuantity >= Number(l.quantity)) throw new ClaimError("A pay-less reduction must lower the quantity.");
    const newValue = l.lift_id ? percentOfPence(newQuantity, toPence(l.gang_rate)) : lineValuePence(newQuantity, l.gang_rate);
    await db.query(
      `UPDATE ops.claim_lines SET quantity = $2, gang_value = $3,
         original_quantity = coalesce(original_quantity, quantity), original_gang_value = coalesce(original_gang_value, gang_value)
       WHERE id = $1`, [lineId, newQuantity, fromPence(newValue)]);
    await db.query(
      `INSERT INTO ops.adjustments (claim_id, claim_line_id, user_id, before_quantity, after_quantity, before_value, after_value, reason_category, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [claimId, lineId, user.id, l.quantity, newQuantity, l.gang_value, fromPence(newValue), reason, note.slice(0, 2000)]);
    const total = (await db.query<{ t: string }>("SELECT coalesce(sum(gang_value), 0) AS t FROM ops.claim_lines WHERE claim_id = $1", [claimId])).rows[0].t;
    const splits = (await db.query<{ payee_id: string; amount: string }>("SELECT payee_id, amount FROM ops.splits WHERE claim_id = $1 ORDER BY payee_id", [claimId])).rows;
    const oldSplitTotal = splits.reduce((a, s) => a + toPence(s.amount), 0);
    const target = Math.min(oldSplitTotal, toPence(total));
    const scaled = rescale(splits.map((s) => toPence(s.amount)), target);
    for (let i = 0; i < splits.length; i++) {
      await db.query("UPDATE ops.splits SET original_amount = coalesce(original_amount, amount), amount = $3 WHERE claim_id = $1 AND payee_id = $2",
        [claimId, splits[i].payee_id, fromPence(scaled[i])]);
    }
    await repriceMemberSplits(db, claimId, toPence(total), user.id);
    await audit(user.id, "claim", claimId, "payless_reduction",
      { line: lineId, before_quantity: l.quantity, after_quantity: newQuantity, before_value: l.gang_value, after_value: fromPence(newValue), reason, note }, db);
  });
}

/** Office may correct a claim until it is approved. A closed or paid pay run stays locked. */
export async function claimEditLock(c: ClaimRow): Promise<string | null> {
  if (c.status === "paid") return "This claim has been paid, so it is locked.";
  if (c.pay_run_id) {
    const run = await q1<{ status: string }>("SELECT status FROM ops.pay_runs WHERE id = $1", [c.pay_run_id]);
    if (run && run.status !== "open") return "This pay run has been closed or paid, so the claim is locked.";
  }
  if (c.status === "approved") return "Un-approve this claim before editing it.";
  return null;
}

/** Why this claim cannot be deleted, or null when the user may delete it. */
export async function deleteBlockReason(user: User, c: ClaimRow): Promise<string | null> {
  if (c.status === "paid") return "This claim has been paid, so it cannot be deleted.";
  if (c.pay_run_id) {
    const run = await q1<{ payment_date: string }>(
      "SELECT to_char(payment_date, 'YYYY-MM-DD') AS payment_date FROM ops.pay_runs WHERE id = $1", [c.pay_run_id]);
    return `This claim is already in a pay run${run ? ` (payment ${run.payment_date})` : ""}, so it cannot be deleted.`;
  }
  if (user.role === "management" || user.role === "admin") return null;
  if (user.role !== "gang" || user.gang_id !== c.gang_id) return "Claim not found.";
  if (c.status !== "draft" && c.status !== "awaiting_management" && c.status !== "returned") {
    return "This claim has been confirmed, so it can no longer be deleted.";
  }
  return null;
}

export async function deleteClaim(user: User, claimId: string, reason: string, confirmed: boolean) {
  if (!confirmed) throw new ClaimError("Confirm that you want to delete this claim.");
  const why = reason.trim();
  if (why.length < 3) throw new ClaimError("Enter a reason for deleting this claim.");
  const c = await loadClaim(user, claimId);
  const block = await deleteBlockReason(user, c);
  if (block) throw new ClaimError(block);
  await q(
    "UPDATE ops.claims SET deleted_at = now(), deleted_by = $2, delete_reason = $3 WHERE id = $1 AND deleted_at IS NULL",
    [claimId, user.id, why.slice(0, 500)]);
  await audit(user.id, "claim", claimId, "deleted", { reason: why.slice(0, 500), status: c.status });
}

export async function restoreClaim(user: User, claimId: string) {
  if (user.role !== "management" && user.role !== "admin") throw new ClaimError("Management only.");
  if (!/^[0-9a-f-]{36}$/.test(claimId)) throw new ClaimError("Claim not found.");
  const c = await q1<{ deleted_at: string | null }>("SELECT deleted_at FROM ops.claims WHERE id = $1", [claimId]);
  if (!c?.deleted_at) throw new ClaimError("That claim is not deleted.");
  await q("UPDATE ops.claims SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL WHERE id = $1", [claimId]);
  await audit(user.id, "claim", claimId, "restored", {});
}

export async function deletedClaims() {
  return q<{ id: string; ref: string; gang: string; status: string; deleted_at: string; deleted_by: string; delete_reason: string }>(
    `SELECT c.id, c.ref, g.name AS gang, c.status::text AS status, c.deleted_at, u.name AS deleted_by, c.delete_reason
     FROM ops.claims c JOIN ops.gangs g ON g.id = c.gang_id LEFT JOIN ops.users u ON u.id = c.deleted_by
     WHERE c.deleted_at IS NOT NULL ORDER BY c.deleted_at DESC`);
}
