-- Company health and safety alerts that block gang leads until they confirm.
-- A new active alert has no acknowledgements, so everyone is blocked again.

CREATE TABLE ops.hs_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  attachment_key text,
  attachment_name text,
  attachment_mime text,
  published_by uuid NOT NULL REFERENCES ops.users(id),
  published_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ops.hs_acknowledgements (
  alert_id uuid NOT NULL REFERENCES ops.hs_alerts(id),
  user_id uuid NOT NULL REFERENCES ops.users(id),
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  ip text NOT NULL DEFAULT '',
  PRIMARY KEY (alert_id, user_id)
);

DO $priv$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ks_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ops.hs_alerts, ops.hs_acknowledgements TO ks_app;
  END IF;
END
$priv$;
