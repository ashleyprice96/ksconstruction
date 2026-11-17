-- 011 granted the table before the sequence privilege was included.
DO $priv$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ks_app') THEN
    GRANT USAGE, SELECT ON SEQUENCE ops.claim_field_edits_id_seq TO ks_app;
  END IF;
END
$priv$;
