-- Toolbox talks sit beside health and safety alerts. A PDF is stored in the
-- database so it survives a Render disk with no persistent storage. A site list
-- limits who must confirm; no sites means every gang lead.

ALTER TABLE ops.hs_alerts
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'alert',
  ADD COLUMN IF NOT EXISTS due_on date,
  ADD COLUMN IF NOT EXISTS attachment_bytes bytea;

ALTER TABLE ops.hs_alerts DROP CONSTRAINT IF EXISTS hs_alerts_kind_check;
ALTER TABLE ops.hs_alerts ADD CONSTRAINT hs_alerts_kind_check CHECK (kind IN ('alert', 'toolbox'));

ALTER TABLE ops.hs_alerts DROP CONSTRAINT IF EXISTS hs_alerts_attachment_size;
ALTER TABLE ops.hs_alerts ADD CONSTRAINT hs_alerts_attachment_size
  CHECK (attachment_bytes IS NULL OR octet_length(attachment_bytes) <= 6291456);

CREATE TABLE ops.hs_alert_sites (
  alert_id uuid NOT NULL REFERENCES ops.hs_alerts(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES ops.sites(id),
  PRIMARY KEY (alert_id, site_id)
);

ALTER TABLE ops.hs_alerts ADD COLUMN IF NOT EXISTS revision text NOT NULL DEFAULT '1';
ALTER TABLE ops.hs_alerts ADD COLUMN IF NOT EXISTS content_sha256 text;

ALTER TABLE ops.hs_acknowledgements ADD COLUMN IF NOT EXISTS signature_name text;
ALTER TABLE ops.hs_acknowledgements ADD COLUMN IF NOT EXISTS signature_png bytea;
ALTER TABLE ops.hs_acknowledgements ADD COLUMN IF NOT EXISTS user_agent text;
ALTER TABLE ops.hs_acknowledgements ADD COLUMN IF NOT EXISTS content_sha256 text;
ALTER TABLE ops.hs_acknowledgements ADD COLUMN IF NOT EXISTS revision text;

ALTER TABLE ops.hs_acknowledgements DROP CONSTRAINT IF EXISTS hs_ack_signature_size;
ALTER TABLE ops.hs_acknowledgements ADD CONSTRAINT hs_ack_signature_size
  CHECK (signature_png IS NULL OR octet_length(signature_png) <= 2000000);

CREATE TABLE ops.hs_attendees (
  alert_id uuid NOT NULL REFERENCES ops.hs_alerts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES ops.users(id),
  member_id uuid NOT NULL REFERENCES ops.gang_members(id),
  PRIMARY KEY (alert_id, user_id, member_id)
);

DO $priv$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ks_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ops.hs_alert_sites, ops.hs_attendees TO ks_app;
  END IF;
END
$priv$;
