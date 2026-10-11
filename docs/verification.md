# Verification

Automated checks cover market-share denominators, doctor-code grouping, regional routing, reporting filters, recipient validation, escaped email HTML, CC deduplication, opening results, coverage, streaming XLSX parsing, hierarchy mapping, private settings, verified membership and transactional import replacement. Email export checks cover MIME round trips, UTF-8 names and subjects, To/CC, preserved HTML tables, header safety and complete ZIP output. The compiled interface check exercises preview, batch generation, .eml downloads, history and username-only sign-in. Authentication checks cover server-only user creation, internally confirmed accounts, role validation, generic login errors, credential privacy, rate limits, disabled account denial, CORS restrictions and last-admin protection.

Run `npm run build` and `npm test` after changes. Database tests use a local PostgreSQL-compatible engine and simulated authentication identities. Production configuration also needs live access checks and the Supabase Security Advisor.

Private source-file reconciliation results and account details are intentionally excluded from this public repository. `scripts/verify-mrw.ts` can check a source spreadsheet locally without committing the source or its results.

Desktop/mobile browser review and a Windows/Classic Outlook acceptance test remain required. The companion is not installed by deploying the website. Email is opened for manual review and sending; a download never counts as an opened or sent message.
