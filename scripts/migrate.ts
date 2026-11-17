// Applies db/migrations/*.sql in order, once each, using the owner login.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { enforceSharedOwnerRls, openOwner, reportFailure } from "./script-db";

async function main() {
  const client = await openOwner();
  try {
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
    const users = await client.query("SELECT to_regclass('ops.users') AS t");
    if (users.rows[0].t) {
      const n = await client.query("SELECT count(*)::int AS n FROM ops.users");
      // An empty database is seeded next. Forcing row security first would block that seed.
      if (n.rows[0].n > 0) await enforceSharedOwnerRls(client);
    }
    console.log("migrations up to date");
  } finally {
    await client.end();
  }
}

main().catch((e) => reportFailure("migrate", e));
