import { describe, expect, it } from "vitest";
import { describeTarget, formatDbError, redact, sslConfigFor, stripSslQuery } from "../../src/lib/pg-config";

describe("database connection description", () => {
  it("hides the user and password and keeps the host", () => {
    expect(describeTarget("postgres://ks_owner:s3cret@dpg-abc-a.frankfurt-postgres.render.com:5432/ks_claims")).toBe(
      "dpg-abc-a.frankfurt-postgres.render.com:5432/ks_claims");
    expect(describeTarget("postgres://ks_owner:s3cret@dpg-abc-a/ks_claims")).toBe("dpg-abc-a:5432/ks_claims");
    expect(describeTarget(undefined)).toBe("(no connection string)");
  });

  it("turns SSL on for Render hosts and for sslmode=require, and off for localhost", () => {
    expect(sslConfigFor("postgres://u:p@localhost:5432/ks_claims")).toBe(false);
    expect(sslConfigFor("postgres://u:p@127.0.0.1:5432/ks_claims")).toBe(false);
    expect(sslConfigFor("postgres://u:p@localhost/ks_claims?sslmode=disable")).toBe(false);
    expect(sslConfigFor("postgres://u:p@localhost/ks_claims?sslmode=require")).toEqual({ rejectUnauthorized: false });
    expect(sslConfigFor("postgres://u:p@dpg-abc-a/ks_claims")).toEqual({ rejectUnauthorized: false });
    expect(sslConfigFor("postgres://u:p@dpg-abc-a.frankfurt-postgres.render.com/ks_claims?sslmode=require")).toEqual({ rejectUnauthorized: false });
    expect(sslConfigFor("postgres://u:p@db.example/ks?sslmode=verify-full")).toEqual({ rejectUnauthorized: true });
  });

  it("strips ssl query params without dropping the password encoding", () => {
    const cleaned = stripSslQuery("postgres://u:p%40ss@db.example:5432/ks?sslmode=require&ssl=true");
    const u = new URL(cleaned);
    expect(decodeURIComponent(u.password)).toBe("p@ss");
    expect(u.searchParams.has("sslmode")).toBe(false);
    expect(u.hostname).toBe("db.example");
  });
});

describe("database error formatting", () => {
  it("prints nested connection errors when the outer message is empty", () => {
    const inner = Object.assign(new Error(""), { code: "ECONNREFUSED", address: "10.0.0.5", port: 5432, syscall: "connect" });
    const err = new AggregateError([inner], "");
    const text = formatDbError(err, ["super-secret-password"]);
    expect(text).toContain("AggregateError");
    expect(text).toContain("ECONNREFUSED");
    expect(text).toContain("10.0.0.5");
    expect(text).toContain("5432");
    expect(text).not.toContain("super-secret-password");
  });

  it("prints pg fields and redacts passwords and connection strings", () => {
    const err = Object.assign(new Error("password authentication failed for user \"ks_app\""), {
      code: "28P01",
      detail: "see postgres://ks_owner:super-secret-password@db.example/ks",
      routine: "auth_failed",
      query: "ALTER ROLE ks_app PASSWORD 'super-secret-password'",
    });
    const text = formatDbError(err, ["super-secret-password"]);
    expect(text).toContain("28P01");
    expect(text).toContain("auth_failed");
    expect(text).toContain("ALTER ROLE ks_app");
    expect(text).not.toContain("super-secret-password");
    expect(text).not.toContain("ks_owner:");
    expect(redact("postgres://a:b@h/db", [])).toBe("postgres://[redacted]@h/db");
  });
});
