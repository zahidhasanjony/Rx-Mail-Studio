# Verification

Automated checks cover market-share denominators, doctor-code grouping, regional routing, reporting filters, recipient validation, escaped email HTML, CC deduplication, opening results, coverage, streaming XLSX parsing, hierarchy mapping, private settings, verified membership and transactional import replacement. The compiled interface check exercises preview, batch generation and history.

Run `npm run build` and `npm test` after changes. Database tests use a local PostgreSQL-compatible engine and simulated authentication identities. Production configuration also needs live access checks and the Supabase Security Advisor.

Private source-file reconciliation results and account details are intentionally excluded from this public repository. `scripts/verify-mrw.ts` can check a source spreadsheet locally without committing the source or its results.

Desktop/mobile browser review and a Windows/Classic Outlook acceptance test remain required. The companion is not installed by deploying the website. Email is opened for manual review and sending; a download never counts as an opened or sent message.
