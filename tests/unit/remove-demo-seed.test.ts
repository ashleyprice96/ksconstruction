import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("db/migrations/015_remove_demo_seed.sql", "utf8");

describe("demo seed removal", () => {
  it("names only the demo rows and does not delete users, gangs or rate items", () => {
    for (const name of [
      "Oak Lane (demo)",
      "Mill Street (demo)",
      "DEMO-001",
      "DEMO-002",
      "Northfield Contracting (demo)",
      "Riverside Civils (demo)",
      "Example Homes (demo)",
      "Type A (demo)",
      "Cold weather working (demo)",
      "Welcome to K-S Claims (demo)",
      "Demo Standard",
      "Demo individual: Gang Two",
      "Demo Riverside client set",
    ]) {
      expect(sql).toContain(name);
    }
    expect(sql).not.toMatch(/DELETE FROM ops\.users/i);
    expect(sql).not.toMatch(/DELETE FROM ops\.gangs/i);
    expect(sql).not.toMatch(/DELETE FROM ops\.rate_items/i);
    expect(sql).not.toMatch(/LIKE /i);
    expect(sql).toContain("status = 'draft'");
  });
});
