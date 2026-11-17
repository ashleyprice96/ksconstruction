import "server-only";
import { q, q1 } from "./db";
import type { User } from "./auth";
import { sha256, signaturePng } from "./sign-off";
import { SafetyError } from "./safety";

export class RamsRequiredError extends SafetyError {
  constructor(public siteId: string) {
    super("Confirm the current RAMS for this site before you claim on it.");
    this.name = "RamsRequiredError";
  }
}

export interface SiteRams {
  id: string;
  site_id: string;
  site: string;
  title: string;
  revision: string;
  content_sha256: string;
  pdf_name: string;
}

/** Active RAMS for this site that this gang lead has not confirmed. */
export async function pendingRams(user: User, siteId: string): Promise<SiteRams[]> {
  if (user.role !== "gang") return [];
  return q<SiteRams>(
    `SELECT r.id, r.site_id, s.name AS site, r.title, r.revision, r.content_sha256, r.pdf_name
     FROM ops.site_rams r JOIN ops.sites s ON s.id = r.site_id
     WHERE r.site_id = $1 AND r.active AND NOT EXISTS (
       SELECT 1 FROM ops.rams_acknowledgements k WHERE k.rams_id = r.id AND k.user_id = $2)
     ORDER BY r.published_at`,
    [siteId, user.id]);
}

export async function assertRamsCleared(user: User, siteId: string) {
  const pending = await pendingRams(user, siteId);
  if (pending.length) throw new RamsRequiredError(siteId);
}

export async function confirmRams(user: User, input: {
  ramsId: string; signatureName: string; signaturePng: string; attendeeIds: string[]; ip: string; userAgent: string;
}) {
  if (user.role !== "gang" || !user.gang_id) throw new SafetyError("Only a gang lead confirms a RAMS.");
  const doc = await q1<{ id: string; revision: string; content_sha256: string; active: boolean }>(
    "SELECT id, revision, content_sha256, active FROM ops.site_rams WHERE id = $1", [input.ramsId]);
  if (!doc?.active) throw new SafetyError("That RAMS is not current.");
  const name = input.signatureName.trim().replace(/\s+/g, " ");
  if (name.length < 3) throw new SafetyError("Type your name to sign.");
  let png: Buffer;
  try { png = signaturePng(input.signaturePng); }
  catch (e) { throw new SafetyError(e instanceof Error ? e.message : "Draw your signature."); }
  const members = await q<{ id: string }>("SELECT id FROM ops.gang_members WHERE gang_id = $1 AND active", [user.gang_id]);
  const allowed = new Set(members.map((m) => m.id));
  if (input.attendeeIds.some((id) => !allowed.has(id))) throw new SafetyError("Briefed people must be in your gang.");
  await q(
    `INSERT INTO ops.rams_acknowledgements
       (rams_id, user_id, ip, user_agent, signature_name, signature_png, content_sha256, revision)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (rams_id, user_id) DO NOTHING`,
    [doc.id, user.id, (input.ip || "unknown").slice(0, 64), (input.userAgent || "unknown").slice(0, 300),
      name.slice(0, 80), png, doc.content_sha256, doc.revision]);
  for (const memberId of input.attendeeIds) {
    await q(
      "INSERT INTO ops.rams_attendees (rams_id, user_id, member_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [doc.id, user.id, memberId]);
  }
}

export async function publishRams(user: User, input: { siteId: string; title: string; revision: string; active: boolean; file: File }) {
  if (user.role !== "admin") throw new SafetyError("Only an administrator can publish a RAMS.");
  const title = input.title.trim();
  const revision = input.revision.trim();
  if (title.length < 3 || revision.length < 1) throw new SafetyError("Enter a title and a revision.");
  if (!input.file || input.file.size === 0 || input.file.type !== "application/pdf") throw new SafetyError("Upload the RAMS as a PDF.");
  if (input.file.size > 6 * 1024 * 1024) throw new SafetyError("The PDF must be 6 MB or smaller.");
  const bytes = Buffer.from(await input.file.arrayBuffer());
  await q(
    `INSERT INTO ops.site_rams (site_id, title, revision, active, pdf_name, pdf_bytes, content_sha256, published_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [input.siteId, title.slice(0, 200), revision.slice(0, 40), input.active, input.file.name.slice(0, 200), bytes, sha256(bytes), user.id]);
}

export interface RamsRoster {
  id: string;
  site: string;
  title: string;
  revision: string;
  active: boolean;
  content_sha256: string;
  published_at: string;
  people: { user_id: string; name: string; acknowledged_at: string | null; signature_name: string | null; signed: boolean; attendees: string | null }[];
}

export async function ramsRoster(): Promise<RamsRoster[]> {
  const rows = await q<{
    id: string; site: string; title: string; revision: string; active: boolean; content_sha256: string; published_at: string;
    user_id: string; person: string; acknowledged_at: string | null; signature_name: string | null; signed: boolean; attendees: string | null;
  }>(
    `SELECT r.id, s.name AS site, r.title, r.revision, r.active, r.content_sha256, r.published_at,
            u.id AS user_id, u.name AS person, k.acknowledged_at, k.signature_name,
            (k.signature_png IS NOT NULL) AS signed,
            (SELECT string_agg(m.name, ', ' ORDER BY m.name) FROM ops.rams_attendees t JOIN ops.gang_members m ON m.id = t.member_id
              WHERE t.rams_id = r.id AND t.user_id = u.id) AS attendees
     FROM ops.site_rams r
     JOIN ops.sites s ON s.id = r.site_id
     JOIN ops.users u ON u.role = 'gang' AND u.active
     LEFT JOIN ops.rams_acknowledgements k ON k.rams_id = r.id AND k.user_id = u.id
     ORDER BY s.name, r.published_at DESC, u.name`);
  const byId = new Map<string, RamsRoster>();
  for (const row of rows) {
    let item = byId.get(row.id);
    if (!item) {
      item = {
        id: row.id, site: row.site, title: row.title, revision: row.revision, active: row.active,
        content_sha256: row.content_sha256, published_at: row.published_at, people: [],
      };
      byId.set(row.id, item);
    }
    item.people.push({
      user_id: row.user_id, name: row.person, acknowledged_at: row.acknowledged_at,
      signature_name: row.signature_name, signed: row.signed, attendees: row.attendees,
    });
  }
  return [...byId.values()];
}

export async function ramsCsv(): Promise<string> {
  const items = await ramsRoster();
  const esc = (v: string | null | undefined) => {
    const s = v ?? "";
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = ["Site,Title,Revision,Content SHA-256,Gang lead,Confirmed,When,Typed name,Drawn signature,Briefed"];
  for (const item of items) {
    for (const person of item.people) {
      lines.push([
        item.site, item.title, item.revision, item.content_sha256, person.name,
        person.acknowledged_at ? "Yes" : "No", person.acknowledged_at ?? "",
        person.signature_name ?? "", person.signed ? "Yes" : "No", person.attendees ?? "",
      ].map(esc).join(","));
    }
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export async function ramsFile(user: User, ramsId: string) {
  const row = await q1<{ pdf_bytes: Buffer; pdf_name: string; active: boolean; site_id: string }>(
    "SELECT pdf_bytes, pdf_name, active, site_id FROM ops.site_rams WHERE id = $1", [ramsId]);
  if (!row) return null;
  if (user.role === "gang" && !row.active) return null;
  const bytes = Buffer.isBuffer(row.pdf_bytes) ? row.pdf_bytes : Buffer.from(row.pdf_bytes);
  return { bytes, name: row.pdf_name, site_id: row.site_id };
}
