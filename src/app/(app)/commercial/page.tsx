import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { addClientLiftValue, addClientRate, isNamedUser, listClientLiftValues, listClientRates, marginBy, NotNamedUser, type MarginGroup } from "@/lib/commercial";
import { back, safeMessage, str } from "@/lib/forms";
import { addDays, fmtDate, isoDate } from "@/lib/dates";
import { gbp, gbpRate } from "@/lib/money";
import Flash from "@/components/Flash";

async function addRate(f: FormData) {
  "use server";
  const user = await requireUser();
  try {
    const rate = Number(str(f, "rate"));
    if (!(rate >= 0) || !str(f, "effective_from")) throw new NotNamedUser();
    await addClientRate(user, { clientId: str(f, "client_id"), siteId: str(f, "site_id") || null, itemId: str(f, "item_id"), rate, effectiveFrom: str(f, "effective_from") });
  } catch (e) { back("/commercial", "error", e instanceof NotNamedUser ? "Check the rate and date." : safeMessage(e, [])); }
  back("/commercial", "ok", "Client rate saved.");
}
async function addLift(f: FormData) {
  "use server";
  const user = await requireUser();
  try {
    const value = Number(str(f, "value"));
    if (!(value >= 0) || !str(f, "effective_from")) throw new NotNamedUser();
    await addClientLiftValue(user, { clientId: str(f, "client_id"), liftId: str(f, "lift_id"), value, effectiveFrom: str(f, "effective_from") });
  } catch (e) { back("/commercial", "error", e instanceof NotNamedUser ? "Check the value and date." : safeMessage(e, [])); }
  back("/commercial", "ok", "Client lift value saved.");
}

const GROUPS: Record<MarginGroup, string> = { gang: "Gang", site: "Site", client: "Client", week: "Week ending" };

export default async function Commercial({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  // Not on the named list: behave exactly as if the page did not exist.
  if (!(await isNamedUser(user))) notFound();
  const sp = await searchParams;
  const group = (sp.group in GROUPS ? sp.group : "gang") as MarginGroup;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to : addDays(isoDate(new Date()), 14);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from : addDays(to, -90);
  const [rows, rates, lifts] = await Promise.all([marginBy(user, group, from, to), listClientRates(user), listClientLiftValues(user)]);
  const [clients, sites, items, liftOpts] = await Promise.all([
    q<{ id: string; name: string }>("SELECT id, name FROM ops.clients WHERE active ORDER BY name"),
    q<{ id: string; name: string }>("SELECT id, name FROM ops.sites WHERE active ORDER BY name"),
    q<{ id: string; name: string; unit: string }>("SELECT id, name, unit FROM ops.rate_items WHERE active ORDER BY claim_type, sort"),
    q<{ id: string; name: string }>("SELECT l.id, h.name || ': ' || l.name AS name FROM ops.lifts l JOIN ops.house_types h ON h.id = l.house_type_id ORDER BY h.name, l.sort"),
  ]);
  const sum = (k: "gang_cost" | "client_value" | "margin") => rows.reduce((a, r) => a + Number(r[k]), 0);
  const totalValue = sum("client_value");
  return (
    <>
      <div className="restricted-banner">Restricted: client charge rates, client values and margin. Visible only to the named list. Every view and export is logged.</div>
      <div className="page-head">
        <div><div className="eyebrow">Commercial</div><h1>Margin</h1></div>
        <div className="actions"><a className="btn" href={`/api/commercial/export?from=${from}&to=${to}`}>Export margin (Excel)</a></div>
      </div>
      <Flash sp={sp} />
      <form className="card row" method="get">
        <div><label htmlFor="group">Group by</label><select id="group" name="group" defaultValue={group}>
          {Object.entries(GROUPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label htmlFor="from">Week ending from</label><input id="from" name="from" type="date" defaultValue={from} /></div>
        <div><label htmlFor="to">to</label><input id="to" name="to" type="date" defaultValue={to} /></div>
        <div style={{ alignSelf: "end" }}><button className="btn secondary" type="submit">Show</button></div>
      </form>
      <p className="small muted">Submitted, approved and paid claims, at gang cost after pay-less reductions. Lines with no client rate set are counted as unpriced and add nothing to client value.</p>
      <div className="table-wrap"><table>
        <thead><tr><th>{GROUPS[group]}</th><th className="num">Gang cost</th><th className="num">Client value</th><th className="num">Margin</th><th className="num">Margin %</th><th className="num">Unpriced lines</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={6} className="muted">No claims in this period.</td></tr>}
          {rows.map((r) => (
            <tr key={r.key}><td>{group === "week" ? fmtDate(r.label) : r.label}</td><td className="num">{gbp(r.gang_cost)}</td><td className="num">{gbp(r.client_value)}</td>
              <td className="num" style={{ color: Number(r.margin) < 0 ? "var(--bad)" : undefined }}>{gbp(r.margin)}</td>
              <td className="num">{r.margin_pct !== null ? `${r.margin_pct}%` : ""}</td><td className="num">{Number(r.unpriced_lines) || ""}</td></tr>
          ))}
          {rows.length > 0 && <tr><td><strong>Total</strong></td><td className="num"><strong>{gbp(sum("gang_cost"))}</strong></td><td className="num"><strong>{gbp(totalValue)}</strong></td>
            <td className="num"><strong>{gbp(sum("margin"))}</strong></td><td className="num"><strong>{totalValue ? `${((sum("margin") / totalValue) * 100).toFixed(1)}%` : ""}</strong></td><td /></tr>}
        </tbody>
      </table></div>

      <h2>Client charge rates</h2>
      <p className="small muted">From each client&apos;s master sheet. A site rate overrides the client&apos;s general rate. Add a new row with a later date for an uplift; earlier claims keep the rate in force on their work date.</p>
      <div className="table-wrap"><table>
        <thead><tr><th>Client</th><th>Site</th><th>Item</th><th className="num">Rate</th><th>Effective from</th></tr></thead>
        <tbody>{rates.map((r) => <tr key={r.id}><td>{r.client}</td><td>{r.site ?? "All sites"}</td><td>{r.item} <span className="muted small">per {r.unit}</span></td><td className="num">{gbpRate(r.rate)}</td><td>{fmtDate(r.effective_from)}</td></tr>)}</tbody>
      </table></div>
      <form action={addRate} className="card stack" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Add client rate</h3>
        <div className="row">
          <div><label htmlFor="cr_client">Client</label><select id="cr_client" name="client_id" required>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label htmlFor="cr_site">Site (optional)</label><select id="cr_site" name="site_id"><option value="">All sites</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div><label htmlFor="cr_item">Item</label><select id="cr_item" name="item_id" required>{items.map((i) => <option key={i.id} value={i.id}>{i.name} (per {i.unit})</option>)}</select></div>
          <div><label htmlFor="cr_rate">Rate (£)</label><input id="cr_rate" name="rate" type="number" step="0.0001" min="0" required /></div>
          <div><label htmlFor="cr_from">Effective from</label><input id="cr_from" name="effective_from" type="date" required /></div>
        </div>
        <button className="btn" type="submit">Save client rate</button>
      </form>

      <h2>Client lift and patch values</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Client</th><th>House type</th><th>Lift</th><th className="num">Client value</th><th>Effective from</th></tr></thead>
        <tbody>{lifts.map((l, i) => <tr key={i}><td>{l.client}</td><td>{l.house_type}</td><td>{l.lift}</td><td className="num">{gbp(l.value)}</td><td>{fmtDate(l.effective_from)}</td></tr>)}</tbody>
      </table></div>
      <form action={addLift} className="card stack" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Add client lift value</h3>
        <div className="row">
          <div><label htmlFor="lv_client">Client</label><select id="lv_client" name="client_id" required>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label htmlFor="lv_lift">Lift</label><select id="lv_lift" name="lift_id" required>{liftOpts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
          <div><label htmlFor="lv_value">Value (£)</label><input id="lv_value" name="value" type="number" step="0.01" min="0" required /></div>
          <div><label htmlFor="lv_from">Effective from</label><input id="lv_from" name="effective_from" type="date" required /></div>
        </div>
        <button className="btn" type="submit">Save lift value</button>
      </form>
    </>
  );
}
