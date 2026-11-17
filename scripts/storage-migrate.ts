// Copies Postgres file bytes to the private S3 bucket, checks the copy, then clears the database bytes.
// An administrator runs this once after STORAGE_DRIVER=s3 is set. Signatures are included unless --skip-signatures is passed.
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Client } from "pg";
import { copyVerified } from "../src/lib/object-store";
import { s3ObjectStore } from "../src/lib/storage-s3";
import { clientConfig, ownerConnectionString } from "../src/lib/pg-config";

const skipSignatures = process.argv.includes("--skip-signatures");

function keyFor(prefix: string, id: string, name: string) {
  const ext = (name.split(".").pop() || "bin").replace(/[^\w]/g, "").slice(0, 8) || "bin";
  return `files/migrated/${prefix}/${id}.${ext}`;
}

async function main() {
  if (process.env.STORAGE_DRIVER !== "s3") {
    console.error("Refusing: set STORAGE_DRIVER=s3 before migrating files.");
    process.exit(1);
  }
  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!adminEmail) {
    console.error("Refusing: set ADMIN_EMAIL to an active administrator. This copy is admin-only.");
    process.exit(1);
  }
  const url = ownerConnectionString();
  if (!url) throw new Error("DATABASE_URL_OWNER or DATABASE_URL is required.");
  const db = new Client(clientConfig(url));
  await db.connect();
  const admin = (await db.query("SELECT 1 FROM ops.users WHERE role = 'admin' AND active AND lower(email) = $1", [adminEmail])).rowCount;
  if (!admin) {
    console.error("Refusing: ADMIN_EMAIL is not an active administrator.");
    process.exit(1);
  }
  const store = s3ObjectStore();
  let moved = 0;

  const rams = (await db.query<{ id: string; pdf_name: string; pdf_bytes: Buffer }>(
    "SELECT id, pdf_name, pdf_bytes FROM ops.site_rams WHERE pdf_bytes IS NOT NULL")).rows;
  for (const row of rams) {
    const key = keyFor("rams", row.id, row.pdf_name);
    const body = Buffer.isBuffer(row.pdf_bytes) ? row.pdf_bytes : Buffer.from(row.pdf_bytes);
    await copyVerified(store, key, body, "application/pdf", async () => {
      await db.query("UPDATE ops.site_rams SET storage_key = $2, pdf_bytes = NULL WHERE id = $1", [row.id, key]);
    });
    moved++;
    console.log(`rams ${row.id} -> ${key}`);
  }

  const alerts = (await db.query<{ id: string; attachment_name: string | null; attachment_mime: string | null; attachment_bytes: Buffer }>(
    "SELECT id, attachment_name, attachment_mime, attachment_bytes FROM ops.hs_alerts WHERE attachment_bytes IS NOT NULL")).rows;
  for (const row of alerts) {
    const key = keyFor("hs", row.id, row.attachment_name ?? "file.pdf");
    const body = Buffer.isBuffer(row.attachment_bytes) ? row.attachment_bytes : Buffer.from(row.attachment_bytes);
    await copyVerified(store, key, body, row.attachment_mime ?? "application/pdf", async () => {
      await db.query("UPDATE ops.hs_alerts SET attachment_key = $2, attachment_bytes = NULL WHERE id = $1", [row.id, key]);
    });
    moved++;
    console.log(`hs ${row.id} -> ${key}`);
  }

  const sheets = (await db.query<{ id: string; original_name: string; mime: string; content: Buffer }>(
    "SELECT id, original_name, mime, content FROM ops.attachments WHERE content IS NOT NULL")).rows;
  for (const row of sheets) {
    const key = keyFor("attachment", row.id, row.original_name);
    const body = Buffer.isBuffer(row.content) ? row.content : Buffer.from(row.content);
    await copyVerified(store, key, body, row.mime, async () => {
      await db.query("UPDATE ops.attachments SET storage_key = $2, content = NULL WHERE id = $1", [row.id, key]);
    });
    moved++;
    console.log(`attachment ${row.id} -> ${key}`);
  }

  if (!skipSignatures) {
    const disk = (await db.query<{ id: string; storage_key: string; mime: string; original_name: string }>(
      "SELECT id, storage_key, mime, original_name FROM ops.attachments WHERE content IS NULL AND storage_key NOT LIKE 'files/%' AND kind = 'signature'")).rows;
    const root = resolve(process.env.UPLOAD_DIR || "./uploads");
    for (const row of disk) {
      const body = await readFile(join(root, row.storage_key)).catch(() => null);
      if (!body) { console.log(`skip missing signature ${row.id}`); continue; }
      const key = keyFor("signature", row.id, row.original_name);
      await copyVerified(store, key, body, row.mime, async () => {
        await db.query("UPDATE ops.attachments SET storage_key = $2 WHERE id = $1", [row.id, key]);
      });
      moved++;
    }
  }

  console.log(`Moved ${moved} file${moved === 1 ? "" : "s"}.`);
  await db.end();
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
