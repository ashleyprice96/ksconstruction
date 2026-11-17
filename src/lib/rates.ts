import "server-only";
import type { PoolClient } from "pg";
import { q } from "./db";

export interface ResolvedRate { rate: string; source: string }

/**
 * Gang pay rate for an item. The site rate card applies, unless this gang has
 * an override for that site (or an older individual agreed rate), which wins.
 * Client charge rates are never read here.
 */
export async function resolveGangRate(
  c: PoolClient, gangId: string, siteId: string, itemId: string, workDate: string,
): Promise<ResolvedRate | null> {
  const r = await c.query<{ rate: string; source: string }>(
    `SELECT rate::text, source FROM (
       SELECT gr.rate, 'Gang override' AS source, gr.effective_from, 1 AS priority
       FROM ops.gang_site_rates gr
       WHERE gr.gang_id = $1 AND gr.site_id = $2 AND gr.item_id = $3 AND gr.effective_from <= $4::date
       UNION ALL
       SELECT gr.rate, 'Gang override' AS source, gr.effective_from, 2 AS priority
       FROM ops.gang_rates gr
       JOIN ops.rate_sets rs ON rs.id = gr.rate_set_id
       JOIN ops.gangs g ON g.individual_rate_set_id = rs.id
       WHERE g.id = $1 AND gr.item_id = $3 AND gr.effective_from <= $4::date
       UNION ALL
       SELECT sr.rate, 'Site rate card', sr.effective_from, 3
       FROM ops.site_rates sr
       WHERE sr.site_id = $2 AND sr.item_id = $3 AND sr.effective_from <= $4::date
     ) rates
     ORDER BY priority, effective_from DESC LIMIT 1`,
    [gangId, siteId, itemId, workDate]);
  return r.rows[0] ?? null;
}

/** Gang value of a lift: the site price when one is set, otherwise the house-type value. */
export async function resolveLiftValue(c: PoolClient, siteId: string, liftId: string, workDate: string): Promise<{ value: string; source: string } | null> {
  const site = await c.query<{ gang_value: string }>(
    `SELECT gang_value::text FROM ops.site_lift_values
     WHERE site_id = $1 AND lift_id = $2 AND effective_from <= $3::date
     ORDER BY effective_from DESC LIMIT 1`, [siteId, liftId, workDate]);
  if (site.rows[0]) return { value: site.rows[0].gang_value, source: "Site lift price" };
  const general = await c.query<{ gang_value: string }>(
    `SELECT gang_value::text FROM ops.lift_values WHERE lift_id = $1 AND effective_from <= $2::date
     ORDER BY effective_from DESC LIMIT 1`, [liftId, workDate]);
  return general.rows[0] ? { value: general.rows[0].gang_value, source: "Lift value" } : null;
}

export interface CardLine { site_id: string; item_id: string; name: string; unit: string; rate: string; source: string }

/** Gang pay rates a lead would see for every active site. No commercial tables. */
export async function gangRateCard(gangId: string, workDate: string): Promise<CardLine[]> {
  return q<CardLine>(
    `SELECT s.id AS site_id, i.id AS item_id, i.name, i.unit, rates.rate::text AS rate, rates.source
     FROM ops.sites s
     JOIN ops.rate_items i ON i.active
     JOIN LATERAL (
       SELECT rate, source, effective_from FROM (
         SELECT gr.rate, 'Gang override' AS source, gr.effective_from, 1 AS priority
         FROM ops.gang_site_rates gr
         WHERE gr.gang_id = $1 AND gr.site_id = s.id AND gr.item_id = i.id AND gr.effective_from <= $2::date
         UNION ALL
         SELECT gr.rate, 'Gang override', gr.effective_from, 2
         FROM ops.gang_rates gr
         JOIN ops.gangs g ON g.individual_rate_set_id = gr.rate_set_id
         WHERE g.id = $1 AND gr.item_id = i.id AND gr.effective_from <= $2::date
         UNION ALL
         SELECT sr.rate, 'Site rate card', sr.effective_from, 3
         FROM ops.site_rates sr
         WHERE sr.site_id = s.id AND sr.item_id = i.id AND sr.effective_from <= $2::date
       ) x ORDER BY priority, effective_from DESC LIMIT 1
     ) rates ON true
     WHERE s.active
     ORDER BY s.name, i.sort, i.name`,
    [gangId, workDate]);
}

export interface LiftCardLine { site_id: string; name: string; house_type: string; value: string; source: string }

export async function gangLiftCard(workDate: string): Promise<LiftCardLine[]> {
  return q<LiftCardLine>(
    `SELECT s.id AS site_id, l.name, h.name AS house_type, priced.value, priced.source
     FROM ops.sites s
     JOIN ops.lifts l ON true
     JOIN ops.house_types h ON h.id = l.house_type_id
     JOIN LATERAL (
       SELECT value, source FROM (
         SELECT sv.gang_value::text AS value, 'Site lift price' AS source, sv.effective_from, 1 AS priority
         FROM ops.site_lift_values sv
         WHERE sv.site_id = s.id AND sv.lift_id = l.id AND sv.effective_from <= $1::date
         UNION ALL
         SELECT lv.gang_value::text, 'Lift value', lv.effective_from, 2
         FROM ops.lift_values lv
         WHERE lv.lift_id = l.id AND lv.effective_from <= $1::date
       ) x ORDER BY priority, effective_from DESC LIMIT 1
     ) priced ON true
     WHERE s.active
     ORDER BY s.name, h.name, l.sort, l.name`,
    [workDate]);
}
