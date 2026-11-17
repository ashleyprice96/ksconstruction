import { Client } from "pg";
import { clientConfig, describeTarget, formatDbError, readDbMode, requireOwnerUrl, secretValues } from "../src/lib/pg-config";

const COMMERCIAL_TABLES = ["client_rates", "client_lift_values", "client_supervision_charges", "access_log"] as const;

try { process.loadEnvFile(".env"); } catch { /* environment already set, or no local file on Render */ }

export async function openOwner(): Promise<Client> {
  const url = requireOwnerUrl();
  console.log(`db target ${describeTarget(url)}`);
  const db = new Client(clientConfig(url));
  await db.connect();
  return db;
}

/** Owner maintenance. Forced row-level security would block seeds in shared-owner mode. */
export async function relaxSharedOwnerRls(db: Client) {
  if (readDbMode() !== "shared-owner") return;
  for (const table of COMMERCIAL_TABLES) {
    await db.query(`ALTER TABLE IF EXISTS commercial.${table} NO FORCE ROW LEVEL SECURITY`);
  }
}

/** Put the named-list check back on the owner connection. Idempotent. */
export async function enforceSharedOwnerRls(db: Client) {
  if (readDbMode() !== "shared-owner") return;
  console.log("db: shared-owner mode, forcing row-level security on commercial tables");
  for (const table of COMMERCIAL_TABLES) {
    await db.query(`ALTER TABLE IF EXISTS commercial.${table} ENABLE ROW LEVEL SECURITY`);
    await db.query(`ALTER TABLE IF EXISTS commercial.${table} FORCE ROW LEVEL SECURITY`);
  }
  await db.query(`
    DO $$
    BEGIN
      IF to_regclass('commercial.client_rates') IS NULL THEN
        RETURN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'commercial' AND tablename = 'client_rates' AND policyname = 'named_owner') THEN
        CREATE POLICY named_owner ON commercial.client_rates FOR ALL TO PUBLIC
          USING (commercial.is_named_user()) WITH CHECK (commercial.is_named_user());
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'commercial' AND tablename = 'client_lift_values' AND policyname = 'named_owner') THEN
        CREATE POLICY named_owner ON commercial.client_lift_values FOR ALL TO PUBLIC
          USING (commercial.is_named_user()) WITH CHECK (commercial.is_named_user());
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'commercial' AND tablename = 'client_supervision_charges' AND policyname = 'named_owner') THEN
        CREATE POLICY named_owner ON commercial.client_supervision_charges FOR ALL TO PUBLIC
          USING (commercial.is_named_user()) WITH CHECK (commercial.is_named_user());
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'commercial' AND tablename = 'access_log' AND policyname = 'named_owner_insert') THEN
        CREATE POLICY named_owner_insert ON commercial.access_log FOR INSERT TO PUBLIC
          WITH CHECK (commercial.is_named_user() AND user_id = nullif(current_setting('ks.user_id', true), '')::uuid);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'commercial' AND tablename = 'access_log' AND policyname = 'named_owner_read') THEN
        CREATE POLICY named_owner_read ON commercial.access_log FOR SELECT TO PUBLIC
          USING (commercial.is_named_user());
      END IF;
    END $$;
  `);
}

export function reportFailure(script: string, err: unknown): never {
  const url = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
  console.error(`${script} failed (target ${describeTarget(url)}):\n${formatDbError(err, secretValues())}`);
  process.exit(1);
}
