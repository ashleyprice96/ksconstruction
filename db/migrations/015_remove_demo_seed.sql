-- Remove the named demo seed rows. Exact names only. Children go first.
-- A second run finds nothing and changes nothing. User accounts and gangs stay.
-- Job numbers on the two named sites are removed with those sites (the demo
-- seed stores them as KS01 and KS02). Codes DEMO-001 and DEMO-002 are removed
-- by that exact code. Gang rate rows are removed only when they belong to one
-- of the three named rate sets, so those sets can be deleted. The gangs themselves
-- stay; their rate-set pointers are cleared when they pointed at a deleted set.

CREATE TEMP TABLE _demo_sites ON COMMIT DROP AS
SELECT id FROM ops.sites WHERE name IN ('Oak Lane (demo)', 'Mill Street (demo)');

CREATE TEMP TABLE _demo_jobs ON COMMIT DROP AS
SELECT id FROM ops.job_numbers
WHERE code IN ('DEMO-001', 'DEMO-002')
   OR site_id IN (SELECT id FROM _demo_sites);

CREATE TEMP TABLE _demo_claims ON COMMIT DROP AS
SELECT id, pay_run_id FROM ops.claims
WHERE status = 'draft'
  AND (site_id IN (SELECT id FROM _demo_sites) OR job_number_id IN (SELECT id FROM _demo_jobs));

CREATE TEMP TABLE _demo_pay_runs ON COMMIT DROP AS
SELECT DISTINCT pay_run_id AS id FROM _demo_claims WHERE pay_run_id IS NOT NULL;

CREATE TEMP TABLE _demo_clients ON COMMIT DROP AS
SELECT id FROM ops.clients WHERE name IN ('Northfield Contracting (demo)', 'Riverside Civils (demo)');

CREATE TEMP TABLE _demo_types ON COMMIT DROP AS
SELECT id FROM ops.house_types WHERE name = 'Type A (demo)';

CREATE TEMP TABLE _demo_lifts ON COMMIT DROP AS
SELECT id FROM ops.lifts WHERE house_type_id IN (SELECT id FROM _demo_types);

CREATE TEMP TABLE _demo_sets ON COMMIT DROP AS
SELECT id FROM ops.rate_sets
WHERE name IN ('Demo Standard', 'Demo individual: Gang Two', 'Demo Riverside client set');

CREATE TEMP TABLE _demo_notices ON COMMIT DROP AS
SELECT id FROM ops.notices
WHERE title IN ('Cold weather working (demo)', 'Welcome to K-S Claims (demo)');

CREATE TEMP TABLE _demo_issues ON COMMIT DROP AS
SELECT id FROM ops.issues WHERE site_id IN (SELECT id FROM _demo_sites);

CREATE TEMP TABLE _demo_assignments ON COMMIT DROP AS
SELECT id FROM ops.supervision_assignments WHERE site_id IN (SELECT id FROM _demo_sites);

-- Commercial rows that point at the named clients, sites, lifts or assignments.
CREATE TEMP TABLE _rls_forced ON COMMIT DROP AS
SELECT c.relname, c.relforcerowsecurity AS forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'commercial'
  AND c.relname IN ('client_rates', 'client_lift_values', 'client_supervision_charges');

ALTER TABLE commercial.client_rates NO FORCE ROW LEVEL SECURITY;
ALTER TABLE commercial.client_lift_values NO FORCE ROW LEVEL SECURITY;
ALTER TABLE commercial.client_supervision_charges NO FORCE ROW LEVEL SECURITY;

DELETE FROM commercial.client_supervision_charges
WHERE assignment_id IN (SELECT id FROM _demo_assignments);
DELETE FROM commercial.client_rates
WHERE client_id IN (SELECT id FROM _demo_clients)
   OR site_id IN (SELECT id FROM _demo_sites);
DELETE FROM commercial.client_lift_values
WHERE client_id IN (SELECT id FROM _demo_clients)
   OR lift_id IN (SELECT id FROM _demo_lifts);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM _rls_forced WHERE relname = 'client_rates' AND forced) THEN
    ALTER TABLE commercial.client_rates FORCE ROW LEVEL SECURITY;
  END IF;
  IF EXISTS (SELECT 1 FROM _rls_forced WHERE relname = 'client_lift_values' AND forced) THEN
    ALTER TABLE commercial.client_lift_values FORCE ROW LEVEL SECURITY;
  END IF;
  IF EXISTS (SELECT 1 FROM _rls_forced WHERE relname = 'client_supervision_charges' AND forced) THEN
    ALTER TABLE commercial.client_supervision_charges FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

DELETE FROM ops.claims WHERE id IN (SELECT id FROM _demo_claims);

DELETE FROM ops.payee_invoices
WHERE pay_run_id IN (
  SELECT p.id FROM _demo_pay_runs p
  WHERE NOT EXISTS (SELECT 1 FROM ops.claims c WHERE c.pay_run_id = p.id));
DELETE FROM ops.pay_runs
WHERE id IN (
  SELECT p.id FROM _demo_pay_runs p
  WHERE NOT EXISTS (SELECT 1 FROM ops.claims c WHERE c.pay_run_id = p.id));

DELETE FROM ops.attachments WHERE issue_id IN (SELECT id FROM _demo_issues);
DELETE FROM ops.issue_updates WHERE issue_id IN (SELECT id FROM _demo_issues);
DELETE FROM ops.issues WHERE id IN (SELECT id FROM _demo_issues);

DELETE FROM ops.supervision_assignments WHERE id IN (SELECT id FROM _demo_assignments);

DELETE FROM ops.gang_site_rates WHERE site_id IN (SELECT id FROM _demo_sites);
DELETE FROM ops.site_rates WHERE site_id IN (SELECT id FROM _demo_sites);
DELETE FROM ops.site_lift_values
WHERE site_id IN (SELECT id FROM _demo_sites)
   OR lift_id IN (SELECT id FROM _demo_lifts);

DELETE FROM ops.agreed_quantities
WHERE plot_id IN (
  SELECT id FROM ops.plots
  WHERE site_id IN (SELECT id FROM _demo_sites)
     OR job_number_id IN (SELECT id FROM _demo_jobs));
DELETE FROM ops.plots
WHERE site_id IN (SELECT id FROM _demo_sites)
   OR job_number_id IN (SELECT id FROM _demo_jobs);

DELETE FROM ops.hs_alert_sites WHERE site_id IN (SELECT id FROM _demo_sites);
DELETE FROM ops.site_rams WHERE site_id IN (SELECT id FROM _demo_sites);

DELETE FROM ops.acknowledgements WHERE notice_id IN (SELECT id FROM _demo_notices);
DELETE FROM ops.notices WHERE id IN (SELECT id FROM _demo_notices);

DELETE FROM ops.job_numbers WHERE id IN (SELECT id FROM _demo_jobs);
DELETE FROM ops.sites WHERE id IN (SELECT id FROM _demo_sites);

DELETE FROM ops.lift_values WHERE lift_id IN (SELECT id FROM _demo_lifts);
DELETE FROM ops.lifts WHERE id IN (SELECT id FROM _demo_lifts);
DELETE FROM ops.house_types WHERE id IN (SELECT id FROM _demo_types);

UPDATE ops.gangs SET base_rate_set_id = NULL
WHERE base_rate_set_id IN (SELECT id FROM _demo_sets);
UPDATE ops.gangs SET individual_rate_set_id = NULL
WHERE individual_rate_set_id IN (SELECT id FROM _demo_sets);
DELETE FROM ops.gang_rates WHERE rate_set_id IN (SELECT id FROM _demo_sets);
DELETE FROM ops.rate_sets WHERE id IN (SELECT id FROM _demo_sets);

DELETE FROM ops.clients WHERE id IN (SELECT id FROM _demo_clients);
DELETE FROM ops.housebuilders WHERE name = 'Example Homes (demo)';
