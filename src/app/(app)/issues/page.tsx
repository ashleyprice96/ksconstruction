import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { canRaise, raiseIssue, IssueError } from "@/lib/issues";
import { back, safeMessage, str } from "@/lib/forms";
import { fmtDate } from "@/lib/dates";
import { currentWeek } from "@/lib/settings";
import Flash from "@/components/Flash";
import ImageInput from "@/components/ImageInput";
import ListToolbar, { SelectAll } from "@/components/ListToolbar";

async function raise(f: FormData) {
  "use server";
  const user = await requireUser(["contracts_manager", "management", "admin"]);
  const photos = f.getAll("photos").filter((x): x is File => x instanceof File && x.size > 0).slice(0, 8);
  let id: string;
  try {
    id = await raiseIssue(user, { kind: str(f, "kind"), siteId: str(f, "site_id"), plotId: str(f, "plot_id") || null, gangId: str(f, "gang_id") || null,
      title: str(f, "title"), description: str(f, "description"), priority: str(f, "priority"), dueDate: str(f, "due_date") || null }, photos);
  } catch (e) { back("/issues", "error", safeMessage(e, [IssueError])); }
  redirect(`/issues/${id}`);
}

const STATUS = { open: "Open", in_progress: "In progress", ready_to_close: "Ready to close", closed: "Closed" } as const;

export default async function Issues({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const showClosed = sp.closed === "1";
  const params: unknown[] = [];
  let where = (showClosed ? "true" : "i.status <> 'closed'") + " AND i.kind = 'snag'";
  if (user.role === "gang") { params.push(user.gang_id); where += ` AND i.gang_id = $${params.length}`; }
  const rows = await q<{ id: string; kind: string; title: string; priority: string; status: keyof typeof STATUS; due_date: string | null; site: string; gang: string | null; plot: string | null }>(
    `SELECT i.id, i.kind, i.title, i.priority, i.status, to_char(i.due_date, 'YYYY-MM-DD') AS due_date, s.name AS site, g.name AS gang, p.plot_number AS plot
     FROM ops.issues i JOIN ops.sites s ON s.id = i.site_id LEFT JOIN ops.gangs g ON g.id = i.gang_id LEFT JOIN ops.plots p ON p.id = i.plot_id
     WHERE ${where} ORDER BY (i.kind = 'safety') DESC, (i.priority = 'high') DESC, i.created_at DESC`, params);
  const { today, weekStart, weekEnding } = await currentWeek();
  const raiser = canRaise(user);
  const [sites, gangs] = raiser ? await Promise.all([
    q<{ id: string; name: string }>("SELECT id, name FROM ops.sites WHERE active ORDER BY name"),
    q<{ id: string; name: string }>("SELECT id, name FROM ops.gangs WHERE active ORDER BY name"),
  ]) : [[], []];
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">Site communication</div><h1>Issues</h1></div></div>
      <Flash sp={sp} />
      <section className="panel">
        <ListToolbar
          tableId="issues-table"
          showSite
          gangs={[...new Set(rows.map((r) => r.gang).filter((g): g is string => !!g))].sort((a, b) => a.localeCompare(b, "en-GB"))}
          sites={[...new Set(rows.map((r) => r.site))].sort((a, b) => a.localeCompare(b, "en-GB"))}
          newClaim={user.role === "gang"}
          statusNavigate={{
            base: "/issues",
            param: "closed",
            value: showClosed ? "1" : "",
            options: [{ value: "", label: "Open" }, { value: "1", label: "Including closed" }],
          }}
        />
        <div className="table-wrap dense"><table id="issues-table" data-today={today} data-week-start={weekStart} data-week-end={weekEnding}>
          <thead><tr>
            <th className="check"><SelectAll tableId="issues-table" /></th>
            <th>Issue</th><th>Site</th><th>Gang</th><th>Due</th><th>Status</th><th className="actions"> </th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr data-empty="1"><td colSpan={7} className="muted">Nothing open.</td></tr>}
            <tr data-filter-empty="1" hidden><td colSpan={7} className="muted">Nothing matches these filters.</td></tr>
            {rows.map((r) => (
              <tr key={r.id} data-status={r.status} data-gang={r.gang ?? ""} data-site={r.site} data-date={r.due_date ?? ""}>
                <td className="check"><input className="row-check" type="checkbox" aria-label={`Select ${r.title}`} /></td>
                <td><Link href={`/issues/${r.id}`}>{r.title}</Link><div>
                  <span className={`badge ${r.kind === "safety" ? "returned" : ""}`}>{r.kind === "safety" ? "Safety" : "Snag"}</span>{r.priority === "high" && <> <span className="badge awaiting_management">High</span></>}</div></td>
                <td>{r.site}{r.plot ? <div className="small muted">Plot {r.plot}</div> : null}</td><td>{r.gang ?? ""}</td><td>{r.due_date ? fmtDate(r.due_date) : ""}</td>
                <td><span className={`badge ${r.status}`}>{STATUS[r.status]}</span></td>
                <td className="actions"><Link className="btn ghost small" href={`/issues/${r.id}`}>View</Link></td></tr>
            ))}
          </tbody>
        </table></div>
      </section>
      {raiser && (
        <form action={raise} className="card stack" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Raise a snag</h2>
          <div className="row">
            <input type="hidden" name="kind" value="snag" />
            <div><label htmlFor="priority">Priority</label><select id="priority" name="priority" defaultValue="normal"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></div>
            <div><label htmlFor="due_date">Due</label><input id="due_date" name="due_date" type="date" /></div>
          </div>
          <div className="row">
            <div><label htmlFor="site_id">Site</label><select id="site_id" name="site_id" required>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div><label htmlFor="gang_id">Assign to gang</label><select id="gang_id" name="gang_id"><option value="">Not assigned</option>{gangs.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
          </div>
          <div><label htmlFor="title">Title</label><input id="title" name="title" type="text" required maxLength={200} /></div>
          <div><label htmlFor="description">Details</label><textarea id="description" name="description" maxLength={5000} /></div>
          <ImageInput name="photos" label="Photos" multiple />
          <button className="btn" type="submit">Raise issue</button>
        </form>
      )}
    </>
  );
}
