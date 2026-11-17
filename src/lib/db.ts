import "server-only";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { clientConfig, describeTarget, ownerConnectionString, readDbMode } from "./pg-config";

// Numeric columns come back as strings; keep them as strings and convert explicitly.

declare global {
  // eslint-disable-next-line no-var
  var __ksPools: { app: Pool; commercial: Pool } | undefined;
}

/**
 * Connection string for one of the app logins. Uses DATABASE_URL_APP / _COMMERCIAL when set;
 * otherwise derives it from the owner URL with that login's password (hosted set-up).
 */
export function loginUrl(kind: "app" | "commercial"): string | undefined {
  const explicit = kind === "app" ? process.env.DATABASE_URL_APP : process.env.DATABASE_URL_COMMERCIAL;
  if (explicit) return explicit;
  const owner = ownerConnectionString();
  const password = kind === "app" ? process.env.APP_DB_PASSWORD : process.env.COMMERCIAL_DB_PASSWORD;
  if (!owner || !password) return undefined;
  const u = new URL(owner);
  u.username = kind === "app" ? "ks_app" : "ks_commercial";
  u.password = password;
  return u.toString();
}

function poolTarget(kind: "app" | "commercial"): { url: string; role?: string } {
  const mode = readDbMode();
  const owner = ownerConnectionString();
  if (mode === "shared-owner") {
    if (!owner) throw new Error("shared-owner mode needs DATABASE_URL_OWNER or DATABASE_URL.");
    return { url: owner };
  }
  if (mode === "set-role") {
    if (!owner) throw new Error("set-role mode needs DATABASE_URL_OWNER or DATABASE_URL.");
    return { url: owner, role: kind === "app" ? "ks_app" : "ks_commercial" };
  }
  const url = loginUrl(kind);
  if (!url) throw new Error(`No database URL for the ${kind} login. Set DATABASE_URL_${kind === "app" ? "APP" : "COMMERCIAL"}, or DATABASE_URL_OWNER with APP_DB_PASSWORD and COMMERCIAL_DB_PASSWORD.`);
  return { url };
}

function pools() {
  if (!global.__ksPools) {
    const mode = readDbMode();
    const app = poolTarget("app");
    const commercial = poolTarget("commercial");
    console.log(`db: mode=${mode} app=${describeTarget(app.url)}${app.role ? ` role=${app.role}` : ""} commercial=${describeTarget(commercial.url)}${commercial.role ? ` role=${commercial.role}` : ""}`);
    if (mode === "shared-owner") {
      console.warn("db: shared-owner mode. Client rates rely on forced row-level security, not a separate login. The owner can turn row security off. Prefer a database user with CREATEROLE so bootstrap-roles can use mode=separate-login.");
    }
    global.__ksPools = {
      app: new Pool({ ...clientConfig(app.url, app.role), max: 10 }),
      commercial: new Pool({ ...clientConfig(commercial.url, commercial.role), max: 3 }),
    };
  }
  return global.__ksPools;
}

export async function q<T extends QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pools().app.query<T>(sql, params)).rows;
}

export async function q1<T extends QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
  return (await q<T>(sql, params))[0] ?? null;
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pools().app.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

/** Internal: only src/lib/commercial.ts may call this. */
export async function commercialConnection(): Promise<PoolClient> {
  return pools().commercial.connect();
}
