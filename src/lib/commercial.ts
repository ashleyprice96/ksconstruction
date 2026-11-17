import "server-only";
import type { PoolClient } from "pg";
import { commercialConnection } from "./db";
import type { User } from "./auth";

// The ONLY module that touches client rates, client values and margin.
// Every call: (1) opens a transaction on the commercial login, (2) stamps the
// user id, (3) asks the database whether that user is on the named list,
// (4) logs the access, and only then runs the query. The database repeats the
// named-list check through row-level security, so a mistake here still leaks nothing.

export class NotNamedUser extends Error {
  constructor() { super("Not available."); }
}

export async function isNamedUser(user: User | null): Promise<boolean> {
  if (!user) return false;
  const c = await commercialConnection();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('ks.user_id', $1, true)", [user.id]);
    const r = await c.query<{ ok: boolean }>("SELECT commercial.is_named_user() AS ok");
    await c.query("COMMIT");
    return r.rows[0]?.ok === true;
  } catch {
    await c.query("ROLLBACK");
    return false;
  } finally {
    c.release();
  }
}

export async function withCommercial<T>(
  user: User, action: string, detail: Record<string, unknown>, fn: (db: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await commercialConnection();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('ks.user_id', $1, true)", [user.id]);
    const ok = (await c.query<{ ok: boolean }>("SELECT commercial.is_named_user() AS ok")).rows[0]?.ok;
    if (!ok) throw new NotNamedUser();
    await c.query("INSERT INTO commercial.access_log (user_id, action, detail) VALUES ($1, $2, $3)", [user.id, action, JSON.stringify(detail)]);
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

export interface MarginRow {
  key: string; label: string; gang_cost: string; client_value: string; margin: string; margin_pct: string | null; unpriced_lines: string;
}

const GROUPS = {
  gang: { col: "v.gang_id", label: "g.name", join: "JOIN ops.gangs g ON g.id = v.gang_id" },
  site: { col: "v.site_id", label: "s.name", join: "JOIN ops.sites s ON s.id = v.site_id" },
  client: { col: "v.client_id", label: "cl.name", join: "JOIN ops.clients cl ON cl.id = v.client_id" },
  week: { col: "v.week_ending", label: "to_char(v.week_ending, 'YYYY-MM-DD')", join: "" },
} as const;
export type MarginGroup = keyof typeof GROUPS;

export async function marginBy(user: User, group: MarginGroup, from: string, to: string): Promise<MarginRow[]> {
  const g = GROUPS[group];
  return withCommercial(user, "view_margin", { group, from, to }, async (db) =>
    (await db.query<MarginRow>(
      `SELECT ${g.col}::text AS key, ${g.label} AS label,
         sum(coalesce(v.gang_value, 0))::numeric(14,2)::text AS gang_cost,
         sum(coalesce(v.client_value, 0))::numeric(14,2)::text AS client_value,
         (sum(coalesce(v.client_value, 0)) - sum(coalesce(v.gang_value, 0)))::numeric(14,2)::text AS margin,
         CASE WHEN sum(coalesce(v.client_value, 0)) > 0 THEN
           round((sum(coalesce(v.client_value, 0)) - sum(coalesce(v.gang_value, 0))) / sum(v.client_value) * 100, 1)::text END AS margin_pct,
         count(*) FILTER (WHERE v.client_value IS NULL)::text AS unpriced_lines
       FROM commercial.claim_line_values v ${g.join}
       WHERE v.status IN ('awaiting_management', 'approved', 'paid') AND v.week_ending BETWEEN $1 AND $2
       GROUP BY 1, 2 ORDER BY 2`, [from, to])).rows);
}

export async function marginDetail(user: User, from: string, to: string) {
  return withCommercial(user, "export_margin", { from, to }, async (db) =>
    (await db.query<Record<string, string | null>>(
      `SELECT to_char(v.week_ending, 'YYYY-MM-DD') AS week_ending, cl.name AS client, s.name AS site, g.name AS gang,
         v.ref AS claim, v.claim_type::text AS claim_type, v.description, v.quantity::text AS quantity,
         v.gang_value::text AS gang_cost, v.client_rate::text AS client_rate, v.client_value::text AS client_value,
         (v.client_value - v.gang_value)::numeric(14,2)::text AS margin
       FROM commercial.claim_line_values v
       JOIN ops.clients cl ON cl.id = v.client_id JOIN ops.sites s ON s.id = v.site_id JOIN ops.gangs g ON g.id = v.gang_id
       WHERE v.status IN ('awaiting_management', 'approved', 'paid') AND v.week_ending BETWEEN $1 AND $2
       ORDER BY v.week_ending, cl.name, s.name, g.name, v.ref`, [from, to])).rows);
}

export async function listClientRates(user: User) {
  return withCommercial(user, "view_client_rates", {}, async (db) =>
    (await db.query<{ id: string; client: string; site: string | null; item: string; unit: string; rate: string; effective_from: string }>(
      `SELECT r.id, cl.name AS client, s.name AS site, i.name AS item, i.unit, r.rate::text AS rate,
         to_char(r.effective_from, 'YYYY-MM-DD') AS effective_from
       FROM commercial.client_rates r JOIN ops.clients cl ON cl.id = r.client_id
       JOIN ops.rate_items i ON i.id = r.item_id LEFT JOIN ops.sites s ON s.id = r.site_id
       ORDER BY cl.name, s.name NULLS FIRST, i.sort, r.effective_from DESC`)).rows);
}

export async function addClientRate(user: User, input: { clientId: string; siteId: string | null; itemId: string; rate: number; effectiveFrom: string }) {
  return withCommercial(user, "edit_client_rate", input, async (db) => {
    await db.query(
      `INSERT INTO commercial.client_rates (client_id, site_id, item_id, rate, effective_from, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
      [input.clientId, input.siteId, input.itemId, input.rate, input.effectiveFrom, user.id]);
  });
}

export async function listClientLiftValues(user: User) {
  return withCommercial(user, "view_client_lift_values", {}, async (db) =>
    (await db.query<{ client: string; house_type: string; lift: string; value: string; effective_from: string }>(
      `SELECT cl.name AS client, h.name AS house_type, l.name AS lift, v.value::text AS value, to_char(v.effective_from, 'YYYY-MM-DD') AS effective_from
       FROM commercial.client_lift_values v JOIN ops.clients cl ON cl.id = v.client_id
       JOIN ops.lifts l ON l.id = v.lift_id JOIN ops.house_types h ON h.id = l.house_type_id
       ORDER BY cl.name, h.name, l.sort, v.effective_from DESC`)).rows);
}

export async function addClientLiftValue(user: User, input: { clientId: string; liftId: string; value: number; effectiveFrom: string }) {
  return withCommercial(user, "edit_client_lift_value", input, async (db) => {
    await db.query("INSERT INTO commercial.client_lift_values (client_id, lift_id, value, effective_from) VALUES ($1, $2, $3, $4)",
      [input.clientId, input.liftId, input.value, input.effectiveFrom]);
  });
}
