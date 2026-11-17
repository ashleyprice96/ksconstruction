import "server-only";
import JSZip from "jszip";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { q } from "./db";
import { readStoredFile } from "./files";
import { fmtDate, fmtDateTime } from "./dates";

// Client backup pack: claims, measures, photos, signatures and sheets for one client
// and period. It contains NO money at all: no gang rates or values (gang top sheets
// stay internal) and no client rates, client values or margin.

export const PACK_LIMIT_BYTES = 18 * 1024 * 1024;

interface PackClaim {
  id: string; ref: string; claim_type: string; stage: string; week_ending: string; work_date: string; site: string; job: string; plot: string | null;
  house_type: string | null; gang: string; foreman_name: string | null; signed_at: string | null; approved_at: string | null; notes: string;
}

export async function packClaims(clientId: string, from: string, to: string): Promise<PackClaim[]> {
  return q<PackClaim>(
    `SELECT c.id, c.ref, c.claim_type::text, c.stage, to_char(c.week_ending, 'YYYY-MM-DD') AS week_ending, to_char(c.work_date, 'YYYY-MM-DD') AS work_date,
       s.name AS site, j.code AS job, p.plot_number AS plot, h.name AS house_type, g.name AS gang, fs.foreman_name, fs.signed_at,
       (SELECT max(a.created_at) FROM ops.approvals a WHERE a.claim_id = c.id AND a.action = 'approve') AS approved_at, c.notes
     FROM ops.claims c JOIN ops.sites s ON s.id = c.site_id JOIN ops.job_numbers j ON j.id = c.job_number_id JOIN ops.gangs g ON g.id = c.gang_id
     LEFT JOIN ops.plots p ON p.id = c.plot_id LEFT JOIN ops.house_types h ON h.id = p.house_type_id LEFT JOIN ops.foreman_signatures fs ON fs.claim_id = c.id
     WHERE c.client_id = $1 AND c.deleted_at IS NULL AND c.week_ending BETWEEN $2 AND $3 AND c.status IN ('approved', 'paid')
     ORDER BY c.week_ending, s.name, j.code, p.plot_number, c.ref`, [clientId, from, to]);
}

async function attachmentsFor(claimIds: string[]) {
  if (!claimIds.length) return [];
  return q<{ id: string; claim_id: string; kind: string; storage_key: string; original_name: string; mime: string; size_bytes: number }>(
    "SELECT id, claim_id, kind, storage_key, original_name, mime, size_bytes FROM ops.attachments WHERE claim_id = ANY($1::uuid[]) AND kind <> 'top_sheet' ORDER BY kind, uploaded_at", [claimIds]);
}

/** Greedy split of claims into parts that each stay under the size limit. */
export async function planParts(claims: PackClaim[]): Promise<PackClaim[][]> {
  const atts = await attachmentsFor(claims.map((c) => c.id));
  const parts: PackClaim[][] = [[]];
  let size = 200_000; // allowance for the summary PDF
  for (const c of claims) {
    const s = atts.filter((a) => a.claim_id === c.id).reduce((x, a) => x + a.size_bytes, 0) + 20_000;
    if (parts[parts.length - 1].length && size + s > PACK_LIMIT_BYTES) { parts.push([]); size = 200_000; }
    parts[parts.length - 1].push(c);
    size += s;
  }
  return parts;
}

async function summaryPdf(client: string, from: string, to: string, claims: PackClaim[], part: number, parts: number): Promise<Uint8Array> {
  const ids = claims.map((c) => c.id);
  const lines = ids.length ? await q<{ claim_id: string; description: string; unit: string; quantity: string }>(
    "SELECT claim_id, description, unit, quantity::text FROM ops.claim_lines WHERE claim_id = ANY($1::uuid[]) ORDER BY description", [ids]) : [];
  const walls = ids.length ? await q<{ claim_id: string; wall_ref: string; courses: number }>(
    "SELECT claim_id, wall_ref, courses FROM ops.wall_measures WHERE claim_id = ANY($1::uuid[]) ORDER BY wall_ref", [ids]) : [];
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await doc.embedPng(await readFile(join(/*turbopackIgnore: true*/ process.cwd(), "public", "ks-logo.png")));
  const charcoal = rgb(0x21 / 255, 0x1f / 255, 0x20 / 255);
  const orange = rgb(0xd3 / 255, 0x7c / 255, 0x46 / 255);
  let page = doc.addPage([595, 842]);
  let y = 0;
  const header = () => {
    page.drawRectangle({ x: 0, y: 782, width: 595, height: 60, color: charcoal });
    page.drawRectangle({ x: 0, y: 778, width: 595, height: 4, color: orange });
    page.drawImage(logo, { x: 36, y: 790, width: 44, height: 44 });
    page.drawText("CLIENT BACKUP PACK", { x: 92, y: 814, size: 15, font: bold, color: rgb(1, 1, 1) });
    page.drawText(`${client} · week endings ${fmtDate(from)} to ${fmtDate(to)}${parts > 1 ? ` · part ${part} of ${parts}` : ""}`.slice(0, 95), { x: 92, y: 797, size: 9, font, color: orange });
    y = 752;
  };
  header();
  const t = (s: string, x: number, size = 9, f = font) => page.drawText(s.slice(0, 110), { x, y, size, font: f, color: charcoal });
  for (const c of claims) {
    const cl = lines.filter((l) => l.claim_id === c.id);
    const cw = walls.filter((w) => w.claim_id === c.id);
    const need = 60 + cl.length * 12 + (cw.length ? 14 : 0);
    if (y - need < 50) { page = doc.addPage([595, 842]); header(); }
    page.drawRectangle({ x: 36, y: y - 4, width: 523, height: 16, color: rgb(0.97, 0.92, 0.87) });
    t(`${c.ref} · ${c.claim_type}${c.stage ? ` · ${c.stage}` : ""}`, 40, 10, bold); y -= 16;
    t(`Site ${c.site} · Job ${c.job}${c.plot ? ` · Plot ${c.plot}` : ""}${c.house_type ? ` · ${c.house_type}` : ""} · Gang ${c.gang}`, 40); y -= 12;
    t(`Work date ${fmtDate(c.work_date)} · Week ending ${fmtDate(c.week_ending)}`, 40); y -= 12;
    for (const l of cl) { t(`${l.description}: ${Number(l.quantity)} ${l.unit}`, 52); y -= 12; }
    if (cw.length) { t(`Courses per wall: ${cw.map((w) => `${w.wall_ref} ${w.courses}`).join(", ")}`, 52); y -= 12; }
    t(`Foreman: ${c.foreman_name ? `${c.foreman_name}, signed ${fmtDateTime(c.signed_at)}` : "not required for this claim type"} · K-S sign-off ${c.approved_at ? fmtDateTime(c.approved_at) : ""}`, 40, 8);
    y -= 20;
  }
  if (!claims.length) { t("No approved claims for this client in this period.", 40); }
  doc.getPages().forEach((p, i, all) => p.drawText(`Page ${i + 1} of ${all.length} · photos, drawings, signatures and sheets are in the claim folders of this zip`, { x: 36, y: 24, size: 7, font, color: rgb(0.45, 0.42, 0.42) }));
  return doc.save();
}

export async function buildPack(clientId: string, from: string, to: string, part: number): Promise<{ zip: Buffer; filename: string; parts: number } | null> {
  const client = (await q<{ name: string }>("SELECT name FROM ops.clients WHERE id = $1", [clientId]))[0];
  if (!client) return null;
  const parts = await planParts(await packClaims(clientId, from, to));
  const mine = parts[part - 1];
  if (!mine) return null;
  const zip = new JSZip();
  zip.file("00-summary.pdf", await summaryPdf(client.name, from, to, mine, part, parts.length));
  const atts = await attachmentsFor(mine.map((c) => c.id));
  for (const c of mine) {
    const folder = zip.folder(`${c.ref}-${c.site}-${c.plot ? `plot-${c.plot}` : c.claim_type}`.replace(/[^\w.-]+/g, "_"))!;
    let n = 0;
    for (const a of atts.filter((x) => x.claim_id === c.id)) {
      const data = await readStoredFile(a.storage_key).catch(() => null);
      if (data) folder.file(`${String(++n).padStart(2, "0")}-${a.kind}-${a.original_name.replace(/[^\w.-]+/g, "_")}`, data);
    }
  }
  const out = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const safe = client.name.replace(/[^\w]+/g, "-");
  return { zip: out, filename: `KS-backup-${safe}-${from}-to-${to}${parts.length > 1 ? `-part${part}of${parts.length}` : ""}.zip`, parts: parts.length };
}
