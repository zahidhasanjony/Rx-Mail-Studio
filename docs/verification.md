# Verification

Automated checks cover market-share denominators, doctor-code grouping, regional routing, reporting filters, recipient validation, escaped email HTML, CC deduplication, opening results, coverage, streaming XLSX parsing, hierarchy mapping, private settings, verified membership and transactional import replacement. Email export checks cover MIME round trips, UTF-8 names and subjects, To/CC, preserved HTML tables, header safety and complete ZIP output. The compiled interface check exercises preview, batch generation, .eml downloads, history and username-only sign-in. Authentication checks cover server-only user creation, internally confirmed accounts, role validation, generic login errors, credential privacy, rate limits, disabled account denial, CORS restrictions and last-admin protection.

Run `npm run build` and `npm test` after changes. Database tests use a local PostgreSQL-compatible engine and simulated authentication identities. Production configuration also needs live access checks and the Supabase Security Advisor.

Private source-file reconciliation results and account details are intentionally excluded from this public repository. `scripts/verify-mrw.ts` can check a source spreadsheet locally without committing the source or its results.

Desktop/mobile browser review and a Windows/Classic Outlook acceptance test remain required. The companion is not installed by deploying the website. Email is opened for manual review and sending; a download never counts as an opened or sent message.

Batch import checks cover automatic versus ambiguous sheet selection, all-market retention, versioned duplicate hashes, cumulative and disjoint phases, overlapping revisions, and replacements that would lose dates or markets. The compiled cloud test selects two workbooks, confirms once, pauses with both ordered jobs persisted, resumes without resending acknowledged records, and verifies both activations and queue cleanup. These tests simulate cloud requests; they do not import real prescription data into production.
