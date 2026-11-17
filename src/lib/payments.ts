import "server-only";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { q, q1, tx } from "./db";
import type { User } from "./auth";
import { audit } from "./audit";
import { settings } from "./settings";
import { fmtDate } from "./dates";

// Everything in this module is built from the operational schema only.
// It cannot include client rates, client values or margin: the login it uses
// has no access to them.

export class PayRunError extends Error {}

function assertManager(user: User) {
  if (user.role !== "management" && user.role !== "admin") throw new PayRunError("Management only.");
}

export async function createPayRun(user: User, paymentDate: string, firstWeekEnding: string, lastWeekEnding: string) {
  assertManager(user);
  if (![paymentDate, firstWeekEnding, lastWeekEnding].every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) throw new PayRunError("Enter all three dates.");
  if (firstWeekEnding > lastWeekEnding) throw new PayRunError("The first week ending must be before the last.");
  if (paymentDate <= lastWeekEnding) throw new PayRunError("The payment date must be after the last week ending.");
  const days = await settings.paylessDays();
  const overlap = await q1("SELECT 1 FROM ops.pay_runs WHERE daterange(first_week_ending, last_week_ending, '[]') && daterange($1::date, $2::date, '[]')", [firstWeekEnding, lastWeekEnding]);
  if (overlap) throw new PayRunError("Those weeks are already in another pay run.");
  const r = await q1<{ id: string }>(
    `INSERT INTO ops.pay_runs (payment_date, first_week_ending, last_week_ending, payless_closes_at)
     VALUES ($1, $2, $3, (($1::date - $4::int) + time '23:59') AT TIME ZONE 'Europe/London') RETURNING id`,
    [paymentDate, firstWeekEnding, lastWeekEnding, days]);
  await audit(user.id, "pay_run", r!.id, "created", { paymentDate, firstWeekEnding, lastWeekEnding });
  // Attach submitted claims whose week ending falls in the new run and have none yet.
  await q(`UPDATE ops.claims SET pay_run_id = $1 WHERE pay_run_id IS NULL AND status IN ('awaiting_management', 'approved')
           AND week_ending BETWEEN $2 AND $3`, [r!.id, firstWeekEnding, lastWeekEnding]);
  await q(`DELETE FROM ops.claim_flags f USING ops.claims c WHERE f.claim_id = c.id AND f.kind = 'no_pay_run' AND c.pay_run_id = $1`, [r!.id]);
  return r!.id;
}

export async function setRunStatus(user: User, runId: string, status: "closed" | "paid") {
  assertManager(user);
  await tx(async (db) => {
    if (status === "paid") {
      const pending = (await db.query("SELECT 1 FROM ops.claims WHERE pay_run_id = $1 AND status = 'awaiting_management' LIMIT 1", [runId])).rowCount;
      if (pending) throw new PayRunError("Some claims in this run are still awaiting sign-off. Approve, return or move them first.");
      await db.query("UPDATE ops.claims SET status = 'paid' WHERE pay_run_id = $1 AND status = 'approved'", [runId]);
    }
    await db.query("UPDATE ops.pay_runs SET status = $2 WHERE id = $1", [runId, status]);
    await db.query("INSERT INTO ops.audit_log (user_id, entity, entity_id, action) VALUES ($1, 'pay_run', $2, $3)", [user.id, runId, `marked_${status}`]);
  });
}

export interface SplitRow {
  payment_date: string; week_ending: string; claim: string; claim_type: string; client: string; site: string; job: string; plot: string | null;
  gang: string; payee: string; legal_name: string; entity_type: string; payment_ref: string | null; amount: string; original_amount: string | null;
  payee_id: string; status: string;
}

/** Approved (and paid) split lines in a pay run. */
export async function runSplits(runId: string, includeAwaiting = false): Promise<SplitRow[]> {
  return q<SplitRow>(
    `SELECT to_char(r.payment_date, 'YYYY-MM-DD') AS payment_date, to_char(c.week_ending, 'YYYY-MM-DD') AS week_ending, c.ref AS claim,
       c.claim_type::text AS claim_type, cl.name AS client, s.name AS site, j.code AS job, p.plot_number AS plot, g.name AS gang,
       py.name AS payee, py.legal_name, py.entity_type::text AS entity_type, py.payment_ref, sp.amount::text AS amount,
       sp.original_amount::text AS original_amount, py.id AS payee_id, c.status::text AS status
     FROM ops.splits sp JOIN ops.claims c ON c.id = sp.claim_id JOIN ops.pay_runs r ON r.id = c.pay_run_id
     JOIN ops.payees py ON py.id = sp.payee_id JOIN ops.gangs g ON g.id = c.gang_id JOIN ops.clients cl ON cl.id = c.client_id
     JOIN ops.sites s ON s.id = c.site_id JOIN ops.job_numbers j ON j.id = c.job_number_id LEFT JOIN ops.plots p ON p.id = c.plot_id
     WHERE c.pay_run_id = $1 AND c.status IN (${includeAwaiting ? "'awaiting_management', " : ""}'approved', 'paid')
     ORDER BY py.name, c.week_ending, c.ref`, [runId]);
}

export async function payeeTotals(runId: string) {
  return q<{ payee_id: string; payee: string; legal_name: string; entity_type: string; payment_ref: string | null; gang: string;
    measured: string; daywork: string; supervision: string; reductions: string; total: string }>(
    `SELECT py.id AS payee_id, py.name AS payee, py.legal_name, py.entity_type::text AS entity_type, py.payment_ref, g.name AS gang,
       coalesce(sum(sp.amount) FILTER (WHERE c.claim_type IN ('substructure', 'superstructure')), 0)::text AS measured,
       coalesce(sum(sp.amount) FILTER (WHERE c.claim_type = 'daywork'), 0)::text AS daywork,
       coalesce(sum(sp.amount) FILTER (WHERE c.claim_type = 'supervision'), 0)::text AS supervision,
       coalesce(sum(sp.original_amount - sp.amount) FILTER (WHERE sp.original_amount IS NOT NULL), 0)::text AS reductions,
       sum(sp.amount)::text AS total
     FROM ops.splits sp JOIN ops.claims c ON c.id = sp.claim_id JOIN ops.payees py ON py.id = sp.payee_id JOIN ops.gangs g ON g.id = py.gang_id
     WHERE c.pay_run_id = $1 AND c.status IN ('approved', 'paid')
     GROUP BY py.id, py.name, py.legal_name, py.entity_type, py.payment_ref, g.name ORDER BY g.name, py.name`, [runId]);
}

async function dayworkLines(runId: string) {
  return q<Record<string, string | null>>(
    `SELECT to_char(c.work_date, 'YYYY-MM-DD') AS work_date, c.ref AS claim, g.name AS gang, cl.name AS client, s.name AS site, j.code AS job,
       l.description, l.quantity::text AS hours, l.gang_rate::text AS rate, l.gang_value::text AS amount,
       (SELECT a.original_name FROM ops.attachments a WHERE a.claim_id = c.id AND a.kind = 'daywork_sheet' LIMIT 1) AS client_sheet
     FROM ops.claim_lines l JOIN ops.claims c ON c.id = l.claim_id JOIN ops.gangs g ON g.id = c.gang_id
     JOIN ops.clients cl ON cl.id = c.client_id JOIN ops.sites s ON s.id = c.site_id JOIN ops.job_numbers j ON j.id = c.job_number_id
     WHERE c.pay_run_id = $1 AND c.claim_type = 'daywork' AND c.status IN ('approved', 'paid') ORDER BY c.work_date, g.name`, [runId]);
}

async function supervisionLines(runId: string) {
  return q<Record<string, string | null>>(
    `SELECT to_char(c.week_ending, 'YYYY-MM-DD') AS week_ending, c.ref AS claim, py.name AS supervisor, s.name AS site, g.name AS gang,
       l.quantity::text AS weeks, l.gang_rate::text AS weekly_amount, l.gang_value::text AS amount
     FROM ops.claim_lines l JOIN ops.claims c ON c.id = l.claim_id JOIN ops.supervision_assignments a ON a.id = l.supervision_assignment_id
     JOIN ops.payees py ON py.id = a.payee_id JOIN ops.sites s ON s.id = c.site_id JOIN ops.gangs g ON g.id = c.gang_id
     WHERE c.pay_run_id = $1 AND c.status IN ('approved', 'paid') ORDER BY py.name, c.week_ending`, [runId]);
}

async function reductionLines(runId: string) {
  return q<Record<string, string | null>>(
    `SELECT to_char(a.created_at AT TIME ZONE 'Europe/London', 'YYYY-MM-DD HH24:MI') AS changed_at, c.ref AS claim, g.name AS gang, l.description,
       a.before_quantity::text, a.after_quantity::text, a.before_value::text, a.after_value::text, a.reason_category AS reason, a.note, u.name AS changed_by
     FROM ops.adjustments a JOIN ops.claims c ON c.id = a.claim_id JOIN ops.claim_lines l ON l.id = a.claim_line_id
     JOIN ops.gangs g ON g.id = c.gang_id JOIN ops.users u ON u.id = a.user_id
     WHERE c.pay_run_id = $1 ORDER BY a.created_at`, [runId]);
}

const money = (s: string | null | undefined) => (s === null || s === undefined || s === "" ? null : Number(s));

/** One-click Excel workbook for Mark: wages, splits, dayworks, supervision, reductions. */
export async function wagesWorkbook(runId: string): Promise<Buffer> {
  const run = await q1<{ payment_date: string; first: string; last: string }>(
    "SELECT to_char(payment_date, 'YYYY-MM-DD') AS payment_date, to_char(first_week_ending, 'YYYY-MM-DD') AS first, to_char(last_week_ending, 'YYYY-MM-DD') AS last FROM ops.pay_runs WHERE id = $1", [runId]);
  if (!run) throw new PayRunError("Pay run not found.");
  const [totals, splits, dw, sup, red] = await Promise.all([payeeTotals(runId), runSplits(runId), dayworkLines(runId), supervisionLines(runId), reductionLines(runId)]);
  const wb = new ExcelJS.Workbook();
  wb.creator = "K-S Claims";
  const header = (ws: ExcelJS.Worksheet) => {
    const r = ws.getRow(1);
    r.font = { bold: true, color: { argb: "FFFFFFFF" } };
    r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF211F20" } };
    r.border = { bottom: { style: "thick", color: { argb: "FFD37C46" } } };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };
  const gbpFmt = '"£"#,##0.00';
  const sheet = (name: string, cols: [string, string, number, boolean?][], rows: Record<string, unknown>[]) => {
    const ws = wb.addWorksheet(name);
    ws.columns = cols.map(([header, key, width]) => ({ header, key, width }));
    for (const r of rows) ws.addRow(Object.fromEntries(cols.map(([, k, , isMoney]) => [k, isMoney ? money(r[k] as string) : r[k]])));
    cols.forEach(([, , , isMoney], i) => { if (isMoney) ws.getColumn(i + 1).numFmt = gbpFmt; });
    header(ws);
    return ws;
  };
  sheet("Wages by payee", [["Gang", "gang", 22], ["Payee", "payee", 22], ["Legal name", "legal_name", 30], ["Entity", "entity_type", 16], ["Payment ref", "payment_ref", 14],
    ["Measured work", "measured", 14, true], ["Daywork", "daywork", 12, true], ["Supervision", "supervision", 13, true], ["Pay-less reductions", "reductions", 18, true], ["Total gross", "total", 14, true]], totals);
  sheet("Gang splits", [["Week ending", "week_ending", 12], ["Claim", "claim", 10], ["Type", "claim_type", 14], ["Client", "client", 24], ["Site", "site", 24], ["Job", "job", 12], ["Plot", "plot", 8],
    ["Gang", "gang", 22], ["Payee", "payee", 22], ["Legal name", "legal_name", 30], ["Entity", "entity_type", 16], ["Amount", "amount", 12, true], ["Before reductions", "original_amount", 16, true]], splits as unknown as Record<string, unknown>[]);
  sheet("Dayworks", [["Work date", "work_date", 12], ["Claim", "claim", 10], ["Gang", "gang", 22], ["Client", "client", 24], ["Site", "site", 24], ["Job", "job", 12],
    ["Item", "description", 22], ["Hours", "hours", 8], ["Rate", "rate", 10, true], ["Amount", "amount", 12, true], ["Client sheet", "client_sheet", 24]], dw);
  sheet("Supervision", [["Week ending", "week_ending", 12], ["Claim", "claim", 10], ["Supervisor", "supervisor", 22], ["Site", "site", 24], ["Gang", "gang", 22],
    ["Weeks", "weeks", 8], ["Weekly amount", "weekly_amount", 14, true], ["Amount", "amount", 12, true]], sup);
  sheet("Pay-less reductions", [["Changed", "changed_at", 17], ["Claim", "claim", 10], ["Gang", "gang", 22], ["Line", "description", 24], ["Qty before", "before_quantity", 10],
    ["Qty after", "after_quantity", 10], ["Value before", "before_value", 12, true], ["Value after", "after_value", 12, true], ["Reason", "reason", 22], ["Note", "note", 40], ["By", "changed_by", 20]], red);
  const info = wb.addWorksheet("About");
  info.addRows([["K-S Claims: pay run export"], ["Payment date", run.payment_date], ["Week endings", `${run.first} to ${run.last}`],
    ["Contents", "Approved claims only. Gross amounts. VAT, CIS and net pay are not calculated here."], ["Generated", new Date().toISOString()]]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** CSV of the gang splits sheet (the most detailed view). */
export async function splitsCsv(runId: string): Promise<string> {
  const rows = await runSplits(runId);
  const cols: (keyof SplitRow)[] = ["payment_date", "week_ending", "claim", "claim_type", "client", "site", "job", "plot", "gang", "payee", "legal_name", "entity_type", "payment_ref", "amount", "original_amount"];
  const esc = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\r\n") + "\r\n";
}

/** One invoice per payee receiving a split in the run, including limited companies. */
export async function generateInvoices(user: User, runId: string): Promise<number> {
  assertManager(user);
  const totals = await payeeTotals(runId);
  let made = 0;
  await tx(async (db) => {
    for (const t of totals) {
      const exists = (await db.query("SELECT 1 FROM ops.payee_invoices WHERE pay_run_id = $1 AND payee_id = $2", [runId, t.payee_id])).rowCount;
      if (exists) {
        await db.query("UPDATE ops.payee_invoices SET total = $3 WHERE pay_run_id = $1 AND payee_id = $2", [runId, t.payee_id, t.total]);
        continue;
      }
      const n = (await db.query<{ n: string }>("SELECT nextval('ops.invoice_seq') AS n")).rows[0].n;
      await db.query("INSERT INTO ops.payee_invoices (number, pay_run_id, payee_id, total) VALUES ($1, $2, $3, $4)",
        [`KS-PAY-${String(n).padStart(6, "0")}`, runId, t.payee_id, t.total]);
      made++;
    }
    await db.query("INSERT INTO ops.audit_log (user_id, entity, entity_id, action, details) VALUES ($1, 'pay_run', $2, 'invoices_generated', $3)",
      [user.id, runId, JSON.stringify({ created: made, payees: totals.length })]);
  });
  return made;
}

/** Payee invoice PDF. Contains gang-side amounts only. Tax treatment left for the accountant. */
export async function invoicePdf(invoiceId: string): Promise<{ pdf: Uint8Array; number: string; payee_id: string; gang_id: string }> {
  const inv = await q1<{ number: string; pay_run_id: string; payee_id: string; total: string; created_at: string; payee: string; legal_name: string;
    entity_type: string; payment_ref: string | null; gang: string; gang_id: string; payment_date: string }>(
    `SELECT i.number, i.pay_run_id, i.payee_id, i.total::text, i.created_at, py.name AS payee, py.legal_name, py.entity_type::text, py.payment_ref,
       g.name AS gang, g.id AS gang_id, to_char(r.payment_date, 'YYYY-MM-DD') AS payment_date
     FROM ops.payee_invoices i JOIN ops.payees py ON py.id = i.payee_id JOIN ops.gangs g ON g.id = py.gang_id JOIN ops.pay_runs r ON r.id = i.pay_run_id
     WHERE i.id = $1`, [invoiceId]);
  if (!inv) throw new PayRunError("Invoice not found.");
  const lines = (await runSplits(inv.pay_run_id)).filter((s) => s.payee_id === inv.payee_id);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const charcoal = rgb(0x21 / 255, 0x1f / 255, 0x20 / 255);
  const orange = rgb(0xd3 / 255, 0x7c / 255, 0x46 / 255);
  let page = doc.addPage([595, 842]);
  const logo = await doc.embedPng(await readFile(join(/*turbopackIgnore: true*/ process.cwd(), "public", "ks-logo.png")));
  const text = (t: string, x: number, y: number, size = 10, f = font, color = charcoal) => page.drawText(t, { x, y, size, font: f, color });
  page.drawRectangle({ x: 0, y: 772, width: 595, height: 70, color: charcoal });
  page.drawRectangle({ x: 0, y: 768, width: 595, height: 4, color: orange });
  page.drawImage(logo, { x: 40, y: 782, width: 50, height: 50 });
  text("PAYMENT INVOICE", 105, 812, 16, bold, rgb(1, 1, 1));
  text("DRAFT FOR ACCOUNTANT REVIEW", 105, 794, 9, bold, orange);
  let y = 740;
  const kv = (k: string, v: string) => { text(k, 40, y, 9, bold); text(v, 160, y, 10); y -= 16; };
  kv("Invoice number", inv.number);
  kv("Date", fmtDate(inv.created_at));
  kv("Payment run", fmtDate(inv.payment_date));
  y -= 6;
  kv("Supplier", inv.legal_name);
  if (inv.legal_name !== inv.payee) kv("Operative", inv.payee);
  kv("Entity", inv.entity_type.replace("_", " "));
  if (inv.payment_ref) kv("Payment reference", inv.payment_ref);
  kv("Gang", inv.gang);
  kv("Customer", "K-S Construction Group (company details to be confirmed)");
  y -= 10;
  const cols = [40, 110, 160, 330, 410, 555];
  page.drawRectangle({ x: 36, y: y - 4, width: 523, height: 18, color: charcoal });
  ["Week end", "Claim", "Site / job / plot", "Work", "", "Amount"].forEach((h, i) => text(h, cols[i] + (i === 5 ? -40 : 0), y, 8, bold, rgb(1, 1, 1)));
  y -= 20;
  for (const l of lines) {
    if (y < 120) { page = doc.addPage([595, 842]); y = 780; }
    text(l.week_ending, cols[0], y, 8); text(l.claim, cols[1], y, 8);
    text(`${l.site} / ${l.job}${l.plot ? ` / ${l.plot}` : ""}`.slice(0, 40), cols[2], y, 8);
    text(l.claim_type, cols[3], y, 8);
    const amt = `GBP ${Number(l.amount).toFixed(2)}`;
    text(amt, cols[5] - font.widthOfTextAtSize(amt, 8), y, 8);
    y -= 14;
  }
  y -= 6;
  page.drawLine({ start: { x: 330, y: y + 8 }, end: { x: 559, y: y + 8 }, thickness: 1, color: orange });
  const tot = `GBP ${Number(inv.total).toFixed(2)}`;
  text("Total gross", 330, y - 6, 11, bold);
  text(tot, 555 - bold.widthOfTextAtSize(tot, 11), y - 6, 11, bold);
  const note = [
    "VAT, CIS deductions, net payment and any self-billing arrangement are not calculated or stated here.",
    "The accountant must confirm the tax treatment, supplier details and invoice wording before issue.",
  ];
  note.forEach((n, i) => text(n, 40, 70 - i * 12, 8, font, rgb(0.42, 0.4, 0.4)));
  return { pdf: await doc.save(), number: inv.number, payee_id: inv.payee_id, gang_id: inv.gang_id };
}
