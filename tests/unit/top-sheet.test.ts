// A scanned top sheet is stored in the database. Another gang cannot open it.
// The owning gang and the office can.
import { afterAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import type { User } from "../../src/lib/auth";
import { addTopSheets, createDraft } from "../../src/lib/claims";
import { openAttachment } from "../../src/lib/attachments";
import { ClaimError } from "../../src/lib/claims";

try { process.loadEnvFile(".env"); } catch { /* environment already set */ }

function user(row: { id: string; email: string | null; username: string | null; name: string; role: User["role"]; gang_id: string | null }): User {
  return { ...row, must_change_password: false };
}

describe("top sheet access", () => {
  const owner = new Client({ connectionString: process.env.DATABASE_URL_OWNER });
  const claimIds: string[] = [];

  afterAll(async () => {
    if (claimIds.length) await owner.query("DELETE FROM ops.claims WHERE id = ANY($1::uuid[])", [claimIds]);
    await owner.end();
  });

  it("stores the sheet in Postgres and hides it from another gang", async () => {
    await owner.connect();
    const people = (await owner.query<{ id: string; email: string | null; username: string | null; name: string; role: User["role"]; gang_id: string | null }>(
      `SELECT id, email, username, name, role, gang_id FROM ops.users
       WHERE active AND (email = 'gang1@demo.test' OR email = 'gang2@demo.test' OR email = 'manager@demo.test')`)).rows;
    const gang = user(people.find((p) => p.email === "gang1@demo.test")!);
    const other = user(people.find((p) => p.email === "gang2@demo.test")!);
    const office = user(people.find((p) => p.email === "manager@demo.test")!);
    await owner.query(
      `INSERT INTO ops.hs_acknowledgements (alert_id, user_id, ip)
       SELECT id, $1, 'test' FROM ops.hs_alerts WHERE active
       ON CONFLICT DO NOTHING`, [gang.id]);

    const job = (await owner.query<{ site_id: string; job_id: string; plot_id: string }>(
      `SELECT j.site_id, j.id AS job_id, p.id AS plot_id
       FROM ops.job_numbers j JOIN ops.plots p ON p.job_number_id = j.id JOIN ops.sites s ON s.id = j.site_id
       WHERE j.active AND s.active LIMIT 1`)).rows[0];
    const claimId = await createDraft(gang, {
      siteId: job.site_id, jobNumberId: job.job_id, plotId: job.plot_id,
      claimType: "substructure", workDate: "2026-06-04", stage: "top sheet",
    });
    claimIds.push(claimId);

    const bytes = new TextEncoder().encode("%PDF-1.4 top sheet test");
    await addTopSheets(gang, claimId, [new File([bytes], "top-sheet.pdf", { type: "application/pdf" })]);
    await expect(addTopSheets(gang, claimId, [new File([new Uint8Array(7 * 1024 * 1024)], "big.pdf", { type: "application/pdf" })])).rejects.toBeInstanceOf(ClaimError);

    const stored = (await owner.query<{ id: string; storage_key: string; n: number }>(
      `SELECT id, storage_key, octet_length(content) AS n FROM ops.attachments WHERE claim_id = $1 AND kind = 'top_sheet'`,
      [claimId])).rows;
    expect(stored).toHaveLength(1);
    expect(stored[0].storage_key.startsWith("pg/")).toBe(true);
    expect(Number(stored[0].n)).toBe(bytes.length);

    const own = await openAttachment(gang, stored[0].id);
    const officeView = await openAttachment(office, stored[0].id);
    const blocked = await openAttachment(other, stored[0].id);
    expect(own?.body.equals(Buffer.from(bytes))).toBe(true);
    expect(officeView?.body.equals(Buffer.from(bytes))).toBe(true);
    expect(blocked).toBeNull();
  });
});
