// Fictional demo data for development and testing. Every name and figure here is
// made up and marked "demo". Real K-S sites, gangs and rates are NEVER put in this
// file: they go in private/seed.private.json (git-ignored), loaded by seed-private.ts.
import bcrypt from "bcryptjs";
import { enforceSharedOwnerRls, openOwner, relaxSharedOwnerRls, reportFailure } from "./script-db";

export const DEMO_PASSWORD = "demo-password-1";

// Distinctive client rates so the leak tests can search every page for them.
export const DEMO_CLIENT_RATES = { trench: "4.3217", block100: "3.1979", commons140: "2.8643", daywork: "37.4129" };
export const DEMO_CLIENT_LIFT_VALUES = { lift1: "4321.97", lift2: "3876.53", patch: "987.61" };

function nextFriday(from = new Date()): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + ((5 - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}
const plus = (iso: string, days: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

async function main() {
  const db = await openOwner();
  try {
  await relaxSharedOwnerRls(db);
  const one = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0];
  const existing = await one("SELECT count(*)::int AS n FROM ops.users");
  if (existing.n > 0 && !process.argv.includes("--force")) {
    console.log("Database already has users; not seeding. Use --force on an empty database only.");
    return;
  }
  await db.query("BEGIN");
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const clientA = (await one("INSERT INTO ops.clients (name, invoice_frequency_weeks) VALUES ('Northfield Contracting (demo)', 1) RETURNING id")).id;
  const clientB = (await one("INSERT INTO ops.clients (name, invoice_frequency_weeks, uses_own_forms) VALUES ('Riverside Civils (demo)', 2, true) RETURNING id")).id;
  const hb = (await one("INSERT INTO ops.housebuilders (name) VALUES ('Example Homes (demo)') RETURNING id")).id;
  const siteA = (await one("INSERT INTO ops.sites (name, client_id, housebuilder_id, region) VALUES ('Oak Lane (demo)', $1, $2, 'North') RETURNING id", [clientA, hb])).id;
  const siteB = (await one("INSERT INTO ops.sites (name, client_id, housebuilder_id, region) VALUES ('Mill Street (demo)', $1, $2, 'Midlands') RETURNING id", [clientB, hb])).id;
  const jobA = (await one("INSERT INTO ops.job_numbers (site_id, code) VALUES ($1, 'KS01') RETURNING id", [siteA])).id;
  const jobB = (await one("INSERT INTO ops.job_numbers (site_id, code) VALUES ($1, 'KS02') RETURNING id", [siteB])).id;
  const ht = (await one("INSERT INTO ops.house_types (name) VALUES ('Type A (demo)') RETURNING id")).id;
  for (let i = 1; i <= 6; i++) {
    await db.query("INSERT INTO ops.plots (site_id, job_number_id, house_type_id, plot_number) VALUES ($1, $2, $3, $4)", [siteA, jobA, ht, String(i)]);
    await db.query("INSERT INTO ops.plots (site_id, job_number_id, house_type_id, plot_number) VALUES ($1, $2, $3, $4)", [siteB, jobB, ht, String(100 + i)]);
  }
  const lift1 = (await one("INSERT INTO ops.lifts (house_type_id, name, sort) VALUES ($1, '1st lift (demo)', 1) RETURNING id", [ht])).id;
  const lift2 = (await one("INSERT INTO ops.lifts (house_type_id, name, sort) VALUES ($1, '2nd lift (demo)', 2) RETURNING id", [ht])).id;
  const patch = (await one("INSERT INTO ops.lifts (house_type_id, name, sort, is_patch) VALUES ($1, 'Patch (demo)', 9, true) RETURNING id", [ht])).id;
  const from = "2026-01-01";
  for (const [lift, v] of [[lift1, "3000.00"], [lift2, "2700.00"], [patch, "600.00"]]) {
    await db.query("INSERT INTO ops.lift_values (lift_id, gang_value, effective_from) VALUES ($1, $2, $3)", [lift, v, from]);
  }

  const item = async (code: string, name: string, unit: string, type: string, courses: boolean, sort: number) =>
    (await one("INSERT INTO ops.rate_items (code, name, unit, claim_type, needs_courses, sort) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
      [code, name, unit, type, courses, sort])).id;
  const trench = await item("DEMO_TRENCH", "Trench block (demo)", "block", "substructure", true, 1);
  const b100 = await item("DEMO_100", "100 mm block (demo)", "block", "substructure", true, 2);
  const c140 = await item("DEMO_140", "140 mm commons (demo)", "brick", "substructure", true, 3);
  const commons = await item("DEMO_COMMONS", "Commons (demo)", "1,000", "substructure", false, 4);
  const facings = await item("DEMO_FACINGS", "Facings (demo)", "1,000", "substructure", false, 5);
  const dw = await item("DEMO_DAYWORK", "Daywork (demo)", "hour", "daywork", false, 1);

  const std = (await one("INSERT INTO ops.rate_sets (name, kind) VALUES ('Demo Standard', 'standard') RETURNING id")).id;
  const clientSet = (await one("INSERT INTO ops.rate_sets (name, kind, client_id) VALUES ('Demo Riverside client set', 'client', $1) RETURNING id", [clientB])).id;
  const indiv = (await one("INSERT INTO ops.rate_sets (name, kind) VALUES ('Demo individual: Gang Two', 'individual') RETURNING id")).id;
  const rate = (set: string, it: string, r: string, eff = from) =>
    db.query("INSERT INTO ops.gang_rates (rate_set_id, item_id, rate, effective_from) VALUES ($1, $2, $3, $4)", [set, it, r, eff]);
  await rate(std, trench, "2.10"); await rate(std, b100, "1.55"); await rate(std, c140, "1.40"); await rate(std, dw, "19.00");
  await rate(std, trench, "2.20", plus(nextFriday(), 60)); // future uplift example
  await rate(clientSet, c140, "1.45");
  await rate(indiv, trench, "2.05");

  const siteRate = (site: string, it: string, r: string) =>
    db.query("INSERT INTO ops.site_rates (site_id, item_id, rate, effective_from) VALUES ($1, $2, $3, $4)", [site, it, r, from]);
  for (const site of [siteA, siteB]) {
    await siteRate(site, trench, "2.10");
    await siteRate(site, b100, "1.55");
    await siteRate(site, c140, "1.40");
    await siteRate(site, dw, "19.00");
    for (const [lift, v] of [[lift1, "3000.00"], [lift2, "2700.00"], [patch, "600.00"]]) {
      await db.query("INSERT INTO ops.site_lift_values (site_id, lift_id, gang_value, effective_from) VALUES ($1, $2, $3, $4)", [site, lift, v, from]);
    }
  }
  // Fictional site card: the North site is £10 higher per 1,000 on commons and facings.
  await siteRate(siteA, commons, "50.00");
  await siteRate(siteB, commons, "40.00");
  await siteRate(siteA, facings, "65.00");
  await siteRate(siteB, facings, "55.00");

  const gang1 = (await one("INSERT INTO ops.gangs (name, ganger_name, base_rate_set_id) VALUES ('Demo Gang One', 'Alex Demo', $1) RETURNING id", [std])).id;
  const gang2 = (await one("INSERT INTO ops.gangs (name, ganger_name, base_rate_set_id, individual_rate_set_id) VALUES ('Demo Gang Two', 'Sam Demo', $1, $2) RETURNING id", [std, indiv])).id;
  const payee = (g: string, n: string, legal: string, e: string, ok: boolean, ref: string) =>
    one("INSERT INTO ops.payees (gang_id, name, legal_name, entity_type, eligible, payment_ref, eligibility_updated_at) VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING id", [g, n, legal, e, ok, ref]);
  const p1 = (await payee(gang1, "Alex Demo", "Alex Demo Brickwork Ltd (demo)", "limited_company", true, "DEMO-P1")).id;
  await payee(gang1, "Jo Demo", "Jo Demo", "sole_trader", true, "DEMO-P2");
  await payee(gang1, "Chris Demo", "Chris Demo", "sole_trader", false, "DEMO-P3");
  await payee(gang2, "Sam Demo", "Sam Demo", "sole_trader", true, "DEMO-P4");
  await db.query("INSERT INTO ops.supervision_assignments (payee_id, site_id, weekly_amount, start_date) VALUES ($1, $2, '250.00', $3)", [p1, siteA, from]);

  const user = async (email: string, name: string, role: string, gang: string | null = null, username: string | null = null) =>
    (await one("INSERT INTO ops.users (email, username, name, password_hash, role, gang_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id", [email, username, name, hash, role, gang])).id;
  const admin = await user("admin@demo.test", "Demo Administrator", "admin");
  const director = await user("director@demo.test", "Demo Director (named list)", "management");
  await user("manager@demo.test", "Demo Manager (not on named list)", "management");
  await user("cm@demo.test", "Demo Contracts Manager", "contracts_manager");
  await user("gang1@demo.test", "Alex Demo", "gang", gang1, "alex.demo");
  await user("gang2@demo.test", "Sam Demo", "gang", gang2);
  await db.query("INSERT INTO commercial.access_list (user_id, added_by, reason) VALUES ($1, 'seed-demo', 'Demo named-list user')", [director]);
  await db.query("INSERT INTO commercial.access_list_history (user_id, action, changed_by, reason) VALUES ($1, 'added', 'seed-demo', 'Demo named-list user')", [director]);

  // Client charge rates (commercial schema; the owner login bypasses row-level security).
  const cr = DEMO_CLIENT_RATES;
  for (const [client, it, r] of [[clientA, trench, cr.trench], [clientA, b100, cr.block100], [clientA, c140, cr.commons140], [clientA, dw, cr.daywork],
    [clientB, trench, cr.trench], [clientB, b100, cr.block100], [clientB, c140, cr.commons140], [clientB, dw, cr.daywork]]) {
    await db.query("INSERT INTO commercial.client_rates (client_id, item_id, rate, effective_from) VALUES ($1, $2, $3, $4)", [client, it, r, from]);
  }
  const lv = DEMO_CLIENT_LIFT_VALUES;
  for (const client of [clientA, clientB]) {
    for (const [lift, v] of [[lift1, lv.lift1], [lift2, lv.lift2], [patch, lv.patch]]) {
      await db.query("INSERT INTO commercial.client_lift_values (client_id, lift_id, value, effective_from) VALUES ($1, $2, $3, $4)", [client, lift, v, from]);
    }
  }

  // Two fortnightly pay runs. ASSUMPTION for the demo: payment 7 days after the
  // second week ending; pay-less closes 7 days before payment.
  const we1 = nextFriday();
  for (const start of [plus(we1, -7), plus(we1, 7)]) {
    const pay = plus(start, 14);
    await db.query(
      `INSERT INTO ops.pay_runs (payment_date, first_week_ending, last_week_ending, payless_closes_at)
       VALUES ($1, $2, $3, (($1::date - 7) + time '23:59') AT TIME ZONE 'Europe/London')`, [pay, start, plus(start, 7)]);
  }

  await db.query("INSERT INTO ops.notices (kind, title, body, published_by) VALUES ('health_safety', 'Cold weather working (demo)', 'Demo alert: check the site instructions before laying in cold weather.', $1)", [admin]);
  await db.query("INSERT INTO ops.notices (kind, title, body, published_by) VALUES ('news', 'Welcome to K-S Claims (demo)', 'Demo news item.', $1)", [admin]);
  await db.query("INSERT INTO ops.issues (kind, site_id, gang_id, title, description, priority, raised_by) VALUES ('safety', $1, $2, 'Keep scaffold access clear (demo)', 'Demo safety issue.', 'high', $3)", [siteA, gang1, admin]);

  await db.query("COMMIT");
  console.log(`Demo data loaded. Every demo login uses the password: ${DEMO_PASSWORD}`);
  console.log("Logins: admin@, director@ (named list), manager@ (not on list), cm@, gang1@, gang2@ ... all @demo.test");
  } finally {
    await enforceSharedOwnerRls(db);
    await db.end();
  }
}

main().catch((e) => reportFailure("seed-demo", e));
