// Office can enter a claim for a gang lead. Gang leads and contracts managers cannot.
// The recorded entry does not include client prices.
import { afterAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import type { User } from "../../src/lib/auth";
import { createOfficeDraft } from "../../src/lib/claims";
import { gangRateCard } from "../../src/lib/rates";

try { process.loadEnvFile(".env"); } catch { /* environment already set */ }

const SENTINELS = ["4.3217", "3.1979", "2.8643", "37.4129", "4321.97", "3876.53", "987.61"];

function asUser(row: { id: string; email: string | null; username: string | null; name: string; role: User["role"]; gang_id: string | null }): User {
  return { ...row, must_change_password: false };
}

describe("enter a claim for a gang", () => {
  const owner = new Client({ connectionString: process.env.DATABASE_URL_OWNER });
  const ids: string[] = [];

  afterAll(async () => {
    if (ids.length) await owner.query("DELETE FROM ops.claims WHERE id = ANY($1::uuid[])", [ids]);
    await owner.end();
  });

  it("records who entered it, refuses the other roles, and hides client rates", async () => {
    await owner.connect();
    const people = (await owner.query<{ id: string; email: string | null; username: string | null; name: string; role: User["role"]; gang_id: string | null }>(
      `SELECT id, email, username, name, role, gang_id FROM ops.users
       WHERE email IN ('manager@demo.test', 'cm@demo.test', 'gang1@demo.test')`)).rows;
    const manager = asUser(people.find((p) => p.role === "management")!);
    const cm = asUser(people.find((p) => p.role === "contracts_manager")!);
    const gang = asUser(people.find((p) => p.role === "gang")!);
    const job = (await owner.query<{ site_id: string; job_id: string }>(
      "SELECT site_id, id AS job_id FROM ops.job_numbers WHERE active LIMIT 1")).rows[0];
    const input = { siteId: job.site_id, jobNumberId: job.job_id, plotId: null, claimType: "daywork" as const, workDate: "2026-06-10", stage: "" };

    await expect(createOfficeDraft(gang, gang.id, input)).rejects.toThrow(/Management only/);
    await expect(createOfficeDraft(cm, gang.id, input)).rejects.toThrow(/Management only/);

    const id = await createOfficeDraft(manager, gang.id, input);
    ids.push(id);
    const saved = (await owner.query<{ gang_id: string; created_by: string; entered_by: string; entered_at: string }>(
      "SELECT gang_id, created_by, entered_by_user_id AS entered_by, entered_at FROM ops.claims WHERE id = $1", [id])).rows[0];
    expect(saved.gang_id).toBe(gang.gang_id);
    expect(saved.created_by).toBe(gang.id);
    expect(saved.entered_by).toBe(manager.id);
    expect(saved.entered_at).toBeTruthy();

    const shown = JSON.stringify(await gangRateCard(gang.gang_id!, input.workDate));
    for (const secret of SENTINELS) expect(shown).not.toContain(secret);
  });
});
