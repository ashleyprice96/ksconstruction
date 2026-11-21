import Link from "next/link";
import { requireUser, type User } from "@/lib/auth";
import { isNamedUser } from "@/lib/commercial";
import { changeNamedList, namedListForAdmin, MarginAccessError } from "@/lib/margin-access";
import { NotNamedUser } from "@/lib/commercial";
import { fulfilResetRequest } from "@/lib/passwords";
import { q, tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { changeLogin, createUser, importEligibility, resetPassword, setUserActive, addSiteRate, addSiteLiftValue, AdminError } from "@/lib/admin";
import { publishSafetyAlert, safetyRoster, setSafetyAlertActive, SafetyError } from "@/lib/safety";
import { publishRams, ramsRoster } from "@/lib/rams";
import { deletedClaims, restoreClaim, ClaimError } from "@/lib/claims";
import ProgressForm from "@/components/ProgressForm";
import { formatBytes, storageUsage } from "@/lib/storage-usage";
import { storageDriver } from "@/lib/object-store";
import { back, safeMessage, str } from "@/lib/forms";
import { claimsEnabled } from "@/lib/features";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { gbp } from "@/lib/money";
import Flash from "@/components/Flash";

const P = "/setup";

/** Runs a setup action: management only, errors shown generically unless known. */
async function runAct(section: string, f: FormData, fn: (user: User) => Promise<string>) {
  const user = await requireUser(["management", "admin"]);
  if (!claimsEnabled() && section !== "users" && section !== "safety") {
    back(P, "error", "That section is not part of this release.");
  }
  let msg = "";
  try { msg = await fn(user); }
  catch (e) {
    const pgUnique = e && typeof e === "object" && "code" in e && (e as { code: string }).code === "23505";
    back(`${P}?s=${section}`, "error", pgUnique ? "That already exists." : safeMessage(e, [AdminError, MarginAccessError, NotNamedUser, SafetyError, ClaimError]));
  }
  back(`${P}?s=${section}`, "ok", msg);
}
const need = (v: string, what: string) => { if (!v) throw new AdminError(`Enter ${what}.`); return v; };

async function addClient(f: FormData) {
  "use server";
  await runAct("sites", f, async (u) => {
  await q("INSERT INTO ops.clients (name, invoice_frequency_weeks, uses_own_forms) VALUES ($1, $2, $3)",
    [need(str(f, "name"), "a name"), Number(str(f, "freq") || 1), f.get("own_forms") === "on"]);
  await audit(u.id, "client", str(f, "name"), "created");
  return "Client added.";
});
}

async function addHousebuilder(f: FormData) {
  "use server";
  await runAct("sites", f, async (u) => {
  await q("INSERT INTO ops.housebuilders (name) VALUES ($1)", [need(str(f, "name"), "a name")]);
  return "Housebuilder added.";
});
}

/** Plot numbers from "1-20, 25, 30A". */
function parsePlots(spec: string): string[] {
  const nums: string[] = [];
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (m) { const [a, b] = [Number(m[1]), Number(m[2])]; if (b - a > 500 || b < a) throw new AdminError("Check the plot range."); for (let i = a; i <= b; i++) nums.push(String(i)); }
    else nums.push(part.slice(0, 20));
  }
  return nums;
}

/** One step: site, client (existing or new), job number, house type and plots. */
async function addSite(f: FormData) {
  "use server";
  await runAct("sites", f, async (u) => {
    const name = need(str(f, "name"), "a site name");
    const plots = str(f, "plots") ? parsePlots(str(f, "plots")) : [];
    const job = str(f, "job");
    if (plots.length && !job) throw new AdminError("Add a job number for the plots.");
    return tx(async (db) => {
      let clientId = str(f, "client_id") || null;
      if (str(f, "new_client")) {
        const c = await db.query<{ id: string }>(
          "INSERT INTO ops.clients (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id", [str(f, "new_client")]);
        clientId = c.rows[0].id;
      }
      const site = (await db.query<{ id: string }>(
        "INSERT INTO ops.sites (name, client_id, housebuilder_id, region, address) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [name, clientId, str(f, "housebuilder_id") || null, str(f, "region"), str(f, "address")])).rows[0].id;
      let added = 0;
      if (job) {
        const jobId = (await db.query<{ id: string }>("INSERT INTO ops.job_numbers (site_id, code) VALUES ($1, $2) RETURNING id", [site, job])).rows[0].id;
        let houseType: string | null = null;
        if (str(f, "house_type")) {
          houseType = (await db.query<{ id: string }>(
            "INSERT INTO ops.house_types (name, site_id) VALUES ($1, $2) RETURNING id", [str(f, "house_type"), site])).rows[0].id;
        }
        for (const n of plots) {
          added += (await db.query("INSERT INTO ops.plots (site_id, job_number_id, house_type_id, plot_number) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING", [site, jobId, houseType, n])).rowCount ?? 0;
        }
      }
      await audit(u.id, "site", site, "created", { name, job, plots: added }, db);
      return `Site added${job ? ` with job number ${job}` : ""}${added ? ` and ${added} plot${added === 1 ? "" : "s"}` : ""}.${clientId && job ? " Gangs can now claim on it." : clientId ? " Add a job number so gangs can claim." : " Set the client and a job number so gangs can claim."}`;
    });
  });
}

async function updateSite(f: FormData) {
  "use server";
  await runAct("sites", f, async (u) => {
  await q("UPDATE ops.sites SET client_id = $2, housebuilder_id = $3, active = $4 WHERE id = $1",
    [str(f, "site_id"), str(f, "client_id") || null, str(f, "housebuilder_id") || null, f.get("active") === "on"]);
  await audit(u.id, "site", str(f, "site_id"), "updated");
  return "Site updated.";
});
}

async function saveSiteRate(f: FormData) {
  "use server";
  await runAct("sites", f, async (u) => {
    await addSiteRate(u, str(f, "site_id"), str(f, "item_id"), Number(str(f, "rate")), str(f, "effective_from"));
    return "Site rate saved.";
  });
}
async function saveSiteLift(f: FormData) {
  "use server";
  await runAct("sites", f, async (u) => {
    await addSiteLiftValue(u, str(f, "site_id"), str(f, "lift_id"), Number(str(f, "gang_value")), str(f, "effective_from"));
    return "Site lift price saved.";
  });
}

async function addJob(f: FormData) {
  "use server";
  await runAct("sites", f, async (u) => {
  await q("INSERT INTO ops.job_numbers (site_id, code, description) VALUES ($1, $2, $3)", [str(f, "site_id"), need(str(f, "code"), "a job number"), str(f, "description")]);
  await audit(u.id, "job_number", str(f, "code"), "created");
  return "Job number added.";
});
}

async function addHouseType(f: FormData) {
  "use server";
  await runAct("sites", f, async (u) => {
  await q("INSERT INTO ops.house_types (name, site_id) VALUES ($1, $2)", [need(str(f, "name"), "a house type"), str(f, "site_id") || null]);
  return "House type added.";
});
}

async function addLift(f: FormData) {
  "use server";
  await runAct("sites", f, async (u) => {
  const value = Number(str(f, "gang_value"));
  if (!(value >= 0)) throw new AdminError("Enter the gang value.");
  const lift = await q<{ id: string }>("INSERT INTO ops.lifts (house_type_id, name, sort, is_patch) VALUES ($1, $2, $3, $4) RETURNING id",
    [str(f, "house_type_id"), need(str(f, "name"), "a lift name"), Number(str(f, "sort") || 1), f.get("is_patch") === "on"]);
  await q("INSERT INTO ops.lift_values (lift_id, gang_value, effective_from) VALUES ($1, $2, $3)", [lift[0].id, value, need(str(f, "effective_from"), "a date")]);
  await audit(u.id, "lift", lift[0].id, "created", { value });
  return "Lift added.";
});
}

async function addLiftValue(f: FormData) {
  "use server";
  await runAct("sites", f, async (u) => {
  const value = Number(str(f, "gang_value"));
  if (!(value >= 0)) throw new AdminError("Enter the gang value.");
  await q("INSERT INTO ops.lift_values (lift_id, gang_value, effective_from) VALUES ($1, $2, $3)", [str(f, "lift_id"), value, need(str(f, "effective_from"), "a date")]);
  await audit(u.id, "lift", str(f, "lift_id"), "value_added", { value });
  return "Lift value saved.";
});
}

async function addPlots(f: FormData) {
  "use server";
  await runAct("sites", f, async (u) => {
  const nums = parsePlots(need(str(f, "plots"), "plot numbers"));
  const job = await q<{ site_id: string }>("SELECT site_id FROM ops.job_numbers WHERE id = $1", [str(f, "job_id")]);
  if (!job[0]) throw new AdminError("Choose a job number.");
  let added = 0;
  for (const n of nums) {
    const r = await q("INSERT INTO ops.plots (site_id, job_number_id, house_type_id, plot_number) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id",
      [job[0].site_id, str(f, "job_id"), str(f, "house_type_id") || null, n]);
    added += r.length;
  }
  await audit(u.id, "plots", str(f, "job_id"), "added", { added });
  return `${added} plot${added === 1 ? "" : "s"} added.`;
});
}

async function addGang(f: FormData) {
  "use server";
  await runAct("gangs", f, async (u) => {
  await q("INSERT INTO ops.gangs (name, ganger_name) VALUES ($1, $2)", [need(str(f, "name"), "a gang name"), need(str(f, "ganger"), "the ganger's name")]);
  await audit(u.id, "gang", str(f, "name"), "created");
  return "Gang added. Set its rates on the Gang rates page.";
});
}

async function addPayee(f: FormData) {
  "use server";
  await runAct("gangs", f, async (u) => {
  await q("INSERT INTO ops.payees (gang_id, name, legal_name, entity_type, payment_ref, eligible, eligibility_updated_at) VALUES ($1, $2, $3, $4, $5, $6, now())",
    [str(f, "gang_id"), need(str(f, "name"), "a name"), str(f, "legal_name") || str(f, "name"), str(f, "entity_type"), str(f, "payment_ref") || null, f.get("eligible") === "on"]);
  await audit(u.id, "payee", str(f, "name"), "created", { eligible: f.get("eligible") === "on" });
  return "Gang member added.";
});
}

async function setEligible(f: FormData) {
  "use server";
  await runAct("gangs", f, async (u) => {
  const eligible = str(f, "eligible") === "true";
  await q("UPDATE ops.payees SET eligible = $2, eligibility_source = 'manual', eligibility_updated_at = now() WHERE id = $1", [str(f, "payee_id"), eligible]);
  await audit(u.id, "payee", str(f, "payee_id"), eligible ? "marked_eligible" : "marked_not_eligible");
  return "Eligibility updated.";
});
}

async function importCsv(f: FormData) {
  "use server";
  await runAct("gangs", f, async (u) => {
  const file = f.get("file");
  if (!(file instanceof File) || file.size === 0) throw new AdminError("Choose the CSV file.");
  if (file.size > 2_000_000) throw new AdminError("The file is too large.");
  const r = await importEligibility(u, await file.text());
  return `${r.updated} gang member${r.updated === 1 ? "" : "s"} updated.${r.unmatched.length ? ` ${r.unmatched.length} reference${r.unmatched.length === 1 ? "" : "s"} not matched: ${r.unmatched.slice(0, 10).join(", ")}` : ""}`;
});
}

async function addSupervision(f: FormData) {
  "use server";
  await runAct("gangs", f, async (u) => {
  const amount = Number(str(f, "weekly_amount"));
  if (!(amount >= 0)) throw new AdminError("Enter the weekly amount.");
  await q("INSERT INTO ops.supervision_assignments (payee_id, site_id, weekly_amount, start_date, end_date) VALUES ($1, $2, $3, $4, $5)",
    [str(f, "payee_id"), str(f, "site_id"), amount, need(str(f, "start_date"), "a start date"), str(f, "end_date") || null]);
  await audit(u.id, "supervision", str(f, "payee_id"), "assigned", { amount });
  return "Supervisor assigned.";
});
}

async function newUser(f: FormData) {
  "use server";
  await runAct("users", f, async (u) => {
  await createUser(u, { email: str(f, "email"), username: str(f, "username"), name: str(f, "name"), role: str(f, "role"), gangId: str(f, "gang_id") || null, password: String(f.get("password") ?? "") });
  return "User created. Give them their password in person, not by email.";
});
}

async function resetPw(f: FormData) {
  "use server";
  await runAct("users", f, async (u) => { await resetPassword(u, str(f, "user_id"), String(f.get("password") ?? "")); return "Password reset. The user has been signed out everywhere."; });
}

async function editLogin(f: FormData) {
  "use server";
  await runAct("users", f, async (u) => { await changeLogin(u, str(f, "user_id"), str(f, "email"), str(f, "username"), str(f, "name")); return "Login updated."; });
}
async function toggleUser(f: FormData) {
  "use server";
  await runAct("users", f, async (u) => { await setUserActive(u, str(f, "user_id"), str(f, "active") === "true"); return "User updated."; });
}

async function issueTemporary(f: FormData) {
  "use server";
  await runAct("users", f, async (u) => fulfilResetRequest(u, str(f, "request_id")));
}
async function addMargin(f: FormData) {
  "use server";
  await runAct("margin", f, async (u) => {
    await changeNamedList(u, str(f, "user_id"), "add", str(f, "reason"));
    return "Added to the named list.";
  });
}
async function removeMargin(f: FormData) {
  "use server";
  await runAct("margin", f, async (u) => {
    await changeNamedList(u, str(f, "user_id"), "remove", str(f, "reason"));
    return "Removed from the named list.";
  });
}

async function saveSettings(f: FormData) {
  "use server";
  await runAct("settings", f, async (u) => {
  const cutoff = { weekday: Number(str(f, "cutoff_weekday")), time: str(f, "cutoff_time"), timezone: "Europe/London" };
  if (!(cutoff.weekday >= 0 && cutoff.weekday <= 6) || !/^\d{2}:\d{2}$/.test(cutoff.time)) throw new AdminError("Check the cut-off.");
  const days = Number(str(f, "payless_days"));
  if (!(days >= 0 && days <= 30)) throw new AdminError("Check the pay-less days.");
  const reasons = str(f, "reasons").split("\n").map((s) => s.trim()).filter(Boolean);
  if (!reasons.length) throw new AdminError("Enter at least one reason.");
  const types = ["substructure", "superstructure", "daywork", "supervision"];
  const minPhotos = Object.fromEntries(types.map((t) => [t, Math.max(1, Number(str(f, `photos_${t}`) || 1))]));
  const sig = Object.fromEntries(types.map((t) => [t, f.get(`sig_${t}`) === "on"]));
  const set = (k: string, v: unknown) => q("UPDATE ops.settings SET value = $2 WHERE key = $1", [k, JSON.stringify(v)]);
  await set("cutoff", cutoff); await set("payless_days_before_payment", days); await set("payless_reasons", reasons);
  await set("min_photos", minPhotos); await set("signature_required", sig);
  await audit(u.id, "settings", "all", "updated", { cutoff, days, reasons, minPhotos, sig });
  return "Settings saved.";
});
}

async function publishAlert(f: FormData) {
  "use server";
  await runAct("safety", f, async (u) => {
    const file = f.get("attachment");
    const kind = str(f, "kind") === "toolbox" ? "toolbox" : "alert";
    await publishSafetyAlert(u, {
      kind,
      title: str(f, "title"),
      body: str(f, "body"),
      active: f.get("active") === "on",
      dueOn: str(f, "due_on"),
      siteIds: f.getAll("site_id").map(String),
      file: file instanceof File ? file : null,
    });
    return kind === "toolbox"
      ? "Toolbox talk published. Everyone with a login must open it and sign before they can continue."
      : "Health and safety alert published. Everyone with a login must sign it before they can continue.";
  });
}
async function publishRamsDoc(f: FormData) {
  "use server";
  await runAct("safety", f, async (u) => {
    const file = f.get("pdf");
    await publishRams(u, {
      siteId: str(f, "site_id"),
      title: str(f, "title"),
      revision: str(f, "revision"),
      active: f.get("active") === "on",
      file: file instanceof File ? file : new File([], ""),
    });
    return "RAMS published. Gang leads must sign this revision for the site.";
  });
}
async function restoreDeleted(f: FormData) {
  "use server";
  await runAct("deleted", f, async (u) => {
    await restoreClaim(u, str(f, "claim_id"));
    return "Claim restored.";
  });
}
async function toggleAlert(f: FormData) {
  "use server";
  await runAct("safety", f, async (u) => {
    const on = f.get("make_active") === "1";
    await setSafetyAlertActive(u, str(f, "alert_id"), on);
    return on ? "Alert is active. Anyone who has not confirmed it is blocked." : "Alert turned off. It no longer blocks anyone.";
  });
}

const TABS = { sites: "Sites and plots", gangs: "Gangs and payees", users: "Users", safety: "Health and safety", deleted: "Deleted claims", settings: "Settings", margin: "Margin access" } as const;

export default async function Setup({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser(["management", "admin"]);
  const sp = await searchParams;
  const namedAdmin = claimsEnabled() && user.role === "admin" && await isNamedUser(user);
  const tabs = (Object.entries(TABS) as [keyof typeof TABS, string][]).filter(([k]) => {
    if (!claimsEnabled() && k !== "users" && k !== "safety") return false;
    return k !== "margin" || namedAdmin;
  });
  const s = (tabs.some(([k]) => k === sp.s) ? sp.s : claimsEnabled() ? "sites" : "safety") as keyof typeof TABS;
  const pending = await q1count();
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Management</div><h1>Setup</h1></div></div>
      <div className="steps">{tabs.map(([k, v]) => k === s ? <span key={k} className="current">{v}{k === "users" && pending > 0 ? ` (${pending})` : ""}</span> : <Link key={k} href={`${P}?s=${k}`}>{v}{k === "users" && pending > 0 ? ` (${pending})` : ""}</Link>)}</div>
      <Flash sp={sp} />
      {s === "sites" && <SitesTab />}
      {s === "gangs" && <GangsTab />}
      {s === "users" && <UsersTab user={user} />}
      {s === "safety" && <SafetyTab admin={user.role === "admin"} />}
      {s === "deleted" && <DeletedTab />}
      {s === "settings" && <SettingsTab />}
      {s === "margin" && namedAdmin && <MarginTab actor={user} />}
    </>
  );
}

async function q1count() {
  const r = await q<{ n: string }>("SELECT count(*)::text AS n FROM ops.password_reset_requests WHERE status = 'pending' AND user_id IS NOT NULL");
  return Number(r[0]?.n ?? 0);
}

async function SitesTab() {
  const [clients, hbs, sites, jobs, hts, lifts, items] = await Promise.all([
    q<{ id: string; name: string; invoice_frequency_weeks: number; uses_own_forms: boolean }>("SELECT id, name, invoice_frequency_weeks, uses_own_forms FROM ops.clients ORDER BY name"),
    q<{ id: string; name: string }>("SELECT id, name FROM ops.housebuilders ORDER BY name"),
    q<{ id: string; name: string; client_id: string | null; housebuilder_id: string | null; active: boolean; region: string; jobs: string; plots: string }>(
      `SELECT s.id, s.name, s.client_id, s.housebuilder_id, s.active, s.region,
         (SELECT string_agg(code, ', ' ORDER BY code) FROM ops.job_numbers j WHERE j.site_id = s.id) AS jobs,
         (SELECT count(*) FROM ops.plots p WHERE p.site_id = s.id) AS plots
       FROM ops.sites s ORDER BY s.active DESC, s.name`),
    q<{ id: string; code: string; site: string }>("SELECT j.id, j.code, s.name AS site FROM ops.job_numbers j JOIN ops.sites s ON s.id = j.site_id ORDER BY s.name, j.code"),
    q<{ id: string; name: string; site: string | null }>("SELECT h.id, h.name, s.name AS site FROM ops.house_types h LEFT JOIN ops.sites s ON s.id = h.site_id ORDER BY h.name"),
    q<{ id: string; name: string; house_type: string; gang_value: string | null; effective_from: string | null }>(
      `SELECT l.id, l.name, h.name AS house_type,
         (SELECT gang_value::text FROM ops.lift_values v WHERE v.lift_id = l.id AND v.effective_from <= current_date ORDER BY effective_from DESC LIMIT 1) AS gang_value,
         (SELECT to_char(effective_from, 'YYYY-MM-DD') FROM ops.lift_values v WHERE v.lift_id = l.id AND v.effective_from <= current_date ORDER BY effective_from DESC LIMIT 1) AS effective_from
       FROM ops.lifts l JOIN ops.house_types h ON h.id = l.house_type_id ORDER BY h.name, l.sort`),
    q<{ id: string; name: string; unit: string }>("SELECT id, name, unit FROM ops.rate_items WHERE active ORDER BY claim_type, sort, name"),
  ]);
  return (
    <>
      <h2>Sites</h2>
      <p className="small muted">Client is who K-S invoices; housebuilder is whose development it is. They can differ.</p>
      <div className="table-wrap dense"><table>
        <thead><tr><th>Site</th><th>Job numbers</th><th>Plots</th><th>Client, housebuilder, active</th></tr></thead>
        <tbody>{sites.map((site) => (
          <tr key={site.id}><td>{site.name}<div className="small muted">{site.region}</div></td><td className="small">{site.jobs ?? <span style={{ color: "var(--bad)" }}>None: gangs cannot claim</span>}</td><td>{site.plots}</td>
            <td><form action={updateSite} className="row" style={{ alignItems: "end" }}>
              <input type="hidden" name="site_id" value={site.id} />
              <select name="client_id" aria-label="Client" defaultValue={site.client_id ?? ""}><option value="">No client yet</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              <select name="housebuilder_id" aria-label="Housebuilder" defaultValue={site.housebuilder_id ?? ""}><option value="">No housebuilder</option>{hbs.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
              <label className="small" style={{ fontWeight: 400 }}><input type="checkbox" name="active" defaultChecked={site.active} /> Active</label>
              <button className="btn secondary small" type="submit">Save</button>
            </form></td></tr>
        ))}</tbody>
      </table></div>

      <div className="grid" style={{ marginTop: 16 }}>
        <form action={addSite} className="card stack" style={{ gridColumn: "1 / -1" }}><h3 style={{ marginTop: 0 }}>Add a site</h3>
          <p className="small muted" style={{ margin: 0 }}>Everything a gang needs to claim, in one go: site, client, job number and plots. Only the site name is required; the rest can be added later.</p>
          <div className="row">
            <div><label htmlFor="as_name">Site name</label><input id="as_name" name="name" type="text" required /></div>
            <div><label htmlFor="as_job">Job number</label><input id="as_job" name="job" type="text" maxLength={30} /></div>
          </div>
          <div className="row">
            <div><label htmlFor="as_client">Client (who K-S invoices)</label><select id="as_client" name="client_id"><option value="">Not known yet</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label htmlFor="as_newclient">Or a new client</label><input id="as_newclient" name="new_client" type="text" placeholder="Type a new client name" /></div>
            <div><label htmlFor="as_hb">Housebuilder</label><select id="as_hb" name="housebuilder_id"><option value="">Not known yet</option>{hbs.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></div>
          </div>
          <div className="row">
            <div><label htmlFor="as_plots">Plots<span className="hint">For example 1-20, 25, 30A</span></label><input id="as_plots" name="plots" type="text" /></div>
            <div><label htmlFor="as_ht">House type for these plots</label><input id="as_ht" name="house_type" type="text" /></div>
          </div>
          <div className="row"><div><label htmlFor="as_region">Region</label><input id="as_region" name="region" type="text" /></div><div><label htmlFor="as_addr">Address</label><input id="as_addr" name="address" type="text" /></div></div>
          <button className="btn" type="submit">Add site</button></form>
        <form action={addJob} className="card stack"><h3 style={{ marginTop: 0 }}>Add job number</h3>
          <div><label htmlFor="aj_site">Site</label><select id="aj_site" name="site_id" required>{sites.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
          <div><label htmlFor="aj_code">Job number</label><input id="aj_code" name="code" type="text" required maxLength={30} /></div>
          <div><label htmlFor="aj_desc">Description</label><input id="aj_desc" name="description" type="text" /></div>
          <button className="btn secondary" type="submit">Add job number</button></form>
        <form action={addPlots} className="card stack"><h3 style={{ marginTop: 0 }}>Add plots</h3>
          <div><label htmlFor="ap_job">Job number</label><select id="ap_job" name="job_id" required>{jobs.map((j) => <option key={j.id} value={j.id}>{j.site} · {j.code}</option>)}</select></div>
          <div><label htmlFor="ap_ht">House type</label><select id="ap_ht" name="house_type_id"><option value="">Not set</option>{hts.map((h) => <option key={h.id} value={h.id}>{h.name}{h.site ? ` (${h.site})` : ""}</option>)}</select></div>
          <div><label htmlFor="ap_plots">Plot numbers<span className="hint">Ranges and lists, for example 1-20, 25, 30A</span></label><input id="ap_plots" name="plots" type="text" required /></div>
          <button className="btn secondary" type="submit">Add plots</button></form>
        <form action={saveSiteRate} className="card stack" style={{ gridColumn: "1 / -1" }}><h3 style={{ marginTop: 0 }}>Site rate card</h3>
          <p className="small muted">Gang pay rates for a site. Any gang lead can claim here and is paid from this card, unless that gang has an override. North sites can be priced higher, for example £10 more per 1,000 on commons and facings. This is not the client charge rate.</p>
          <div className="row">
            <div><label htmlFor="sr_site">Site</label><select id="sr_site" name="site_id" required>{sites.map((x) => <option key={x.id} value={x.id}>{x.name}{x.region ? ` · ${x.region}` : ""}</option>)}</select></div>
            <div><label htmlFor="sr_item">Item</label><select id="sr_item" name="item_id" required>{items.map((i) => <option key={i.id} value={i.id}>{i.name} (per {i.unit})</option>)}</select></div>
            <div><label htmlFor="sr_rate">Gang rate (£)</label><input id="sr_rate" name="rate" type="number" min="0" step="0.0001" required /></div>
            <div><label htmlFor="sr_from">Effective from</label><input id="sr_from" name="effective_from" type="date" required /></div>
          </div>
          <button className="btn" type="submit">Save site rate</button>
        </form>
        <form action={saveSiteLift} className="card stack"><h3 style={{ marginTop: 0 }}>Site lift price</h3>
          <p className="small muted">Optional. When set, this gang price is used for that lift on this site instead of the house-type price.</p>
          <div className="row">
            <div><label htmlFor="sl_site">Site</label><select id="sl_site" name="site_id" required>{sites.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
            <div><label htmlFor="sl_lift">Lift</label><select id="sl_lift" name="lift_id" required>{lifts.map((l) => <option key={l.id} value={l.id}>{l.house_type}: {l.name}</option>)}</select></div>
            <div><label htmlFor="sl_value">Gang price (£)</label><input id="sl_value" name="gang_value" type="number" min="0" step="0.01" required /></div>
            <div><label htmlFor="sl_from">Effective from</label><input id="sl_from" name="effective_from" type="date" required /></div>
          </div>
          <button className="btn secondary" type="submit">Save lift price</button>
        </form>
      </div>

      <h2>House types, lifts and patch (gang values)</h2>
      <p className="small muted">Superstructure is a fixed gang price per plot and house type, split into lifts plus patch. The lift and patch values are still to be supplied by K-S. Client values for the same lifts are entered in the restricted commercial area.</p>
      <div className="table-wrap dense"><table>
        <thead><tr><th>House type</th><th>Lift</th><th className="num">Gang value</th><th>Since</th><th>New value</th></tr></thead>
        <tbody>{lifts.map((l) => (
          <tr key={l.id}><td>{l.house_type}</td><td>{l.name}</td><td className="num">{l.gang_value ? gbp(l.gang_value) : "Not set"}</td><td>{l.effective_from ? fmtDate(l.effective_from) : ""}</td>
            <td><form action={addLiftValue} className="row" style={{ alignItems: "end" }}><input type="hidden" name="lift_id" value={l.id} />
              <input name="gang_value" type="number" step="0.01" min="0" required aria-label="Gang value" /><input name="effective_from" type="date" required aria-label="Effective from" />
              <button className="btn secondary small" type="submit">Save</button></form></td></tr>
        ))}</tbody>
      </table></div>
      <div className="grid" style={{ marginTop: 16 }}>
        <form action={addHouseType} className="card stack"><h3 style={{ marginTop: 0 }}>Add house type</h3>
          <div><label htmlFor="ah_name">Name</label><input id="ah_name" name="name" type="text" required /></div>
          <div><label htmlFor="ah_site">Site (if specific to one site)</label><select id="ah_site" name="site_id"><option value="">Any site</option>{sites.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
          <button className="btn secondary" type="submit">Add house type</button></form>
        <form action={addLift} className="card stack"><h3 style={{ marginTop: 0 }}>Add lift or patch</h3>
          <div><label htmlFor="al_ht">House type</label><select id="al_ht" name="house_type_id" required>{hts.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></div>
          <div className="row"><div><label htmlFor="al_name">Name</label><input id="al_name" name="name" type="text" required placeholder="1st lift" /></div>
            <div><label htmlFor="al_sort">Order</label><input id="al_sort" name="sort" type="number" min="1" defaultValue={1} /></div></div>
          <div className="row"><div><label htmlFor="al_val">Gang value (£)</label><input id="al_val" name="gang_value" type="number" step="0.01" min="0" required /></div>
            <div><label htmlFor="al_from">Effective from</label><input id="al_from" name="effective_from" type="date" required /></div></div>
          <label className="small" style={{ fontWeight: 400 }}><input type="checkbox" name="is_patch" /> This is the patch</label>
          <button className="btn secondary" type="submit">Add</button></form>
      </div>

      <h2>Clients and housebuilders</h2>
      <div className="table-wrap dense"><table>
        <thead><tr><th>Client</th><th>Invoiced every</th><th>Own forms only</th></tr></thead>
        <tbody>{clients.map((c) => <tr key={c.id}><td>{c.name}</td><td>{c.invoice_frequency_weeks} week{c.invoice_frequency_weeks > 1 ? "s" : ""}</td><td>{c.uses_own_forms ? "Yes" : "No"}</td></tr>)}</tbody>
      </table></div>
      <div className="grid" style={{ marginTop: 16 }}>
        <form action={addClient} className="card stack"><h3 style={{ marginTop: 0 }}>Add client</h3>
          <div><label htmlFor="ac_name">Name</label><input id="ac_name" name="name" type="text" required /></div>
          <div><label htmlFor="ac_freq">Invoiced every (weeks)</label><input id="ac_freq" name="freq" type="number" min="1" max="8" defaultValue={1} /></div>
          <label className="small" style={{ fontWeight: 400 }}><input type="checkbox" name="own_forms" /> May only accept its own forms</label>
          <button className="btn secondary" type="submit">Add client</button></form>
        <form action={addHousebuilder} className="card stack"><h3 style={{ marginTop: 0 }}>Add housebuilder</h3>
          <div><label htmlFor="ahb_name">Name</label><input id="ahb_name" name="name" type="text" required /></div>
          <p className="small muted">{hbs.map((h) => h.name).join(", ") || "None yet."}</p>
          <button className="btn secondary" type="submit">Add housebuilder</button></form>
      </div>
    </>
  );
}

async function GangsTab() {
  const [gangs, payees, sites, sups] = await Promise.all([
    q<{ id: string; name: string; ganger_name: string }>("SELECT id, name, ganger_name FROM ops.gangs ORDER BY name"),
    q<{ id: string; gang_id: string; name: string; legal_name: string; entity_type: string; payment_ref: string | null; eligible: boolean; eligibility_source: string; eligibility_updated_at: string | null }>(
      "SELECT id, gang_id, name, legal_name, entity_type, payment_ref, eligible, eligibility_source, eligibility_updated_at FROM ops.payees WHERE active ORDER BY name"),
    q<{ id: string; name: string }>("SELECT id, name FROM ops.sites WHERE active ORDER BY name"),
    q<{ payee: string; site: string; weekly_amount: string; start_date: string; end_date: string | null }>(
      `SELECT p.name AS payee, s.name AS site, a.weekly_amount::text, to_char(a.start_date, 'YYYY-MM-DD') AS start_date, to_char(a.end_date, 'YYYY-MM-DD') AS end_date
       FROM ops.supervision_assignments a JOIN ops.payees p ON p.id = a.payee_id JOIN ops.sites s ON s.id = a.site_id ORDER BY p.name`),
  ]);
  return (
    <>
      <div className="alert info">Onboarding, passport and CSCS checks and agreement signing are done by the payment company, not in this app. A gang member can only receive a split once marked as cleared here, by hand or by importing the payment company&apos;s list.</div>
      {gangs.map((g) => (
        <div key={g.id} className="card">
          <h3 style={{ marginTop: 0 }}>{g.name} <span className="muted small">ganger: {g.ganger_name}</span></h3>
          <div className="table-wrap dense"><table>
            <thead><tr><th>Member</th><th>Entity</th><th>Payment ref</th><th>Cleared for payment</th></tr></thead>
            <tbody>{payees.filter((p) => p.gang_id === g.id).map((p) => (
              <tr key={p.id}><td>{p.name}{p.legal_name !== p.name && <div className="small muted">{p.legal_name}</div>}</td><td>{p.entity_type.replace("_", " ")}</td><td>{p.payment_ref ?? ""}</td>
                <td><form action={setEligible} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="hidden" name="payee_id" value={p.id} /><input type="hidden" name="eligible" value={p.eligible ? "false" : "true"} />
                  <span className={`badge ${p.eligible ? "approved" : "returned"}`}>{p.eligible ? "Cleared" : "Not cleared"}</span>
                  <button className="btn secondary small" type="submit">{p.eligible ? "Remove" : "Mark cleared"}</button>
                  <span className="small muted">{p.eligibility_source}{p.eligibility_updated_at ? `, ${fmtDateTime(p.eligibility_updated_at)}` : ""}</span>
                </form></td></tr>
            ))}</tbody>
          </table></div>
        </div>
      ))}
      <div className="grid">
        <form action={addGang} className="card stack"><h3 style={{ marginTop: 0 }}>Add gang</h3>
          <div><label htmlFor="ag_name">Gang name</label><input id="ag_name" name="name" type="text" required /></div>
          <div><label htmlFor="ag_ganger">Ganger</label><input id="ag_ganger" name="ganger" type="text" required /></div>
          <button className="btn secondary" type="submit">Add gang</button></form>
        <form action={addPayee} className="card stack"><h3 style={{ marginTop: 0 }}>Add gang member</h3>
          <div><label htmlFor="ap_gang">Gang</label><select id="ap_gang" name="gang_id" required>{gangs.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
          <div><label htmlFor="ap_name">Name</label><input id="ap_name" name="name" type="text" required /></div>
          <div><label htmlFor="ap_legal">Legal or company name</label><input id="ap_legal" name="legal_name" type="text" /></div>
          <div className="row"><div><label htmlFor="ap_entity">Entity</label><select id="ap_entity" name="entity_type"><option value="sole_trader">Sole trader</option><option value="limited_company">Limited company</option><option value="partnership">Partnership</option><option value="other">Other</option></select></div>
            <div><label htmlFor="ap_ref">Payment company ref</label><input id="ap_ref" name="payment_ref" type="text" /></div></div>
          <label className="small" style={{ fontWeight: 400 }}><input type="checkbox" name="eligible" /> Cleared for payment by the payment company</label>
          <button className="btn secondary" type="submit">Add member</button></form>
        <form action={importCsv} className="card stack"><h3 style={{ marginTop: 0 }}>Import eligibility</h3>
          <p className="small muted">CSV from the payment company with columns <code>payment_ref</code> and <code>eligible</code> (yes or no). Matches on payment ref only; nobody is created.</p>
          <input name="file" type="file" accept=".csv,text/csv" required aria-label="Eligibility CSV" />
          <button className="btn secondary" type="submit">Import</button></form>
      </div>
      <h2>Working supervisors</h2>
      <div className="table-wrap dense"><table>
        <thead><tr><th>Supervisor</th><th>Site</th><th className="num">Weekly amount</th><th>From</th><th>To</th></tr></thead>
        <tbody>{sups.map((x, i) => <tr key={i}><td>{x.payee}</td><td>{x.site}</td><td className="num">{gbp(x.weekly_amount)}</td><td>{fmtDate(x.start_date)}</td><td>{x.end_date ? fmtDate(x.end_date) : "Ongoing"}</td></tr>)}</tbody>
      </table></div>
      <form action={addSupervision} className="card stack" style={{ marginTop: 12 }}><h3 style={{ marginTop: 0 }}>Assign a working supervisor</h3>
        <p className="small muted">The weekly amount is set per person and site. It is a separate supervision line, not mixed into measured work.</p>
        <div className="row">
          <div><label htmlFor="su_p">Gang member</label><select id="su_p" name="payee_id" required>{payees.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div><label htmlFor="su_s">Site</label><select id="su_s" name="site_id" required>{sites.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
          <div><label htmlFor="su_a">Weekly amount (£)</label><input id="su_a" name="weekly_amount" type="number" step="0.01" min="0" required /></div>
          <div><label htmlFor="su_f">From</label><input id="su_f" name="start_date" type="date" required /></div>
          <div><label htmlFor="su_t">To (optional)</label><input id="su_t" name="end_date" type="date" /></div>
        </div>
        <button className="btn secondary" type="submit">Assign</button></form>
    </>
  );
}

async function UsersTab({ user }: { user: User }) {
  const [users, gangs, requests] = await Promise.all([
    q<{ id: string; email: string | null; username: string | null; name: string; role: string; gang: string | null; active: boolean }>(
      "SELECT u.id, u.email, u.username, u.name, u.role, g.name AS gang, u.active FROM ops.users u LEFT JOIN ops.gangs g ON g.id = u.gang_id ORDER BY u.active DESC, u.role, u.name"),
    q<{ id: string; name: string; ganger_name: string; has_login: boolean }>(
      `SELECT g.id, g.name, g.ganger_name,
         EXISTS (SELECT 1 FROM ops.users u WHERE u.gang_id = g.id AND u.role = 'gang' AND u.active) AS has_login
       FROM ops.gangs g WHERE g.active ORDER BY has_login, g.name`),
    q<{ id: string; identifier: string; created_at: string; name: string; username: string | null; email: string | null }>(
      `SELECT r.id, r.identifier, r.created_at, u.name, u.username, u.email
       FROM ops.password_reset_requests r JOIN ops.users u ON u.id = r.user_id
       WHERE r.status = 'pending' ORDER BY r.created_at`),
  ]);
  return (
    <>
      <div className="alert info">Margin access is not a role. Making someone a manager does not put them on the named list. A named-list administrator changes that list under Margin access.</div>
      <section className="panel">
        <div className="panel-head"><h2>Password reset requests {requests.length > 0 && <span className="badge awaiting_management">{requests.length} pending</span>}</h2></div>
        {requests.length === 0 ? <p className="muted small">No pending requests.</p> : (
          <div className="table-wrap dense"><table>
            <thead><tr><th>When</th><th>Person</th><th>They typed</th><th></th></tr></thead>
            <tbody>{requests.map((r) => (
              <tr key={r.id}>
                <td>{fmtDateTime(r.created_at)}</td>
                <td>{r.name}<div className="small muted">{r.username || r.email}</div></td>
                <td>{r.identifier}</td>
                <td className="actions"><form action={issueTemporary}><input type="hidden" name="request_id" value={r.id} /><button className="btn small" type="submit">Set temporary password</button></form></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      <div className="table-wrap dense"><table>
        <thead><tr><th>Name, username and email</th><th>Role</th><th>Status</th><th>Reset password</th></tr></thead>
        <tbody>{users.map((u) => (
          <tr key={u.id}><td><form action={editLogin} className="row" style={{ alignItems: "end" }}><input type="hidden" name="user_id" value={u.id} />
              <input name="name" type="text" defaultValue={u.name} required aria-label={`Name of ${u.name}`} />
              <input name="username" type="text" defaultValue={u.username ?? ""} aria-label={`Username of ${u.name}`} autoComplete="off" placeholder="username" />
              <input name="email" type="text" defaultValue={u.email ?? ""} aria-label={`Email of ${u.name}`} placeholder="email" />
              <button className="btn secondary small" type="submit">Save</button></form></td><td>{u.role.replace("_", " ")}{u.gang ? `: ${u.gang}` : ""}</td>
            <td><form action={toggleUser}><input type="hidden" name="user_id" value={u.id} /><input type="hidden" name="active" value={u.active ? "false" : "true"} />
              <span className={`badge ${u.active ? "approved" : "returned"}`}>{u.active ? "Active" : "Inactive"}</span>{" "}
              {u.id !== user.id && <button className="btn secondary small" type="submit">{u.active ? "Deactivate" : "Activate"}</button>}</form></td>
            <td><form action={resetPw} className="row" style={{ alignItems: "end" }}><input type="hidden" name="user_id" value={u.id} />
              <input name="password" type="password" minLength={10} required aria-label={`New password for ${u.name}`} autoComplete="new-password" />
              <button className="btn secondary small" type="submit">Reset</button></form></td></tr>
        ))}</tbody>
      </table></div>
      <form action={newUser} className="card stack" style={{ marginTop: 16 }}><h3 style={{ marginTop: 0 }}>Add user</h3>
        <p className="small muted">Gang leads are already stored as gangs. Choose that gang to give the lead a login. They need a username, an email, or both. The starting password must be changed at the first sign-in.</p>
        <div className="row">
          <div><label htmlFor="nu_name">Name</label><input id="nu_name" name="name" type="text" required /></div>
          <div><label htmlFor="nu_user">Username<span className="hint">Lowercase letters, digits, dots and hyphens. For example jane.smith.</span></label><input id="nu_user" name="username" type="text" autoComplete="off" /></div>
          <div><label htmlFor="nu_email">Email<span className="hint">Optional for a gang lead.</span></label><input id="nu_email" name="email" type="text" autoComplete="off" /></div>
          <div><label htmlFor="nu_role">Role</label><select id="nu_role" name="role"><option value="gang">Gang account</option><option value="contracts_manager">Contracts manager</option><option value="management">Management</option>{user.role === "admin" && <option value="admin">Administrator</option>}</select></div>
          <div><label htmlFor="nu_gang">Gang<span className="hint">Required for a gang account.</span></label><select id="nu_gang" name="gang_id"><option value="">None</option>{gangs.map((g) => <option key={g.id} value={g.id}>{g.ganger_name} — {g.name}{g.has_login ? " (already has a login)" : ""}</option>)}</select></div>
          <div><label htmlFor="nu_pw">Starting password</label><input id="nu_pw" name="password" type="password" minLength={10} required autoComplete="new-password" /></div>
        </div>
        <button className="btn" type="submit">Add user</button></form>
    </>
  );
}

async function MarginTab({ actor }: { actor: User }) {
  const [{ members, history }, people] = await Promise.all([
    namedListForAdmin(actor),
    q<{ id: string; name: string; email: string | null; username: string | null; role: string }>(
      "SELECT id, name, email, username, role::text FROM ops.users WHERE active ORDER BY name"),
  ]);
  const onList = new Set(members.map((m) => m.user_id));
  return (
    <>
      <div className="restricted-banner">Named list only. Client rates stay in the commercial schema. This page does not show them.</div>
      <section className="panel">
        <div className="panel-head"><h2>Who can open Margin</h2></div>
        <div className="table-wrap dense"><table>
          <thead><tr><th>Person</th><th>Added</th><th>Reason</th><th></th></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.user_id}>
                <td>{m.name}<div className="small muted">{m.username || m.email} · {m.role.replace("_", " ")}</div></td>
                <td>{fmtDateTime(m.added_at)}<div className="small muted">{m.added_by}</div></td>
                <td>{m.reason}</td>
                <td className="actions">{m.user_id !== actor.id && (
                  <form action={removeMargin} className="row" style={{ alignItems: "end" }}>
                    <input type="hidden" name="user_id" value={m.user_id} />
                    <input name="reason" type="text" required minLength={3} placeholder="Reason" aria-label={`Reason for removing ${m.name}`} />
                    <button className="btn danger small" type="submit">Remove</button>
                  </form>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <form action={addMargin} className="row" style={{ alignItems: "end", marginTop: 12 }}>
          <div><label htmlFor="ma_user">Add a user</label><select id="ma_user" name="user_id" required>
            {people.filter((p) => !onList.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.username || p.email})</option>)}
          </select></div>
          <div><label htmlFor="ma_reason">Reason</label><input id="ma_reason" name="reason" type="text" required minLength={3} /></div>
          <button className="btn" type="submit">Add to named list</button>
        </form>
      </section>
      <h2>Audit trail</h2>
      <div className="table-wrap dense"><table>
        <thead><tr><th>When</th><th>Person</th><th>Action</th><th>By</th><th>Reason</th></tr></thead>
        <tbody>{history.map((h, i) => (
          <tr key={i}><td>{fmtDateTime(h.at)}</td><td>{h.name}</td><td>{h.action}</td><td>{h.changed_by}</td><td>{h.reason}</td></tr>
        ))}</tbody>
      </table></div>
    </>
  );
}

async function SafetyTab({ admin }: { admin: boolean }) {
  const [alerts, rams, sites, usage] = await Promise.all([
    safetyRoster(),
    ramsRoster(),
    q<{ id: string; name: string }>("SELECT id, name FROM ops.sites WHERE active ORDER BY name"),
    storageUsage(),
  ]);
  return (
    <>
      <div className={`alert ${usage.warning ? "warn" : "info"}`} data-testid="storage-meter">
        Stored files: {usage.bytes ? formatBytes(usage.bytes) : "0 MB"} on {usage.driver === "s3" ? "S3" : usage.driver === "vercel-blob" ? "Vercel Blob" : "Postgres"}
        {usage.quota ? ` of ${formatBytes(usage.quota)}` : ""}.
        {usage.warning ? ` ${usage.warning}` : usage.driver === "postgres" ? " A free Render Postgres database is 1 GB, so about 20 to 40 large RAMS fit." : usage.driver === "vercel-blob" ? " Hobby Blob storage includes 1 GB." : ""}
      </div>
      <p className="small"><a href="/api/safety/export">Download alert and toolbox CSV</a> · <a href="/api/rams/export">Download RAMS CSV</a></p>
      {admin ? (
        <>
          <ProgressForm actionUrl="/api/safety/upload" button="Publish" blobPurpose={storageDriver() === "vercel-blob" ? "hs" : undefined}>
            <h2 style={{ marginTop: 0 }}>Publish an alert or toolbox talk</h2>
            <p className="small muted">Only an administrator publishes these. Everyone with a login must sign each active alert and toolbox talk. Gang leads also record who attended a talk, and who was briefed on a site RAMS.</p>
            <div className="row">
              <div><label htmlFor="hs_kind">Type</label><select id="hs_kind" name="kind"><option value="alert">H&amp;S alert</option><option value="toolbox">Toolbox talk</option></select></div>
              <div><label htmlFor="hs_due">Due date (optional)</label><input id="hs_due" name="due_on" type="date" /></div>
            </div>
            <div><label htmlFor="hs_title">Title</label><input id="hs_title" name="title" type="text" required maxLength={200} /></div>
            <div><label htmlFor="hs_body">Text (optional if you attach a PDF)</label><textarea id="hs_body" name="body" maxLength={10000} /></div>
            <div><label htmlFor="hs_file">PDF</label><input id="hs_file" name="attachment" type="file" accept="application/pdf" /></div>
            <div><label htmlFor="hs_sites">Sites (leave unselected for every site)</label>
              <select id="hs_sites" name="site_id" multiple size={4}>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <label className="check"><input type="checkbox" name="active" defaultChecked /> Active</label>
          </ProgressForm>
          <ProgressForm actionUrl="/api/rams/upload" button="Publish RAMS" blobPurpose={storageDriver() === "vercel-blob" ? "rams" : undefined}>
            <h2 style={{ marginTop: 0 }}>Publish site RAMS</h2>
            <p className="small muted">{claimsEnabled()
              ? "A gang lead must read and sign the current RAMS, and tick who was briefed, before they can create or submit a claim on that site. A new revision has to be confirmed again."
              : "A gang lead opens any site, reads the current RAMS, signs it, and ticks who was briefed. A new revision has to be signed again."}</p>
            <div className="row">
              <div><label htmlFor="rams_site">Site</label><select id="rams_site" name="site_id" required><option value="">Choose a site</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div><label htmlFor="rams_rev">Revision</label><input id="rams_rev" name="revision" type="text" required maxLength={40} placeholder="For example, 2" /></div>
            </div>
            <div><label htmlFor="rams_title">Title</label><input id="rams_title" name="title" type="text" required maxLength={200} /></div>
            <div><label htmlFor="rams_pdf">PDF</label><input id="rams_pdf" name="pdf" type="file" accept="application/pdf" required /></div>
            <label className="check"><input type="checkbox" name="active" defaultChecked /> Active</label>
          </ProgressForm>
        </>
      ) : <p className="muted">Only an administrator can publish health and safety documents.</p>}
      <div data-testid="hs-ack-list">
        {alerts.length === 0 && <p className="muted">No alerts or toolbox talks yet.</p>}
        {alerts.map((a) => (
          <div key={a.id} className="card">
            <div className="split">
              <div>
                <div className="eyebrow">{a.kind === "toolbox" ? "Toolbox talk" : "H&S alert"} · {fmtDateTime(a.published_at)}{a.sites ? ` · ${a.sites}` : " · All sites"}</div>
                <h3 style={{ margin: "4px 0" }}>{a.title}</h3>
              </div>
              <span className={`badge ${a.active ? "submitted" : "draft"}`}>{a.active ? "Active" : "Off"}</span>
            </div>
            <p className="small"><a href={`/api/safety/${a.id}/record`}>Signed record (PDF)</a></p>
            <div className="table-wrap dense">
              <table>
                <thead><tr><th>Person</th><th>Confirmed</th><th>When</th><th>Signature</th><th>Attendees</th></tr></thead>
                <tbody>
                  {a.people.map((p) => (
                    <tr key={p.user_id}>
                      <td>{p.name}</td>
                      <td>{p.acknowledged_at ? <span className="badge approved">Confirmed</span> : <span className="badge flagged">Not yet</span>}</td>
                      <td>{p.acknowledged_at ? fmtDateTime(p.acknowledged_at) : "—"}</td>
                      <td>{p.signed ? <img src={`/api/safety/signature/${a.id}/${p.user_id}`} alt={`Signature of ${p.name}`} style={{ height: 36, background: "#fff" }} /> : "—"}{p.signature_name ? <div className="small">{p.signature_name}</div> : null}</td>
                      <td>{p.attendees ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {admin && (
              <form action={toggleAlert} style={{ marginTop: 12 }}>
                <input type="hidden" name="alert_id" value={a.id} />
                <input type="hidden" name="make_active" value={a.active ? "0" : "1"} />
                <button className="btn ghost small" type="submit">{a.active ? "Turn off" : "Turn on"}</button>
              </form>
            )}
          </div>
        ))}
      </div>
      <div data-testid="rams-ack-list">
        <h2>Site RAMS</h2>
        {rams.length === 0 && <p className="muted">No RAMS yet.</p>}
        {rams.map((r) => (
          <div key={r.id} className="card">
            <div className="eyebrow">{r.site} · revision {r.revision} · {fmtDateTime(r.published_at)}</div>
            <h3 style={{ margin: "4px 0" }}>{r.title} {r.active ? <span className="badge submitted">Active</span> : <span className="badge draft">Off</span>}</h3>
            <p className="small"><a href={`/api/rams/${r.id}/record`}>Signed record (PDF)</a></p>
            <div className="table-wrap dense">
              <table>
                <thead><tr><th>Gang lead</th><th>Confirmed</th><th>When</th><th>Signature</th><th>Briefed</th></tr></thead>
                <tbody>
                  {r.people.map((p) => (
                    <tr key={p.user_id}>
                      <td>{p.name}</td>
                      <td>{p.acknowledged_at ? <span className="badge approved">Confirmed</span> : <span className="badge flagged">Not yet</span>}</td>
                      <td>{p.acknowledged_at ? fmtDateTime(p.acknowledged_at) : "—"}</td>
                      <td>{p.signed ? p.signature_name : "—"}</td>
                      <td>{p.attendees ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

async function DeletedTab() {
  const rows = await deletedClaims();
  return (
    <div data-testid="deleted-claims">
      <p className="small muted">Deleted claims stay out of the lists and no longer use a lift allowance. Restoring one puts it back.</p>
      {rows.length === 0 && <p className="muted">No deleted claims.</p>}
      {rows.length > 0 && (
        <div className="table-wrap dense"><table>
          <thead><tr><th>Claim</th><th>Gang</th><th>Status</th><th>Deleted</th><th>By</th><th>Reason</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.ref}</td><td>{r.gang}</td><td>{r.status}</td>
                <td>{fmtDateTime(r.deleted_at)}</td><td>{r.deleted_by}</td><td>{r.delete_reason}</td>
                <td><form action={restoreDeleted}><input type="hidden" name="claim_id" value={r.id} /><button className="btn ghost small" type="submit">Restore</button></form></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}

async function SettingsTab() {
  const rows = await q<{ key: string; value: unknown; description: string }>("SELECT key, value, description FROM ops.settings");
  const v = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const d = Object.fromEntries(rows.map((r) => [r.key, r.description]));
  const types = ["substructure", "superstructure", "daywork", "supervision"];
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return (
    <form action={saveSettings} className="stack">
      <div className="card"><h3 style={{ marginTop: 0 }}>Weekly cut-off</h3><p className="small muted">{d.cutoff}</p>
        <div className="row">
          <div><label htmlFor="co_day">Day</label><select id="co_day" name="cutoff_weekday" defaultValue={v.cutoff.weekday}>{days.map((x, i) => <option key={i} value={i}>{x}</option>)}</select></div>
          <div><label htmlFor="co_time">Time (UK)</label><input id="co_time" name="cutoff_time" type="text" pattern="\d{2}:\d{2}" defaultValue={v.cutoff.time} /></div>
        </div></div>
      <div className="card"><h3 style={{ marginTop: 0 }}>Pay-less</h3><p className="small muted">{d.payless_days_before_payment}</p>
        <div><label htmlFor="pl_days">Days before payment the window closes</label><input id="pl_days" name="payless_days" type="number" min="0" max="30" defaultValue={v.payless_days_before_payment} /></div>
        <div><label htmlFor="pl_r">Reason categories (one per line)<span className="hint">{d.payless_reasons}</span></label><textarea id="pl_r" name="reasons" defaultValue={(v.payless_reasons as string[]).join("\n")} /></div></div>
      <div className="card"><h3 style={{ marginTop: 0 }}>Evidence</h3><p className="small muted">{d.min_photos} {d.signature_required}</p>
        {types.map((t) => (
          <div key={t} className="row" style={{ alignItems: "end", marginBottom: 8 }}>
            <div><label htmlFor={`ph_${t}`}>{t[0].toUpperCase() + t.slice(1)}: minimum photos</label><input id={`ph_${t}`} name={`photos_${t}`} type="number" min="1" max="20" defaultValue={v.min_photos[t] ?? 1} /></div>
            <label className="small" style={{ fontWeight: 400 }}><input type="checkbox" name={`sig_${t}`} defaultChecked={v.signature_required[t] !== false} /> Foreman signature required</label>
          </div>
        ))}</div>
      <button className="btn" type="submit">Save settings</button>
    </form>
  );
}
