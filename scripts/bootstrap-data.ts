// Hosted start-up step 3: first administrator and (once) the private seed.
//  - ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME: created only if that login does not exist.
//    The administrator is also put on the named list when ADMIN_NAMED_LIST=true.
//  - PRIVATE_SEED_B64: base64 of private/seed.private.json. Loaded if set (safe to repeat);
//    remove the variable once loaded.
import bcrypt from "bcryptjs";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openOwner, reportFailure } from "./script-db";

async function main() {
  const db = await openOwner();
  const email = process.env.ADMIN_EMAIL?.toLowerCase().trim(), pw = process.env.ADMIN_PASSWORD;
  if (email && pw) {
    let id = (await db.query("SELECT id FROM ops.users WHERE lower(email) = $1", [email])).rows[0]?.id;
    if (!id) {
      id = (await db.query("INSERT INTO ops.users (email, name, password_hash, role) VALUES ($1, $2, $3, 'admin') RETURNING id",
        [email, process.env.ADMIN_NAME || "Administrator", await bcrypt.hash(pw, 12)])).rows[0].id;
      console.log("bootstrap-data: administrator created");
    }
    if (process.env.ADMIN_NAMED_LIST === "true") {
      const r = await db.query("INSERT INTO commercial.access_list (user_id, added_by, reason) VALUES ($1, 'bootstrap', 'Administrator named in the brief') ON CONFLICT DO NOTHING", [id]);
      if (r.rowCount) await db.query("INSERT INTO commercial.access_list_history (user_id, action, changed_by, reason) VALUES ($1, 'added', 'bootstrap', 'Administrator named in the brief')", [id]);
    }
  }
  await db.end();
  const seed = process.env.PRIVATE_SEED_B64;
  if (seed) {
    const dir = join(tmpdir(), "ks-seed"); mkdirSync(dir, { recursive: true });
    const f = join(dir, "seed.json");
    writeFileSync(f, Buffer.from(seed, "base64"), { mode: 0o600 });
    try { execFileSync("npx", ["tsx", "scripts/seed-private.ts", f], { stdio: "inherit" }); }
    finally { rmSync(f, { force: true }); }
  }
}

main().catch((e) => reportFailure("bootstrap-data", e));
