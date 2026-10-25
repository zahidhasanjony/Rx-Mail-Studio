# Native prescription analytics

The Dashboard now contains Rx dashboard, Specialty & productivity, Field force,
and Doctor targeting pages. All controls, tables and charts are native React and
CSS. No external dashboards, iframe charts, or new runtime dependencies are used.

## Shared scope

Single month/month range, dosage form, strength, specialty and ACD/CCD territory
filters carry through drill-downs and browser history. Saved filter presets and
doctor follow-up notes are scoped to the current account and device. They do not
alter source files and are not synchronized between devices.

The current summary RPC still renders the initial overview. Detailed analytics
load independently, in cursor-paginated batches of 12 source chunks, cancellable
when changing the period or leaving the dashboard. Only complete detailed results
are shown. One account/period/source-version cache avoids repeated downloads.
Monthly doctor/product aggregates omit source-row arrays and retain daily counts
for equivalent-day comparisons. Large month ranges still require reading all
selected cloud records; there is no server analytics index in this release.

## Counts and denominators

- Rx means product occurrences, matching existing reports. It is not the number
  of unique prescription slips. Overall counts never add ACD and CCD together.
- Each structure KPI uses records with a non-empty RSE assignment in that
  structure. ACD and CCD can legitimately have the same share when their
  eligible populations are identical.
- Top prescribers default to generic volume. Brand selection changes ordering
  and inclusion, but the selected Beximco brand's share keeps the full generic
  market denominator, respecting the active route/form/strength filters.
- Specialty Rx/doctor includes every observed doctor in that specialty, even if
  they never prescribed the selected product. SFE ID deduplicates doctors; their
  latest recorded specialty within the period and territory determines the
  specialty denominator and attribution. Product filters do not shrink it.
- Contribution percentages are specialty count / overall count. Productivity
  index is Rx contribution percentage / doctor contribution percentage.
  Specialty filtering changes displayed rows without rebasing the benchmark.
- Zero denominators return N/A. A known denominator with no brand Rx shows zero.
- Equivalent-period comparison uses common day numbers observed in both months,
  within the selected specialty/territory before product filters. Missing days
  are excluded from both sides. Share differences are percentage points.
- Doctor targeting ranks zero brand Rx, low brand share (below 50%), then
  declining observed share. Minimum generic Rx defaults to five and is editable.
  Declining-share flags explicitly require checking period completeness.
  Recommendations respect catalog forms and known strength variants. Unknown
  strength information is flagged for field verification rather than inferred.

## Import compatibility

New imports retain strength, product variants and a composite prescription key
when its source columns are present. `analyticsVersion: 1` changes only enriched
source identity, allowing a verified replacement of an older import from the
same workbook. A second enriched import is still detected as a duplicate.
The existing resumable-upload protocol remains compatible with queued jobs.

Old imports remain readable. Missing strength displays as Not specified. Re-import
the original workbook through Admin panel → Source files to recover strength.
Existing overlap detection and complete-source replacement checks remain active;
do not manually sum cumulative phase files.

Doctor profiles intentionally omit degrees, institute/chamber and addresses.
FF codes come from source records. RSE names are shown when available in the
effective hierarchy; missing MPE/ASE names are not invented.

## Verification and rollback

Run `npm run build` then `npm test`. The suite covers existing login, admin-only
management, upload staging, resume/activation, TG classification, email rendering,
exports, database authorization, and the added analytic formulas and navigation.
The dashboards do not require a database migration or permission changes.
Reverting the client commit restores the previous UI. New optional import fields
are ignored by the previous client, so no source rollback is needed.
