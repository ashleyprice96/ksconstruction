-- Operational schema: everything gangs, contracts managers and management use.
-- It holds NO client charge rates, client values or margin. Those live in the
-- commercial schema (002), which the operational login cannot read.

CREATE SCHEMA ops;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE ops.user_role AS ENUM ('gang', 'contracts_manager', 'management', 'admin');
CREATE TYPE ops.claim_type AS ENUM ('substructure', 'superstructure', 'daywork', 'supervision');
CREATE TYPE ops.claim_status AS ENUM ('draft', 'awaiting_management', 'returned', 'approved', 'paid');
CREATE TYPE ops.entity_type AS ENUM ('sole_trader', 'limited_company', 'partnership', 'other');

CREATE TABLE ops.settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text NOT NULL DEFAULT ''
);

CREATE TABLE ops.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  invoice_frequency_weeks int NOT NULL DEFAULT 1 CHECK (invoice_frequency_weeks BETWEEN 1 AND 8),
  uses_own_forms boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE ops.housebuilders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE
);

CREATE TABLE ops.sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  client_id uuid REFERENCES ops.clients(id),
  housebuilder_id uuid REFERENCES ops.housebuilders(id),
  region text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  UNIQUE (name, client_id)
);

CREATE TABLE ops.job_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES ops.sites(id),
  code text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE ops.house_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  site_id uuid REFERENCES ops.sites(id),
  UNIQUE (name, site_id)
);

CREATE TABLE ops.plots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES ops.sites(id),
  job_number_id uuid NOT NULL REFERENCES ops.job_numbers(id),
  house_type_id uuid REFERENCES ops.house_types(id),
  plot_number text NOT NULL,
  UNIQUE (site_id, plot_number)
);

-- Gang pay rates -----------------------------------------------------------

CREATE TABLE ops.rate_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  unit text NOT NULL,
  claim_type ops.claim_type NOT NULL,
  -- Whether the gang must record course counts per wall for this item.
  needs_courses boolean NOT NULL DEFAULT false,
  sort int NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true
);

-- kind: standard, north, client, individual (individual sets belong to one gang)
CREATE TABLE ops.rate_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('standard', 'north', 'client', 'individual')),
  client_id uuid REFERENCES ops.clients(id),
  CHECK ((kind = 'client') = (client_id IS NOT NULL))
);

CREATE TABLE ops.gangs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  ganger_name text NOT NULL,
  base_rate_set_id uuid REFERENCES ops.rate_sets(id),
  -- Individual agreed rates for this gang, checked before any other set.
  individual_rate_set_id uuid REFERENCES ops.rate_sets(id),
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE ops.gang_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_set_id uuid NOT NULL REFERENCES ops.rate_sets(id),
  item_id uuid NOT NULL REFERENCES ops.rate_items(id),
  rate numeric(12,4) NOT NULL CHECK (rate >= 0),
  effective_from date NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rate_set_id, item_id, effective_from)
);

-- Superstructure: fixed gang value per house type, split into lifts and patch.
CREATE TABLE ops.lifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_type_id uuid NOT NULL REFERENCES ops.house_types(id),
  name text NOT NULL,
  is_patch boolean NOT NULL DEFAULT false,
  sort int NOT NULL DEFAULT 1,
  UNIQUE (house_type_id, name)
);

CREATE TABLE ops.lift_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lift_id uuid NOT NULL REFERENCES ops.lifts(id),
  gang_value numeric(12,2) NOT NULL CHECK (gang_value >= 0),
  effective_from date NOT NULL,
  UNIQUE (lift_id, effective_from)
);

-- Optional agreed quantities per plot, used to flag over-claims.
CREATE TABLE ops.agreed_quantities (
  plot_id uuid NOT NULL REFERENCES ops.plots(id),
  item_id uuid NOT NULL REFERENCES ops.rate_items(id),
  quantity numeric(12,3) NOT NULL,
  PRIMARY KEY (plot_id, item_id)
);

-- People ----------------------------------------------------------------------

CREATE TABLE ops.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  role ops.user_role NOT NULL,
  gang_id uuid REFERENCES ops.gangs(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'gang') = (gang_id IS NOT NULL))
);

CREATE TABLE ops.sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES ops.users(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ops.payees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gang_id uuid NOT NULL REFERENCES ops.gangs(id),
  name text NOT NULL,
  legal_name text NOT NULL,
  entity_type ops.entity_type NOT NULL DEFAULT 'sole_trader',
  -- Identifier used by the payment company, for matching eligibility imports.
  payment_ref text UNIQUE,
  eligible boolean NOT NULL DEFAULT false,
  eligibility_source text NOT NULL DEFAULT 'manual',
  eligibility_updated_at timestamptz,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE ops.supervision_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payee_id uuid NOT NULL REFERENCES ops.payees(id),
  site_id uuid NOT NULL REFERENCES ops.sites(id),
  weekly_amount numeric(12,2) NOT NULL CHECK (weekly_amount >= 0),
  start_date date NOT NULL,
  end_date date
);

-- Pay runs and claims -----------------------------------------------------------

CREATE TABLE ops.pay_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_date date NOT NULL UNIQUE,
  -- Week endings covered by this run (inclusive).
  first_week_ending date NOT NULL,
  last_week_ending date NOT NULL,
  -- After this moment management can no longer apply pay-less reductions.
  payless_closes_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'paid')),
  CHECK (first_week_ending <= last_week_ending)
);

CREATE SEQUENCE ops.claim_ref_seq START 1001;

CREATE TABLE ops.claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref text NOT NULL UNIQUE DEFAULT ('KS-' || nextval('ops.claim_ref_seq')),
  gang_id uuid NOT NULL REFERENCES ops.gangs(id),
  client_id uuid NOT NULL REFERENCES ops.clients(id),
  site_id uuid NOT NULL REFERENCES ops.sites(id),
  job_number_id uuid NOT NULL REFERENCES ops.job_numbers(id),
  plot_id uuid REFERENCES ops.plots(id),
  claim_type ops.claim_type NOT NULL,
  stage text NOT NULL DEFAULT '',
  work_date date NOT NULL,
  week_ending date,
  pay_run_id uuid REFERENCES ops.pay_runs(id),
  rolled_to_next_run boolean NOT NULL DEFAULT false,
  status ops.claim_status NOT NULL DEFAULT 'draft',
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES ops.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  CHECK (claim_type IN ('daywork', 'supervision') OR plot_id IS NOT NULL)
);

CREATE TABLE ops.claim_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES ops.claims(id) ON DELETE CASCADE,
  item_id uuid REFERENCES ops.rate_items(id),
  lift_id uuid REFERENCES ops.lifts(id),
  supervision_assignment_id uuid REFERENCES ops.supervision_assignments(id),
  description text NOT NULL,
  unit text NOT NULL,
  -- For lifts the quantity is the percentage of the lift claimed.
  quantity numeric(12,3) NOT NULL CHECK (quantity >= 0),
  gang_rate numeric(12,4),
  rate_source text,
  gang_value numeric(12,2),
  -- Set when management first reduces the line, so the original is never lost.
  original_quantity numeric(12,3),
  original_gang_value numeric(12,2),
  CHECK (num_nonnulls(item_id, lift_id, supervision_assignment_id) = 1)
);

CREATE TABLE ops.wall_measures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES ops.claims(id) ON DELETE CASCADE,
  wall_ref text NOT NULL,
  courses int NOT NULL CHECK (courses >= 0 AND courses <= 200)
);

CREATE TABLE ops.issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('snag', 'safety')),
  site_id uuid NOT NULL REFERENCES ops.sites(id),
  plot_id uuid REFERENCES ops.plots(id),
  gang_id uuid REFERENCES ops.gangs(id),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  due_date date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'ready_to_close', 'closed')),
  raised_by uuid NOT NULL REFERENCES ops.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE TABLE ops.issue_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL REFERENCES ops.issues(id),
  user_id uuid NOT NULL REFERENCES ops.users(id),
  note text NOT NULL DEFAULT '',
  new_status text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ops.attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid REFERENCES ops.claims(id) ON DELETE CASCADE,
  issue_id uuid REFERENCES ops.issues(id),
  kind text NOT NULL CHECK (kind IN ('photo', 'drawing', 'daywork_sheet', 'client_form', 'signature', 'issue_photo')),
  storage_key text NOT NULL UNIQUE,
  original_name text NOT NULL,
  mime text NOT NULL,
  size_bytes int NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES ops.users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(claim_id, issue_id) = 1)
);

-- The client foreman is not an app user. The signature records the typed name
-- and the on-screen signature, given in good faith on the gang's device. It does
-- not verify the signer's identity.
CREATE TABLE ops.foreman_signatures (
  claim_id uuid PRIMARY KEY REFERENCES ops.claims(id) ON DELETE CASCADE,
  foreman_name text NOT NULL,
  attachment_id uuid NOT NULL REFERENCES ops.attachments(id),
  signed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ops.splits (
  claim_id uuid NOT NULL REFERENCES ops.claims(id) ON DELETE CASCADE,
  payee_id uuid NOT NULL REFERENCES ops.payees(id),
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  original_amount numeric(12,2),
  PRIMARY KEY (claim_id, payee_id)
);

CREATE TABLE ops.claim_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES ops.claims(id) ON DELETE CASCADE,
  kind text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ops.approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES ops.claims(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES ops.users(id),
  action text NOT NULL CHECK (action IN ('approve', 'return')),
  comment text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Pay-less reductions: one row per change, never edited or deleted.
CREATE TABLE ops.adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES ops.claims(id) ON DELETE CASCADE,
  claim_line_id uuid NOT NULL REFERENCES ops.claim_lines(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES ops.users(id),
  before_quantity numeric(12,3) NOT NULL,
  after_quantity numeric(12,3) NOT NULL,
  before_value numeric(12,2) NOT NULL,
  after_value numeric(12,2) NOT NULL,
  reason_category text NOT NULL,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE ops.invoice_seq START 1;

CREATE TABLE ops.payee_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE,
  pay_run_id uuid NOT NULL REFERENCES ops.pay_runs(id),
  payee_id uuid NOT NULL REFERENCES ops.payees(id),
  total numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pay_run_id, payee_id)
);

CREATE TABLE ops.notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('health_safety', 'news')),
  title text NOT NULL,
  body text NOT NULL,
  site_id uuid REFERENCES ops.sites(id),
  gang_id uuid REFERENCES ops.gangs(id),
  version int NOT NULL DEFAULT 1,
  published_by uuid NOT NULL REFERENCES ops.users(id),
  published_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE ops.acknowledgements (
  notice_id uuid NOT NULL REFERENCES ops.notices(id),
  user_id uuid NOT NULL REFERENCES ops.users(id),
  version int NOT NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notice_id, user_id, version)
);

-- Append-only audit trail.
CREATE TABLE ops.audit_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  entity text NOT NULL,
  entity_id text NOT NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX ON ops.claims (gang_id, status);
CREATE INDEX ON ops.claims (pay_run_id);
CREATE INDEX ON ops.claim_lines (claim_id);
CREATE INDEX ON ops.audit_log (entity, entity_id);

-- Default settings. Every value is editable by management; none is a confirmed K-S rule
-- unless the description says so.
INSERT INTO ops.settings (key, value, description) VALUES
 ('cutoff', '{"weekday": 5, "time": "11:00", "timezone": "Europe/London"}',
  'Weekly booking-in cut-off. Default 11:00 Friday (from the brief). Late claims roll to the next week.'),
 ('payless_days_before_payment', '7',
  'Pay-less edits close this many days before the payment date. ASSUMPTION: about seven days, exact rule to be confirmed.'),
 ('payless_reasons', '["Quantity not agreed", "Work incomplete", "Defective work", "Over claim", "Other (explain in note)"]',
  'Reason categories for pay-less reductions. PLACEHOLDER list, to be replaced with K-S confirmed categories.'),
 ('min_photos', '{"substructure": 1, "superstructure": 1, "daywork": 1, "supervision": 1}',
  'Minimum work photos per claim type. Photos are mandatory for every claim (agreed). Minimum numbers to be confirmed.'),
 ('signature_required', '{"substructure": true, "superstructure": true, "daywork": true, "supervision": false}',
  'Whether a client foreman signature is required. ASSUMPTION: supervision has no stage to sign.');
