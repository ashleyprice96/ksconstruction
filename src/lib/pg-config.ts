import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ClientConfig } from "pg";

/** Written by scripts/bootstrap-roles.ts and read by the app on the same machine. */
export const DB_MODE_FILE = ".ks-db-mode.json";

export type DbMode = "separate-login" | "set-role" | "shared-owner";

export function ownerConnectionString(): string | undefined {
  return process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
}

export function requireOwnerUrl(): string {
  const url = ownerConnectionString();
  if (!url) {
    throw new Error("Set DATABASE_URL_OWNER or DATABASE_URL to the Postgres connection string. The value is not printed.");
  }
  return url;
}

/** Host, port and database only. User and password are never included. */
export function describeTarget(connectionString: string | undefined): string {
  if (!connectionString) return "(no connection string)";
  const parsed = parseUrl(connectionString);
  if (!parsed) return "(unparseable connection string)";
  const db = parsed.database || "(default-db)";
  return `${parsed.host}:${parsed.port}/${db}`;
}

export function sslConfigFor(connectionString: string): false | { rejectUnauthorized: boolean } {
  const parsed = parseUrl(connectionString);
  if (!parsed) {
    if (/@(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(connectionString)) return false;
    return { rejectUnauthorized: false };
  }
  const mode = parsed.sslmode;
  if (mode === "disable" || mode === "0" || mode === "false") return false;
  const local = parsed.host === "localhost" || parsed.host === "127.0.0.1" || parsed.host === "::1";
  const asked = mode === "require" || mode === "prefer" || mode === "verify-ca" || mode === "verify-full"
    || mode === "no-verify" || mode === "true" || mode === "1";
  if (!asked && local) return false;
  if (!asked && !local) return { rejectUnauthorized: false };
  if (mode === "verify-full" || mode === "verify-ca") return { rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

/** Remove ssl query params so node-pg cannot override the ssl option we set. */
export function stripSslQuery(connectionString: string): string {
  const parsed = parseUrl(connectionString);
  if (!parsed) return connectionString;
  try {
    const u = new URL(connectionString);
    for (const key of ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"]) u.searchParams.delete(key);
    return u.toString();
  } catch {
    return connectionString;
  }
}

export function clientConfig(connectionString: string, role?: string): ClientConfig {
  if (role && !/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Refusing an unexpected database role name.");
  const config: ClientConfig = {
    connectionString: stripSslQuery(connectionString),
    ssl: sslConfigFor(connectionString),
  };
  // Applied at session start, before any query. Used when the owner must SET ROLE
  // because the app roles are NOLOGIN.
  if (role) config.options = `-c role=${role}`;
  return config;
}

export function writeDbMode(mode: DbMode) {
  const path = join(process.cwd(), DB_MODE_FILE);
  writeFileSync(path, JSON.stringify({ mode }) + "\n", { mode: 0o600 });
}

export function readDbMode(): DbMode {
  try {
    const raw = JSON.parse(readFileSync(join(process.cwd(), DB_MODE_FILE), "utf8")) as { mode?: string };
    if (raw.mode === "separate-login" || raw.mode === "set-role" || raw.mode === "shared-owner") return raw.mode;
  } catch { /* no file yet: local .env with explicit app URLs */ }
  return "separate-login";
}

export function secretValues(): string[] {
  const keys = ["DATABASE_URL_OWNER", "DATABASE_URL", "DATABASE_URL_APP", "DATABASE_URL_COMMERCIAL", "APP_DB_PASSWORD", "COMMERCIAL_DB_PASSWORD", "ADMIN_PASSWORD"];
  return keys.map((k) => process.env[k]).filter((v): v is string => !!v);
}

/** Full error text for AggregateError, pg errors and connection failures. Secrets are removed. */
export function formatDbError(err: unknown, secrets: string[] = []): string {
  const lines: string[] = [];
  const seen = new Set<unknown>();
  const walk = (value: unknown, indent: string) => {
    if (value == null || seen.has(value)) return;
    if (typeof value !== "object") {
      lines.push(indent + String(value));
      return;
    }
    seen.add(value);
    const o = value as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name : "Error";
    const message = typeof o.message === "string" ? o.message : "";
    lines.push(`${indent}${name}: ${message}`);
    for (const key of ["code", "detail", "hint", "schema", "table", "column", "constraint", "routine", "severity", "errno", "syscall", "address", "port"]) {
      const field = o[key];
      if (field !== undefined && field !== null && field !== "") lines.push(`${indent}  ${key}: ${field}`);
    }
    if (typeof o.query === "string" && o.query) lines.push(`${indent}  query: ${o.query}`);
    if (typeof o.stack === "string") {
      for (const line of o.stack.split("\n").slice(0, 12)) lines.push(indent + line);
    }
    if (Array.isArray(o.errors)) {
      o.errors.forEach((nested, i) => {
        lines.push(`${indent}  nested[${i}]:`);
        walk(nested, indent + "    ");
      });
    }
    if (o.cause) {
      lines.push(`${indent}  cause:`);
      walk(o.cause, indent + "    ");
    }
  };
  walk(err, "");
  return redact(lines.join("\n"), secrets);
}

export function redact(text: string, secrets: string[]): string {
  let out = text;
  const unique = [...new Set(secrets.filter((s) => s.length > 0))].sort((a, b) => b.length - a.length);
  for (const secret of unique) out = out.split(secret).join("[redacted]");
  out = out.replace(/postgres(?:ql)?:\/\/[^\s'")]+/gi, (match) => {
    try {
      const u = new URL(match);
      return `${u.protocol}//[redacted]@${u.host}${u.pathname}`;
    } catch {
      return "postgres://[redacted]";
    }
  });
  return out;
}

function parseUrl(connectionString: string): { host: string; port: string; database: string; sslmode: string | null } | null {
  try {
    const u = new URL(connectionString);
    return {
      host: u.hostname,
      port: u.port || "5432",
      database: decodeURIComponent(u.pathname.replace(/^\//, "")),
      sslmode: u.searchParams.get("sslmode") ?? u.searchParams.get("ssl"),
    };
  } catch {
    return null;
  }
}
