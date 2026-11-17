import { revalidatePath } from "next/cache";
import { requireUser, isManager } from "@/lib/auth";
import { q } from "@/lib/db";
import { acknowledge, noticesFor, publishNotice } from "@/lib/notices";
import { back, str } from "@/lib/forms";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import Flash from "@/components/Flash";

async function ack(f: FormData) {
  "use server";
  const user = await requireUser();
  await acknowledge(user, str(f, "notice_id"));
  revalidatePath("/notices");
}
async function publish(f: FormData) {
  "use server";
  const user = await requireUser(["management", "admin"]);
  const kind = str(f, "kind") === "news" ? "news" : "health_safety";
  if (str(f, "title").length < 3 || str(f, "body").length < 3) back("/notices", "error", "Enter a title and the message.");
  await publishNotice(user, { kind, title: str(f, "title"), body: str(f, "body"), siteId: str(f, "site_id") || null, gangId: str(f, "gang_id") || null });
  back("/notices", "ok", "Published.");
}

export default async function Notices({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const mgr = isManager(user);
  const notices = await noticesFor(user);
  const [sites, gangs, report] = mgr ? await Promise.all([
    q<{ id: string; name: string }>("SELECT id, name FROM ops.sites WHERE active ORDER BY name"),
    q<{ id: string; name: string }>("SELECT id, name FROM ops.gangs WHERE active ORDER BY name"),
    // Who has not acknowledged each active notice, among the users it targets.
    q<{ notice_id: string; acknowledged: string; outstanding: string | null }>(
      `SELECT n.id AS notice_id,
         count(a.user_id)::text AS acknowledged,
         string_agg(u.name, ', ' ORDER BY u.name) FILTER (WHERE a.user_id IS NULL) AS outstanding
       FROM ops.notices n
       JOIN ops.users u ON u.active AND (n.gang_id IS NULL OR u.gang_id = n.gang_id)
         AND (n.site_id IS NULL OR u.role <> 'gang' OR u.gang_id IN (SELECT gang_id FROM ops.claims WHERE site_id = n.site_id))
       LEFT JOIN ops.acknowledgements a ON a.notice_id = n.id AND a.user_id = u.id AND a.version = n.version
       WHERE n.active GROUP BY n.id`),
  ]) : [[], [], []];
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Site communication</div><h1>Noticeboard</h1></div></div>
      <Flash sp={sp} />
      {notices.length === 0 && <p className="muted">No notices.</p>}
      {notices.map((n) => {
        const r = report.find((x) => x.notice_id === n.id);
        return (
          <div key={n.id} className={`card ${n.kind === "health_safety" ? "accent" : ""}`}>
            <div className="eyebrow">{n.kind === "health_safety" ? "Health and safety" : "Company news"} · {fmtDate(n.published_at)}{n.site ? ` · ${n.site}` : ""}{n.gang ? ` · ${n.gang}` : ""}</div>
            <h3 style={{ margin: "4px 0 8px" }}>{n.title}</h3>
            <p style={{ whiteSpace: "pre-line" }}>{n.body}</p>
            {n.acknowledged ? <span className="badge approved">You acknowledged this</span> : (
              <form action={ack}><input type="hidden" name="notice_id" value={n.id} /><button className="btn small" type="submit">I have read and understood this</button></form>
            )}
            {mgr && r && <p className="small muted" style={{ marginBottom: 0 }}>{r.acknowledged} acknowledged.{r.outstanding ? ` Not yet: ${r.outstanding}.` : " Everyone has acknowledged."}</p>}
          </div>
        );
      })}
      {mgr && (
        <form action={publish} className="card stack">
          <h2 style={{ marginTop: 0 }}>Publish</h2>
          <div className="row">
            <div><label htmlFor="kind">Type</label><select id="kind" name="kind"><option value="health_safety">Health and safety alert</option><option value="news">Company news</option></select></div>
            <div><label htmlFor="site_id">Only for a site</label><select id="site_id" name="site_id"><option value="">Everyone</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div><label htmlFor="gang_id">Only for a gang</label><select id="gang_id" name="gang_id"><option value="">Everyone</option>{gangs.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
          </div>
          <div><label htmlFor="title">Title</label><input id="title" name="title" type="text" required maxLength={200} /></div>
          <div><label htmlFor="body">Message</label><textarea id="body" name="body" required maxLength={10000} /></div>
          <button className="btn" type="submit">Publish</button>
          <p className="small muted">Health and safety alerts stay pinned on each person&apos;s home screen until they acknowledge them. Each acknowledgement is recorded with the date and time.</p>
        </form>
      )}
      <p className="small muted">Last updated {fmtDateTime(new Date())}.</p>
    </>
  );
}
