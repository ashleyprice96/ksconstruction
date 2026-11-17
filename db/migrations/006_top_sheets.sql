-- Scanned claim top sheets. Render's free web service has no persistent disk, so the
-- file bytes live in Postgres rather than on the instance filesystem. 6 MB is the
-- per-page cap (also enforced in the app). A new page is a new row.

ALTER TABLE ops.attachments ADD COLUMN IF NOT EXISTS content bytea;

DO $kind$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'ops.attachments'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%photo%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%octet_length%'
  LOOP
    EXECUTE format('ALTER TABLE ops.attachments DROP CONSTRAINT %I', r.conname);
  END LOOP;
END
$kind$;

ALTER TABLE ops.attachments ADD CONSTRAINT attachments_kind_check
  CHECK (kind IN ('photo', 'drawing', 'daywork_sheet', 'client_form', 'signature', 'issue_photo', 'top_sheet'));

ALTER TABLE ops.attachments DROP CONSTRAINT IF EXISTS attachments_content_size;
ALTER TABLE ops.attachments ADD CONSTRAINT attachments_content_size
  CHECK (content IS NULL OR octet_length(content) <= 6291456);
