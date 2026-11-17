import "server-only";
import { q, q1 } from "./db";
import type { User } from "./auth";
import { checkFile, saveFile } from "./files";

export interface SafetyAlert {
  id: string;
  title: string;
  body: string;
  attachment_name: string | null;
  attachment_mime: string | null;
  published_at: string;
}

/** Active alerts this gang lead has not confirmed. Office users are never blocked. */
export async function pendingSafetyAlerts(user: User): Promise<SafetyAlert[]> {
  if (user.role !== "gang") return [];
  return q<SafetyAlert>(
    `SELECT a.id, a.title, a.body, a.attachment_name, a.attachment_mime, a.published_at
     FROM ops.hs_alerts a
     WHERE a.active AND NOT EXISTS (
       SELECT 1 FROM ops.hs_acknowledgements k WHERE k.alert_id = a.id AND k.user_id = $1)
     ORDER BY a.published_at`,
    [user.id]);
}

export async function gangMustAcknowledge(user: User): Promise<boolean> {
  return (await pendingSafetyAlerts(user)).length > 0;
}

/** Used by claim actions so a gang lead cannot submit work while an alert is outstanding. */
export async function assertSafetyCleared(user: User) {
  if (await gangMustAcknowledge(user)) {
    throw new SafetyError("Confirm the health and safety alert before continuing.");
  }
}

export class SafetyError extends Error {}

export async function safetyApiBlock(user: User | null): Promise<Response | null> {
  if (!user || user.role !== "gang") return null;
  if (user.must_change_password) return new Response("Set a new password before continuing.", { status: 403 });
  if (await gangMustAcknowledge(user)) return new Response("Confirm the health and safety alert before continuing.", { status: 403 });
  return null;
}

export async function confirmSafetyAlerts(user: User, confirmedIds: string[], ip: string) {
  const pending = await pendingSafetyAlerts(user);
  if (!pending.length) return;
  const chosen = new Set(confirmedIds);
  if (pending.some((a) => !chosen.has(a.id))) throw new SafetyError("Tick every alert to confirm you have read and understood it.");
  const recordedIp = (ip || "unknown").slice(0, 64);
  for (const alert of pending) {
    await q(
      `INSERT INTO ops.hs_acknowledgements (alert_id, user_id, ip) VALUES ($1, $2, $3)
       ON CONFLICT (alert_id, user_id) DO NOTHING`,
      [alert.id, user.id, recordedIp]);
  }
}

export async function publishSafetyAlert(user: User, input: { title: string; body: string; active: boolean; file: File | null }) {
  if (user.role !== "management" && user.role !== "admin") throw new SafetyError("Management only.");
  if (input.title.trim().length < 3 || input.body.trim().length < 3) throw new SafetyError("Enter a title and the alert text.");
  let key: string | null = null;
  let name: string | null = null;
  let mime: string | null = null;
  if (input.file && input.file.size > 0) {
    const err = checkFile(input.file, true);
    if (err) throw new SafetyError(err);
    key = await saveFile(Buffer.from(await input.file.arrayBuffer()), input.file.type);
    name = input.file.name.slice(0, 200);
    mime = input.file.type;
  }
  await q(
    `INSERT INTO ops.hs_alerts (title, body, active, attachment_key, attachment_name, attachment_mime, published_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [input.title.trim().slice(0, 200), input.body.trim().slice(0, 10000), input.active, key, name, mime, user.id]);
}

export async function setSafetyAlertActive(user: User, alertId: string, active: boolean) {
  if (user.role !== "management" && user.role !== "admin") throw new SafetyError("Management only.");
  await q("UPDATE ops.hs_alerts SET active = $2 WHERE id = $1", [alertId, active]);
}

export interface SafetyRoster {
  id: string;
  title: string;
  body: string;
  active: boolean;
  published_at: string;
  attachment_name: string | null;
  people: { name: string; acknowledged_at: string | null; ip: string | null }[];
}

export async function safetyRoster(): Promise<SafetyRoster[]> {
  const rows = await q<{
    id: string; title: string; body: string; active: boolean; published_at: string; attachment_name: string | null;
    person: string; acknowledged_at: string | null; ip: string | null;
  }>(
    `SELECT a.id, a.title, a.body, a.active, a.published_at, a.attachment_name,
            u.name AS person, k.acknowledged_at, k.ip
     FROM ops.hs_alerts a
     JOIN ops.users u ON u.role = 'gang' AND u.active
     LEFT JOIN ops.hs_acknowledgements k ON k.alert_id = a.id AND k.user_id = u.id
     ORDER BY a.published_at DESC, u.name`);
  const byId = new Map<string, SafetyRoster>();
  for (const row of rows) {
    let alert = byId.get(row.id);
    if (!alert) {
      alert = { id: row.id, title: row.title, body: row.body, active: row.active, published_at: row.published_at, attachment_name: row.attachment_name, people: [] };
      byId.set(row.id, alert);
    }
    alert.people.push({ name: row.person, acknowledged_at: row.acknowledged_at, ip: row.ip });
  }
  return [...byId.values()];
}

export async function safetyFile(user: User, alertId: string) {
  return q1<{ attachment_key: string; attachment_name: string; attachment_mime: string; active: boolean }>(
    `SELECT attachment_key, attachment_name, attachment_mime, active FROM ops.hs_alerts
     WHERE id = $1 AND attachment_key IS NOT NULL`,
    [alertId]).then((row) => {
      if (!row) return null;
      if (user.role === "gang" && !row.active) return null;
      return row;
    });
}
