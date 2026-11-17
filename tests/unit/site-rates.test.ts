// A gang lead's rate card lists every active site. Prices come from the site,
// a per-gang override wins, and client charge rates are not in the result.
import { afterAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { gangRateCard } from "../../src/lib/rates";

try { process.loadEnvFile(".env"); } catch { /* environment already set */ }

const SENTINELS = ["4.3217", "3.1979", "2.8643", "37.4129", "4321.97", "3876.53", "987.61"];

describe("site rate cards for gang leads", () => {
  const owner = new Client({ connectionString: process.env.DATABASE_URL_OWNER });
  let gangId = "";
  let northId = "";
  let midlandsId = "";
  let itemId = "";

  afterAll(async () => {
    if (gangId) {
      await owner.query("DELETE FROM ops.gang_site_rates WHERE gang_id = $1", [gangId]);
      await owner.query("DELETE FROM ops.site_rates WHERE site_id = ANY($1::uuid[])", [[northId, midlandsId]]);
      await owner.query("DELETE FROM ops.job_numbers WHERE site_id = ANY($1::uuid[])", [[northId, midlandsId]]);
      await owner.query("DELETE FROM ops.gangs WHERE id = $1", [gangId]);
      await owner.query("DELETE FROM ops.sites WHERE id = ANY($1::uuid[])", [[northId, midlandsId]]);
      await owner.query("DELETE FROM ops.rate_items WHERE id = $1", [itemId]);
    }
    await owner.end();
  });

  it("lets a gang use any active site and shows that site's gang rate, not the client rate", async () => {
    await owner.connect();
    itemId = (await owner.query<{ id: string }>(
      "INSERT INTO ops.rate_items (code, name, unit, claim_type) VALUES ('TEST_COMMONS', 'Commons (test)', '1,000', 'substructure') RETURNING id")).rows[0].id;
    northId = (await owner.query<{ id: string }>(
      "INSERT INTO ops.sites (name, region) VALUES ('North site (test)', 'North') RETURNING id")).rows[0].id;
    midlandsId = (await owner.query<{ id: string }>(
      "INSERT INTO ops.sites (name, region) VALUES ('Midlands site (test)', 'Midlands') RETURNING id")).rows[0].id;
    await owner.query("INSERT INTO ops.job_numbers (site_id, code) VALUES ($1, 'KS-TEST-N'), ($2, 'KS-TEST-M')", [northId, midlandsId]);
    await owner.query(
      "INSERT INTO ops.site_rates (site_id, item_id, rate, effective_from) VALUES ($1, $3, 50, '2026-01-01'), ($2, $3, 40, '2026-01-01')",
      [northId, midlandsId, itemId]);
    gangId = (await owner.query<{ id: string }>(
      "INSERT INTO ops.gangs (name, ganger_name) VALUES ('Rate card gang (test)', 'Test Lead') RETURNING id")).rows[0].id;
    await owner.query(
      "INSERT INTO ops.gang_site_rates (gang_id, site_id, item_id, rate, effective_from) VALUES ($1, $2, $3, 42, '2026-01-01')",
      [gangId, midlandsId, itemId]);

    const card = await gangRateCard(gangId, "2026-06-01");
    const at = (siteId: string) => card.find((r) => r.site_id === siteId && r.item_id === itemId);
    expect(at(northId)?.rate).toBe("50.0000");
    expect(at(northId)?.source).toBe("Site rate card");
    expect(at(midlandsId)?.rate).toBe("42.0000");
    expect(at(midlandsId)?.source).toBe("Gang override");
    const jobs = (await owner.query<{ code: string }>(
      "SELECT j.code FROM ops.job_numbers j JOIN ops.sites s ON s.id = j.site_id WHERE j.active AND s.active AND j.code LIKE 'KS%'")).rows;
    expect(jobs.map((j) => j.code)).toEqual(expect.arrayContaining(["KS-TEST-N", "KS-TEST-M"]));
    const shown = JSON.stringify(card);
    for (const secret of SENTINELS) expect(shown).not.toContain(secret);
  });
});
