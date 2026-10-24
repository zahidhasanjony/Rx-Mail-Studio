# Rx Mail Studio

A responsive, installable web app for turning user-uploaded spreadsheets into regional prescription summaries and editable email batches. React, TypeScript and Vite provide the interface; Supabase provides authentication and protected cloud storage.

This repository contains application code and fictional examples. It contains no uploaded prescription files, company contacts, real recipient lists or private reporting results. Personal signature and CC presets belong in protected database records, never in frontend code or public environment variables.

## Local development

Use Node.js 24. Run `npm ci`, `npm run build`, then `npm test`. Start a local development session with `npm run dev`. The device workspace uses IndexedDB; the sample workspace uses fictional doctors and example.com addresses.

## Database setup

For a new installation, replace the example owner address in `supabase/schema.sql`, then apply it once as a migration. The `rxm_` tables are isolated from other applications. Apply `supabase/username-auth.sql` after the initial schema, then apply `supabase/admin-reporting.sql` and `supabase/brand-catalogue.sql`. Deploy the `rxm-auth` Edge Function with its included files. The function implements custom authentication: login accepts a username and password, while all management requests verify a Supabase JWT and an active database admin role. Set gateway `verify_jwt = false` to allow the public login action; management actions remain authenticated inside the function. Supabase supplies its server keys automatically to hosted Edge Functions; never put those keys in Vercel or browser code.

Initialize the first admin through the function’s `bootstrap` action using a randomly generated 64-character token. Insert only its SHA-256 digest into `rxm_auth_bootstrap` with a short expiry. The function consumes it once, preserves an existing verified owner identity when present, and refuses initialization once an active admin exists. Keep the token and chosen password out of Git. The admin then creates usernames and passwords on the **Users** page. Accounts are confirmed internally; no confirmation or invitation email is sent. Roles are Admin, Editor and Member. Disabled users immediately lose database access even with an existing token.

Optional first-login signature presets use `rxm_user_templates`. A verified member can read only their own preset. Saved personal settings take precedence. Configure real contacts privately after deployment.

## Vercel deployment

Import this GitHub repository, choose Vite, use `npm ci` and `npm run build`, and set the output directory to `dist`. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Use only a publishable key in the frontend. Update the function’s explicit CORS origin list for your deployment URL. Git integration builds subsequent pushes.

## App use

Upload source spreadsheets and a recipient hierarchy through the interface. Review the imported columns, reporting period, market definition and recipients before generating a batch. Source files stay on the device; cloud storage holds aggregates and protected settings. Imported hierarchy revisions and generated batches retain their versions.

The own-brand summary appears before the prescriber table, followed by up to four leading competitors. Counts use the selected market denominator. Doctor codes identify records. Missing routing or reporting coverage blocks the affected email.

National share is own-brand Rx divided by all generic Rx across all source regions, multiplied by 100, within the selected month range, cycle and dosage forms. Each source record is counted once regardless of ACD/CCD routing. The comparison sentence appears immediately above the regional share table; regional share is red below the national benchmark and green at or above it. Doctors below the same benchmark are marked red. The Other Brand column lists each competitor with its Rx count, such as `FENAT (1), TOTI (2)`.

In **Settings → Your email defaults**, enter the sender name, designation, email, phone extension and mobile numbers. The signature uses the fixed Beximco office details and blue/gray reference styling. Cloud defaults are private to the signed-in user and stay saved until edited; device defaults stay in IndexedDB. Sample defaults last only for the session. Saved batches retain their original content; generate a new batch after changing defaults or email formatting.

## Email export and Outlook

Generating a batch downloads an Outlook Excel `.xlsm` workbook by default. Choosing `.eml ZIP` downloads one ZIP containing a separate `.eml` file for every selected regional email. To, CC, subject, regional Rx share summary, prescriber table and signature are preserved. Newly generated emails use Arial Narrow throughout, including every table and the signature, with existing sizes and colours retained. Batch history offers both formats, and previews or batch rows can download individual `.eml` files. Downloading keeps opening status unchanged.

Extract the ZIP and open the files in Outlook. UTF-8 MIME messages include a plain-text fallback and `X-Unsent: 1` to request editable opening. Email clients handle this differently; test one file in the intended Outlook version before using the full batch. No companion or PowerShell is needed for the `.eml` export. Review recipients and the sending account before sending manually.

On Windows, the optional paired companion or batch launcher displays editable messages in Classic Outlook. Automatic companion opening is off by default and can be enabled in Settings. Neither explicitly saves nor sends email. Outlook can autosave according to its own settings. The companion listens only on loopback and checks its paired origin and token. New Outlook and mobile Outlook do not support this COM integration.

The installed PWA supports mobile review and settings. Cloud sync requires a connection. Large spreadsheet imports should be tested on the intended device. A real Windows/Classic Outlook acceptance test is required before operational use.

## Storage and validation

### Outlook Excel export

Choose **Download format → Outlook Excel (.xlsm)** before generating, or use
**Download Outlook Excel (.xlsm)** in the prepared batch window. Batch history
also has an **Outlook Excel** button. The default is `Outlook Excel (.xlsm)`;
users can switch to `.eml ZIP`. All existing
export and companion options remain available.

Open the downloaded workbook in Excel for Windows with permitted VBA macros and
click **Open all emails in Outlook**. Classic Outlook opens each prepared email
with its To, CC, subject, full formatted body and signature. The button does not
call Save or Send, run CMD/PowerShell, or contact the website. Outlook's own
autosave setting still applies. Review the sending account and send manually.

Rows record Opened or Failed with details. Clicking again skips Opened rows and
retries remaining emails. Save the Excel workbook to retain those statuses after
closing it. A fresh download starts a new opening session. Excel statuses do not
change app history. Long bodies are stored in chunks and reconstructed with
Unicode and formatting intact. Build details and desktop acceptance checks are
in `assets/outlook/README.md`.

Keep raw spreadsheets, email exports, credentials and recipient files out of Git. Monitor the target accounts' database usage and plan limits. The app does not purchase or upgrade services. Automated checks cover calculations, import parsing, routing, database access and the compiled interface. See `docs/verification.md` for remaining acceptance checks.

## Reporting ranges and admin controls

Select **From month** and **To month**. The same month reports a single month; a range combines counts into one email per region and generic. A selected Flash applies to each month. Subject and opening show the period, for example `July'26 1st Flash` or `June'26–July'26 2nd Flash`. Every month needs source coverage for that cycle, and a region without coverage in every selected month is blocked. National share uses total brand Rx / total generic Rx across the range, never an average of monthly percentages.

With **All available dates**, the period automatically ends in `1st Flash` when the final selected month has days 1–10, or `2nd Flash` for days 1–20. A full final month has no Flash suffix. This uses active source coverage, not doctor or specialty filters; missing days and isolated 11–20 data do not count as a complete cumulative Flash. Generated batches retain this wording in mail previews, exports and history even after more source data is imported.

Admin users publish the shared subject and body from **Settings → Your email defaults → Make this the default for all users → Publish team default**. Members keep their own signature and personal CC, and can customize wording for an individual batch. Refresh the cloud workspace to receive a newly published template. Historical batches keep their frozen wording.

Only admins can delete completed sources, upload or revise hierarchy versions, or use **Download full hierarchy**. Source deletion requires confirmation and cascades to imported Rx chunks; prepared emails remain in history. Editors can still upload sources and safely clean up their own failed uploads. Database policies enforce these restrictions, including disabled-user denial. Full hierarchy export is an admin-checked RPC; hierarchy routing remains readable by team members because it is needed to prepare regional emails.

**Map hierarchy columns → Additional hierarchy CC** accepts any number of extra contacts. Choose the role from uploaded headers, or map a column containing per-region titles; map name and email columns. Blank emails are skipped and duplicates are removed. The full Excel-compatible CSV includes every route (including inactive routes), salutation and each CC title, name and email, and can be uploaded again. ASE/MPE summaries place eight code cells beside the legend, wrapping after eight while keeping all three values centered.

Verified saved sessions reopen the cloud workspace after a page refresh. The top bar shows a green cloud indicator with an accessible label and hover tooltip, the signed-in username and role, and **Sign out**. Admin functions remain on Users, Settings, Source files and Region hierarchy; there is no separate header shortcut. Sign-out clears the browser's cloud session and visible cloud data; saved device data remains separate. Expired or disabled accounts return to the username sign-in form. Page headings, dashboard values, field labels and actionable warnings remain; repeated descriptions, upload controls and instructional cards are removed.

Brand Library has a Search button for brand/generic names and a Clear action. Successful cloud imports atomically append new Beximco pairs from the full source catalogue, including markets not retained as Rx facts. Admins can also use **Update catalogue** to scan completed imports. Both paths insert missing pairs only; existing IDs, forms, aliases and favourites are preserved. Company-tagged competitor entries are excluded; older catalogues remain compatible with the original Beximco-only importer. Cloud loading reconciles stored definitions with built-in defaults and imported catalogues and paginates profile reads. Device-to-cloud copy preserves cloud definitions while adding missing device pairs. An empty reporting scope still requires additional source data before generation.

New emails use black greeting, opening and comparison text. The default opening is `Please find below the prescription share of {Brand} and prescribers list of {Generic} in {Region} Region for {Period}.` Existing custom wording remains editable. Both the comparison percentage and the own-brand tile percentage use red below the national benchmark and green at/above it, using unrounded Rx counts. Missing benchmarks use black. Signature styling and doctor marking remain as before.

To/CC exports contain bare email addresses. Personal team/boss CC comes first in saved order, followed by hierarchy CC; duplicate addresses and the To address are removed case-insensitively. EML uses standard comma-separated mailbox headers; the preview displays semicolons. Outlook may resolve addresses to contact names using its own address book. Generate a new batch for the revised body and CC ordering; previously prepared HTML remains frozen.

## Multiple target generics and admin brand-pair deletion

On **Generate emails**, choose the target brand, expand **Target generics**, and check additional generic markets. The brand's direct generic remains selected. **Use own generic only** restores the original behavior. With multiple markets, **All forms in selected markets** includes their dosage forms; a specific form can still be selected.

Counts use the union of selected markets. National, regional, ASE/MPE and doctor shares divide the target brand's Rx by the selected-market Rx total, and combined reports state that scope explicitly. Each doctor is merged within the same structure, region and MPE using the doctor code. Own-brand Rx belongs to the direct generic and its explicit aliases. Subjects, openings and batch labels include the selected market names. Saved batches keep a copy of the selected scope and frozen HTML.

Selected markets must be retained in active source data for every selected month/cycle. Older imports may need re-importing with the additional market checked. New imports discover every generic in the source, including competitor-only markets, independently of Beximco brand-pair discovery. Raw spreadsheets remain on the device.

Admins can delete a pair from **Brand library** after confirming the named pair. A database policy limits deletion to owners; editors and members cannot delete. A trigger records the deleted normalized brand/generic pair, and import discovery, catalogue refresh, startup defaults and device/cloud reconciliation skip these pairs. Stale inserts or updates cannot recreate a removed pair. Source facts and saved batches are preserved.

Apply `supabase/migrations/20261017045737_brand_pair_deletion.sql` after `brand-catalogue.sql` before deploying the updated client. The migration was generated with the Supabase CLI and adds deletion markers, operation-specific policies and guarded catalogue insertion.

## Rx dashboard

Dashboard adds single-month and range reporting, overall Beximco Rx share/counts, TG shares and a TG-to-brand view. Brand rows show their generic-market denominator, including competitor counts whose TG is unknown. Counts are prescription product occurrences, and range shares are calculated from summed counts. Only active, completed sources are included. Missing months, selected-generic imports and unclassified TGs are shown explicitly.

The source importer retains the MRW `TG_l(All)` classification in source metadata without changing the checked upload-payload format. Older imports can use the protected reference taxonomy populated from the supplied MRW files; conflicting or absent mappings stay Unclassified. Reference data is not part of this repository. Future source-specific mappings take precedence.

Unclassified Beximco brands have a TG dropdown and Save button. Admins and Editors can save shared manual mappings; members can view them. A mapping is scoped to the normalized generic, brand and company, applies across months and future imports, and takes precedence over source/reference TGs. The override table has RLS, restricted column writes and a database-assigned editor/timestamp. Device-only mappings are saved separately from workspace/mail records in IndexedDB; sample changes stay in the preview. Failed saves retain the selection and do not move the brand. Apply the `dashboard_tg_assignments` migration before publishing this feature.

Apply the `dashboard_summaries` migration after `resumable_source_upload`. Its trigger caches non-identifying brand/company occurrence totals per chunk. Backfill existing null `dashboard_summary` values using `rxm_private.summarize_rx(payload)` in bounded batches before publishing. The authenticated, security-invoker `rxm_dashboard` RPC reads these compact summaries through existing RLS. Data API clients cannot forge summary columns or edit the reference taxonomy. Activation, deletion, payload changes and replacement automatically affect the dashboard. The dashboard does not hydrate all prescription facts into the browser.

## Mobile source imports and recovery

Cloud imports scan prescription rows once, discovering all generic markets while staging facts in small batches in a worker. All markets are selected by default; the review can narrow them without parsing the workbook again. After confirmation the worker prepares byte-capped parts and a manifest. Only metadata crosses into React reporting state. Equivalent Rx rows may be aggregated in separate batches; all counts are summed by the report engine. Device-only imports retain their existing selected-market workflow.

Upload requests combine small generic parts up to 512 KiB, with at most two requests in flight. Slow requests or transient failures reduce concurrency to one, with bounded exponential retry and request timeouts. Each part has a deterministic index and SHA-256 digest of all known prescription fields. Supabase derives actual record and Rx counts, validates each month/generic, and ignores identical retries. An activation trigger verifies every manifest part before the existing finish RPC atomically activates the source and archives overlaps.

Prepared parts and jobs persist in a separate IndexedDB database to avoid blocking older app tabs. Pause/resume checks server acknowledgements and sends only missing parts. Temporary failures preserve the job. Prepared raw staging is freed after the resumable job is saved. Successful imports and explicit discards remove their temporary files; old incomplete imports appear in Source files with a discard action. Completed reports and saved email batches are kept. Progress distinguishes preparation, uploading and verification without a blocking overlay. Resume requires the same account and device; Android can suspend the tab while it is closed.

Apply the `resumable_source_upload` migration after the earlier migrations before publishing this client. Existing legacy imports, including older unfinished uploads, retain their original protocol. The new protocol uses private checked routines behind public security-invoker wrappers; anonymous access is denied and direct chunk writes are blocked for manifest imports. Normal reporting reads only the selected markets. `node --import tsx scripts/benchmark-upload.mjs /path/to/source.xlsx` runs a full offline import and compares request counts and all month/generic Rx totals without accessing Supabase.

`/recover.html` opens independently of the React app. Its refresh button unregisters this app's service worker and removes only `rx-shell-` file caches; it preserves localStorage, IndexedDB workspace data and Supabase data. Startup HTML and the React error boundary provide a link to this page when the app cannot open.
