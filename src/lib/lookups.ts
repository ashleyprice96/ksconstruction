import "server-only";
import { q } from "./db";

export async function jobOptions() {
  return q<{ id: string; code: string; site_id: string; site: string; client: string | null }>(
    `SELECT j.id, j.code, s.id AS site_id, s.name AS site, c.name AS client
     FROM ops.job_numbers j JOIN ops.sites s ON s.id = j.site_id LEFT JOIN ops.clients c ON c.id = s.client_id
     WHERE j.active AND s.active ORDER BY s.name, j.code`);
}

export async function plotOptions() {
  return q<{ id: string; plot_number: string; job_number_id: string; job: string; site: string; house_type: string | null }>(
    `SELECT p.id, p.plot_number, p.job_number_id, j.code AS job, s.name AS site, h.name AS house_type
     FROM ops.plots p JOIN ops.job_numbers j ON j.id = p.job_number_id JOIN ops.sites s ON s.id = p.site_id
     LEFT JOIN ops.house_types h ON h.id = p.house_type_id
     WHERE j.active AND s.active ORDER BY s.name, j.code, length(p.plot_number), p.plot_number`);
}

export async function claimContext(claimId: string) {
  const r = await q<{ gang: string; client: string; site: string; job: string; plot: string | null; house_type: string | null; house_type_id: string | null }>(
    `SELECT g.name AS gang, cl.name AS client, s.name AS site, j.code AS job, p.plot_number AS plot, h.name AS house_type, h.id AS house_type_id
     FROM ops.claims c JOIN ops.gangs g ON g.id = c.gang_id JOIN ops.clients cl ON cl.id = c.client_id
     JOIN ops.sites s ON s.id = c.site_id JOIN ops.job_numbers j ON j.id = c.job_number_id
     LEFT JOIN ops.plots p ON p.id = c.plot_id LEFT JOIN ops.house_types h ON h.id = p.house_type_id
     WHERE c.id = $1`, [claimId]);
  return r[0];
}

export const TYPE_LABEL: Record<string, string> = {
  substructure: "Substructure", superstructure: "Superstructure", daywork: "Daywork", supervision: "Supervision",
};
export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft", awaiting_management: "Awaiting sign-off", returned: "Returned", approved: "Approved", paid: "Paid",
};
