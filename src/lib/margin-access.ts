import "server-only";
import { commercialConnection } from "./db";
import { isNamedUser, NotNamedUser } from "./commercial";
import type { User } from "./auth";

export class MarginAccessError extends Error {}

function assertNamedAdmin(user: User) {
  if (user.role !== "admin") throw new MarginAccessError("Only an administrator on the named list can change margin access.");
}

/** Add or remove someone. The database repeats the named-list administrator check. */
export async function changeNamedList(actor: User, targetId: string, op: "add" | "remove", reason: string) {
  assertNamedAdmin(actor);
  if (!(await isNamedUser(actor))) throw new NotNamedUser();
  if (reason.trim().length < 3) throw new MarginAccessError("Enter a short reason.");
  if (op === "remove" && targetId === actor.id) throw new MarginAccessError("You cannot remove yourself.");
  const c = await commercialConnection();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('ks.user_id', $1, true)", [actor.id]);
    await c.query("SELECT commercial.manage_named_list($1, $2, $3)", [targetId, op, reason.trim()]);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
    if (code === "42501") throw new MarginAccessError("You cannot change the named list.");
    if (code === "22023") throw new MarginAccessError(e instanceof Error ? e.message : "Check the person and the reason.");
    throw e;
  } finally {
    c.release();
  }
}

export interface NamedMember {
  user_id: string; name: string; email: string | null; username: string | null; role: string;
  added_at: string; added_by: string; reason: string;
}
export interface NamedHistory {
  at: string; name: string; action: string; changed_by: string; reason: string;
}

export async function namedListForAdmin(actor: User): Promise<{ members: NamedMember[]; history: NamedHistory[] }> {
  assertNamedAdmin(actor);
  if (!(await isNamedUser(actor))) throw new NotNamedUser();
  const c = await commercialConnection();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('ks.user_id', $1, true)", [actor.id]);
    const members = (await c.query<NamedMember>(
      `SELECT a.user_id, u.name, u.email, u.username, u.role::text, a.added_at, a.added_by, a.reason
       FROM commercial.access_list a JOIN ops.users u ON u.id = a.user_id
       ORDER BY u.name`)).rows;
    const history = (await c.query<NamedHistory>(
      `SELECT h.at, u.name, h.action, h.changed_by, h.reason
       FROM commercial.access_list_history h JOIN ops.users u ON u.id = h.user_id
       ORDER BY h.at DESC LIMIT 40`)).rows;
    await c.query("COMMIT");
    return { members, history };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
