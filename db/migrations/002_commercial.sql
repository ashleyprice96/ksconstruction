-- Commercial schema: client charge rates, client values and margin.
-- Readable ONLY through the ks_commercial login, and then only for a request made
-- by a user on commercial.access_list (enforced by row-level security below).
-- The operational login ks_app has no privileges here at all.

CREATE SCHEMA commercial;

-- The named list. Access comes from being on this list, never from a role.
CREATE TABLE commercial.access_list (
  user_id uuid PRIMARY KEY REFERENCES ops.users(id),
  added_by text NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL DEFAULT ''
);

-- History of every change to the named list.
CREATE TABLE commercial.access_list_history (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('added', 'removed')),
  changed_by text NOT NULL,
  reason text NOT NULL DEFAULT ''
);

-- Every view and export of commercial data.
CREATE TABLE commercial.access_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'
);

-- Client charge rates per client (optionally per site), by item and effective date.
CREATE TABLE commercial.client_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES ops.clients(id),
  site_id uuid REFERENCES ops.sites(id),
  item_id uuid NOT NULL REFERENCES ops.rate_items(id),
  rate numeric(12,4) NOT NULL CHECK (rate >= 0),
  effective_from date NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX client_rates_unique ON commercial.client_rates
  (client_id, coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid), item_id, effective_from);

-- Client value per lift (superstructure), by effective date.
CREATE TABLE commercial.client_lift_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES ops.clients(id),
  lift_id uuid NOT NULL REFERENCES ops.lifts(id),
  value numeric(12,2) NOT NULL CHECK (value >= 0),
  effective_from date NOT NULL,
  UNIQUE (client_id, lift_id, effective_from)
);

-- Client weekly charge for a supervision assignment, if recharged (D18).
CREATE TABLE commercial.client_supervision_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES ops.supervision_assignments(id),
  weekly_charge numeric(12,2) NOT NULL CHECK (weekly_charge >= 0),
  UNIQUE (assignment_id)
);

-- True only when the current request carries a user on the named list.
-- The app sets ks.user_id inside the commercial transaction, after its own check.
CREATE FUNCTION commercial.is_named_user() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = commercial, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM commercial.access_list a
    WHERE a.user_id = nullif(current_setting('ks.user_id', true), '')::uuid
  )
$$;

-- Client value for each claim line, priced at the claim's work date.
CREATE VIEW commercial.claim_line_values WITH (security_barrier) AS
SELECT
  l.id AS claim_line_id,
  c.id AS claim_id,
  c.ref,
  c.client_id,
  c.site_id,
  c.gang_id,
  c.week_ending,
  c.work_date,
  c.claim_type,
  c.status,
  l.description,
  l.quantity,
  l.gang_value,
  coalesce(
    (SELECT r.rate FROM commercial.client_rates r
      WHERE l.item_id IS NOT NULL AND r.item_id = l.item_id AND r.client_id = c.client_id
        AND (r.site_id = c.site_id OR r.site_id IS NULL) AND r.effective_from <= c.work_date
      ORDER BY (r.site_id IS NULL), r.effective_from DESC LIMIT 1),
    NULL) AS client_rate,
  CASE
    WHEN l.item_id IS NOT NULL THEN round(l.quantity * (
      SELECT r.rate FROM commercial.client_rates r
      WHERE r.item_id = l.item_id AND r.client_id = c.client_id
        AND (r.site_id = c.site_id OR r.site_id IS NULL) AND r.effective_from <= c.work_date
      ORDER BY (r.site_id IS NULL), r.effective_from DESC LIMIT 1), 2)
    WHEN l.lift_id IS NOT NULL THEN round(l.quantity / 100 * (
      SELECT v.value FROM commercial.client_lift_values v
      WHERE v.lift_id = l.lift_id AND v.client_id = c.client_id AND v.effective_from <= c.work_date
      ORDER BY v.effective_from DESC LIMIT 1), 2)
    WHEN l.supervision_assignment_id IS NOT NULL THEN round(l.quantity * (
      SELECT s.weekly_charge FROM commercial.client_supervision_charges s
      WHERE s.assignment_id = l.supervision_assignment_id), 2)
  END AS client_value
FROM ops.claim_lines l
JOIN ops.claims c ON c.id = l.claim_id
WHERE commercial.is_named_user();

-- Privileges -------------------------------------------------------------------
-- Grants are skipped when the role does not exist yet (shared-owner fallback).
-- A normal Render boot creates the roles first, so these grants still run.

REVOKE ALL ON SCHEMA ops, commercial FROM PUBLIC;
ALTER TABLE commercial.client_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial.client_lift_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial.client_supervision_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial.access_log ENABLE ROW LEVEL SECURITY;

DO $priv$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ks_app') THEN
    -- Operational login: full use of ops, NOTHING in commercial.
    GRANT USAGE ON SCHEMA ops TO ks_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ops TO ks_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ops TO ks_app;
    -- The audit trail and pay-less history are append-only for the app.
    REVOKE UPDATE, DELETE ON ops.audit_log, ops.adjustments, ops.approvals FROM ks_app;
  ELSE
    RAISE NOTICE 'ks_app is absent; operational grants skipped';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ks_commercial') THEN
    -- Commercial login: read ops for joins, read and write commercial data, but
    -- only through row-level security tied to the named list.
    GRANT USAGE ON SCHEMA ops, commercial TO ks_commercial;
    GRANT SELECT ON ALL TABLES IN SCHEMA ops TO ks_commercial;
    GRANT SELECT ON commercial.access_list TO ks_commercial;
    GRANT SELECT, INSERT, UPDATE, DELETE ON commercial.client_rates, commercial.client_lift_values,
      commercial.client_supervision_charges TO ks_commercial;
    GRANT SELECT ON commercial.claim_line_values TO ks_commercial;
    GRANT INSERT ON commercial.access_log TO ks_commercial;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA commercial TO ks_commercial;
    GRANT EXECUTE ON FUNCTION commercial.is_named_user() TO ks_commercial;
    -- Changes to the named list are made only by the owner (scripts/commercial-access.ts).

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'commercial' AND tablename = 'client_rates' AND policyname = 'named_only') THEN
      CREATE POLICY named_only ON commercial.client_rates FOR ALL TO ks_commercial
        USING (commercial.is_named_user()) WITH CHECK (commercial.is_named_user());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'commercial' AND tablename = 'client_lift_values' AND policyname = 'named_only') THEN
      CREATE POLICY named_only ON commercial.client_lift_values FOR ALL TO ks_commercial
        USING (commercial.is_named_user()) WITH CHECK (commercial.is_named_user());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'commercial' AND tablename = 'client_supervision_charges' AND policyname = 'named_only') THEN
      CREATE POLICY named_only ON commercial.client_supervision_charges FOR ALL TO ks_commercial
        USING (commercial.is_named_user()) WITH CHECK (commercial.is_named_user());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'commercial' AND tablename = 'access_log' AND policyname = 'named_insert') THEN
      CREATE POLICY named_insert ON commercial.access_log FOR INSERT TO ks_commercial
        WITH CHECK (commercial.is_named_user()
                    AND user_id = nullif(current_setting('ks.user_id', true), '')::uuid);
    END IF;
  ELSE
    RAISE NOTICE 'ks_commercial is absent; commercial grants skipped';
  END IF;
END
$priv$;
