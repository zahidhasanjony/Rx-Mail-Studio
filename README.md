# Rx Mail Studio

A responsive, installable web app for turning user-uploaded spreadsheets into regional prescription summaries and editable email batches. React, TypeScript and Vite provide the interface; Supabase provides authentication and protected cloud storage.

This repository contains application code and fictional examples. It contains no uploaded prescription files, company contacts, real recipient lists or private reporting results. Personal signature and CC presets belong in protected database records, never in frontend code or public environment variables.

## Local development

Use Node.js 24. Run `npm ci`, `npm run build`, then `npm test`. Start a local development session with `npm run dev`. The device workspace uses IndexedDB; the sample workspace uses fictional doctors and example.com addresses.

## Database setup

For a new installation, replace the example owner address in `supabase/schema.sql`, then apply it once as a migration. The `rxm_` tables are isolated from other applications. Apply `supabase/username-auth.sql` after the initial schema. Deploy the `rxm-auth` Edge Function with its included files. The function implements custom authentication: login accepts a username and password, while all management requests verify a Supabase JWT and an active database admin role. Set gateway `verify_jwt = false` to allow the public login action; management actions remain authenticated inside the function. Supabase supplies its server keys automatically to hosted Edge Functions; never put those keys in Vercel or browser code.

Initialize the first admin through the function’s `bootstrap` action using a randomly generated 64-character token. Insert only its SHA-256 digest into `rxm_auth_bootstrap` with a short expiry. The function consumes it once, preserves an existing verified owner identity when present, and refuses initialization once an active admin exists. Keep the token and chosen password out of Git. The admin then creates usernames and passwords on the **Users** page. Accounts are confirmed internally; no confirmation or invitation email is sent. Roles are Admin, Editor and Member. Disabled users immediately lose database access even with an existing token.

Optional first-login signature presets use `rxm_user_templates`. A verified member can read only their own preset. Saved personal settings take precedence. Configure real contacts privately after deployment.

## Vercel deployment

Import this GitHub repository, choose Vite, use `npm ci` and `npm run build`, and set the output directory to `dist`. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Use only a publishable key in the frontend. Update the function’s explicit CORS origin list for your deployment URL. Git integration builds subsequent pushes.

## App use

Upload source spreadsheets and a recipient hierarchy through the interface. Review the imported columns, reporting period, market definition and recipients before generating a batch. Source files stay on the device; cloud storage holds aggregates and protected settings. Imported hierarchy revisions and generated batches retain their versions.

The own-brand summary appears before the prescriber table, followed by up to four leading competitors. Counts use the selected market denominator. Doctor codes identify records. Missing routing or reporting coverage blocks the affected email.

## Email export and Outlook

Generating a batch downloads one ZIP containing a separate `.eml` file for every selected regional email. To, CC, sender, subject, regional Rx share summary, prescriber table and signature are preserved. Batch history can download the complete ZIP again, and previews or batch rows can download individual `.eml` files. Downloading keeps opening status unchanged.

Extract the ZIP and open the files in Outlook. UTF-8 MIME messages include a plain-text fallback and `X-Unsent: 1` to request editable opening. Email clients handle this differently; test one file in the intended Outlook version before using the full batch. No companion or PowerShell is needed for the `.eml` export. Review recipients and the sending account before sending manually.

On Windows, the optional paired companion or batch launcher displays editable messages in Classic Outlook. Automatic companion opening is off by default and can be enabled in Settings. Neither explicitly saves nor sends email. Outlook can autosave according to its own settings. The companion listens only on loopback and checks its paired origin and token. New Outlook and mobile Outlook do not support this COM integration.

The installed PWA supports mobile review and settings. Cloud sync requires a connection. Large spreadsheet imports should be tested on the intended device. A real Windows/Classic Outlook acceptance test is required before operational use.

## Storage and validation

Keep raw spreadsheets, email exports, credentials and recipient files out of Git. Monitor the target accounts' database usage and plan limits. The app does not purchase or upgrade services. Automated checks cover calculations, import parsing, routing, database access and the compiled interface. See `docs/verification.md` for remaining acceptance checks.
