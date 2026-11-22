import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/dates";
import { redirect } from "next/navigation";
import { SHARE_KIND_LABEL, setShareActive, shareBoard, ShareError } from "@/lib/share";
import ShareForm from "@/components/ShareForm";

async function turnOff(f: FormData) {
  "use server";
  const user = await requireUser(["management", "admin"]);
  try { await setShareActive(user, String(f.get("id") ?? ""), false); }
  catch (e) {
    const message = e instanceof ShareError ? e.message : "Could not turn the link off.";
    redirect(`/setup?s=safety&error=${encodeURIComponent(message)}`);
  }
  redirect("/setup?s=safety&ok=Signing%20link%20switched%20off.");
}

export default async function SharePanel({ sites, useBlob }: { sites: string[]; useBlob: boolean }) {
  const cards = await shareBoard();
  return (
    <section>
      <ShareForm sites={sites} useBlob={useBlob} />
      <p className="small"><a href="/api/share/export">Download signing CSV</a></p>
      <div data-testid="share-list">
        {cards.length === 0 && <p className="muted">No signing links yet.</p>}
        {cards.map((card) => (
          <div key={card.id} className="card" id={`share-${card.id}`}>
            <div className="split">
              <div>
                <div className="eyebrow">{SHARE_KIND_LABEL[card.kind]}{card.site_name ? ` · ${card.site_name}` : ""} · {card.signers} signed</div>
                <h3 style={{ margin: "4px 0" }}>{card.title}</h3>
              </div>
              <span className={`badge ${card.active ? "submitted" : "draft"}`}>{card.active ? "Link on" : "Off"}</span>
            </div>
            <p className="small" style={{ wordBreak: "break-all" }}>{`/sign/${card.token}`}</p>
            <p className="small">
              <a href={`/api/share/${card.id}/signed-copy`}>Signed copy (PDF)</a>
              {card.missing ? ` · Still to sign: ${card.missing}` : " · Every app user has signed"}
            </p>
            <div className="table-wrap dense">
              <table>
                <thead><tr><th>Name</th><th>Company / gang</th><th>When</th><th>Signature</th></tr></thead>
                <tbody>
                  {card.people.map((p) => (
                    <tr key={p.id}>
                      <td>{p.full_name}</td>
                      <td>{p.company || "—"}</td>
                      <td>{fmtDateTime(p.signed_at)}</td>
                      <td><img src={`/api/share/signature/${p.id}`} alt={`Signature of ${p.full_name}`} style={{ height: 36, background: "#fff" }} /></td>
                    </tr>
                  ))}
                  {card.people.length === 0 && <tr><td colSpan={4}>No signatures yet.</td></tr>}
                </tbody>
              </table>
            </div>
            {card.active && (
              <form action={turnOff} style={{ marginTop: 12 }}>
                <input type="hidden" name="id" value={card.id} />
                <button className="btn ghost small" type="submit">Turn link off</button>
              </form>
            )}
          </div>
        ))}
      </div>
      <p className="small"><Link href="/api/share/export">CSV of every signature</Link></p>
    </section>
  );
}
