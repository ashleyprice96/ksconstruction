# Run on Vercel

The app can run on Vercel Hobby and still use the Render Postgres database. Large health and safety PDFs do not go through the function. The browser uploads them to private Vercel Blob, then the function records the pathname, size and SHA-256.

Set the project build command to:

`npm run db:migrate && next build`

`db:migrate` reads `DATABASE_URL` (or `DATABASE_URL_OWNER` if that is set) and applies `db/migrations`. You can also run `npm run db:migrate` yourself before the first deploy. Use the Render **external** connection string. The app turns SSL on for any host that is not localhost.

On Vercel the pool is 4 connections for the app and 3 for the commercial login, and idle connections are dropped. Render's free Postgres allows few connections, so do not raise this.

If only `DATABASE_URL` is set, the app uses that one login. Set `DATABASE_URL_APP` and `DATABASE_URL_COMMERCIAL` as well when you want the separate logins.

`STORAGE_DRIVER` must be `vercel-blob` on Vercel. `postgres` and `s3` still work on Render. Blob files stay private. Signed-in users read them through the existing PDF routes. The storage meter uses Blob's total size. Hobby includes 1 GB; set `STORAGE_QUOTA_GB` if you want a different warning line.

Server actions accept at most 4 MB. Adding a site and the other Setup forms are small. A 50 MB RAMS, alert or toolbox PDF, and a top-sheet PDF, are uploaded by the browser.

## Environment variable names

- `DATABASE_URL`
- `DATABASE_URL_OWNER`
- `DATABASE_URL_APP`
- `DATABASE_URL_COMMERCIAL`
- `APP_DB_PASSWORD`
- `COMMERCIAL_DB_PASSWORD`
- `BLOB_READ_WRITE_TOKEN`
- `STORAGE_DRIVER`
- `STORAGE_QUOTA_GB`
- `SECURE_COOKIES`
- `FEATURE_CLAIMS`
- `HS_PDF_MAX_MB`
