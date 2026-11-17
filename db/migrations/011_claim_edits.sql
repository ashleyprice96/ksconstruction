-- Field-level record of office corrections on a gang claim.

CREATE TABLE ops.claim_field_edits (
  id bigserial PRIMARY KEY,
  claim_id uuid NOT NULL REFERENCES ops.claims(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES ops.users(id),
  at timestamptz NOT NULL DEFAULT now(),
  field text NOT NULL,
  old_value text NOT NULL DEFAULT '',
  new_value text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT ''
);

CREATE INDEX ON ops.claim_field_edits (claim_id, at);

DO $priv$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ks_app') THEN
    GRANT SELECT, INSERT ON ops.claim_field_edits TO ks_app;
    GRANT USAGE, SELECT ON SEQUENCE ops.claim_field_edits_id_seq TO ks_app;
  END IF;
END
$priv$;
