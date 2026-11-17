import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { packClaims, planParts } from "@/lib/backup";
import { addDays, fmtDate, isoDate } from "@/lib/dates";

export default async function Backup({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireUser(["management", "admin"]);
  const sp = await searchParams;
  const clients = await q<{ id: string; name: string; invoice_frequency_weeks: number }>("SELECT id, name, invoice_frequency_weeks FROM ops.clients WHERE active ORDER BY name");
  const client = clients.find((c) => c.id === sp.client);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to : isoDate(new Date());
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from : addDays(to, -6 - 7 * ((client?.invoice_frequency_weeks ?? 1) - 1));
  const parts = client ? await planParts(await packClaims(client.id, from, to)) : [];
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Payments</div><h1>Client backup packs</h1></div></div>
      <p className="small muted">One pack per client per invoice period: claims, measures, course counts, drawings, photos, foreman signatures, daywork sheets and client forms for approved claims. Packs contain no rates, values or margin, and no gang top sheets. Packs over 18 MB are split into parts.</p>
      <form method="get" className="card row" style={{ alignItems: "end" }}>
        <div><label htmlFor="client">Client</label><select id="client" name="client" defaultValue={client?.id ?? ""} required><option value="" disabled>Choose</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name} (every {c.invoice_frequency_weeks} wk)</option>)}</select></div>
        <div><label htmlFor="from">Week ending from</label><input id="from" name="from" type="date" defaultValue={from} /></div>
        <div><label htmlFor="to">to</label><input id="to" name="to" type="date" defaultValue={to} /></div>
        <div><button className="btn secondary" type="submit">Prepare</button></div>
      </form>
      {client && (
        <div className="card">
          <p style={{ marginTop: 0 }}><strong>{client.name}</strong>, week endings {fmtDate(from)} to {fmtDate(to)}: {parts.reduce((a, p) => a + p.length, 0)} approved claims.</p>
          {parts.map((p, i) => (
            <p key={i}><a className="btn" href={`/api/backup?client=${client.id}&from=${from}&to=${to}&part=${i + 1}`}>Download{parts.length > 1 ? ` part ${i + 1} of ${parts.length}` : ""}</a> <span className="small muted">{p.length} claims</span></p>
          ))}
        </div>
      )}
    </>
  );
}
