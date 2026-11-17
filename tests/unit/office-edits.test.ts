// Office can correct a gang claim. Approved claims need an un-approve first.
// A closed pay run stays locked. Lift caps still apply. The audit stores old and new values.
import { afterAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import type { User } from "../../src/lib/auth";
import { claimFieldEdits, officeSetQuantity, unapproveClaim } from "../../src/lib/office-edit";
import { ClaimError } from "../../src/lib/claims";

try { process.loadEnvFile(".env"); } catch { /* environment already set */ }

function asUser(row: { id: string; email: string | null; username: string | null; name: string; role: User["role"]; gang_id: string | null }): User {
  return { ...row, must_change_password: false };
}

describe("office claim edits", () => {
  const owner = new Client({ connectionString: process.env.DATABASE_URL_OWNER });
  const claimIds: string[] = [];

  afterAll(async () => {
    if (claimIds.length) await owner.query("DELETE FROM ops.claims WHERE id = ANY($1::uuid[])", [claimIds]);
    await owner.end();
  });

  it("records an audit, enforces the lift cap, and blocks edits after approval or a closed pay run", async () => {
    await owner.connect();
    const people = (await owner.query<{ id: string; email: string | null; username: string | null; name: string; role: User["role"]; gang_id: string | null }>(
      `SELECT id, email, username, name, role, gang_id FROM ops.users
       WHERE email IN ('manager@demo.test', 'cm@demo.test', 'gang1@demo.test')`)).rows;
    const manager = asUser(people.find((p) => p.role === "management")!);
    const cm = asUser(people.find((p) => p.role === "contracts_manager")!);
    const gang = people.find((p) => p.email === "gang1@demo.test")!;
    const plot = (await owner.query<{ plot_id: string; site_id: string; job_id: string; lift_id: string; client_id: string }>(
      `SELECT p.id AS plot_id, p.site_id, p.job_number_id AS job_id, l.id AS lift_id, s.client_id
       FROM ops.plots p JOIN ops.sites s ON s.id = p.site_id JOIN ops.lifts l ON l.house_type_id = p.house_type_id
       LIMIT 1`)).rows[0];

    const make = async (percent: string, status = "awaiting_management") => {
      const id = (await owner.query<{ id: string }>(
        `INSERT INTO ops.claims (gang_id, client_id, site_id, job_number_id, plot_id, claim_type, work_date, status, created_by)
         VALUES ($1, $2, $3, $4, $5, 'superstructure', '2026-06-01', $6, $7) RETURNING id`,
        [gang.gang_id, plot.client_id, plot.site_id, plot.job_id, plot.plot_id, status, gang.id])).rows[0].id;
      claimIds.push(id);
      const line = (await owner.query<{ id: string }>(
        `INSERT INTO ops.claim_lines (claim_id, lift_id, description, unit, quantity, gang_rate, gang_value)
         VALUES ($1, $2, '1st lift (test)', '%', $3, 1000, $4) RETURNING id`,
        [id, plot.lift_id, percent, Number(percent) * 10])).rows[0].id;
      return { id, line };
    };

    const open = await make("10");
    await expect(officeSetQuantity(cm, open.id, open.line, 15, "cm")).rejects.toBeInstanceOf(ClaimError);
    await officeSetQuantity(manager, open.id, open.line, 20, "Quantity was short");
    const audit = await claimFieldEdits(open.id);
    expect(audit.some((row) => row.field === "1st lift (test)" && row.old_value === "10" && row.new_value === "20" && row.who === manager.name)).toBe(true);
    expect(audit.every((row) => !row.old_value.includes("4.3217") && !row.new_value.toLowerCase().includes("margin"))).toBe(true);

    const held = await make("90");
    await expect(officeSetQuantity(manager, open.id, open.line, 20, "too much")).rejects.toThrow(/left to claim/);

    await owner.query("UPDATE ops.claims SET status = 'approved' WHERE id = $1", [open.id]);
    await expect(officeSetQuantity(manager, open.id, open.line, 15, "while approved")).rejects.toThrow(/Un-approve/);
    await unapproveClaim(manager, open.id, "Need a correction");
    await officeSetQuantity(manager, open.id, open.line, 5, "After un-approve");

    await owner.query("DELETE FROM ops.pay_runs WHERE payment_date IN ('2031-01-20', '2032-03-16')");
    const run = (await owner.query<{ id: string }>(
      `INSERT INTO ops.pay_runs (payment_date, first_week_ending, last_week_ending, payless_closes_at, status)
       VALUES ('2032-03-16', '2032-03-04', '2032-03-11', '2032-03-12', 'closed') RETURNING id`)).rows[0].id;
    await owner.query("UPDATE ops.claims SET status = 'approved', pay_run_id = $2 WHERE id = $1", [open.id, run]);
    await expect(unapproveClaim(manager, open.id, "too late")).rejects.toThrow(/locked/);
    await owner.query("UPDATE ops.claims SET pay_run_id = NULL WHERE pay_run_id = $1", [run]);
    await owner.query("DELETE FROM ops.pay_runs WHERE id = $1", [run]);
  });
});
