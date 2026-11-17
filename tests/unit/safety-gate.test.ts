// Gang leads with an outstanding health and safety alert cannot open claims
// or submit one. Confirming clears them. A newly published alert blocks them again.
import { afterAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { appAccess, type User } from "../../src/lib/auth";
import { createDraft } from "../../src/lib/claims";
import { SafetyError } from "../../src/lib/safety";

try { process.loadEnvFile(".env"); } catch { /* environment already set */ }

describe("health and safety gate", () => {
  const owner = new Client({ connectionString: process.env.DATABASE_URL_OWNER });
  const alertIds: string[] = [];
  const claimIds: string[] = [];
  let gang: User;
  let siteId = "";
  let jobId = "";
  let plotId = "";

  afterAll(async () => {
    if (claimIds.length) await owner.query("DELETE FROM ops.claims WHERE id = ANY($1::uuid[])", [claimIds]);
    if (alertIds.length) {
      await owner.query("DELETE FROM ops.hs_acknowledgements WHERE alert_id = ANY($1::uuid[])", [alertIds]);
      await owner.query("DELETE FROM ops.hs_alerts WHERE id = ANY($1::uuid[])", [alertIds]);
    }
    await owner.end();
  });

  async function publish(title: string) {
    const id = (await owner.query<{ id: string }>(
      `INSERT INTO ops.hs_alerts (title, body, active, published_by)
       VALUES ($1, 'Hard hats and hi-vis are required on every site.', true, $2) RETURNING id`,
      [title, gang.id])).rows[0].id;
    alertIds.push(id);
    return id;
  }

  it("blocks an unacknowledged gang lead, allows them after they confirm, and blocks them again for a new alert", async () => {
    await owner.connect();
    const row = (await owner.query<{ id: string; email: string; username: string | null; name: string; gang_id: string }>(
      "SELECT id, email, username, name, gang_id FROM ops.users WHERE role = 'gang' AND active ORDER BY email LIMIT 1")).rows[0];
    gang = { id: row.id, email: row.email, username: row.username, name: row.name, role: "gang", gang_id: row.gang_id, must_change_password: false };
    const job = (await owner.query<{ site_id: string; job_id: string; plot_id: string }>(
      `SELECT j.site_id, j.id AS job_id, p.id AS plot_id
       FROM ops.job_numbers j JOIN ops.plots p ON p.job_number_id = j.id JOIN ops.sites s ON s.id = j.site_id
       WHERE j.active AND s.active LIMIT 1`)).rows[0];
    siteId = job.site_id; jobId = job.job_id; plotId = job.plot_id;

    const first = await publish("Scaffold inspection (test)");
    await expect(appAccess(gang)).resolves.toBe("safety");
    await expect(appAccess({ ...gang, must_change_password: true })).resolves.toBe("password");
    await expect(createDraft(gang, {
      siteId, jobNumberId: jobId, plotId, claimType: "substructure", workDate: "2026-06-02", stage: "1st lift",
    })).rejects.toBeInstanceOf(SafetyError);

    await owner.query(
      "INSERT INTO ops.hs_acknowledgements (alert_id, user_id, ip) VALUES ($1, $2, '203.0.113.10')",
      [first, gang.id]);
    const claimId = await createDraft(gang, {
      siteId, jobNumberId: jobId, plotId, claimType: "substructure", workDate: "2026-06-02", stage: "1st lift",
    });
    claimIds.push(claimId);
    await expect(appAccess(gang)).resolves.toBe("ok");

    await publish("Ladder check (test)");
    await expect(appAccess(gang)).resolves.toBe("safety");
    await expect(createDraft(gang, {
      siteId, jobNumberId: jobId, plotId, claimType: "substructure", workDate: "2026-06-03", stage: "1st lift",
    })).rejects.toBeInstanceOf(SafetyError);
  });
});
