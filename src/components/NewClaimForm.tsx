"use client";

import { useMemo, useState } from "react";
import { gbpRate } from "@/lib/money";

export interface ClaimSite { id: string; name: string; region: string; client: string | null }
export interface ClaimJob { id: string; siteId: string; code: string; site: string }
export interface ClaimPlot { id: string; jobId: string; site: string; job: string; label: string }
export interface ClaimRate { siteId: string; name: string; unit: string; rate: string; source: string }

export default function NewClaimForm({
  action, sites, jobs, plots, rates, defaultDate, siteWarnings, gangUserId,
}: {
  action: (f: FormData) => void;
  sites: ClaimSite[];
  jobs: ClaimJob[];
  plots: ClaimPlot[];
  rates: ClaimRate[];
  defaultDate: string;
  siteWarnings?: Record<string, string>;
  gangUserId?: string;
}) {
  const [siteId, setSiteId] = useState("");
  const [jobId, setJobId] = useState("");
  const siteJobs = useMemo(() => jobs.filter((j) => j.siteId === siteId), [jobs, siteId]);
  const jobPlots = useMemo(() => plots.filter((p) => p.jobId === jobId), [plots, jobId]);
  const siteRates = useMemo(() => rates.filter((r) => r.siteId === siteId), [rates, siteId]);
  const site = sites.find((s) => s.id === siteId);

  return (
    <form action={action} className="card accent stack">
      {gangUserId && <input type="hidden" name="gang_user" value={gangUserId} />}
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
        <label htmlFor="site">Site<span className="hint">Any active site. You do not need the office to assign it.</span></label>
        <select id="site" name="site" required value={siteId} onChange={(e) => { setSiteId(e.target.value); setJobId(""); }}>
          <option value="" disabled>Choose the site</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}{s.region ? ` · ${s.region}` : ""}{s.client ? ` · ${s.client}` : ""}</option>)}
        </select>
        {siteId && siteWarnings?.[siteId] && <div className="alert warn" role="status">{siteWarnings[siteId]}</div>}
      </div>
      <div>
        <label htmlFor="job">Job number<span className="hint">K-S job code for the site, for example KS01.</span></label>
        <select id="job" name="job" required value={jobId} disabled={!siteId} onChange={(e) => setJobId(e.target.value)}>
          <option value="" disabled>{siteId ? "Choose the job number" : "Choose a site first"}</option>
          {siteJobs.map((j) => <option key={j.id} value={j.id}>{j.code} · {j.site}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="plot">Plot<span className="hint">One plot per claim. Not needed for dayworks or supervision.</span></label>
        <select id="plot" name="plot" defaultValue="">
          <option value="">No plot</option>
          {jobPlots.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>
      {site && (
        <div className="table-wrap dense" data-testid="site-rates">
          <table>
            <caption className="small" style={{ captionSide: "top", textAlign: "left", padding: "8px 10px" }}>
              Gang pay rates for {site.name}. A rate agreed for your gang replaces the site card. These are not client prices.
            </caption>
            <thead><tr><th>Item</th><th>From</th><th className="num">Rate</th></tr></thead>
            <tbody>
              {siteRates.length === 0 && <tr><td colSpan={3} className="muted">No gang rates are set for this site yet. The office can add a site rate card.</td></tr>}
              {siteRates.map((r) => (
                <tr key={`${r.name}-${r.unit}`}>
                  <td>{r.name}<div className="small muted">per {r.unit}</div></td>
                  <td>{r.source}</td>
                  <td className="num">{gbpRate(r.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="row">
        <div><label htmlFor="work_date">Work date</label><input id="work_date" name="work_date" type="date" required defaultValue={defaultDate} /></div>
        <div><label htmlFor="stage">Stage reference<span className="hint">Optional, for example the stage name on the client sheet.</span></label><input id="stage" name="stage" type="text" maxLength={80} /></div>
      </div>
      <p className="muted small">The week ending and pay run are set automatically when you submit, from the weekly cut-off.</p>
      <button className="btn" type="submit">Continue</button>
    </form>
  );
}
