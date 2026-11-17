import "server-only";
import { q, q1 } from "./db";
import type { User } from "./auth";
import { audit } from "./audit";

/** Notices relevant to a user: all-company, their gang, or a site their gang has claimed on. */
export async function noticesFor(user: User) {
  return q<{ id: string; kind: string; title: string; body: string; version: number; published_at: string; acknowledged: boolean; site: string | null; gang: string | null }>(
    `SELECT n.id, n.kind, n.title, n.body, n.version, n.published_at, s.name AS site, g.name AS gang,
       EXISTS (SELECT 1 FROM ops.acknowledgements a WHERE a.notice_id = n.id AND a.user_id = $1 AND a.version = n.version) AS acknowledged
     FROM ops.notices n LEFT JOIN ops.sites s ON s.id = n.site_id LEFT JOIN ops.gangs g ON g.id = n.gang_id
     WHERE n.active AND (
       $2::text <> 'gang'
       OR (n.gang_id IS NULL AND n.site_id IS NULL)
       OR n.gang_id = $3
       OR n.site_id IN (SELECT site_id FROM ops.claims WHERE gang_id = $3))
     ORDER BY n.published_at DESC`, [user.id, user.role, user.gang_id]);
}

export async function acknowledge(user: User, noticeId: string) {
  const n = (await noticesFor(user)).find((x) => x.id === noticeId);
  if (!n) return;
  await q("INSERT INTO ops.acknowledgements (notice_id, user_id, version) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [noticeId, user.id, n.version]);
  await audit(user.id, "notice", noticeId, "acknowledged", { version: n.version });
}

export async function publishNotice(user: User, input: { kind: string; title: string; body: string; siteId: string | null; gangId: string | null }) {
  const r = await q1<{ id: string }>(
    "INSERT INTO ops.notices (kind, title, body, site_id, gang_id, published_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
    [input.kind, input.title.slice(0, 200), input.body.slice(0, 10000), input.siteId, input.gangId, user.id]);
  await audit(user.id, "notice", r!.id, "published", { kind: input.kind, title: input.title });
}
