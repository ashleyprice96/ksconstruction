import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { splitScreen, submitClaim, ClaimError } from "@/lib/claims";
import { claimContext, TYPE_LABEL } from "@/lib/lookups";
import { back, safeMessage, str } from "@/lib/forms";
import { gbp, gbpPence, gbpRate, toPence } from "@/lib/money";
import { settings } from "@/lib/settings";
import ClaimSteps from "@/components/ClaimSteps";
import Flash from "@/components/Flash";
import SplitForm from "@/components/SplitForm";

async function submit(f: FormData) {
  "use server";
  const user = await requireUser(["gang"]);
  const id = str(f, "claim_id");
  const split: { payeeId: string; pence: number }[] = [];
  for (const [k, v] of f.entries()) {
    if (k.startsWith("split_") && String(v).trim() !== "") split.push({ payeeId: k.slice(6), pence: toPence(String(v)) });
  }
  try { await submitClaim(user, id, split); }
  catch (e) { back(`/claims/${id}/split`, "error", safeMessage(e, [ClaimError])); }
  redirect(`/claims/${id}?ok=${encodeURIComponent("Claim submitted for management sign-off.")}`);
}

export default async function Split({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser(["gang"]);
  const { id } = await params;
  const sp = await searchParams;
  const data = await splitScreen(user, id).catch((e) => (e instanceof ClaimError ? null : Promise.reject(e)));
  if (!data) redirect(`/claims/${id}`);
  const ctx = await claimContext(id);
  const sig = await settings.signatureRequired();
  const existing = Object.fromEntries(data.existing.map((s) => [s.payee_id, s.amount]));
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">{data.claim.ref} · {TYPE_LABEL[data.claim.claim_type]}</div>
        <h1>Check and split</h1>
        <p className="muted small">{ctx.site} · {ctx.job}{ctx.plot ? ` · Plot ${ctx.plot}` : ""}</p></div></div>
      <ClaimSteps id={id} current="split" signatureRequired={sig[data.claim.claim_type] !== false} />
      <Flash sp={sp} />
      <div className="card accent">
        <h2 style={{ marginTop: 0 }}>Your claim</h2>
        <p className="small muted">Worked out from your agreed rates. You cannot change a rate here: if one looks wrong, contact the office.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Work</th><th className="num">Quantity</th><th className="num">Rate</th><th className="num">Value</th></tr></thead>
            <tbody>
              {data.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.description}{l.problem && <div className="small" style={{ color: "var(--bad)" }}>{l.problem}</div>}</td>
                  <td className="num">{Number(l.quantity)} {l.unit}</td>
                  <td className="num">{l.gang_rate ? (l.unit === "%" ? `${gbp(l.gang_rate)} lift` : gbpRate(l.gang_rate)) : "Not set"}</td>
                  <td className="num">{l.gang_value_pence !== null ? gbpPence(l.gang_value_pence) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="total-line"><span>Claim total</span><span>{gbpPence(data.totalPence)}</span></div>
      </div>
      <form action={submit} className="card stack">
        <input type="hidden" name="claim_id" value={id} />
        <SplitForm totalPence={data.totalPence} payees={data.payees} existing={existing} disabled={data.problems.length > 0} />
        <p className="small muted">The split cannot be more than the claim value. Submitted claims go to K-S management for sign-off.</p>
        <button className="btn" type="submit" disabled={data.problems.length > 0}>Submit claim</button>
      </form>
    </>
  );
}
