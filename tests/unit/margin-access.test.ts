// Named-list changes go through commercial.manage_named_list. ks_app cannot call
// it or read commercial data. A named-list administrator can. Removing someone
// makes the same check the /commercial page uses return false.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import bcrypt from "bcryptjs";

try { process.loadEnvFile(".env"); } catch { /* environment already set */ }

const app = new Client({ connectionString: process.env.DATABASE_URL_APP });
const com = new Client({ connectionString: process.env.DATABASE_URL_COMMERCIAL });
const owner = new Client({ connectionString: process.env.DATABASE_URL_OWNER });

const password = "margin-test-password";
let adminId = "";
let outsiderId = "";
let targetId = "";

beforeAll(async () => {
  await Promise.all([app.connect(), com.connect(), owner.connect()]);
  const hash = await bcrypt.hash(password, 4);
  const insert = async (email: string, role: string) => (await owner.query<{ id: string }>(
    `INSERT INTO ops.users (email, name, password_hash, role, must_change_password)
     VALUES ($1, $2, $3, $4, false) RETURNING id`,
    [email, email, hash, role])).rows[0].id;
  adminId = await insert("margin-admin@demo.test", "admin");
  outsiderId = await insert("margin-outsider@demo.test", "admin");
  targetId = await insert("margin-target@demo.test", "management");
  await owner.query(
    "INSERT INTO commercial.access_list (user_id, added_by, reason) VALUES ($1, 'test', 'Margin access test')",
    [adminId]);
});

afterAll(async () => {
  await owner.query("DELETE FROM commercial.access_list_history WHERE user_id = ANY($1::uuid[])", [[adminId, outsiderId, targetId]]);
  await owner.query("DELETE FROM commercial.access_list WHERE user_id = ANY($1::uuid[])", [[adminId, outsiderId, targetId]]);
  await owner.query("DELETE FROM ops.sessions WHERE user_id = ANY($1::uuid[])", [[adminId, outsiderId, targetId]]);
  await owner.query("DELETE FROM ops.users WHERE id = ANY($1::uuid[])", [[adminId, outsiderId, targetId]]);
  await Promise.all([app.end(), com.end(), owner.end()]);
});

async function asCommercial(actor: string, sql: string, params: unknown[] = []) {
  await com.query("BEGIN");
  try {
    await com.query("SELECT set_config('ks.user_id', $1, true)", [actor]);
    return await com.query(sql, params);
  } finally {
    await com.query("ROLLBACK");
  }
}

describe("named list changes", () => {
  it("refuses the operational login", async () => {
    await expect(app.query("SELECT commercial.manage_named_list($1, 'add', 'not allowed')", [targetId])).rejects.toThrow(/permission denied/);
    await expect(app.query("SELECT * FROM commercial.client_rates LIMIT 1")).rejects.toThrow(/permission denied/);
  });

  it("refuses an administrator who is not on the named list", async () => {
    await expect(asCommercial(outsiderId, "SELECT commercial.manage_named_list($1, 'add', 'should fail')", [targetId])).rejects.toThrow(/not allowed/);
  });

  it("lets a named-list administrator add and remove, and removal closes Margin", async () => {
    await com.query("BEGIN");
    await com.query("SELECT set_config('ks.user_id', $1, true)", [adminId]);
    await com.query("SELECT commercial.manage_named_list($1, 'add', 'Site manager needs margin')", [targetId]);
    const added = await com.query("SELECT commercial.is_named_user() AS ok");
    await com.query("SELECT set_config('ks.user_id', $1, true)", [targetId]);
    const visible = (await com.query("SELECT commercial.is_named_user() AS ok")).rows[0].ok;
    await com.query("SELECT set_config('ks.user_id', $1, true)", [adminId]);
    await com.query("SELECT commercial.manage_named_list($1, 'remove', 'No longer needed')", [targetId]);
    await com.query("SELECT set_config('ks.user_id', $1, true)", [targetId]);
    const gone = (await com.query("SELECT commercial.is_named_user() AS ok")).rows[0].ok;
    await com.query("ROLLBACK");
    expect(added.rows).toBeDefined();
    expect(visible).toBe(true);
    expect(gone).toBe(false);
  });
});
