import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { logout, requireUser } from "@/lib/auth";
import { confirmSafetyAlerts, pendingSafetyAlerts, SafetyError } from "@/lib/safety";
import { safeMessage } from "@/lib/forms";

function clientIp(h: Headers): string {
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (fwd || h.get("x-real-ip") || "unknown").slice(0, 64);
}

async function confirm(f: FormData) {
  "use server";
  const user = await requireUser(undefined, { allowSafety: true });
  const ids = f.getAll("alert_id").map(String).filter((id) => f.get(`confirm_${id}`) === "on");
  try {
    await confirmSafetyAlerts(user, ids, clientIp(await headers()));
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
  const sp = await searchParams;
  return (
    <div className="login-wrap">
      <div className="login-card wide" data-testid="hs-gate">
        <img src="/ks-logo.png" alt="" width={72} height={72} />
        <p className="eyebrow">Health and safety</p>
        <h1>Read and confirm</h1>
        <p className="lede">You need to confirm {alerts.length === 1 ? "this alert" : "these alerts"} before you can use Claims, {user.name.split(" ")[0]}.</p>
        {sp.error && <div className="alert error" role="alert">{sp.error}</div>}
        <form action={confirm} className="stack">
          {alerts.map((a) => (
            <article key={a.id} className="panel">
              <h2 style={{ marginTop: 0 }}>{a.title}</h2>
              <p style={{ whiteSpace: "pre-line" }}>{a.body}</p>
              {a.attachment_name && (
                <p><a href={`/api/safety/${a.id}`} target="_blank" rel="noreferrer">{a.attachment_mime?.startsWith("image/") ? "View image" : "Open attachment"}: {a.attachment_name}</a></p>
              )}
              <input type="hidden" name="alert_id" value={a.id} />
              <label className="check">
                <input type="checkbox" name={`confirm_${a.id}`} required />
                I confirm I have read and understood this H&amp;S alert
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
