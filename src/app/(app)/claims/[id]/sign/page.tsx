import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { q1 } from "@/lib/db";
import { loadClaim, signForeman, ClaimError } from "@/lib/claims";
import { claimContext, TYPE_LABEL } from "@/lib/lookups";
import { back, safeMessage, str } from "@/lib/forms";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import ClaimSteps from "@/components/ClaimSteps";
import ClaimSummary from "@/components/ClaimSummary";
import Flash from "@/components/Flash";
import SignaturePad from "@/components/SignaturePad";

async function sign(f: FormData) {
  "use server";
  const user = await requireUser(["gang", "management", "admin"]);
  const id = str(f, "claim_id");
  try { await signForeman(user, id, str(f, "foreman_name"), str(f, "signature")); }
  catch (e) { back(`/claims/${id}/sign`, "error", safeMessage(e, [ClaimError])); }
  redirect(`/claims/${id}/split`);
}

export default async function Sign({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser(["gang", "management", "admin"]);
  const { id } = await params;
  const sp = await searchParams;
  const c = await loadClaim(user, id).catch(() => null);
  if (!c) redirect("/claims?error=Claim%20not%20found.");
  if (c.status !== "draft" && c.status !== "returned") redirect(`/claims/${id}`);
  const ctx = await claimContext(id);
  const existing = await q1<{ foreman_name: string; signed_at: string }>("SELECT foreman_name, signed_at FROM ops.foreman_signatures WHERE claim_id = $1", [id]);
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">{c.ref} · {TYPE_LABEL[c.claim_type]}</div>
        <h1>Foreman sign-off</h1></div></div>
      <ClaimSteps id={id} current="sign" />
      <Flash sp={sp} />
      <div className="card accent">
        <p className="eyebrow" style={{ marginTop: 0 }}>Hand the phone to the client foreman</p>
        <dl className="kv" style={{ marginBottom: 12 }}>
          <dt>Gang</dt><dd>{ctx.gang}</dd>
          <dt>Client</dt><dd>{ctx.client}</dd>
          <dt>Site</dt><dd>{ctx.site} · {ctx.job}</dd>
          {ctx.plot && <><dt>Plot</dt><dd>{ctx.plot}{ctx.house_type ? ` · ${ctx.house_type}` : ""}</dd></>}
          <dt>Work date</dt><dd>{fmtDate(c.work_date)}</dd>
          {c.stage && <><dt>Stage</dt><dd>{c.stage}</dd></>}
        </dl>
        <ClaimSummary claimId={id} />
      </div>
      {existing && <div className="alert ok">Signed by {existing.foreman_name} on {fmtDateTime(existing.signed_at)}. Signing again replaces it.</div>}
      <form action={sign} className="card stack">
        <input type="hidden" name="claim_id" value={id} />
        <div><label htmlFor="foreman_name">Foreman full name</label>
          <input id="foreman_name" name="foreman_name" type="text" autoComplete="off" required minLength={3} maxLength={120} /></div>
        <div><label>Signature</label><SignaturePad name="signature" /></div>
        <p className="small muted">Sign to confirm you have checked the work shown above. This records your typed name and signature with the date and time.</p>
        <button className="btn" type="submit">Sign</button>
      </form>
    </>
  );
}
