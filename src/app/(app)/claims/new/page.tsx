import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createDraft, ClaimError, type ClaimType } from "@/lib/claims";
import { jobOptions, plotOptions } from "@/lib/lookups";
import { back, safeMessage, str } from "@/lib/forms";
import { isoDate } from "@/lib/dates";
import Flash from "@/components/Flash";

async function create(f: FormData) {
  "use server";
  const user = await requireUser(["gang"]);
  const job = (await jobOptions()).find((j) => j.id === str(f, "job"));
  let id: string;
  try {
    id = await createDraft(user, {
      siteId: job?.site_id ?? "", jobNumberId: str(f, "job"), plotId: str(f, "plot") || null,
      claimType: str(f, "type") as ClaimType, workDate: str(f, "work_date"), stage: str(f, "stage"),
    });
  } catch (e) {
    back("/claims/new", "error", safeMessage(e, [ClaimError]));
  }
  redirect(`/claims/${id}/quantities`);
}

export default async function NewClaim({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireUser(["gang"]);
  const sp = await searchParams;
  const [jobs, plots] = await Promise.all([jobOptions(), plotOptions()]);
  const byJob = new Map<string, typeof plots>();
  for (const p of plots) byJob.set(p.job_number_id, [...(byJob.get(p.job_number_id) ?? []), p]);
  return (
    <>
      <div className="page-head"><div><div className="eyebrow">New claim</div><h1>Where did you work?</h1></div></div>
      <Flash sp={sp} />
      <form action={create} className="card accent stack">
        <div>
          <label htmlFor="type">Claim type</label>
          <select id="type" name="type" required defaultValue="substructure">
            <option value="substructure">Substructure (measured work)</option>
            <option value="superstructure">Superstructure (lifts and patch)</option>
            <option value="daywork">Daywork</option>
            <option value="supervision">Supervision</option>
          </select>
        </div>
        <div>
          <label htmlFor="job">Site and job number<span className="hint">Every claim goes to a job number so the cost goes to the right client.</span></label>
          <select id="job" name="job" required defaultValue="">
            <option value="" disabled>Choose the site and job number</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.site} · {j.code}{j.client ? ` · ${j.client}` : ""}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="plot">Plot<span className="hint">One plot per claim. Not needed for dayworks or supervision.</span></label>
          <select id="plot" name="plot" defaultValue="">
            <option value="">No plot</option>
            {jobs.filter((j) => byJob.has(j.id)).map((j) => (
              <optgroup key={j.id} label={`${j.site} · ${j.code}`}>
                {byJob.get(j.id)!.map((p) => <option key={p.id} value={p.id}>Plot {p.plot_number}{p.house_type ? ` · ${p.house_type}` : ""}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="row">
          <div><label htmlFor="work_date">Work date</label><input id="work_date" name="work_date" type="date" required defaultValue={isoDate(new Date())} /></div>
          <div><label htmlFor="stage">Stage reference<span className="hint">Optional, for example the stage name on the client sheet.</span></label><input id="stage" name="stage" type="text" maxLength={80} /></div>
        </div>
        <p className="muted small">The week ending and pay run are set automatically when you submit, from the weekly cut-off.</p>
        <button className="btn" type="submit">Continue</button>
      </form>
    </>
  );
}
