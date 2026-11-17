import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { addGangRate, addRateItem, addRateSet, setGangRateSets, AdminError } from "@/lib/admin";
import { back, safeMessage, str } from "@/lib/forms";
import { fmtDate, isoDate } from "@/lib/dates";
import { gbp, gbpRate } from "@/lib/money";
import Flash from "@/components/Flash";

async function rate(f: FormData) {
  "use server";
  const user = await requireUser(["management", "admin"]);
  try { await addGangRate(user, str(f, "set_id"), str(f, "item_id"), Number(str(f, "rate")), str(f, "effective_from")); }
  catch (e) { back("/rates", "error", safeMessage(e, [AdminError])); }
  back("/rates", "ok", "Rate saved.");
}
async function set(f: FormData) {
  "use server";
  const user = await requireUser(["management", "admin"]);
  try { await addRateSet(user, str(f, "name"), str(f, "kind"), str(f, "client_id") || null); }
  catch (e) { back("/rates", "error", safeMessage(e, [AdminError])); }
  back("/rates", "ok", "Rate set created.");
}
async function item(f: FormData) {
  "use server";
  const user = await requireUser(["management", "admin"]);
  try { await addRateItem(user, { code: str(f, "code"), name: str(f, "name"), unit: str(f, "unit"), claimType: str(f, "claim_type"), needsCourses: f.get("needs_courses") === "on" }); }
  catch (e) { back("/rates", "error", safeMessage(e, [AdminError])); }
  back("/rates", "ok", "Item created.");
}
async function gangSets(f: FormData) {
  "use server";
  const user = await requireUser(["management", "admin"]);
  try { await setGangRateSets(user, str(f, "gang_id"), str(f, "base") || null, str(f, "individual") || null); }
  catch (e) { back("/rates", "error", safeMessage(e, [AdminError])); }
  back("/rates", "ok", "Gang rate sets updated.");
}

const KIND = { standard: "KS Standard type", north: "North type", client: "Client-specific", individual: "Individual agreed" } as const;

export default async function Rates({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireUser(["management", "admin"]);
  const sp = await searchParams;
  const today = isoDate(new Date());
  const [sets, items, rates, gangs, clients] = await Promise.all([
    q<{ id: string; name: string; kind: keyof typeof KIND; client: string | null }>(
      "SELECT rs.id, rs.name, rs.kind, c.name AS client FROM ops.rate_sets rs LEFT JOIN ops.clients c ON c.id = rs.client_id ORDER BY rs.kind, rs.name"),
    q<{ id: string; code: string; name: string; unit: string; claim_type: string; needs_courses: boolean }>(
      "SELECT id, code, name, unit, claim_type, needs_courses FROM ops.rate_items WHERE active ORDER BY claim_type, sort, name"),
    q<{ rate_set_id: string; item_id: string; rate: string; effective_from: string }>(
      "SELECT rate_set_id, item_id, rate::text, to_char(effective_from, 'YYYY-MM-DD') AS effective_from FROM ops.gang_rates ORDER BY effective_from DESC"),
    q<{ id: string; name: string; ganger_name: string; base_rate_set_id: string | null; individual_rate_set_id: string | null }>(
      "SELECT id, name, ganger_name, base_rate_set_id, individual_rate_set_id FROM ops.gangs WHERE active ORDER BY name"),
    q<{ id: string; name: string }>("SELECT id, name FROM ops.clients WHERE active ORDER BY name"),
  ]);
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Management</div><h1>Gang pay rates</h1></div></div>
      <Flash sp={sp} />
      <div className="alert info">Gang pay rates only. Client charge rates are held separately in the restricted commercial area. Foremen never see rates; gangs see their own rates only at the final split step of a claim.</div>
      <p className="small muted">Order used on a claim (to be confirmed by K-S): the gang&apos;s individual agreed rate, then a client-specific set for the claim&apos;s client, then the gang&apos;s base set. A rate with a future effective date is an uplift: claims with a work date from that day use it.</p>

      {sets.map((s) => {
        const mine = rates.filter((r) => r.rate_set_id === s.id);
        return (
          <details key={s.id} className="card" open={sets.length <= 3}>
            <summary>{s.name} <span className="badge">{KIND[s.kind]}{s.client ? `: ${s.client}` : ""}</span></summary>
            <div className="table-wrap" style={{ marginTop: 10 }}><table>
              <thead><tr><th>Item</th><th className="num">Current rate</th><th>Since</th><th>Scheduled changes</th></tr></thead>
              <tbody>{items.map((i) => {
                const all = mine.filter((r) => r.item_id === i.id);
                const current = all.find((r) => r.effective_from <= today);
                const future = all.filter((r) => r.effective_from > today);
                if (!all.length) return null;
                return (
                  <tr key={i.id}><td>{i.name} <span className="muted small">per {i.unit}</span></td>
                    <td className="num">{current ? gbpRate(current.rate) : <span className="muted">none yet</span>}</td>
                    <td>{current ? fmtDate(current.effective_from) : ""}</td>
                    <td className="small">{future.map((r) => `${gbpRate(r.rate)} from ${fmtDate(r.effective_from)}`).join("; ")}</td></tr>
                );
              })}</tbody>
            </table></div>
            <form action={rate} className="row" style={{ marginTop: 10, alignItems: "end" }}>
              <input type="hidden" name="set_id" value={s.id} />
              <div><label htmlFor={`i_${s.id}`}>Item</label><select id={`i_${s.id}`} name="item_id">{items.map((i) => <option key={i.id} value={i.id}>{i.name} (per {i.unit})</option>)}</select></div>
              <div><label htmlFor={`r_${s.id}`}>Rate (£)</label><input id={`r_${s.id}`} name="rate" type="number" min="0" step="0.0001" required /></div>
              <div><label htmlFor={`d_${s.id}`}>Effective from</label><input id={`d_${s.id}`} name="effective_from" type="date" required defaultValue={today} /></div>
              <div><button className="btn" type="submit">Save rate</button></div>
            </form>
          </details>
        );
      })}

      <h2>Which rates each gang uses</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Gang</th><th>Base set</th><th>Individual agreed set</th><th></th></tr></thead>
        <tbody>{gangs.map((g) => (
          <tr key={g.id}><td>{g.name}<div className="small muted">{g.ganger_name}</div></td>
            <td colSpan={3}>
              <form action={gangSets} className="row" style={{ alignItems: "end" }}>
                <input type="hidden" name="gang_id" value={g.id} />
                <select name="base" aria-label={`Base set for ${g.name}`} defaultValue={g.base_rate_set_id ?? ""}><option value="">None</option>
                  {sets.filter((s) => s.kind === "standard" || s.kind === "north").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                <select name="individual" aria-label={`Individual set for ${g.name}`} defaultValue={g.individual_rate_set_id ?? ""}><option value="">None</option>
                  {sets.filter((s) => s.kind === "individual").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                <button className="btn secondary small" type="submit">Save</button>
              </form>
            </td></tr>
        ))}</tbody>
      </table></div>

      <div className="grid" style={{ marginTop: 16 }}>
        <form action={set} className="card stack">
          <h3 style={{ marginTop: 0 }}>New rate set</h3>
          <div><label htmlFor="ns_name">Name</label><input id="ns_name" name="name" type="text" required /></div>
          <div><label htmlFor="ns_kind">Type</label><select id="ns_kind" name="kind">{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div><label htmlFor="ns_client">Client (client-specific sets only)</label><select id="ns_client" name="client_id"><option value="">None</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <button className="btn secondary" type="submit">Create set</button>
        </form>
        <form action={item} className="card stack">
          <h3 style={{ marginTop: 0 }}>New item</h3>
          <div className="row">
            <div><label htmlFor="ni_code">Code</label><input id="ni_code" name="code" type="text" required maxLength={30} /></div>
            <div><label htmlFor="ni_unit">Unit</label><input id="ni_unit" name="unit" type="text" required maxLength={20} placeholder="brick, block, m2, hour" /></div>
          </div>
          <div><label htmlFor="ni_name">Name</label><input id="ni_name" name="name" type="text" required maxLength={80} /></div>
          <div><label htmlFor="ni_type">Claim type</label><select id="ni_type" name="claim_type"><option value="substructure">Substructure</option><option value="daywork">Daywork</option></select></div>
          <label className="small" style={{ fontWeight: 400 }}><input type="checkbox" name="needs_courses" /> Gang must record courses per wall</label>
          <button className="btn secondary" type="submit">Create item</button>
        </form>
      </div>
    </>
  );
}
