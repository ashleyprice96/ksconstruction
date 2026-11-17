import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, isManager } from "@/lib/auth";
import { q, q1 } from "@/lib/db";
import { approveClaim, assignPayRun, loadClaim, reduceLine, returnClaim, ClaimError } from "@/lib/claims";
import { claimContext, STATUS_LABEL, TYPE_LABEL } from "@/lib/lookups";
import { back, safeMessage, str } from "@/lib/forms";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { gbp, gbpRate } from "@/lib/money";
import { settings } from "@/lib/settings";
import ClaimSummary from "@/components/ClaimSummary";
import Flash from "@/components/Flash";

async function approve(f: FormData) {
  "use server";
  const user = await requireUser(["management", "admin"]);
  const id = str(f, "claim_id");
  try { await approveClaim(user, id, str(f, "comment")); }
  catch (e) { back(`/claims/${id}`, "error", safeMessage(e, [ClaimError])); }
  back(`/claims/${id}`, "ok", "Claim approved.");
}
async function sendBack(f: FormData) {
  "use server";
  const user = await requireUser(["management", "admin"]);
  const id = str(f, "claim_id");
  try { await returnClaim(user, id, str(f, "comment")); }
  catch (e) { back(`/claims/${id}`, "error", safeMessage(e, [ClaimError])); }
  back(`/claims/${id}`, "ok", "Claim returned to the gang.");
}
async function reduce(f: FormData) {
  "use server";
  const user = await requireUser(["management", "admin"]);
  const id = str(f, "claim_id");
  try { await reduceLine(user, id, str(f, "line_id"), Number(str(f, "quantity")), str(f, "reason"), str(f, "note")); }
  catch (e) { back(`/claims/${id}`, "error", safeMessage(e, [ClaimError])); }
  back(`/claims/${id}`, "ok", "Reduction recorded. Splits rescaled.");
}
async function setRun(f: FormData) {
  "use server";
  const user = await requireUser(["management", "admin"]);
  const id = str(f, "claim_id");
  try { await assignPayRun(user, id, str(f, "pay_run_id")); }
  catch (e) { back(`/claims/${id}`, "error", safeMessage(e, [ClaimError])); }
  back(`/claims/${id}`, "ok", "Pay run assigned.");
}

export default async function ClaimPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const c = await loadClaim(user, id).catch(() => null);
  if (!c) redirect("/claims?error=Claim%20not%20found.");
  const mgr = isManager(user);
  const ctx = await claimContext(id);
  const sig = await q1<{ foreman_name: string; signed_at: string; attachment_id: string }>(
    "SELECT foreman_name, signed_at, attachment_id FROM ops.foreman_signatures WHERE claim_id = $1", [id]);
  const run = c.pay_run_id ? await q1<{ payment_date: string; payless_closes_at: string; open: boolean }>(
    `SELECT to_char(payment_date, 'YYYY-MM-DD') AS payment_date, payless_closes_at, (status = 'open' AND payless_closes_at > now()) AS open
     FROM ops.pay_runs WHERE id = $1`, [c.pay_run_id]) : null;
  const lastReturn = await q1<{ comment: string; created_at: string }>(
    "SELECT comment, created_at FROM ops.approvals WHERE claim_id = $1 AND action = 'return' ORDER BY created_at DESC LIMIT 1", [id]);
  const editable = user.role === "gang" && (c.status === "draft" || c.status === "returned");
  // Gangs see their own split amounts once submitted; management sees everything gang-side.
  const showSplits = mgr || (user.role === "gang" && !editable);
  const splits = showSplits ? await q<{ name: string; legal_name: string; amount: string; original_amount: string | null }>(
    `SELECT p.name, p.legal_name, s.amount, s.original_amount FROM ops.splits s JOIN ops.payees p ON p.id = s.payee_id WHERE s.claim_id = $1 ORDER BY p.name`, [id]) : [];

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">{TYPE_LABEL[c.claim_type]} claim</div><h1>{c.ref}</h1>
          <p className="muted small">{ctx.gang} · {ctx.client} · {ctx.site} · {ctx.job}{ctx.plot ? ` · Plot ${ctx.plot}` : ""}{ctx.house_type ? ` · ${ctx.house_type}` : ""}</p></div>
        <div className="actions">
          <span className={`badge ${c.status}${c.status === "awaiting_management" ? " submitted" : ""}`}>{STATUS_LABEL[c.status]}</span>
          {sig && <span className="badge signed">Signed</span>}
        </div>
      </div>
      <Flash sp={sp} />
      {c.status === "returned" && lastReturn && <div className="alert warn">Returned by K-S on {fmtDateTime(lastReturn.created_at)}: {lastReturn.comment}</div>}
      {editable && (
        <div className="card accent">
          <p style={{ marginTop: 0 }}>This claim has not been submitted yet.</p>
          <Link className="btn" href={`/claims/${id}/quantities`}>Continue the claim</Link>
        </div>
      )}

      <div className="card">
        <dl className="kv">
          <dt>Work date</dt><dd>{fmtDate(c.work_date)}</dd>
          <dt>Week ending</dt><dd>{c.week_ending ? fmtDate(c.week_ending) : "Set when submitted"}</dd>
          <dt>Pay run</dt><dd>{run ? `Payment ${fmtDate(run.payment_date)}${c.rolled_to_next_run ? " (rolled from an earlier run: late)" : ""}` : "Not assigned"}</dd>
          {c.stage && <><dt>Stage</dt><dd>{c.stage}</dd></>}
          {c.submitted_at && <><dt>Submitted</dt><dd>{fmtDateTime(c.submitted_at)}</dd></>}
          {c.notes && <><dt>Notes</dt><dd>{c.notes}</dd></>}
        </dl>
      </div>

      <h2>Work and evidence</h2>
      <div className="card"><ClaimSummary claimId={id} /></div>

      <h2>Foreman sign-off</h2>
      <div className="card">
        {sig ? (
          <>
            <p style={{ marginTop: 0 }}>Signed by <strong>{sig.foreman_name}</strong> on {fmtDateTime(sig.signed_at)}.</p>
            <img className="sig-preview" src={`/api/files/${sig.attachment_id}`} alt={`Signature of ${sig.foreman_name}`} />
            <p className="small muted">Given on the gang&apos;s device in good faith. The app records the typed name and signature; it does not verify identity.</p>
          </>
        ) : <p className="muted" style={{ margin: 0 }}>Not signed.</p>}
      </div>

      {showSplits && splits.length > 0 && (
        <>
          <h2>Split</h2>
          <div className="table-wrap dense"><table>
            <thead><tr><th>Payee</th><th className="num">Amount</th>{mgr && <th className="num">Before reductions</th>}</tr></thead>
            <tbody>{splits.map((s, i) => (
              <tr key={i}><td>{s.name}{s.legal_name !== s.name && <div className="small muted">{s.legal_name}</div>}</td>
                <td className="num">{gbp(s.amount)}</td>{mgr && <td className="num">{s.original_amount ? gbp(s.original_amount) : ""}</td>}</tr>
            ))}</tbody>
          </table></div>
        </>
      )}

      {mgr && <ManagementPanel claimId={id} status={c.status} paylessOpen={!run || run.open} hasRun={!!run} />}
    </>
  );
}

async function ManagementPanel({ claimId, status, paylessOpen, hasRun }: { claimId: string; status: string; paylessOpen: boolean; hasRun: boolean }) {
  const [lines, flags, history, adjustments, runs, reasons] = await Promise.all([
    q<{ id: string; description: string; unit: string; quantity: string; gang_rate: string | null; rate_source: string | null; gang_value: string | null;
      original_quantity: string | null; original_gang_value: string | null }>(
      "SELECT id, description, unit, quantity, gang_rate, rate_source, gang_value, original_quantity, original_gang_value FROM ops.claim_lines WHERE claim_id = $1 ORDER BY description", [claimId]),
    q<{ kind: string; message: string }>("SELECT kind, message FROM ops.claim_flags WHERE claim_id = $1", [claimId]),
    q<{ at: string; action: string; who: string | null; details: Record<string, unknown> }>(
      `SELECT a.at, a.action, u.name AS who, a.details FROM ops.audit_log a LEFT JOIN ops.users u ON u.id = a.user_id
       WHERE a.entity = 'claim' AND a.entity_id = $1 ORDER BY a.at`, [claimId]),
    q<{ description: string; before_quantity: string; after_quantity: string; before_value: string; after_value: string; reason_category: string; note: string; who: string; created_at: string }>(
      `SELECT l.description, a.before_quantity, a.after_quantity, a.before_value, a.after_value, a.reason_category, a.note, u.name AS who, a.created_at
       FROM ops.adjustments a JOIN ops.claim_lines l ON l.id = a.claim_line_id JOIN ops.users u ON u.id = a.user_id WHERE a.claim_id = $1 ORDER BY a.created_at`, [claimId]),
    q<{ id: string; payment_date: string }>("SELECT id, to_char(payment_date, 'YYYY-MM-DD') AS payment_date FROM ops.pay_runs WHERE status = 'open' ORDER BY payment_date"),
    settings.paylessReasons(),
  ]);
  const total = lines.reduce((a, l) => a + Number(l.gang_value ?? 0), 0);
  const canReduce = (status === "awaiting_management" || status === "approved") && paylessOpen;
  return (
    <>
      <h2>Management</h2>
      {flags.length > 0 && <div className="alert warn"><strong>Flags</strong>{flags.map((f, i) => <div key={i}>{f.message}</div>)}</div>}
      <div className="table-wrap dense" style={{ marginBottom: 16 }}><table>
        <thead><tr><th>Line</th><th className="num">Quantity</th><th className="num">Gang rate</th><th>Rate from</th><th className="num">Gang value</th><th className="num">Originally</th></tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <td>{l.description}</td>
              <td className="num">{Number(l.quantity)} {l.unit}</td>
              <td className="num">{l.gang_rate ? (l.unit === "%" ? gbp(l.gang_rate) : gbpRate(l.gang_rate)) : "Not set"}</td>
              <td className="small">{l.rate_source ?? ""}</td>
              <td className="num">{l.gang_value ? gbp(l.gang_value) : ""}</td>
              <td className="num small">{l.original_gang_value ? `${Number(l.original_quantity)} ${l.unit} · ${gbp(l.original_gang_value)}` : ""}</td>
            </tr>
          ))}
          <tr><td colSpan={4}><strong>Total gang cost</strong></td><td className="num"><strong>{gbp(total)}</strong></td><td /></tr>
        </tbody>
      </table></div>

      {status === "awaiting_management" && (
        <div className="grid">
          <form action={approve} className="card stack">
            <input type="hidden" name="claim_id" value={claimId} />
            <h3 style={{ marginTop: 0 }}>Approve (second sign-off)</h3>
            <div><label htmlFor="ac">Comment (optional)</label><input id="ac" name="comment" type="text" maxLength={1000} /></div>
            <button className="btn" type="submit" disabled={!hasRun}>Approve</button>
            {!hasRun && <p className="small muted">Assign a pay run first.</p>}
          </form>
          <form action={sendBack} className="card stack">
            <input type="hidden" name="claim_id" value={claimId} />
            <h3 style={{ marginTop: 0 }}>Return to the gang</h3>
            <div><label htmlFor="rc">What needs fixing</label><input id="rc" name="comment" type="text" required minLength={3} maxLength={1000} /></div>
            <button className="btn secondary" type="submit">Return</button>
          </form>
        </div>
      )}

      {status !== "paid" && (
        <form action={setRun} className="card stack">
          <input type="hidden" name="claim_id" value={claimId} />
          <h3 style={{ marginTop: 0 }}>Pay run</h3>
          <div><label htmlFor="pr">Move to pay run</label>
            <select id="pr" name="pay_run_id" required defaultValue="">
              <option value="" disabled>Choose</option>
              {runs.map((r) => <option key={r.id} value={r.id}>Payment {fmtDate(r.payment_date)}</option>)}
            </select></div>
          <button className="btn secondary" type="submit">Assign</button>
        </form>
      )}

      {(status === "awaiting_management" || status === "approved") && (
        <details className="card">
          <summary>Pay-less reduction</summary>
          {!canReduce && <p className="alert warn">The pay-less window for this pay run has closed.</p>}
          <p className="small muted">Reduce a line&apos;s quantity. The original, the change, who made it and why are kept permanently, and the split is rescaled in proportion. The exact pay-less rules and any notice requirements are still to be confirmed by K-S.</p>
          <form action={reduce} className="stack">
            <input type="hidden" name="claim_id" value={claimId} />
            <div><label htmlFor="rl">Line</label>
              <select id="rl" name="line_id" required>{lines.map((l) => <option key={l.id} value={l.id}>{l.description} ({Number(l.quantity)} {l.unit})</option>)}</select></div>
            <div className="row">
              <div><label htmlFor="rq">Reduced quantity</label><input id="rq" name="quantity" type="number" min="0" step="any" required /></div>
              <div><label htmlFor="rr">Reason</label><select id="rr" name="reason" required>{reasons.map((r) => <option key={r}>{r}</option>)}</select></div>
            </div>
            <div><label htmlFor="rn">Note</label><textarea id="rn" name="note" required minLength={5} maxLength={2000} /></div>
            <button className="btn danger" type="submit" disabled={!canReduce}>Record reduction</button>
          </form>
        </details>
      )}

      {adjustments.length > 0 && (
        <>
          <h3>Reductions</h3>
          <div className="table-wrap dense"><table>
            <thead><tr><th>When</th><th>Who</th><th>Line</th><th>Change</th><th>Reason</th></tr></thead>
            <tbody>{adjustments.map((a, i) => (
              <tr key={i}><td className="small">{fmtDateTime(a.created_at)}</td><td>{a.who}</td><td>{a.description}</td>
                <td className="small">{Number(a.before_quantity)} to {Number(a.after_quantity)}<br />{gbp(a.before_value)} to {gbp(a.after_value)}</td>
                <td className="small">{a.reason_category}<br />{a.note}</td></tr>
            ))}</tbody>
          </table></div>
        </>
      )}

      <details className="card" style={{ marginTop: 16 }}>
        <summary>History ({history.length})</summary>
        <ul className="small">
          {history.map((h, i) => <li key={i}>{fmtDateTime(h.at)} · {h.who ?? "System"} · {h.action.replaceAll("_", " ")}</li>)}
        </ul>
      </details>
    </>
  );
}
