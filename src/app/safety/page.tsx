import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { logout, requireUser } from "@/lib/auth";
import { confirmSafetyAlerts, pendingSafetyAlerts, SafetyError, type SafetyConfirmation } from "@/lib/safety";
import { gangMembers } from "@/lib/members";
import { safeMessage, str } from "@/lib/forms";
import { fmtDate } from "@/lib/dates";
import SignaturePad from "@/components/SignaturePad";

function clientIp(h: Headers): string {
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (fwd || h.get("x-real-ip") || "unknown").slice(0, 64);
}

async function confirm(f: FormData) {
  "use server";
  const user = await requireUser(undefined, { allowSafety: true });
  const h = await headers();
  const items: SafetyConfirmation[] = f.getAll("alert_id").map(String).filter((id) => f.get(`confirm_${id}`) === "on").map((id) => ({
    id,
    signatureName: str(f, `sign_${id}`),
    signaturePng: str(f, `signature_${id}`),
    attendeeIds: f.getAll(`attend_${id}`).map(String),
  }));
  try {
    await confirmSafetyAlerts(user, items, clientIp(h), h.get("user-agent") ?? "");
  } catch (e) {
    redirect(`/safety?error=${encodeURIComponent(safeMessage(e, [SafetyError]))}`);
  }
  redirect("/");
}

async function signOut() {
  "use server";
  await logout();
  redirect("/login");
}

export default async function SafetyGate({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser(undefined, { allowSafety: true });
  const alerts = await pendingSafetyAlerts(user);
  if (!alerts.length) redirect("/");
  const members = user.gang_id ? await gangMembers(user.gang_id) : [];
  const sp = await searchParams;
  return (
    <div className="login-wrap">
      <div className="login-card wide" data-testid="hs-gate">
        <img src="/ks-logo.png" alt="" width={72} height={72} />
        <p className="eyebrow">Health and safety</p>
        <h1>Read and confirm</h1>
        <p className="lede">Confirm {alerts.length === 1 ? "this document" : "these documents"} before you can use Claims, {user.name.split(" ")[0]}.</p>
        {sp.error && <div className="alert error" role="alert">{sp.error}</div>}
        <form action={confirm} className="stack">
          {alerts.map((a) => (
            <article key={a.id} className="panel">
              <p className="eyebrow">{a.kind === "toolbox" ? "Toolbox talk" : "H&S alert"}{a.sites ? ` · ${a.sites}` : " · All sites"}{a.due_on ? ` · Due ${fmtDate(a.due_on)}` : ""}</p>
              <h2 style={{ marginTop: 0 }}>{a.title}</h2>
              {a.body && <p style={{ whiteSpace: "pre-line" }}>{a.body}</p>}
              {a.attachment_mime === "application/pdf" && (
                <iframe title={a.title} src={`/api/safety/${a.id}`} style={{ width: "100%", height: "70vh", border: 0, borderRadius: 8, background: "#fff" }} />
              )}
              {a.attachment_mime?.startsWith("image/") && <img src={`/api/safety/${a.id}`} alt={a.attachment_name ?? a.title} style={{ width: "100%", height: "auto" }} />}
              <input type="hidden" name="alert_id" value={a.id} />
              {a.kind === "toolbox" && (
                <fieldset>
                  <legend>Who attended</legend>
                  {members.length === 0 && <p className="small muted">Add people to your gang from a claim, then come back and tick who was there.</p>}
                  {members.map((m) => (
                    <label key={m.id} className="check"><input type="checkbox" name={`attend_${a.id}`} value={m.id} /> {m.name}</label>
                  ))}
                </fieldset>
              )}
              <div><label htmlFor={`sign_${a.id}`}>Your name</label><input id={`sign_${a.id}`} name={`sign_${a.id}`} type="text" required minLength={3} maxLength={80} autoComplete="name" /></div>
              <div><label>Draw your signature</label><SignaturePad name={`signature_${a.id}`} /></div>
              <label className="check">
                <input type="checkbox" name={`confirm_${a.id}`} required />
                I confirm I have read and understood this {a.kind === "toolbox" ? "toolbox talk" : "H&S alert"}
              </label>
            </article>
          ))}
          <button className="btn" type="submit">Confirm</button>
        </form>
        <form action={signOut} style={{ marginTop: 16 }}><button className="btn ghost" type="submit">Sign out</button></form>
      </div>
    </div>
  );
}
