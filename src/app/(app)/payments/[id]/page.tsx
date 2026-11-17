import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { q, q1 } from "@/lib/db";
import { generateInvoices, payeeTotals, setRunStatus, PayRunError } from "@/lib/payments";
import { back, safeMessage, str } from "@/lib/forms";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { gbp } from "@/lib/money";
import { STATUS_LABEL } from "@/lib/lookups";
import Flash from "@/components/Flash";

async function invoices(f: FormData) {
  "use server";
  const user = await requireUser(["management", "admin"]);
  const id = str(f, "run_id");
  let n = 0;
  try { n = await generateInvoices(user, id); }
  catch (e) { back(`/payments/${id}`, "error", safeMessage(e, [PayRunError])); }
  back(`/payments/${id}`, "ok", `${n} new invoice${n === 1 ? "" : "s"} generated. Existing invoices were updated.`);
}
async function status(f: FormData) {
  "use server";
  const user = await requireUser(["management", "admin"]);
  const id = str(f, "run_id");
  try { await setRunStatus(user, id, str(f, "status") === "paid" ? "paid" : "closed"); }
  catch (e) { back(`/payments/${id}`, "error", safeMessage(e, [PayRunError])); }
  back(`/payments/${id}`, "ok", "Pay run updated.");
}

export default async function PayRun({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  await requireUser(["management", "admin"]);
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) redirect("/payments");
  const run = await q1<{ payment_date: string; first: string; last: string; payless_closes_at: string; status: string }>(
    `SELECT to_char(payment_date, 'YYYY-MM-DD') AS payment_date, to_char(first_week_ending, 'YYYY-MM-DD') AS first,
       to_char(last_week_ending, 'YYYY-MM-DD') AS last, payless_closes_at, status FROM ops.pay_runs WHERE id = $1`, [id]);
  if (!run) redirect("/payments");
  const [totals, claims, invs] = await Promise.all([
    payeeTotals(id),
    q<{ id: string; ref: string; gang: string; site: string; status: string; value: string | null; flags: string }>(
      `SELECT c.id, c.ref, g.name AS gang, s.name AS site, c.status, (SELECT sum(gang_value) FROM ops.claim_lines l WHERE l.claim_id = c.id) AS value,
         (SELECT count(*) FROM ops.claim_flags f WHERE f.claim_id = c.id) AS flags
       FROM ops.claims c JOIN ops.gangs g ON g.id = c.gang_id JOIN ops.sites s ON s.id = c.site_id WHERE c.pay_run_id = $1 ORDER BY c.status, g.name`, [id]),
    q<{ id: string; number: string; payee: string; total: string }>(
      "SELECT i.id, i.number, p.name AS payee, i.total::text FROM ops.payee_invoices i JOIN ops.payees p ON p.id = i.payee_id WHERE i.pay_run_id = $1 ORDER BY p.name", [id]),
  ]);
  const grand = totals.reduce((a, t) => a + Number(t.total), 0);
  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Pay run · {run.status}</div><h1>Payment {fmtDate(run.payment_date)}</h1>
          <p className="muted small">Week endings {fmtDate(run.first)} to {fmtDate(run.last)}. Pay-less window closes {fmtDateTime(run.payless_closes_at)}.</p></div>
        <div className="actions">
          <a className="btn" href={`/api/payruns/${id}/export?format=xlsx`}>Excel for Mark</a>
          <a className="btn secondary" href={`/api/payruns/${id}/export?format=csv`}>CSV</a>
        </div>
      </div>
      <Flash sp={sp} />
      <p className="small muted">Exports include approved claims only: wages by payee, gang splits, dayworks, supervision and pay-less reductions. Gross amounts; VAT, CIS and net pay are handled by the payment company and accountant.</p>
      <h2>Wages by payee</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Payee</th><th>Gang</th><th className="num">Measured</th><th className="num">Daywork</th><th className="num">Supervision</th><th className="num">Reductions</th><th className="num">Total</th></tr></thead>
        <tbody>
          {totals.length === 0 && <tr><td colSpan={7} className="muted">No approved claims yet.</td></tr>}
          {totals.map((t) => (
            <tr key={t.payee_id}><td>{t.payee}<div className="small muted">{t.legal_name} · {t.entity_type.replace("_", " ")}</div></td><td>{t.gang}</td>
              <td className="num">{gbp(t.measured)}</td><td className="num">{gbp(t.daywork)}</td><td className="num">{gbp(t.supervision)}</td>
              <td className="num">{Number(t.reductions) ? `-${gbp(t.reductions)}` : ""}</td><td className="num"><strong>{gbp(t.total)}</strong></td></tr>
          ))}
          {totals.length > 0 && <tr><td colSpan={6}><strong>Total</strong></td><td className="num"><strong>{gbp(grand)}</strong></td></tr>}
        </tbody>
      </table></div>

      <h2>Invoices</h2>
      <form action={invoices}><input type="hidden" name="run_id" value={id} /><button className="btn secondary" type="submit">Generate or refresh invoices</button></form>
      {invs.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 12 }}><table>
          <thead><tr><th>Invoice</th><th>Payee</th><th className="num">Total</th></tr></thead>
          <tbody>{invs.map((i) => <tr key={i.id}><td><a href={`/api/invoices/${i.id}`}>{i.number}</a></td><td>{i.payee}</td><td className="num">{gbp(i.total)}</td></tr>)}</tbody>
        </table></div>
      )}

      <h2>Claims in this run</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Claim</th><th>Gang</th><th>Site</th><th>Status</th><th className="num">Gang value</th></tr></thead>
        <tbody>{claims.map((c) => (
          <tr key={c.id}><td><Link href={`/claims/${c.id}`}>{c.ref}</Link></td><td>{c.gang}</td><td>{c.site}</td>
            <td><span className={`badge ${c.status}`}>{STATUS_LABEL[c.status]}</span>{Number(c.flags) > 0 && <> <span className="badge flag">flagged</span></>}</td>
            <td className="num">{c.value ? gbp(c.value) : ""}</td></tr>
        ))}</tbody>
      </table></div>

      {run.status !== "paid" && (
        <div className="grid" style={{ marginTop: 16 }}>
          {run.status === "open" && (
            <form action={status} className="card stack"><input type="hidden" name="run_id" value={id} /><input type="hidden" name="status" value="closed" />
              <h3 style={{ marginTop: 0 }}>Close to new claims</h3><p className="small muted">Later claims roll to the next open run.</p>
              <button className="btn secondary" type="submit">Close run</button></form>
          )}
          <form action={status} className="card stack"><input type="hidden" name="run_id" value={id} /><input type="hidden" name="status" value="paid" />
            <h3 style={{ marginTop: 0 }}>Mark as paid</h3><p className="small muted">Marks every approved claim in this run as paid.</p>
            <button className="btn" type="submit">Mark paid</button></form>
        </div>
      )}
    </>
  );
}
