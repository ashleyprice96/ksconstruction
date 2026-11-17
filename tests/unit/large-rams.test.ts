// An 88-page RAMS of about 20 MB must be accepted and must report 88 pages.
import { afterAll, describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import type { User } from "../../src/lib/auth";
import { publishRams } from "../../src/lib/rams";
import { readByteaSlice } from "../../src/lib/pdf-stream";

try { process.loadEnvFile(".env"); } catch { /* environment already set */ }

async function ramsPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 88; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Site RAMS page ${i + 1}`, { x: 48, y: 800, size: 12, font });
  }
  await doc.attach(randomBytes(20 * 1024 * 1024), "padding.bin", {
    mimeType: "application/octet-stream",
    description: "Size padding so this stands in for a long RAMS",
  });
  return Buffer.from(await doc.save());
}

describe("large site RAMS", () => {
  const owner = new Client({ connectionString: process.env.DATABASE_URL_OWNER });
  let ramsId = "";

  afterAll(async () => {
    if (ramsId) await owner.query("DELETE FROM ops.site_rams WHERE id = $1", [ramsId]);
    await owner.end();
  });

  it("stores an 88-page PDF of about 20 MB and can stream a slice of it", async () => {
    const pdf = await ramsPdf();
    expect(pdf.length).toBeGreaterThan(18 * 1024 * 1024);
    expect(pdf.length).toBeLessThan(28 * 1024 * 1024);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(88);

    await owner.connect();
    const admin = (await owner.query<{ id: string; email: string; name: string }>(
      "SELECT id, email, name FROM ops.users WHERE role = 'admin' AND active ORDER BY email LIMIT 1")).rows[0];
    const site = (await owner.query<{ id: string }>("SELECT id FROM ops.sites WHERE active ORDER BY name LIMIT 1")).rows[0];
    const user: User = { id: admin.id, email: admin.email, username: null, name: admin.name, role: "admin", gang_id: null, must_change_password: false };
    await publishRams(user, {
      siteId: site.id,
      title: "Large RAMS test",
      revision: "large-test",
      active: false,
      file: new File([new Uint8Array(pdf)], "large-rams.pdf", { type: "application/pdf" }),
    });
    const row = (await owner.query<{ id: string; pdf_pages: number; n: number }>(
      "SELECT id, pdf_pages, octet_length(pdf_bytes)::int AS n FROM ops.site_rams WHERE title = 'Large RAMS test' AND revision = 'large-test'")).rows[0];
    ramsId = row.id;
    expect(row.pdf_pages).toBe(88);
    expect(row.n).toBe(pdf.length);
    const slice = await readByteaSlice("ops.site_rams", "pdf_bytes", row.id, 0, 7);
    expect(slice.toString()).toMatch(/^%PDF-/);
  }, 120_000);
});
