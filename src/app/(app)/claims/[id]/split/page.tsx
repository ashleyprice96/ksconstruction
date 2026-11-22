import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { splitScreen, submitClaim, approveEnteredClaim, ClaimError } from "@/lib/claims";
import { addGangMember, gangMembers, MemberSplitError, type SplitRequest } from "@/lib/members";
import { RamsRequiredError } from "@/lib/rams";
import { claimContext, TYPE_LABEL } from "@/lib/lookups";
import { back, safeMessage, str } from "@/lib/forms";
import { gbp, gbpPence, gbpRate, toPence } from "@/lib/money";
import { settings } from "@/lib/settings";
import ClaimSteps from "@/components/ClaimSteps";
import Flash from "@/components/Flash";
import SplitForm from "@/components/SplitForm";

function readSplit(f: FormData): SplitRequest[] {
  const basis = str(f, "basis") === "percent" ? "percent" : "amount";
  const rows: SplitRequest[] = [];
  for (const [k, v] of f.entries()) {
    if (!k.startsWith("split_") || String(v).trim() === "") continue;
    const raw = String(v);
    rows.push({ memberId: k.slice(6), basis, value: basis === "percent" ? Number(raw) : toPence(raw) });
  }
  return rows;
}

async function addPerson(f: FormData) {
  "use server";
  const user = await requireUser(["gang", "management", "admin"]);
  const id = str(f, "claim_id");
  try { await addGangMember(user, str(f, "name")); }
  catch (e) { back(`/claims/${id}/split`, "error", safeMessage(e, [MemberSplitError])); }
  back(`/claims/${id}/split`, "ok", "Added. They do not get a login.");
}

async function submit(f: FormData) {
  "use server";
  const user = await requireUser(["gang", "management", "admin"]);
  const id = str(f, "claim_id");
  const intent = str(f, "intent");
  try {
    if (intent === "approve") await approveEnteredClaim(user, id, readSplit(f));
    else await submitClaim(user, id, readSplit(f));
  }
  catch (e) {
    if (e instanceof RamsRequiredError) redirect(`/safety/rams/${e.siteId}?next=/claims/${id}/split`);
    back(`/claims/${id}/split`, "error", safeMessage(e, [ClaimError, MemberSplitError]));
  }
  redirect(`/claims/${id}?ok=${encodeURIComponent(intent === "approve" ? "Claim approved." : "Claim submitted for management sign-off.")}`);
}

export default async function Split({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser(["gang", "management", "admin"]);
  const { id } = await params;
  const sp = await searchParams;
  const data = await splitScreen(user, id).catch((e) => (e instanceof ClaimError ? null : Promise.reject(e)));
  if (!data) redirect(`/claims/${id}`);
  const ctx = await claimContext(id);
  const sig = await settings.signatureRequired();
  const members = await gangMembers(data.claim.gang_id);
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
      {user.role === "gang" && (
      <form action={addPerson} className="card stack">
        <h2 style={{ marginTop: 0 }}>People in your gang</h2>
        <p className="small muted">Add each person by name. This does not create a login.</p>
        <input type="hidden" name="claim_id" value={id} />
        <div className="row">
          <div style={{ flex: 1 }}><label htmlFor="member_name">Name</label><input id="member_name" name="name" type="text" required maxLength={80} placeholder="For example, Jo Demo" /></div>
          <div style={{ alignSelf: "end" }}><button className="btn secondary" type="submit">Add member</button></div>
        </div>
        {members.length > 0 && <p className="small" style={{ marginBottom: 0 }}>{members.map((m) => m.name).join(", ")}</p>}
      </form>
      )}
      <form action={submit} className="card stack">
        <input type="hidden" name="claim_id" value={id} />
        <SplitForm totalPence={data.totalPence} members={members} existing={{}} disabled={data.problems.length > 0} />
        {user.role === "gang" ? (
          <button className="btn" type="submit" disabled={data.problems.length > 0}>Submit claim</button>
        ) : (
          <div className="actions">
            <button className="btn" name="intent" value="submit" type="submit" disabled={data.problems.length > 0}>Submit for approval</button>
            <button className="btn secondary" name="intent" value="approve" type="submit" disabled={data.problems.length > 0}>Approve now</button>
          </div>
        )}
      </form>
    </>
  );
}
