// Hosted start-up step 1: make sure the two app logins exist with the configured
// passwords. Runs with the owner login (a superuser on the hosted database).
import { Client } from "pg";

try { process.loadEnvFile(".env"); } catch { /* environment already set */ }

async function main() {
  const app = process.env.APP_DB_PASSWORD, com = process.env.COMMERCIAL_DB_PASSWORD;
  if (!app || !com) { console.log("bootstrap-roles: APP_DB_PASSWORD / COMMERCIAL_DB_PASSWORD not set, skipping"); return; }
  const db = new Client({ connectionString: process.env.DATABASE_URL_OWNER });
  await db.connect();
  for (const [role, pw] of [["ks_app", app], ["ks_commercial", com]]) {
    const exists = (await db.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role])).rowCount;
    const lit = (await db.query("SELECT quote_literal($1) AS q", [pw])).rows[0].q;
    await db.query(`${exists ? "ALTER" : "CREATE"} ROLE ${role} LOGIN PASSWORD ${lit}`);
  }
  await db.end();
  console.log("bootstrap-roles: logins ready");
}

main().catch((e) => { console.error("bootstrap-roles failed:", e.message); process.exit(1); });
