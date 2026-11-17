import "server-only";
import type { PoolClient } from "pg";

export interface ResolvedRate { rate: string; source: string }

/**
 * Gang pay rate for an item on a claim. Order (ASSUMPTION, to confirm with K-S):
 *   1. the gang's individual agreed rate set
 *   2. a client-specific rate set for the claim's client (for example all MVK jobs)
 *   3. the gang's base set (KS Standard or KS Standard (North))
 * Within a set, the latest rate effective on or before the work date applies.
 * Returns null when no rate is set: the claim is then flagged, never guessed.
 */
export async function resolveGangRate(
  c: PoolClient, gangId: string, clientId: string, itemId: string, workDate: string,
): Promise<ResolvedRate | null> {
  const r = await c.query<{ rate: string; set_name: string; priority: number }>(
    `WITH g AS (SELECT individual_rate_set_id, base_rate_set_id FROM ops.gangs WHERE id = $1),
     candidates AS (
       SELECT gr.rate, rs.name AS set_name, gr.effective_from,
         CASE WHEN rs.id = (SELECT individual_rate_set_id FROM g) THEN 1
              WHEN rs.kind = 'client' AND rs.client_id = $2 THEN 2
              WHEN rs.id = (SELECT base_rate_set_id FROM g) THEN 3 END AS priority
       FROM ops.gang_rates gr JOIN ops.rate_sets rs ON rs.id = gr.rate_set_id
       WHERE gr.item_id = $3 AND gr.effective_from <= $4::date
     )
     SELECT rate, set_name, priority FROM candidates WHERE priority IS NOT NULL
     ORDER BY priority, effective_from DESC LIMIT 1`,
    [gangId, clientId, itemId, workDate]);
  const row = r.rows[0];
  return row ? { rate: row.rate, source: row.set_name } : null;
}

/** Gang value of a lift effective on the work date, or null if not set. */
export async function resolveLiftValue(c: PoolClient, liftId: string, workDate: string): Promise<string | null> {
  const r = await c.query<{ gang_value: string }>(
    `SELECT gang_value FROM ops.lift_values WHERE lift_id = $1 AND effective_from <= $2::date
     ORDER BY effective_from DESC LIMIT 1`, [liftId, workDate]);
  return r.rows[0]?.gang_value ?? null;
}
