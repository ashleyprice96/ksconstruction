import "server-only";
import { q, q1, tx } from "./db";
import type { User } from "./auth";
import { audit } from "./audit";
import { checkFile, saveFile } from "./files";

export class IssueError extends Error {}

const canRaise = (u: User) => u.role === "contracts_manager" || u.role === "management" || u.role === "admin";

export async function loadIssue(user: User, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new IssueError("Not found.");
  const i = await q1<{ id: string; kind: string; title: string; description: string; priority: string; status: string; due_date: string | null;
    site: string; plot: string | null; gang: string | null; gang_id: string | null; raised_by: string; created_at: string; closed_at: string | null }>(
    `SELECT i.id, i.kind, i.title, i.description, i.priority, i.status, to_char(i.due_date, 'YYYY-MM-DD') AS due_date, s.name AS site,
       p.plot_number AS plot, g.name AS gang, i.gang_id, u.name AS raised_by, i.created_at, i.closed_at
     FROM ops.issues i JOIN ops.sites s ON s.id = i.site_id LEFT JOIN ops.plots p ON p.id = i.plot_id LEFT JOIN ops.gangs g ON g.id = i.gang_id
     JOIN ops.users u ON u.id = i.raised_by WHERE i.id = $1`, [id]);
  if (!i || (user.role === "gang" && i.gang_id !== user.gang_id)) throw new IssueError("Not found.");
  return i;
}

export async function raiseIssue(user: User, input: { kind: string; siteId: string; plotId: string | null; gangId: string | null; title: string; description: string; priority: string; dueDate: string | null }, photos: File[]) {
  if (!canRaise(user)) throw new IssueError("Only contracts managers and management can raise issues.");
  if (!["snag", "safety"].includes(input.kind) || !["low", "normal", "high"].includes(input.priority)) throw new IssueError("Choose the type and priority.");
  if (input.title.length < 3) throw new IssueError("Give the issue a title.");
  for (const p of photos) { const err = checkFile(p, false); if (err) throw new IssueError(err); }
  const keys = await Promise.all(photos.map(async (p) => ({ key: await saveFile(Buffer.from(await p.arrayBuffer()), p.type), p })));
  return tx(async (db) => {
    const r = await db.query<{ id: string }>(
      `INSERT INTO ops.issues (kind, site_id, plot_id, gang_id, title, description, priority, due_date, raised_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [input.kind, input.siteId, input.plotId, input.gangId, input.title.slice(0, 200), input.description.slice(0, 5000), input.priority, input.dueDate, user.id]);
    const id = r.rows[0].id;
    for (const { key, p } of keys) {
      await db.query(`INSERT INTO ops.attachments (issue_id, kind, storage_key, original_name, mime, size_bytes, uploaded_by) VALUES ($1, 'issue_photo', $2, $3, $4, $5, $6)`,
        [id, key, p.name.slice(0, 200), p.type, p.size, user.id]);
    }
    await audit(user.id, "issue", id, "raised", { kind: input.kind, title: input.title }, db);
    return id;
  });
}

/** Gangs can comment, add photos and mark ready to close; only CM or management close or reopen. */
export async function updateIssue(user: User, id: string, note: string, newStatus: string | null, photos: File[]) {
  const issue = await loadIssue(user, id);
  if (issue.status === "closed" && !(canRaise(user) && newStatus === "open")) throw new IssueError("This issue is closed.");
  const allowed = user.role === "gang" ? ["in_progress", "ready_to_close"] : ["open", "in_progress", "ready_to_close", "closed"];
  if (newStatus && !allowed.includes(newStatus)) throw new IssueError("You cannot set that status.");
  if (!note && !newStatus && !photos.length) throw new IssueError("Add a note, a photo or a status change.");
  for (const p of photos) { const err = checkFile(p, false); if (err) throw new IssueError(err); }
  const keys = await Promise.all(photos.map(async (p) => ({ key: await saveFile(Buffer.from(await p.arrayBuffer()), p.type), p })));
  await tx(async (db) => {
    await db.query("INSERT INTO ops.issue_updates (issue_id, user_id, note, new_status) VALUES ($1, $2, $3, $4)", [id, user.id, note.slice(0, 5000), newStatus]);
    if (newStatus) await db.query("UPDATE ops.issues SET status = $2, closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE NULL END WHERE id = $1", [id, newStatus]);
    for (const { key, p } of keys) {
      await db.query(`INSERT INTO ops.attachments (issue_id, kind, storage_key, original_name, mime, size_bytes, uploaded_by) VALUES ($1, 'issue_photo', $2, $3, $4, $5, $6)`,
        [id, key, p.name.slice(0, 200), p.type, p.size, user.id]);
    }
    await audit(user.id, "issue", id, "updated", { status: newStatus }, db);
  });
}

export { canRaise };
