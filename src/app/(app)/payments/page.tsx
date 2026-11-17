import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { createPayRun, PayRunError } from "@/lib/payments";
import { back, safeMessage, str } from "@/lib/forms";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { gbp } from "@/lib/money";
import { currentWeek } from "@/lib/settings";
import Flash from "@/components/Flash";
import ListToolbar, { SelectAll } from "@/components/ListToolbar";

async function create(f: FormData) {
  "use server";
  const user = await requireUser(["management", "admin"]);
  try { await createPayRun(user, str(f, "payment_date"), str(f, "first"), str(f, "last")); }
  catch (e) { back("/payments", "error", safeMessage(e, [PayRunError])); }
  back("/payments", "ok", "Pay run created.");
}

export default async function PayRuns({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireUser(["management", "admin"]);
  const sp = await searchParams;
  const { today, weekStart, weekEnding } = await currentWeek();
  const runs = await q<{ id: string; payment_date: string; first: string; last: string; payless_closes_at: string; status: string; claims: string; awaiting: string; total: string | null }>(
    `SELECT r.id, to_char(r.payment_date, 'YYYY-MM-DD') AS payment_date, to_char(r.first_week_ending, 'YYYY-MM-DD') AS first,
       to_char(r.last_week_ending, 'YYYY-MM-DD') AS last, r.payless_closes_at, r.status,
       (SELECT count(*) FROM ops.claims c WHERE c.pay_run_id = r.id) AS claims,
       (SELECT count(*) FROM ops.claims c WHERE c.pay_run_id = r.id AND c.status = 'awaiting_management') AS awaiting,
       (SELECT sum(sp.amount) FROM ops.splits sp JOIN ops.claims c ON c.id = sp.claim_id WHERE c.pay_run_id = r.id AND c.status IN ('approved', 'paid')) AS total
     FROM ops.pay_runs r ORDER BY r.payment_date DESC`);
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Payments</div><h1>Pay runs</h1></div><div className="actions"><Link className="btn ghost" href="/payments/backup">Client backup packs</Link></div></div>
      <Flash sp={sp} />
      <section className="panel">
        <ListToolbar tableId="pay-runs" showGang={false} statusClient statuses={[{ value: "open", label: "Open" }, { value: "closed", label: "Closed" }, { value: "paid", label: "Paid" }]} />
        <div className="table-wrap dense">
          <table id="pay-runs" data-today={today} data-week-start={weekStart} data-week-end={weekEnding}>
            <thead><tr>
              <th className="check"><SelectAll tableId="pay-runs" /></th>
              <th>Payment date</th><th>Week endings</th><th>Pay-less closes</th><th>Claims</th><th className="num">Approved gross</th><th>Status</th><th className="actions"> </th>
            </tr></thead>
            <tbody>
              {runs.length === 0 && <tr data-empty="1"><td colSpan={8} className="muted">No pay runs yet.</td></tr>}
              <tr data-filter-empty="1" hidden><td colSpan={8} className="muted">No pay runs match these filters.</td></tr>
              {runs.map((r) => (
                <tr key={r.id} data-status={r.status} data-date={r.payment_date}>
                  <td className="check"><input className="row-check" type="checkbox" aria-label={`Select pay run ${fmtDate(r.payment_date)}`} /></td>
                  <td>{fmtDate(r.payment_date)}</td>
                  <td>{fmtDate(r.first)} to {fmtDate(r.last)}</td>
                  <td>{fmtDateTime(r.payless_closes_at)}</td>
                  <td>{r.claims}{Number(r.awaiting) > 0 && <span className="muted small"> ({r.awaiting} awaiting)</span>}</td>
                  <td className="num">{gbp(r.total ?? 0)}</td>
                  <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                  <td className="actions"><Link className="btn ghost small" href={`/payments/${r.id}`}>View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <form action={create} className="card stack" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>New pay run</h2>
        <p className="small muted">A fortnightly run normally covers two week endings. The pay-less window closes the set number of days before the payment date (Setup). The exact pay calendar is still to be confirmed by K-S.</p>
        <div className="row">
          <div><label htmlFor="first">First week ending</label><input id="first" name="first" type="date" required /></div>
          <div><label htmlFor="last">Last week ending</label><input id="last" name="last" type="date" required /></div>
          <div><label htmlFor="payment_date">Payment date</label><input id="payment_date" name="payment_date" type="date" required /></div>
        </div>
        <button className="btn" type="submit">Create pay run</button>
      </form>
    </>
  );
}
