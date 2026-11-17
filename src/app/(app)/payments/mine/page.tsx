import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { fmtDate } from "@/lib/dates";
import { gbp } from "@/lib/money";
import { currentWeek } from "@/lib/settings";
import ListToolbar, { SelectAll } from "@/components/ListToolbar";

export default async function MyPayments() {
  const user = await requireUser(["gang"]);
  const { today, weekStart, weekEnding } = await currentWeek();
  const rows = await q<{ payment_date: string; status: string; payee: string; total: string; invoice_id: string | null; number: string | null }>(
    `SELECT to_char(r.payment_date, 'YYYY-MM-DD') AS payment_date, r.status, py.name AS payee, sum(sp.amount)::text AS total,
       (SELECT i.id::text FROM ops.payee_invoices i WHERE i.pay_run_id = r.id AND i.payee_id = py.id) AS invoice_id,
       (SELECT i.number FROM ops.payee_invoices i WHERE i.pay_run_id = r.id AND i.payee_id = py.id) AS number
     FROM ops.splits sp JOIN ops.claims c ON c.id = sp.claim_id JOIN ops.pay_runs r ON r.id = c.pay_run_id JOIN ops.payees py ON py.id = sp.payee_id
     WHERE c.gang_id = $1 AND c.status IN ('approved', 'paid')
     GROUP BY r.id, r.payment_date, r.status, py.id, py.name ORDER BY r.payment_date DESC, py.name`, [user.gang_id]);
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Payments</div><h1>Your gang&apos;s payments</h1></div></div>
      <p className="small muted">Approved amounts per gang member and pay run. Gross amounts before any deductions by the payment company.</p>
      <section className="panel">
        <ListToolbar tableId="my-payments" showGang={false} newClaim statusClient statuses={[{ value: "open", label: "Open" }, { value: "paid", label: "Paid" }]} />
        <div className="table-wrap dense"><table id="my-payments" data-today={today} data-week-start={weekStart} data-week-end={weekEnding}>
          <thead><tr>
            <th className="check"><SelectAll tableId="my-payments" /></th>
            <th>Payment date</th><th>Gang member</th><th className="num">Amount</th><th>Invoice</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr data-empty="1"><td colSpan={5} className="muted">No approved payments yet.</td></tr>}
            <tr data-filter-empty="1" hidden><td colSpan={5} className="muted">No payments match these filters.</td></tr>
            {rows.map((r, i) => (
              <tr key={i} data-status={r.status} data-date={r.payment_date} data-gang={r.payee}>
                <td className="check"><input className="row-check" type="checkbox" aria-label={`Select payment ${fmtDate(r.payment_date)} ${r.payee}`} /></td>
                <td>{fmtDate(r.payment_date)}{r.status === "paid" && <span className="badge paid" style={{ marginLeft: 6 }}>Paid</span>}</td>
                <td>{r.payee}</td><td className="num">{gbp(r.total)}</td>
                <td>{r.invoice_id ? <a className="btn ghost small" href={`/api/invoices/${r.invoice_id}`}>{r.number}</a> : <span className="muted small">Not yet issued</span>}</td></tr>
            ))}
          </tbody>
        </table></div>
      </section>
    </>
  );
}
