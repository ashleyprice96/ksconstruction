// Alerts and toolbox talks block every active login, not only gang leads.
import { afterAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { appAccess, type User } from "../../src/lib/auth";
import { pendingSafetyAlerts, safetyRoster } from "../../src/lib/safety";

try { process.loadEnvFile(".env"); } catch { /* environment already set */ }

describe("health and safety audience", () => {
  const owner = new Client({ connectionString: process.env.DATABASE_URL_OWNER });
  const ids: string[] = [];

  afterAll(async () => {
    if (ids.length) {
      await owner.query("DELETE FROM ops.hs_alert_sites WHERE alert_id = ANY($1::uuid[])", [ids]);
      await owner.query("DELETE FROM ops.hs_acknowledgements WHERE alert_id = ANY($1::uuid[])", [ids]);
      await owner.query("DELETE FROM ops.hs_alerts WHERE id = ANY($1::uuid[])", [ids]);
    }
    await owner.end();
  });

  it("asks every role to sign an alert and a toolbox talk, and lists them in Setup", async () => {
    await owner.connect();
    const users = (await owner.query<{ id: string; email: string; username: string | null; name: string; role: User["role"]; gang_id: string | null }>(
      `SELECT DISTINCT ON (role) id, email, username, name, role, gang_id
       FROM ops.users WHERE active AND role IN ('gang', 'contracts_manager', 'management', 'admin')
       ORDER BY role, email`)).rows;
    expect(users.map((u) => u.role).sort()).toEqual(["admin", "contracts_manager", "gang", "management"]);
    const publisher = users.find((u) => u.role === "admin")!;
    for (const kind of ["alert", "toolbox"] as const) {
      const id = (await owner.query<{ id: string }>(
        `INSERT INTO ops.hs_alerts (kind, title, body, active, published_by)
         VALUES ($1, $2, 'Read this before you go on site.', true, $3) RETURNING id`,
        [kind, `${kind} for everyone`, publisher.id])).rows[0].id;
      ids.push(id);
    }
    for (const row of users) {
      const user: User = { ...row, must_change_password: false };
      const pending = await pendingSafetyAlerts(user);
      expect(pending.map((a) => a.title)).toEqual(expect.arrayContaining(["alert for everyone", "toolbox for everyone"]));
      await expect(appAccess(user)).resolves.toBe("safety");
    }
    const roster = await safetyRoster();
    const talk = roster.find((a) => a.title === "toolbox for everyone");
    for (const row of users) expect(talk?.people.some((p) => p.user_id === row.id)).toBe(true);
  });
});
