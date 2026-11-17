-- Site RAMS. A new revision is a new row, so earlier confirmations do not cover it.
-- The PDF and the gang lead's drawn signature are stored in Postgres.

CREATE TABLE ops.site_rams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES ops.sites(id),
  title text NOT NULL,
  revision text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  pdf_name text NOT NULL,
  pdf_bytes bytea NOT NULL,
  content_sha256 text NOT NULL,
  published_by uuid NOT NULL REFERENCES ops.users(id),
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, revision),
  CHECK (octet_length(pdf_bytes) <= 6291456)
);

CREATE TABLE ops.rams_acknowledgements (
  rams_id uuid NOT NULL REFERENCES ops.site_rams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES ops.users(id),
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  ip text NOT NULL DEFAULT '',
  user_agent text NOT NULL DEFAULT '',
  signature_name text NOT NULL,
  signature_png bytea NOT NULL,
  content_sha256 text NOT NULL,
  revision text NOT NULL,
  PRIMARY KEY (rams_id, user_id),
  CHECK (octet_length(signature_png) BETWEEN 1500 AND 2000000)
);

CREATE TABLE ops.rams_attendees (
  rams_id uuid NOT NULL REFERENCES ops.site_rams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES ops.users(id),
  member_id uuid NOT NULL REFERENCES ops.gang_members(id),
  PRIMARY KEY (rams_id, user_id, member_id)
);

DO $priv$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ks_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ops.site_rams, ops.rams_acknowledgements, ops.rams_attendees TO ks_app;
  END IF;
END
$priv$;
