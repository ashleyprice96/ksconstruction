-- Public share-to-sign links. The token is the only secret. The file stays private
-- and is streamed by the app. A drawn signature is stored with each sign-off.

CREATE TABLE ops.share_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('rams', 'toolbox', 'alert')),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  site_name text,
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1,
  file_name text,
  file_mime text,
  file_bytes bytea,
  storage_key text,
  content_sha256 text,
  pdf_pages int,
  created_by uuid NOT NULL REFERENCES ops.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    file_bytes IS NOT NULL OR storage_key IS NOT NULL
    OR (kind = 'alert' AND length(btrim(body)) >= 3)
  ),
  CHECK (file_bytes IS NULL OR octet_length(file_bytes) <= 52428800)
);

CREATE TABLE ops.share_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES ops.share_items(id) ON DELETE CASCADE,
  version int NOT NULL,
  user_id uuid REFERENCES ops.users(id),
  full_name text NOT NULL,
  company text NOT NULL DEFAULT '',
  signature_png bytea NOT NULL,
  ip text NOT NULL DEFAULT '',
  user_agent text NOT NULL DEFAULT '',
  signed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (octet_length(signature_png) BETWEEN 1500 AND 2000000)
);

CREATE UNIQUE INDEX share_signatures_person
  ON ops.share_signatures (item_id, version, lower(btrim(full_name)), lower(btrim(company)));
CREATE UNIQUE INDEX share_signatures_user
  ON ops.share_signatures (item_id, version, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX share_signatures_ip_at ON ops.share_signatures (ip, signed_at);

DO $priv$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ks_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ops.share_items, ops.share_signatures TO ks_app;
  END IF;
END
$priv$;
