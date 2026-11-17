import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, isManager } from "@/lib/auth";
import { q, q1 } from "@/lib/db";
import { approveClaim, assignPayRun, addTopSheets, claimEditLock, deleteBlockReason, deleteClaim, loadClaim, reduceLine, returnClaim, ClaimError } from "@/lib/claims";
import { gangMembers, memberSplitsFor, updateMemberSplit, MemberSplitError, type SplitRequest } from "@/lib/members";
import { claimContext, STATUS_LABEL, TYPE_LABEL } from "@/lib/lookups";
import { unsignedRamsFor } from "@/lib/rams";
import { back, safeMessage, str } from "@/lib/forms";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { gbp, gbpRate, toPence } from "@/lib/money";
import { settings } from "@/lib/settings";
import ClaimSummary from "@/components/ClaimSummary";
import TopSheetScanner from "@/components/TopSheetScanner";
import SplitForm from "@/components/SplitForm";
import DeleteClaimDialog from "@/components/DeleteClaimDialog";
import { claimFieldEdits, officeSetQuantity, officeUpdateDetails, unapproveClaim } from "@/lib/office-edit";
import Flash from "@/components/Flash";
import { listTopSheets } from "@/lib/attachments";

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
async function saveTopSheet(f: FormData) {
  "use server";
  const user = await requireUser(["management", "admin"]);
  const id = str(f, "claim_id");
  const files = f.getAll("pages").filter((x): x is File => x instanceof File && x.size > 0);
  try { await addTopSheets(user, id, files); }
  catch (e) { back(`/claims/${id}`, "error", safeMessage(e, [ClaimError])); }
  back(`/claims/${id}`, "ok", "Top sheet saved.");
}

async function saveSplit(f: FormData) {
  "use server";
  const user = await requireUser(["gang"]);
  const id = str(f, "claim_id");
  const basis = str(f, "basis") === "percent" ? "percent" : "amount";
  const rows: SplitRequest[] = [];
  for (const [k, v] of f.entries()) {
    if (!k.startsWith("split_") || String(v).trim() === "") continue;
    rows.push({ memberId: k.slice(6), basis, value: basis === "percent" ? Number(v) : toPence(String(v)) });
  }
  try { await updateMemberSplit(user, id, rows); }
  catch (e) { back(`/claims/${id}`, "error", safeMessage(e, [MemberSplitError])); }
  back(`/claims/${id}`, "ok", "Split saved.");
}
async function removeClaim(f: FormData) {
  "use server";
  const user = await requireUser();
  const id = str(f, "claim_id");
  try { await deleteClaim(user, id, str(f, "reason"), f.get("confirm") === "on"); }
  catch (e) { back(`/claims/${id}`, "error", safeMessage(e, [ClaimError])); }
  redirect("/claims?ok=Claim%20deleted.");
}
async function correctLine(f: FormData) {
  "use server";
  const user = await requireUser(["management", "admin"]);
  const id = str(f, "claim_id");
  try { await officeSetQuantity(user, id, str(f, "line_id"), Number(str(f, "quantity")), str(f, "reason")); }
  catch (e) { back(`/claims/${id}`, "error", safeMessage(e, [ClaimError])); }
  back(`/claims/${id}`, "ok", "Correction saved.");
}
async function correctDetails(f: FormData) {
  "use server";
  const user = await requireUser(["management", "admin"]);
  const id = str(f, "claim_id");
  try {
    await officeUpdateDetails(user, id, {
      siteId: str(f, "site_id"), jobNumberId: str(f, "job_id"), plotId: str(f, "plot_id") || null,
      notes: str(f, "notes"), reason: str(f, "reason"),
    });
  } catch (e) { back(`/claims/${id}`, "error", safeMessage(e, [ClaimError])); }
  back(`/claims/${id}`, "ok", "Claim details corrected.");
}
async function unapprove(f: FormData) {
  "use server";
  const user = await requireUser(["management", "admin"]);
  const id = str(f, "claim_id");
  try { await unapproveClaim(user, id, str(f, "reason")); }
  catch (e) { back(`/claims/${id}`, "error", safeMessage(e, [ClaimError])); }
  back(`/claims/${id}`, "ok", "Claim un-approved. You can edit it now.");
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
  const enteredBy = c.entered_by_user_id
    ? await q1<{ name: string }>("SELECT name FROM ops.users WHERE id = $1", [c.entered_by_user_id])
    : null;
  const missingRams = c.entered_by_user_id
    ? await unsignedRamsFor(c.created_by, c.site_id)
    : [];
  // Gangs see their own split amounts once submitted; management sees everything gang-side.
  const showSplits = mgr || (user.role === "gang" && !editable);
  const splits = showSplits ? await q<{ name: string; legal_name: string; amount: string; original_amount: string | null }>(
    `SELECT p.name, p.legal_name, s.amount, s.original_amount FROM ops.splits s JOIN ops.payees p ON p.id = s.payee_id WHERE s.claim_id = $1 ORDER BY p.name`, [id]) : [];
  const sheets = await listTopSheets(id);
  const memberSplit = (mgr || user.role === "gang") ? await memberSplitsFor(user, id).catch(() => []) : [];
  const members = user.role === "gang" && user.gang_id ? await gangMembers(user.gang_id) : [];
  const claimValue = await q1<{ t: string }>("SELECT coalesce(sum(gang_value), 0)::text AS t FROM ops.claim_lines WHERE claim_id = $1", [id]);
  const canEditSplit = user.role === "gang" && (c.status === "awaiting_management" || c.status === "returned");
  const deleteReason = (user.role === "gang" || mgr) ? await deleteBlockReason(user, c) : null;
  const editLock = mgr ? await claimEditLock(c) : null;
  const edits = await claimFieldEdits(id);
  const officeLines = mgr ? await q<{ id: string; description: string; quantity: string; unit: string }>(
    "SELECT id, description, quantity::text, unit FROM ops.claim_lines WHERE claim_id = $1 ORDER BY description", [id]) : [];
  const officeSites = mgr && !editLock ? await q<{ id: string; name: string }>("SELECT id, name FROM ops.sites WHERE active ORDER BY name") : [];
  const officeJobs = mgr && !editLock ? await q<{ id: string; code: string; site_id: string }>("SELECT id, code, site_id FROM ops.job_numbers WHERE active ORDER BY code") : [];

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
      {enteredBy && <p className="eyebrow" data-testid="entered-by">Entered by {enteredBy.name}{c.entered_at ? ` · ${fmtDateTime(c.entered_at)}` : ""}</p>}
      {missingRams.length > 0 && (
        <div className="alert warn" role="status">
          The gang lead has not signed the current RAMS for this site: {missingRams.map((r) => `${r.title} (revision ${r.revision})`).join(", ")}. They will be asked to sign it the next time they log in.
        </div>
      )}
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

      <h2>Top sheet</h2>
      <div className="card" data-testid="top-sheet-approval">
        {sheets.length === 0 && <p className="muted" style={{ marginTop: 0 }}>No top sheet has been scanned for this claim.</p>}
        {sheets.length > 0 && (
          <div className="thumbs">
            {sheets.map((f, i) => (
              <figure key={f.id}>
                <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer">
                  {f.mime.startsWith("image/")
                    ? <img src={`/api/files/${f.id}`} alt={`Top sheet page ${i + 1}`} />
                    : <div className="file-tile">Open PDF</div>}
                </a>
                <figcaption>Page {i + 1}</figcaption>
              </figure>
            ))}
          </div>
        )}
        {mgr && !editLock && <TopSheetScanner action={saveTopSheet} claimId={id} />}
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

      <h2>Gang split</h2>
      <div className="card" data-testid="approval-splits">
        {memberSplit.some((s) => s.needs_confirm) && <div className="alert warn">The claim value changed. Confirm the split again.</div>}
        {memberSplit.length === 0 && <p className="muted" style={{ marginTop: 0 }}>No split recorded yet.</p>}
        {memberSplit.length > 0 && (
          <div className="table-wrap dense"><table>
            <thead><tr><th>Person</th><th>Basis</th><th className="num">Percent</th><th className="num">Amount</th></tr></thead>
            <tbody>{memberSplit.map((s) => (
              <tr key={s.member_id}><td>{s.name}</td><td>{s.basis === "percent" ? "Percentage" : "Amount"}</td>
                <td className="num">{s.percent ? `${s.percent}%` : "—"}</td><td className="num">{gbp(s.amount)}</td></tr>
            ))}</tbody>
          </table></div>
        )}
        {canEditSplit && (
          <form action={saveSplit} className="stack" style={{ marginTop: 12 }}>
            <input type="hidden" name="claim_id" value={id} />
            <SplitForm totalPence={toPence(claimValue?.t ?? 0)} members={members} existing={{}} disabled={false} />
            <button className="btn" type="submit">Save split</button>
          </form>
        )}
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

      {edits.length > 0 && (
        <div className="card" data-testid="edit-audit">
          <h2 style={{ marginTop: 0 }}>Corrections</h2>
          <p className="small muted">K-S changed this claim. Each change records who made it and the previous value.</p>
          <div className="table-wrap dense"><table>
            <thead><tr><th>When</th><th>Field</th><th>From</th><th>To</th><th>By</th><th>Reason</th></tr></thead>
            <tbody>{edits.map((e, i) => (
              <tr key={i}><td>{fmtDateTime(e.at)}</td><td>{e.field}</td><td>{e.old_value}</td><td>{e.new_value}</td><td>{e.who}</td><td>{e.reason || "—"}</td></tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
      {mgr && editLock && <div className="alert warn" data-testid="edit-locked">{editLock}</div>}
      {mgr && c.status === "approved" && editLock === "Un-approve this claim before editing it." && (
        <form action={unapprove} className="card stack">
          <h2 style={{ marginTop: 0 }}>Un-approve</h2>
          <input type="hidden" name="claim_id" value={id} />
          <div><label htmlFor="un_reason">Reason (optional)</label><input id="un_reason" name="reason" type="text" maxLength={500} /></div>
          <button className="btn secondary" type="submit">Un-approve to edit</button>
        </form>
      )}
      {mgr && !editLock && (
        <div className="card stack" data-testid="office-edit">
          <h2 style={{ marginTop: 0 }}>Correct this claim</h2>
          <p className="small muted">Gang pay rates only. Client prices are not shown here.</p>
          {officeLines.map((line) => (
            <form key={line.id} action={correctLine} className="row" style={{ alignItems: "end" }}>
              <input type="hidden" name="claim_id" value={id} />
              <input type="hidden" name="line_id" value={line.id} />
              <div style={{ flex: 1 }}><label htmlFor={`q_${line.id}`}>{line.description}</label>
                <input id={`q_${line.id}`} name="quantity" type="number" min="0" step="any" defaultValue={Number(line.quantity)} /></div>
              <div><label htmlFor={`why_${line.id}`}>Reason</label><input id={`why_${line.id}`} name="reason" type="text" maxLength={500} /></div>
              <button className="btn secondary small" type="submit">Save</button>
            </form>
          ))}
          <form action={correctDetails} className="stack">
            <input type="hidden" name="claim_id" value={id} />
            <div className="row">
              <div><label htmlFor="edit_site">Site</label><select id="edit_site" name="site_id" defaultValue={c.site_id}>{officeSites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div><label htmlFor="edit_job">Job</label><select id="edit_job" name="job_id" defaultValue={c.job_number_id}>{officeJobs.filter((j) => j.site_id === c.site_id).map((j) => <option key={j.id} value={j.id}>{j.code}</option>)}</select></div>
            </div>
            <input type="hidden" name="plot_id" value={c.plot_id ?? ""} />
            <div><label htmlFor="edit_notes">Notes</label><textarea id="edit_notes" name="notes" defaultValue={c.notes} maxLength={2000} /></div>
            <div><label htmlFor="edit_reason">Reason (optional)</label><input id="edit_reason" name="reason" type="text" maxLength={500} /></div>
            <button className="btn secondary" type="submit">Save site and notes</button>
          </form>
        </div>
      )}
      {mgr && <ManagementPanel claimId={id} status={c.status} paylessOpen={!run || run.open} hasRun={!!run} />}
      {(user.role === "gang" || mgr) && <DeleteClaimDialog action={removeClaim} claimId={id} blocked={deleteReason} />}
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
