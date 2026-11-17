import "server-only";
import { q } from "./db";
import { buildSignedRecord, type SignedRow } from "./signed-record";

export async function alertSignedRecord(alertId: string): Promise<Uint8Array | null> {
  const rows = await q<{
    title: string; kind: string; revision: string; content_sha256: string | null;
    person: string; acknowledged_at: string | null; ip: string | null; user_agent: string | null;
    signature_name: string | null; signature_png: Buffer | null; attendees: string | null;
  }>(
    `SELECT a.title, a.kind, a.revision, a.content_sha256, u.name AS person, k.acknowledged_at, k.ip, k.user_agent,
            k.signature_name, k.signature_png,
            (SELECT string_agg(m.name, ', ' ORDER BY m.name) FROM ops.hs_attendees t JOIN ops.gang_members m ON m.id = t.member_id
              WHERE t.alert_id = a.id AND t.user_id = u.id) AS attendees
     FROM ops.hs_alerts a
     JOIN ops.hs_acknowledgements k ON k.alert_id = a.id
     JOIN ops.users u ON u.id = k.user_id
     WHERE a.id = $1 ORDER BY k.acknowledged_at`, [alertId]);
  if (!rows.length) return null;
  const first = rows[0];
  return buildSignedRecord({
    heading: first.kind === "toolbox" ? "Toolbox talk" : "Health and safety alert",
    title: first.title,
    revision: first.revision,
    sha256: first.content_sha256,
    rows: rows.map(toRow),
  });
}

export async function ramsSignedRecord(ramsId: string): Promise<Uint8Array | null> {
  const rows = await q<{
    title: string; revision: string; content_sha256: string; site: string;
    person: string; acknowledged_at: string | null; ip: string | null; user_agent: string | null;
    signature_name: string | null; signature_png: Buffer | null; attendees: string | null;
  }>(
    `SELECT r.title, r.revision, r.content_sha256, s.name AS site, u.name AS person, k.acknowledged_at, k.ip, k.user_agent,
            k.signature_name, k.signature_png,
            (SELECT string_agg(m.name, ', ' ORDER BY m.name) FROM ops.rams_attendees t JOIN ops.gang_members m ON m.id = t.member_id
              WHERE t.rams_id = r.id AND t.user_id = u.id) AS attendees
     FROM ops.site_rams r
     JOIN ops.sites s ON s.id = r.site_id
     JOIN ops.rams_acknowledgements k ON k.rams_id = r.id
     JOIN ops.users u ON u.id = k.user_id
     WHERE r.id = $1 ORDER BY k.acknowledged_at`, [ramsId]);
  if (!rows.length) return null;
  const first = rows[0];
  return buildSignedRecord({
    heading: `Site RAMS · ${first.site}`,
    title: first.title,
    revision: first.revision,
    sha256: first.content_sha256,
    rows: rows.map(toRow),
  });
}

function toRow(row: { person: string; acknowledged_at: string | null; ip: string | null; user_agent: string | null; signature_name: string | null; signature_png: Buffer | null; attendees: string | null }): SignedRow {
  const png = row.signature_png
    ? (Buffer.isBuffer(row.signature_png) ? row.signature_png : Buffer.from(row.signature_png))
    : null;
  return {
    name: row.person, at: row.acknowledged_at, ip: row.ip, agent: row.user_agent,
    typed: row.signature_name, png, attendees: row.attendees,
  };
}
