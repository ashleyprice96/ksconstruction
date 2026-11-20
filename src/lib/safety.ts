import "server-only";
import { q, q1 } from "./db";
import type { User } from "./auth";
import { checkFile, saveFile } from "./files";
import { sha256, signaturePng } from "./sign-off";
import { assertHsPdfSize, pdfPageCount } from "./hs-pdf";
import { storageDriver } from "./object-store";
import { claimsEnabled } from "./features";

export type SafetyKind = "alert" | "toolbox";

export interface SafetyAlert {
  id: string;
  kind: SafetyKind;
  title: string;
  body: string;
  attachment_name: string | null;
  attachment_mime: string | null;
  pdf_pages: number | null;
  published_at: string;
  due_on: string | null;
  sites: string | null;
}

const TARGET = `(
  NOT EXISTS (SELECT 1 FROM ops.hs_alert_sites s WHERE s.alert_id = a.id)
  OR $2::uuid IS NULL
  OR $3::boolean = false
  OR EXISTS (
    SELECT 1 FROM ops.hs_alert_sites s
    JOIN ops.claims c ON c.site_id = s.site_id AND c.gang_id = $2 AND c.deleted_at IS NULL
    WHERE s.alert_id = a.id))`;

/** Active alerts and toolbox talks this person has not signed. Every login is included. */
export async function pendingSafetyAlerts(user: User): Promise<SafetyAlert[]> {
  return q<SafetyAlert>(
    `SELECT a.id, a.kind, a.title, a.body, a.attachment_name, a.attachment_mime, a.pdf_pages, a.published_at,
            to_char(a.due_on, 'YYYY-MM-DD') AS due_on,
            (SELECT string_agg(si.name, ', ' ORDER BY si.name)
               FROM ops.hs_alert_sites s JOIN ops.sites si ON si.id = s.site_id
              WHERE s.alert_id = a.id) AS sites
     FROM ops.hs_alerts a
     WHERE a.active AND NOT EXISTS (
       SELECT 1 FROM ops.hs_acknowledgements k WHERE k.alert_id = a.id AND k.user_id = $1)
       AND ${TARGET}
     ORDER BY a.published_at`,
    [user.id, user.gang_id, claimsEnabled()]);
}

export async function gangMustAcknowledge(user: User): Promise<boolean> {
  return (await pendingSafetyAlerts(user)).length > 0;
}

export async function assertSafetyCleared(user: User) {
  if (await gangMustAcknowledge(user)) {
    throw new SafetyError("Confirm the health and safety item before continuing.");
  }
}

export class SafetyError extends Error {}

export async function safetyApiBlock(user: User | null): Promise<Response | null> {
  if (!user) return null;
  if (user.must_change_password) return new Response("Set a new password before continuing.", { status: 403 });
  if (await gangMustAcknowledge(user)) return new Response("Confirm the health and safety item before continuing.", { status: 403 });
  return null;
}

export interface SafetyConfirmation {
  id: string;
  signatureName: string;
  signaturePng: string;
  opened: boolean;
  attendeeIds: string[];
}

export async function confirmSafetyAlerts(user: User, items: SafetyConfirmation[], ip: string, userAgent: string) {
  const pending = await pendingSafetyAlerts(user);
  if (!pending.length) return;
  const byId = new Map(items.map((item) => [item.id, item]));
  if (pending.some((a) => !byId.has(a.id))) throw new SafetyError("Confirm every health and safety item.");
  const recordedIp = (ip || "unknown").slice(0, 64);
  const agent = (userAgent || "unknown").slice(0, 300);
  const members = user.gang_id
    ? await q<{ id: string }>("SELECT id FROM ops.gang_members WHERE gang_id = $1 AND active", [user.gang_id])
    : [];
  const memberIds = new Set(members.map((m) => m.id));
  for (const alert of pending) {
    const item = byId.get(alert.id)!;
    const signature = item.signatureName.trim().replace(/\s+/g, " ");
    if (signature.length < 3) throw new SafetyError("Type your name to sign.");
    let png: Buffer;
    try { png = signaturePng(item.signaturePng); }
    catch (e) { throw new SafetyError(e instanceof Error ? e.message : "Draw your signature."); }
    if (alert.attachment_mime === "application/pdf" && !item.opened) throw new SafetyError("Open the PDF before you sign.");
    if (alert.kind === "toolbox" && item.attendeeIds.some((id) => !memberIds.has(id))) {
      throw new SafetyError("Attendance can only include people in your gang.");
    }
    const doc = await q1<{ content_sha256: string | null; revision: string }>(
      "SELECT content_sha256, revision FROM ops.hs_alerts WHERE id = $1", [alert.id]);
    await q(
      `INSERT INTO ops.hs_acknowledgements
         (alert_id, user_id, ip, user_agent, signature_name, signature_png, content_sha256, revision)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (alert_id, user_id) DO NOTHING`,
      [alert.id, user.id, recordedIp, agent, signature.slice(0, 80), png, doc?.content_sha256 ?? null, doc?.revision ?? "1"]);
    if (alert.kind === "toolbox") {
      for (const memberId of item.attendeeIds) {
        await q(
          `INSERT INTO ops.hs_attendees (alert_id, user_id, member_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [alert.id, user.id, memberId]);
      }
    }
  }
}

function assertPublisher(user: User) {
  if (user.role !== "admin") throw new SafetyError("Only an administrator can publish health and safety items.");
}

export async function publishSafetyAlert(user: User, input: {
  kind: SafetyKind; title: string; body: string; active: boolean; dueOn: string;
  siteIds: string[]; file: File | null;
}) {
  assertPublisher(user);
  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < 3) throw new SafetyError("Enter a title.");
  const file = input.file && input.file.size > 0 ? input.file : null;
  if (!file && body.length < 3) throw new SafetyError("Add a PDF, or write the text.");
  if (input.dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn)) throw new SafetyError("Check the due date.");
  let key: string | null = null;
  let name: string | null = null;
  let mime: string | null = null;
  let bytes: Buffer | null = null;
  let pageCount: number | null = null;
  let hashed = Buffer.from(body, "utf8");
  if (file) {
    if (input.kind === "toolbox" && file.type !== "application/pdf") throw new SafetyError("A toolbox talk file must be a PDF.");
    if (file.type === "application/pdf") {
      try { assertHsPdfSize(file.size); }
      catch (e) { throw new SafetyError(e instanceof Error ? e.message : "The PDF is too large."); }
    } else {
      const err = checkFile(file, true);
      if (err) throw new SafetyError(err);
    }
    const raw = Buffer.from(await file.arrayBuffer());
    pageCount = file.type === "application/pdf" ? await pdfPageCount(raw).catch(() => null) : null;
    hashed = file.type === "application/pdf" ? raw : hashed;
    if (file.type === "application/pdf" && storageDriver() !== "s3") bytes = raw;
    else key = await saveFile(raw, file.type);
    name = file.name.slice(0, 200);
    mime = file.type;
  }
  const row = await q1<{ id: string }>(
    `INSERT INTO ops.hs_alerts (kind, title, body, active, due_on, revision, content_sha256, pdf_pages, attachment_key, attachment_name, attachment_mime, attachment_bytes, published_by)
     VALUES ($1, $2, $3, $4, $5, '1', $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [input.kind, title.slice(0, 200), body.slice(0, 10000), input.active, input.dueOn || null, sha256(hashed), pageCount, key, name, mime, bytes, user.id]);
  for (const siteId of [...new Set(input.siteIds)].filter((id) => /^[0-9a-f-]{36}$/.test(id))) {
    await q("INSERT INTO ops.hs_alert_sites (alert_id, site_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [row!.id, siteId]);
  }
}

export async function setSafetyAlertActive(user: User, alertId: string, active: boolean) {
  assertPublisher(user);
  await q("UPDATE ops.hs_alerts SET active = $2 WHERE id = $1", [alertId, active]);
}

export interface SafetyRoster {
  id: string;
  kind: SafetyKind;
  title: string;
  body: string;
  active: boolean;
  published_at: string;
  due_on: string | null;
  revision: string;
  content_sha256: string | null;
  sites: string | null;
  attachment_name: string | null;
  people: { user_id: string; name: string; acknowledged_at: string | null; ip: string | null; signature_name: string | null; signed: boolean; attendees: string | null }[];
}

export async function safetyRoster(): Promise<SafetyRoster[]> {
  const rows = await q<{
    id: string; kind: SafetyKind; title: string; body: string; active: boolean; published_at: string;
    due_on: string | null; revision: string; content_sha256: string | null; sites: string | null; attachment_name: string | null;
    person: string; user_id: string; acknowledged_at: string | null; ip: string | null; signature_name: string | null; signed: boolean; attendees: string | null;
  }>(
    `SELECT a.id, a.kind, a.title, a.body, a.active, a.published_at, to_char(a.due_on, 'YYYY-MM-DD') AS due_on,
            a.revision, a.content_sha256,
            (SELECT string_agg(si.name, ', ' ORDER BY si.name) FROM ops.hs_alert_sites s JOIN ops.sites si ON si.id = s.site_id WHERE s.alert_id = a.id) AS sites,
            a.attachment_name, u.id AS user_id, u.name AS person, k.acknowledged_at, k.ip, k.signature_name,
            (k.signature_png IS NOT NULL) AS signed,
            (SELECT string_agg(m.name, ', ' ORDER BY m.name) FROM ops.hs_attendees t JOIN ops.gang_members m ON m.id = t.member_id
              WHERE t.alert_id = a.id AND t.user_id = u.id) AS attendees
     FROM ops.hs_alerts a
     JOIN ops.users u ON u.active AND (
       NOT EXISTS (SELECT 1 FROM ops.hs_alert_sites s WHERE s.alert_id = a.id)
       OR u.gang_id IS NULL
       OR $1::boolean = false
       OR EXISTS (
         SELECT 1 FROM ops.hs_alert_sites s
         JOIN ops.claims c ON c.site_id = s.site_id AND c.gang_id = u.gang_id AND c.deleted_at IS NULL
         WHERE s.alert_id = a.id))
     LEFT JOIN ops.hs_acknowledgements k ON k.alert_id = a.id AND k.user_id = u.id
     ORDER BY a.published_at DESC, u.name`, [claimsEnabled()]);
  const byId = new Map<string, SafetyRoster>();
  for (const row of rows) {
    let alert = byId.get(row.id);
    if (!alert) {
      alert = {
        id: row.id, kind: row.kind, title: row.title, body: row.body, active: row.active, published_at: row.published_at,
        due_on: row.due_on, revision: row.revision, content_sha256: row.content_sha256, sites: row.sites, attachment_name: row.attachment_name, people: [],
      };
      byId.set(row.id, alert);
    }
    alert.people.push({
      user_id: row.user_id, name: row.person, acknowledged_at: row.acknowledged_at, ip: row.ip,
      signature_name: row.signature_name, signed: row.signed, attendees: row.attendees,
    });
  }
  return [...byId.values()];
}

export async function safetyCsv(): Promise<string> {
  const alerts = await safetyRoster();
  const esc = (v: string | null | undefined) => {
    const s = v ?? "";
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = ["Type,Title,Revision,Content SHA-256,Sites,Due,Gang lead,Confirmed,When,Typed name,Drawn signature,Attendees"];
  for (const alert of alerts) {
    for (const person of alert.people) {
      lines.push([
        alert.kind === "toolbox" ? "Toolbox talk" : "H&S alert",
        alert.title, alert.revision, alert.content_sha256 ?? "", alert.sites ?? "All sites", alert.due_on ?? "",
        person.name, person.acknowledged_at ? "Yes" : "No", person.acknowledged_at ?? "",
        person.signature_name ?? "", person.signed ? "Yes" : "No", person.attendees ?? "",
      ].map(esc).join(","));
    }
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export async function safetyFile(user: User, alertId: string) {
  const row = await q1<{ attachment_key: string | null; attachment_name: string; attachment_mime: string; attachment_bytes: Buffer | null; active: boolean }>(
    `SELECT attachment_key, attachment_name, attachment_mime, attachment_bytes, active FROM ops.hs_alerts
     WHERE id = $1 AND (attachment_bytes IS NOT NULL OR attachment_key IS NOT NULL)`,
    [alertId]);
  if (!row) return null;
  if (user.role === "gang" && !row.active) return null;
  const bytes = row.attachment_bytes
    ? (Buffer.isBuffer(row.attachment_bytes) ? row.attachment_bytes : Buffer.from(row.attachment_bytes))
    : null;
  return { ...row, bytes };
}
