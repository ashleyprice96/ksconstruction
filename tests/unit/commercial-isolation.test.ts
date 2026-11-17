// Database-level checks that client rates, client values and margin cannot be read
// except by a named-list user through the commercial login. Needs the database from
// .env with the demo seed loaded (npm run db:seed-demo).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

try { process.loadEnvFile(".env"); } catch { /* environment already set */ }

const app = new Client({ connectionString: process.env.DATABASE_URL_APP });
const com = new Client({ connectionString: process.env.DATABASE_URL_COMMERCIAL });
const owner = new Client({ connectionString: process.env.DATABASE_URL_OWNER });
let named = "", manager = "";

beforeAll(async () => {
  await Promise.all([app.connect(), com.connect(), owner.connect()]);
  named = (await owner.query("SELECT user_id FROM commercial.access_list LIMIT 1")).rows[0]?.user_id;
  manager = (await owner.query("SELECT id FROM ops.users WHERE role = 'management' AND id NOT IN (SELECT user_id FROM commercial.access_list) LIMIT 1")).rows[0]?.id;
  if (!named || !manager) throw new Error("Load the demo seed first.");
});
afterAll(async () => { await Promise.all([app.end(), com.end(), owner.end()]); });

async function asUser(userId: string | null, sql: string) {
  await com.query("BEGIN");
  try {
    if (userId) await com.query("SELECT set_config('ks.user_id', $1, true)", [userId]);
    return (await com.query(sql)).rows;
  } finally { await com.query("ROLLBACK"); }
}

describe("operational login", () => {
  for (const table of ["client_rates", "client_lift_values", "client_supervision_charges", "claim_line_values", "access_list", "access_log"]) {
    it(`is refused commercial.${table}`, async () => {
      await expect(app.query(`SELECT * FROM commercial.${table} LIMIT 1`)).rejects.toThrow(/permission denied/);
    });
  }
  it("cannot rewrite the audit trail or pay-less history", async () => {
    await expect(app.query("UPDATE ops.audit_log SET action = 'x' WHERE false")).rejects.toThrow(/permission denied/);
    await expect(app.query("DELETE FROM ops.adjustments WHERE false")).rejects.toThrow(/permission denied/);
  });
});

describe("commercial login", () => {
  it("returns nothing without a user", async () => {
    expect(await asUser(null, "SELECT * FROM commercial.client_rates")).toHaveLength(0);
    expect(await asUser(null, "SELECT * FROM commercial.claim_line_values")).toHaveLength(0);
  });
  it("returns nothing for a manager who is not on the named list", async () => {
    expect(await asUser(manager, "SELECT * FROM commercial.client_rates")).toHaveLength(0);
    expect(await asUser(manager, "SELECT * FROM commercial.client_lift_values")).toHaveLength(0);
    expect(await asUser(manager, "SELECT * FROM commercial.claim_line_values")).toHaveLength(0);
  });
  it("refuses writes for a manager who is not on the named list", async () => {
    await expect(asUser(manager, `INSERT INTO commercial.client_rates (client_id, item_id, rate, effective_from)
      SELECT (SELECT id FROM ops.clients LIMIT 1), (SELECT id FROM ops.rate_items LIMIT 1), 1, '2030-01-01'`)).rejects.toThrow(/row-level security/);
  });
  it("returns client rates for a named-list user", async () => {
    expect((await asUser(named, "SELECT * FROM commercial.client_rates")).length).toBeGreaterThan(0);
  });
  it("cannot change the named list", async () => {
    await expect(asUser(named, `INSERT INTO commercial.access_list (user_id, added_by) VALUES ('${manager}', 'test')`)).rejects.toThrow(/permission denied/);
  });
});
