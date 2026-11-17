-- Site rate cards. A gang lead can claim on any active site. The price is the
-- site card, unless that gang has an override for the same item, which wins.
-- Existing rate sets are kept. Standard (and North, where the site region says
-- so) rates are copied onto sites so claims already in use keep a price.
-- Individual agreed rates are copied as per-gang overrides.

CREATE TABLE ops.site_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES ops.sites(id),
  item_id uuid NOT NULL REFERENCES ops.rate_items(id),
  rate numeric(12,4) NOT NULL CHECK (rate >= 0),
  effective_from date NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, item_id, effective_from)
);

CREATE TABLE ops.site_lift_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES ops.sites(id),
  lift_id uuid NOT NULL REFERENCES ops.lifts(id),
  gang_value numeric(12,2) NOT NULL CHECK (gang_value >= 0),
  effective_from date NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, lift_id, effective_from)
);

CREATE TABLE ops.gang_site_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gang_id uuid NOT NULL REFERENCES ops.gangs(id),
  site_id uuid NOT NULL REFERENCES ops.sites(id),
  item_id uuid NOT NULL REFERENCES ops.rate_items(id),
  rate numeric(12,4) NOT NULL CHECK (rate >= 0),
  effective_from date NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gang_id, site_id, item_id, effective_from)
);

-- Standard card onto every site.
INSERT INTO ops.site_rates (site_id, item_id, rate, effective_from)
SELECT s.id, gr.item_id, gr.rate, gr.effective_from
FROM ops.sites s
JOIN ops.gang_rates gr ON gr.rate_set_id = (
  SELECT id FROM ops.rate_sets WHERE kind = 'standard' ORDER BY name LIMIT 1)
ON CONFLICT (site_id, item_id, effective_from) DO NOTHING;

-- North card replaces the same item and date on sites whose region is North.
INSERT INTO ops.site_rates (site_id, item_id, rate, effective_from)
SELECT s.id, gr.item_id, gr.rate, gr.effective_from
FROM ops.sites s
JOIN ops.gang_rates gr ON gr.rate_set_id = (
  SELECT id FROM ops.rate_sets WHERE kind = 'north' ORDER BY name LIMIT 1)
WHERE s.region ILIKE '%north%'
ON CONFLICT (site_id, item_id, effective_from) DO UPDATE SET rate = EXCLUDED.rate;

-- A gang's individual agreed rates win on every current site.
INSERT INTO ops.gang_site_rates (gang_id, site_id, item_id, rate, effective_from)
SELECT g.id, s.id, gr.item_id, gr.rate, gr.effective_from
FROM ops.gangs g
JOIN ops.sites s ON true
JOIN ops.gang_rates gr ON gr.rate_set_id = g.individual_rate_set_id
ON CONFLICT (gang_id, site_id, item_id, effective_from) DO NOTHING;

DO $priv$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ks_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ops.site_rates, ops.site_lift_values, ops.gang_site_rates TO ks_app;
  END IF;
END
$priv$;
