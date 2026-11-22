import { headers } from "next/headers";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/dates";
import { redirect } from "next/navigation";
import { SHARE_KIND_LABEL, setShareActive, shareBoard, ShareError } from "@/lib/share";
import ShareForm from "@/components/ShareForm";
import ShareLinkActions from "@/components/ShareLinkActions";

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
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const origin = host ? `${proto}://${host}` : "";
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
                <div className="eyebrow">{SHARE_KIND_LABEL[card.kind]}{card.site_name ? ` · ${card.site_name}` : ""}</div>
                <h3 style={{ margin: "4px 0" }}>{card.title}</h3>
                <p className="small" style={{ margin: 0 }}>{card.signers} {card.signers === 1 ? "signature" : "signatures"}</p>
              </div>
              <span className={`badge ${card.active ? "submitted" : "draft"}`}>{card.active ? "Link on" : "Off"}</span>
            </div>
            <ShareLinkActions kind={SHARE_KIND_LABEL[card.kind]} title={card.title} site={card.site_name ?? ""} url={`${origin}/sign/${card.token}`} />
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
                      <td>{p.company.trim() ? p.company : "Not given"}</td>
                      <td>{fmtDateTime(p.signed_at)}</td>
                      <td>
                        <img src={`/api/share/signature/${p.id}`} alt={`Signature of ${p.full_name}`} style={{ height: 36, background: "#fff" }} />
                        <div className="small"><a href={`/api/share/${card.id}/signed-copy?signer=${p.id}`}>Signed copy</a></div>
                      </td>
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
