-- Health and safety PDFs can be a long RAMS. 50 MB is the database ceiling.
-- The app can set a lower cap with HS_PDF_MAX_MB. Top sheets stay at 6 MB.

ALTER TABLE ops.hs_alerts ADD COLUMN IF NOT EXISTS pdf_pages int;
ALTER TABLE ops.site_rams ADD COLUMN IF NOT EXISTS pdf_pages int;
ALTER TABLE ops.site_rams ADD COLUMN IF NOT EXISTS storage_key text;
ALTER TABLE ops.site_rams ALTER COLUMN pdf_bytes DROP NOT NULL;

ALTER TABLE ops.hs_alerts DROP CONSTRAINT IF EXISTS hs_alerts_attachment_size;
ALTER TABLE ops.hs_alerts ADD CONSTRAINT hs_alerts_attachment_size
  CHECK (attachment_bytes IS NULL OR octet_length(attachment_bytes) <= 52428800);

DO $drop$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'ops.site_rams'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%6291456%'
  LOOP
    EXECUTE format('ALTER TABLE ops.site_rams DROP CONSTRAINT %I', r.conname);
  END LOOP;
END
$drop$;

ALTER TABLE ops.site_rams DROP CONSTRAINT IF EXISTS site_rams_pdf_size;
ALTER TABLE ops.site_rams ADD CONSTRAINT site_rams_pdf_size
  CHECK (pdf_bytes IS NULL OR octet_length(pdf_bytes) <= 52428800);

ALTER TABLE ops.site_rams DROP CONSTRAINT IF EXISTS site_rams_pdf_location;
ALTER TABLE ops.site_rams ADD CONSTRAINT site_rams_pdf_location
  CHECK (pdf_bytes IS NOT NULL OR storage_key IS NOT NULL);
