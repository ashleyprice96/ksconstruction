# K-S Claims (web MVP)

Subcontractor claims, approvals and payments for K-S. Gangs book work in on their phones, a client foreman signs each stage on screen, K-S management signs off, and the office gets one-click exports, payee invoices and client backup packs. Client charge rates, client values and margin are held separately and are visible only to a named list of people.

This is the first working build of the proposal. It runs end to end, but several rules are still placeholders until K-S answers the open decisions listed at the end. **It is not ready for live use until those are answered and the go-live checklist is done.**

## What it does

| Area | What works now |
|---|---|
| Claims | Substructure (quantities plus course counts per wall), superstructure (percentage of each lift and patch), dayworks, supervision. Site, job number and plot are picked from lists. One site and one plot per claim. |
| Evidence | Work photos mandatory for every claim. Foundation drawing photo or scan mandatory for substructure. Signed client daywork sheet mandatory for dayworks. Optional client form upload. Photos are shrunk on the phone; documents can be enhanced (greyscale and contrast). |
| Foreman signature | Typed name plus finger signature on the gang's device, on a screen that shows measures and photos only, never money. Changing the measures afterwards clears the signature. It records a sign-off given in good faith; it does not verify identity. |
| Rates | Gang pay rates by rate set (KS Standard, North, client-specific, individual agreed) with effective dates, so future uplifts can be entered in advance. Gangs see their rates only at the final split step. |
| Checks | Every total is calculated. Submission is blocked without photos, drawing, daywork sheet, course counts, foreman signature or a rate. A lift can never be claimed past 100%. Claims over an agreed plot quantity, late claims and claims with no pay run are flagged for management. |
| Splits | The ganger splits the value between gang members who are cleared for payment. The split can never exceed the claim value. |
| Cut-off and pay runs | Weekly cut-off (default 11:00 Friday, UK time, configurable) sets the week ending. Fortnightly pay runs with a pay-less window that closes a set number of days before payment. Late claims roll to the next open run. |
| Management | Second sign-off, return to gang with a reason, pay-less reductions per line with reason and note. Originals, every change, who and why are kept permanently. Splits are rescaled in proportion. |
| Payments | Excel workbook for Mark (wages by payee, gang splits, dayworks, supervision, reductions) and CSV. One invoice PDF per payee per pay run, including limited companies. |
| Client backup pack | Zip per client per period with a summary PDF, photos, drawings, signatures and sheets. No money of any kind. Split into parts to stay under 18 MB. |
| Margin (named list only) | Margin by gang, site, client and week; client charge rates and client lift values; margin Excel export. Every view and export is logged. |
| Site communication | Snags and safety issues with photos, assignment to a gang and close-out. Health and safety alerts and news with recorded acknowledgements; H&S alerts stay pinned until acknowledged. |
| Eligibility | Gang members are cleared for payment by hand or by importing the payment company's CSV (`payment_ref`, `eligible`). Onboarding itself stays with the payment company. |

## How client rates and margin are protected

1. **Separate schema.** Client rates, client values and margin live only in the `commercial` database schema.
2. **Separate logins.** The app normally connects as `ks_app`, which has no permission on `commercial` at all. Only `src/lib/commercial.ts` uses the `ks_commercial` login.
3. **Named list, not a role.** `commercial.access_list` holds the named users. Being a manager or administrator gives nothing. The list can only be changed with the owner login (`npm run commercial:access`), which writes a history row.
4. **Checked twice.** The app checks the named list on every request, and the database checks it again through row-level security. A manager who is not on the list gets no rows even if the code is wrong.
5. **Everything else is built without it.** Gang screens, management screens, exports for Mark, invoices, backup packs and error messages are all generated with the `ks_app` login, so they cannot contain client figures.
6. **Logged.** Every view and export of commercial data is written to `commercial.access_log` (`npm run commercial:access -- log 30`).
7. **Tested.** `tests/unit/commercial-isolation.test.ts` checks the database rules. `tests/e2e/leaks.spec.ts` logs in as each non-named role, opens every reachable page, export, invoice PDF and backup pack, and fails if any client figure appears.

Once margin data is exported to Excel or Power BI, its protection depends on where that file or workspace is shared.

## Running it locally

Needs Node 20 or later and PostgreSQL 16.

```bash
npm install
cp .env.example .env                       # then set real passwords
psql -U postgres -f db/bootstrap.sql       # creates the database and the three logins
npm run db:migrate
npm run db:seed-demo                       # fictional demo data only
npm run dev
```

Demo logins (password `demo-password-1`): `gang1@demo.test`, `gang2@demo.test`, `cm@demo.test`, `manager@demo.test` (not on the named list), `director@demo.test` (on the named list), `admin@demo.test`.

`scripts/reset-dev-db.sh` rebuilds a local database from scratch with demo data. It refuses to run against anything but localhost.

### Tests

```bash
npm test                                   # unit and database rules (needs the demo seed)
scripts/reset-dev-db.sh && npm run build && npm start &
BASE_URL=http://localhost:3000 npm run test:leaks
```

## Real K-S data

Real sites, gangs and rates are **never committed**. They go in `private/seed.private.json` (git-ignored) and are loaded with `npm run db:seed-private`. Keep that file in a private K-S location, not in this repository and not in any demo or screenshot. The Labour Rates workbook in 02 - COMMERCIAL is the master: units marked TBC and effective dates must be checked against it before go-live. No client charge rates are loaded because none are known yet; enter them in the Margin area from each client's master sheet.

## Ownership

K-S should own every account: the code repository (a private K-S GitHub organisation), hosting, database, file storage, email and domain, opened with a company email and card and with at least two K-S owners. Developers are invited as members and removed at the end. This code currently sits in a folder of another repository and should be moved into a K-S-owned repository; `git subtree split --prefix ks-claims` keeps its history.

## Deploying on Render

The web service start command is `npm run start:hosted`:

```bash
tsx scripts/bootstrap-roles.ts && tsx scripts/migrate.ts && tsx scripts/bootstrap-data.ts && tsx scripts/seed-demo.ts && next start -p ${PORT:-3000}
```

`render.yaml` describes a free web service and a Postgres 16 database in Frankfurt. If the database already exists, do not sync that file over it. Set the variables below on the web service.

SSL is turned on for every host other than `localhost` / `127.0.0.1`, and also when the URL contains `sslmode=require`. Internal (`dpg-…-a`) and external (`*.render.com`) URLs both work. Certificate hostnames on the internal address do not match Render's certificate, so the certificate is encrypted but not verified unless the URL sets `sslmode=verify-full`.

The database user Render creates is not a superuser. It does have `CREATEROLE`. `bootstrap-roles` then creates two logins:

- `ks_app`, password `APP_DB_PASSWORD`. No privileges on the commercial schema.
- `ks_commercial`, password `COMMERCIAL_DB_PASSWORD`. Reads and writes commercial data only through row-level security, and only for a user on the named list.

The mode is printed at boot (`separate-login`, `set-role`, or `shared-owner`). Passwords and full connection strings are never printed. If this user cannot create roles, the app connects as the owner. Once the database has users, row-level security is forced on the commercial tables, so a connection as the owner still has to pass the named-list check. That is weaker than separate logins: the owner can turn row security off. A restart is safe: roles are altered rather than recreated, migrations run once, and `seed-demo` does nothing once any user exists.

`seed-demo` loads fictional data, including demo commercial figures. After the first boot of a real service, take `tsx scripts/seed-demo.ts` out of the start command before loading real sites and rates.

### Env vars the web service needs

| Variable | Required | What to set |
|---|---|---|
| `DATABASE_URL_OWNER` | Yes | Render Postgres connection string. Prefer the **internal** URL when the service and database are in the same region. The external URL works too. |
| `DATABASE_URL` | Yes, if `DATABASE_URL_OWNER` is unset | Same connection string. Render fills this in when the database is linked. The scripts use `DATABASE_URL_OWNER` first. |
| `APP_DB_PASSWORD` | Yes | Long random password for the `ks_app` login. |
| `COMMERCIAL_DB_PASSWORD` | Yes | Long random password for the `ks_commercial` login. Different from the app password. |
| `SECURE_COOKIES` | Yes in production | `true` |
| `DATABASE_URL_APP` | No | Set only if you do not want the app URL derived from the owner URL and `APP_DB_PASSWORD`. |
| `DATABASE_URL_COMMERCIAL` | No | Same, for the commercial login. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | No | Creates that administrator once, if the email does not exist. |
| `ADMIN_NAMED_LIST` | No | `true` puts that administrator on the commercial named list. |
| `PRIVATE_SEED_B64` | No | Base64 of `private/seed.private.json`. Loaded on boot. Remove it after it has loaded. Do not use the demo seed for real sites. |
| `UPLOAD_DIR` | No | Defaults to `./uploads`. Render's disk is ephemeral, so uploaded photos do not survive a restart until object storage is wired up. |
| `RESET_REQUEST_EMAIL` | No | Office inbox that receives password-reset requests. If this or `SMTP_HOST` is unset, the request is still recorded in Setup and no email is sent. |
| `SMTP_HOST` | No | SMTP server. Leave unset to skip email. |
| `SMTP_PORT` | No | Defaults to `587`. Port `465` uses TLS from the start. |
| `SMTP_USER` | No | SMTP username, if the server requires authentication. |
| `SMTP_PASS` | No | SMTP password. |
| `SMTP_FROM` | No | From address. Defaults to `SMTP_USER`, then `RESET_REQUEST_EMAIL`. |

## Production notes

- Host the app, database and file storage in a UK region. Swap `src/lib/files.ts` from local disk to private object storage.
- Set `SECURE_COOKIES=true` behind HTTPS. Use long random passwords for all three database logins and keep them in a password manager.
- Back up the database and file store daily; test a restore. Backups contain commercial data, so limit who can reach them.
- Transactional email (password resets, notifications) is not built yet.

## Open decisions the code depends on

These are built as editable placeholders or assumptions. None should be treated as a K-S rule until confirmed.

| Ref | Decision | Where it lives now |
|---|---|---|
| D1 | Payment company, eligibility file format and matching reference | CSV import by `payment_ref` (Setup, Gangs) |
| D2 | Substructure item list, units, whether coursing is a pay item, agreed quantities per plot | Items and units in Gang rates; units TBC in the private seed |
| D3 | Lifts and patch per house type, values, part-lift rules | Lifts entered in Setup; part lifts claimed as a percentage |
| D4 | Pay calendar: payment date against the weekly cut-offs, pay-less window | Settings: cut-off 11:00 Friday, window closes 7 days before payment |
| D5 | Who may change the named list | Owner-only script with history |
| D6 | Who gives the second sign-off, value limits, cover | Any management user |
| D7 | Payee invoice content: VAT, CIS, self-billing, numbering, company details | Draft PDF marked for accountant review; no tax shown |
| D8 | Pay-less reason categories, notice requirements, wording, authority | Placeholder reason list in Settings; no notice generated |
| D9 | Minimum photos and required views per stage | Settings: minimum 1 per claim type |
| D10 | Whether contracts managers see gang rates | They do not |
| D12 | Split in pounds or percentages; whether a split may be less than the claim | Pounds; less is allowed and flagged |
| D13 | Client invoices: produced here or in the accounts system | Not built; client values are in the Margin export |
| D14 | Offline capture | Not built (needs signal to upload) |
| D18 | Supervision rules and any client recharge | Weekly amount per person and site; claimed in weeks; no foreman signature |
| D25 | Client and housebuilder per site, job numbers | Sites load without job numbers; gangs cannot claim until the office adds them |
| D26 | Retention | Not built |

Rate order on a claim (individual agreed set, then client-specific set, then base set) is also an assumption to confirm.
