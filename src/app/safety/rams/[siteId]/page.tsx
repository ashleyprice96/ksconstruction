import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { confirmRams, pendingRams } from "@/lib/rams";
import { gangMembers } from "@/lib/members";
import { SafetyError } from "@/lib/safety";
import { safeMessage, str } from "@/lib/forms";
import SignaturePad from "@/components/SignaturePad";
import PdfViewer, { OpenedGate, SignButton } from "@/components/PdfViewer";
import { claimsEnabled } from "@/lib/features";

function clientIp(h: Headers): string {
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (fwd || h.get("x-real-ip") || "unknown").slice(0, 64);
}

function afterRams(next: string) {
  const fallback = claimsEnabled() ? "/claims/new" : "/";
  if (!next.startsWith("/")) return fallback;
  if (!claimsEnabled() && (next.startsWith("/claims") || next.startsWith("/payments") || next.startsWith("/rates"))) return "/";
  return next;
}

async function confirm(f: FormData) {
  "use server";
  const user = await requireUser(["gang"]);
  const siteId = str(f, "site_id");
  const next = afterRams(str(f, "next"));
  const h = await headers();
  try {
    for (const id of f.getAll("rams_id").map(String)) {
      if (f.get(`confirm_${id}`) !== "on") throw new SafetyError("Tick to confirm you have read the RAMS.");
      await confirmRams(user, {
        ramsId: id,
        signatureName: str(f, `sign_${id}`),
        signaturePng: str(f, `signature_${id}`),
        attendeeIds: f.getAll(`attend_${id}`).map(String),
        ip: clientIp(h),
        userAgent: h.get("user-agent") ?? "",
        opened: f.get(`opened_${id}`) === "yes",
      });
    }
  } catch (e) {
    redirect(`/safety/rams/${siteId}?error=${encodeURIComponent(safeMessage(e, [SafetyError]))}`);
  }
  redirect(next);
}

export default async function RamsGate({ params, searchParams }: { params: Promise<{ siteId: string }>; searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser(["gang"]);
  const { siteId } = await params;
  const sp = await searchParams;
  const docs = await pendingRams(user, siteId);
  if (!docs.length) redirect(afterRams(sp.next ?? ""));
  const members = user.gang_id ? await gangMembers(user.gang_id) : [];
  return (
    <div className="login-wrap">
      <div className="login-card wide" data-testid="rams-gate">
        <img src="/ks-logo.png" alt="" width={72} height={72} />
        <p className="eyebrow">Site RAMS</p>
        <h1>Read and sign</h1>
        <p className="lede">{claimsEnabled()
          ? `Confirm the current RAMS for ${docs[0].site} before you create or submit a claim there. The rest of the app stays open.`
          : `Read the current RAMS for ${docs[0].site}, sign it, and tick who was briefed. A new version needs signing again.`}</p>
        {sp.error && <div className="alert error" role="alert">{sp.error}</div>}
        <form action={confirm} className="stack">
          <input type="hidden" name="site_id" value={siteId} />
          <input type="hidden" name="next" value={sp.next ?? ""} />
          <OpenedGate pdfIds={docs.map((doc) => doc.id)}>
          {docs.map((doc) => (
            <article key={doc.id} className="panel">
              <p className="eyebrow">Revision {doc.revision}</p>
              <h2 style={{ marginTop: 0 }}>{doc.title}</h2>
              <PdfViewer id={doc.id} src={`/api/rams/${doc.id}`} pages={doc.pdf_pages} title={doc.title} />
              <input type="hidden" name="rams_id" value={doc.id} />
              <fieldset>
                <legend>Who was briefed</legend>
                {members.map((m) => (
                  <label key={m.id} className="check"><input type="checkbox" name={`attend_${doc.id}`} value={m.id} /> {m.name}</label>
                ))}
              </fieldset>
              <div><label htmlFor={`sign_${doc.id}`}>Your name</label><input id={`sign_${doc.id}`} name={`sign_${doc.id}`} type="text" required minLength={3} maxLength={80} /></div>
              <div><label>Draw your signature</label><SignaturePad name={`signature_${doc.id}`} /></div>
              <label className="check"><input type="checkbox" name={`confirm_${doc.id}`} required /> I confirm I have read and understood this RAMS</label>
            </article>
          ))}
          <SignButton>Confirm</SignButton>
          </OpenedGate>
        </form>
      </div>
    </div>
  );
}
