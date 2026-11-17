// Applies db/migrations/*.sql in order, once each, using the owner login.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

try { process.loadEnvFile(".env"); } catch { /* environment already set */ }

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL_OWNER });
  await client.connect();
  await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await client.query("SELECT name FROM public.schema_migrations")).rows.map((r) => r.name));
  const dir = join(process.cwd(), "db", "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    console.log("applying", file);
    await client.query("BEGIN");
    try {
      await client.query(readFileSync(join(dir, file), "utf8"));
      await client.query("INSERT INTO public.schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  }
  await client.end();
  console.log("migrations up to date");
}

main().catch((e) => { console.error(e); process.exit(1); });
