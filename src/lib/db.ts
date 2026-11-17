import "server-only";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

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
  const owner = process.env.DATABASE_URL_OWNER;
  const password = kind === "app" ? process.env.APP_DB_PASSWORD : process.env.COMMERCIAL_DB_PASSWORD;
  if (!owner || !password) return undefined;
  const u = new URL(owner);
  u.username = kind === "app" ? "ks_app" : "ks_commercial";
  u.password = password;
  return u.toString();
}

function pools() {
  if (!global.__ksPools) {
    global.__ksPools = {
      // Operational login: has no privileges on the commercial schema.
      app: new Pool({ connectionString: loginUrl("app"), max: 10 }),
      // Commercial login: only ever used from src/lib/commercial.ts.
      commercial: new Pool({ connectionString: loginUrl("commercial"), max: 3 }),
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
