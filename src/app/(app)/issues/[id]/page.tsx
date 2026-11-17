import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { canRaise, loadIssue, updateIssue, IssueError } from "@/lib/issues";
import { back, safeMessage, str } from "@/lib/forms";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import Flash from "@/components/Flash";
import ImageInput from "@/components/ImageInput";

async function update(f: FormData) {
  "use server";
  const user = await requireUser();
  const id = str(f, "issue_id");
  const photos = f.getAll("photos").filter((x): x is File => x instanceof File && x.size > 0).slice(0, 8);
  try { await updateIssue(user, id, str(f, "note"), str(f, "status") || null, photos); }
  catch (e) { back(`/issues/${id}`, "error", safeMessage(e, [IssueError])); }
  back(`/issues/${id}`, "ok", "Update saved.");
}

const STATUS: Record<string, string> = { open: "Open", in_progress: "In progress", ready_to_close: "Ready to close", closed: "Closed" };

export default async function Issue({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const issue = await loadIssue(user, id).catch(() => null);
  if (!issue) redirect("/issues");
  const [updates, photos] = await Promise.all([
    q<{ note: string; new_status: string | null; who: string; created_at: string }>(
      "SELECT u.note, u.new_status, us.name AS who, u.created_at FROM ops.issue_updates u JOIN ops.users us ON us.id = u.user_id WHERE u.issue_id = $1 ORDER BY u.created_at", [id]),
    q<{ id: string; original_name: string }>("SELECT id, original_name FROM ops.attachments WHERE issue_id = $1 ORDER BY uploaded_at", [id]),
  ]);
  const statuses = canRaise(user) ? ["open", "in_progress", "ready_to_close", "closed"] : ["in_progress", "ready_to_close"];
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">{issue.kind === "safety" ? "Safety issue" : "Snag"} · {issue.priority} priority</div><h1>{issue.title}</h1>
        <p className="muted small">{issue.site}{issue.plot ? ` · Plot ${issue.plot}` : ""}{issue.gang ? ` · ${issue.gang}` : ""} · raised by {issue.raised_by} on {fmtDate(issue.created_at)}{issue.due_date ? ` · due ${fmtDate(issue.due_date)}` : ""}</p></div>
        <div className="actions"><span className="badge">{STATUS[issue.status]}</span></div></div>
      <Flash sp={sp} />
      {issue.description && <div className="card">{issue.description}</div>}
      {photos.length > 0 && <div className="thumbs" style={{ marginBottom: 16 }}>{photos.map((p) => <figure key={p.id}><a href={`/api/files/${p.id}`} target="_blank" rel="noreferrer"><img src={`/api/files/${p.id}`} alt={p.original_name} /></a></figure>)}</div>}
      <h2>Updates</h2>
      <div className="card">
        {updates.length === 0 && <p className="muted" style={{ margin: 0 }}>No updates yet.</p>}
        {updates.map((u, i) => <p key={i} style={{ margin: "0 0 10px" }}><strong>{u.who}</strong> <span className="small muted">{fmtDateTime(u.created_at)}</span>{u.new_status && <> · <span className="badge">{STATUS[u.new_status]}</span></>}<br />{u.note}</p>)}
      </div>
      {(issue.status !== "closed" || canRaise(user)) && (
        <form action={update} className="card stack">
          <input type="hidden" name="issue_id" value={id} />
          <h3 style={{ marginTop: 0 }}>Add an update</h3>
          <div><label htmlFor="note">Note</label><textarea id="note" name="note" maxLength={5000} /></div>
          <div><label htmlFor="status">Change status</label><select id="status" name="status" defaultValue=""><option value="">No change</option>{statuses.map((s) => <option key={s} value={s}>{STATUS[s]}</option>)}</select></div>
          <ImageInput name="photos" label="Close-out photos" multiple />
          <button className="btn" type="submit">Save update</button>
        </form>
      )}
    </>
  );
}
