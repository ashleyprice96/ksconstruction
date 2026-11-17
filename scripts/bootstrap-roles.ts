// Hosted start-up step 1. The owner login on Render is not a superuser, but it
// does have CREATEROLE. This creates ks_app and ks_commercial when that is
// allowed, and records which connection mode the app should use.
import { Client } from "pg";
import { describeTarget, requireOwnerUrl, writeDbMode, type DbMode } from "../src/lib/pg-config";
import { openOwner, reportFailure } from "./script-db";

const ROLES = ["ks_app", "ks_commercial"] as const;

async function quoted(db: Client, value: string): Promise<string> {
  return (await db.query("SELECT quote_literal($1) AS q", [value])).rows[0].q as string;
}

async function ensureLogin(db: Client, role: (typeof ROLES)[number], password: string): Promise<"created" | "updated" | "exists-unmanaged"> {
  const lit = await quoted(db, password);
  const row = (await db.query<{ rolcanlogin: boolean }>("SELECT rolcanlogin FROM pg_roles WHERE rolname = $1", [role])).rows[0];
  if (!row) {
    try {
      await db.query(`CREATE ROLE ${role} LOGIN PASSWORD ${lit}`);
    } catch (e) {
      if ((e as { code?: string }).code === "42710") {
        await db.query(`ALTER ROLE ${role} WITH LOGIN PASSWORD ${lit}`);
        return "updated";
      }
      throw e;
    }
    return "created";
  }
  try {
    await db.query(`ALTER ROLE ${role} WITH LOGIN PASSWORD ${lit}`);
    return "updated";
  } catch (e) {
    // PostgreSQL 16: CREATEROLE cannot alter a role this user did not create.
    if (isPrivilege(e) && row.rolcanlogin) return "exists-unmanaged";
    throw e;
  }
}

async function ensureNoLogin(db: Client, role: (typeof ROLES)[number]) {
  const exists = (await db.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role])).rowCount;
  if (!exists) await db.query(`CREATE ROLE ${role} NOLOGIN`);
  else await db.query(`ALTER ROLE ${role} NOLOGIN`);
  // The owner adopts this role with SET ROLE. Granting twice is a no-op.
  await db.query(`GRANT ${role} TO CURRENT_USER`);
}

async function grantConnect(db: Client) {
  const ident = (await db.query("SELECT quote_ident(current_database()) AS q")).rows[0].q as string;
  for (const role of ROLES) await db.query(`GRANT CONNECT ON DATABASE ${ident} TO ${role}`);
}

function isPrivilege(e: unknown): boolean {
  return (e as { code?: string }).code === "42501";
}

async function main() {
  const url = requireOwnerUrl();
  console.log(`bootstrap-roles: target ${describeTarget(url)}`);
  const app = process.env.APP_DB_PASSWORD;
  const com = process.env.COMMERCIAL_DB_PASSWORD;
  const db = await openOwner();
  try {
    const me = (await db.query<{ u: string; rolsuper: boolean; rolcreaterole: boolean }>(
      "SELECT current_user AS u, rolsuper, rolcreaterole FROM pg_roles WHERE rolname = current_user")).rows[0];
    console.log(`bootstrap-roles: connected as ${me.u} superuser=${me.rolsuper} createrole=${me.rolcreaterole}`);

    if (!app || !com) {
      const mode: DbMode = process.env.DATABASE_URL_APP && process.env.DATABASE_URL_COMMERCIAL ? "separate-login" : "shared-owner";
      writeDbMode(mode);
      console.log(`bootstrap-roles: APP_DB_PASSWORD / COMMERCIAL_DB_PASSWORD not set, mode=${mode}. Separate ks_app and ks_commercial passwords were not changed.`);
      return;
    }

    if (!me.rolcreaterole && !me.rolsuper) {
      const existing = await db.query<{ rolname: string; rolcanlogin: boolean }>(
        "SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = ANY($1::text[])", [[...ROLES]]);
      const bothLogin = ROLES.every((role) => existing.rows.some((row) => row.rolname === role && row.rolcanlogin));
      if (bothLogin) {
        writeDbMode("separate-login");
        console.log("bootstrap-roles: mode=separate-login. ks_app and ks_commercial already exist. This login cannot change their passwords because it does not have CREATEROLE.");
        return;
      }
      finishShared();
      return;
    }

    try {
      const appResult = await ensureLogin(db, "ks_app", app);
      const comResult = await ensureLogin(db, "ks_commercial", com);
      if (appResult === "exists-unmanaged" || comResult === "exists-unmanaged") {
        writeDbMode("separate-login");
        console.log("bootstrap-roles: mode=separate-login. ks_app and ks_commercial already exist and this login cannot change their passwords. Connect with the passwords already set on those roles.");
        return;
      }
      await grantConnect(db);
      writeDbMode("separate-login");
      console.log("bootstrap-roles: mode=separate-login. ks_app has no commercial access. ks_commercial is limited by row-level security to the named list.");
      return;
    } catch (e) {
      if (!isPrivilege(e)) throw e;
      console.log(`bootstrap-roles: LOGIN role was refused (${(e as { code?: string }).code}). Trying NOLOGIN roles granted to the owner.`);
    }

    try {
      await ensureNoLogin(db, "ks_app");
      await ensureNoLogin(db, "ks_commercial");
      writeDbMode("set-role");
      console.log("bootstrap-roles: mode=set-role. The app connects as the owner, then SET ROLE ks_app or ks_commercial. Commercial row-level security still applies to ks_commercial.");
    } catch (e) {
      if (!isPrivilege(e)) throw e;
      console.log(`bootstrap-roles: creating roles was refused (${(e as { code?: string }).code}).`);
      finishShared();
    }
  } finally {
    await db.end();
  }
}

function finishShared() {
  writeDbMode("shared-owner");
  console.log("bootstrap-roles: mode=shared-owner. This login cannot create roles. The app will connect as the database owner. migrate will force row-level security on the commercial tables so the named-list check still runs. This is weaker than separate logins: the owner can turn row security off. A user with CREATEROLE (Render's database owner has it) enables mode=separate-login.");
}

main().catch((e) => reportFailure("bootstrap-roles", e));
