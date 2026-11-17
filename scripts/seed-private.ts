// Loads K-S's REAL starting data from private/seed.private.json (git-ignored).
// The file holds commercially sensitive rates: never commit it, never use it for demos.
// Safe to re-run: existing records are matched by name and left alone.
import { readFileSync } from "node:fs";
import { Client } from "pg";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

try { process.loadEnvFile(".env"); } catch { /* environment already set */ }

interface Seed {
  clients: { name: string; invoice_frequency_weeks?: number; uses_own_forms?: boolean }[];
  housebuilders: string[];
  sites: { name: string; client?: string | null; housebuilder?: string | null; notes?: string }[];
  rate_items: { code: string; name: string; unit: string; claim_type: string; needs_courses?: boolean }[];
  rate_sets: { name: string; kind: string; client?: string; rates: { item: string; rate: number; effective_from: string; note?: string }[] }[];
  gangs: { name: string; ganger: string; base_set?: string; individual_set?: string; payees?: { name: string; legal_name?: string; entity_type?: string }[] }[];
  named_list_users?: { name: string; email: string; role: string }[];
}

async function main() {
  const path = process.argv[2] ?? "private/seed.private.json";
  const seed: Seed = JSON.parse(readFileSync(path, "utf8"));
  const db = new Client({ connectionString: process.env.DATABASE_URL_OWNER });
  await db.connect();
  const id = async (sql: string, p: unknown[]) => (await db.query(sql, p)).rows[0]?.id as string | undefined;
  await db.query("BEGIN");
  const clientId = new Map<string, string>();
  for (const c of seed.clients) {
    const existing = await id("SELECT id FROM ops.clients WHERE name = $1", [c.name]);
    clientId.set(c.name, existing ?? (await id("INSERT INTO ops.clients (name, invoice_frequency_weeks, uses_own_forms) VALUES ($1, $2, $3) RETURNING id",
      [c.name, c.invoice_frequency_weeks ?? 1, c.uses_own_forms ?? false]))!);
  }
  const hbId = new Map<string, string>();
  for (const h of seed.housebuilders) {
    hbId.set(h, (await id("SELECT id FROM ops.housebuilders WHERE name = $1", [h])) ?? (await id("INSERT INTO ops.housebuilders (name) VALUES ($1) RETURNING id", [h]))!);
  }
  let sites = 0;
  for (const s of seed.sites) {
    if (await id("SELECT id FROM ops.sites WHERE name = $1", [s.name])) continue;
    await db.query("INSERT INTO ops.sites (name, client_id, housebuilder_id, notes) VALUES ($1, $2, $3, $4)",
      [s.name, s.client ? clientId.get(s.client) ?? null : null, s.housebuilder ? hbId.get(s.housebuilder) ?? null : null, s.notes ?? ""]);
    sites++;
  }
  const itemId = new Map<string, string>();
  for (const it of seed.rate_items) {
    itemId.set(it.code, (await id("SELECT id FROM ops.rate_items WHERE code = $1", [it.code])) ?? (await id(
      "INSERT INTO ops.rate_items (code, name, unit, claim_type, needs_courses) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [it.code, it.name, it.unit, it.claim_type, it.needs_courses ?? false]))!);
  }
  const setId = new Map<string, string>();
  let rates = 0;
  for (const rs of seed.rate_sets) {
    const sid = (await id("SELECT id FROM ops.rate_sets WHERE name = $1", [rs.name])) ?? (await id(
      "INSERT INTO ops.rate_sets (name, kind, client_id) VALUES ($1, $2, $3) RETURNING id", [rs.name, rs.kind, rs.client ? clientId.get(rs.client) : null]))!;
    setId.set(rs.name, sid);
    for (const r of rs.rates) {
      const iid = itemId.get(r.item);
      if (!iid) throw new Error(`Unknown item ${r.item} in ${rs.name}`);
      const res = await db.query("INSERT INTO ops.gang_rates (rate_set_id, item_id, rate, effective_from) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING", [sid, iid, r.rate, r.effective_from]);
      rates += res.rowCount ?? 0;
    }
  }
  let gangs = 0;
  for (const g of seed.gangs) {
    if (await id("SELECT id FROM ops.gangs WHERE name = $1", [g.name])) continue;
    const gid = (await id("INSERT INTO ops.gangs (name, ganger_name, base_rate_set_id, individual_rate_set_id) VALUES ($1, $2, $3, $4) RETURNING id",
      [g.name, g.ganger, g.base_set ? setId.get(g.base_set) ?? null : null, g.individual_set ? setId.get(g.individual_set) ?? null : null]))!;
    for (const p of g.payees ?? [{ name: g.ganger }]) {
      // Not cleared for payment until the payment company confirms it.
      await db.query("INSERT INTO ops.payees (gang_id, name, legal_name, entity_type, eligible) VALUES ($1, $2, $3, $4, false)",
        [gid, p.name, p.legal_name ?? p.name, p.entity_type ?? "sole_trader"]);
    }
    gangs++;
  }
  const created: string[] = [];
  for (const u of seed.named_list_users ?? []) {
    let uid = await id("SELECT id FROM ops.users WHERE lower(email) = lower($1)", [u.email]);
    if (!uid) {
      // Random password nobody knows: an administrator sets the real login and password in Setup.
      const pw = randomBytes(24).toString("base64url");
      uid = await id("INSERT INTO ops.users (email, name, password_hash, role) VALUES (lower($1), $2, $3, $4) RETURNING id", [u.email, u.name, await bcrypt.hash(pw, 12), u.role]);
      created.push(`${u.name} <${u.email}>`);
    }
    const added = await db.query("INSERT INTO commercial.access_list (user_id, added_by, reason) VALUES ($1, 'seed-private', 'Named in the meeting brief') ON CONFLICT DO NOTHING", [uid]);
    if (added.rowCount) await db.query("INSERT INTO commercial.access_list_history (user_id, action, changed_by, reason) VALUES ($1, 'added', 'seed-private', 'Named in the meeting brief')", [uid]);
  }
  await db.query("COMMIT");
  await db.end();
  console.log(`Loaded: ${sites} sites, ${rates} gang rates, ${gangs} gangs.`);
  if (created.length) { console.log("New named-list users (set their login email and password in Setup, Users):"); created.forEach((c) => console.log("  " + c)); }
}

main().catch((e) => { console.error(e); process.exit(1); });
