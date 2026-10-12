# Outlook Excel template

The app populates `public/Outlook-Emails-Template-v1.xlsm` from the frozen prepared
batch. The template has an Emails sheet, a very hidden Email bodies sheet, and a
Forms button assigned to `OpenAllEmails` in the complete `RxMail.bas` module.
No automatic macro runs on workbook opening. VBA uses late-bound Classic Outlook
COM, displays messages, and never calls Save or Send. Body parts are validated
against the stable mail ID, part sequence and UTF-16 length before displaying.

The Excel opening statuses belong to this downloaded workbook. Save it to retain
them between Excel sessions. A new download starts a fresh opening session and
does not update the app's opening statuses.

To rebuild the checked-in template:

1. Create a writable temporary directory and symlink its `node_modules` to
   `CODEX_PRIMARY_RUNTIME_NODE_MODULES`.
2. Copy `scripts/build-outlook-template.mjs` there, run it with
   `CODEX_PRIMARY_RUNTIME_NODE`, and supply the temporary `.xlsx` output path.
   It authors the worksheet layout with `@oai/artifact-tool` and renders a preview.
3. Run `python scripts/build-outlook-vba.py assets/outlook/project-metadata.json
   assets/outlook/RxMail.bas /tmp/vbaProject.bin`.
4. Run `node scripts/package-outlook-template.mjs /tmp/outlook-template.xlsx
   /tmp/vbaProject.bin public/Outlook-Emails-Template-v1.xlsm`.
5. Run `npm run build` and `npm test`.

`project-metadata.json` contains only Office-produced project information, VBA/
Excel typelib references and unprotected-project flags from the BSD-licensed
XlsxWriter example. None of the original macro code or compiled caches is retained.
The project uses MS-OVBA source-only module streams, zero MODULEOFFSET values,
and `_VBA_PROJECT.Version = 0xFFFF` so Office compiles the visible source.

References:
- https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ovba/
- https://learn.microsoft.com/en-us/office/vba/api/outlook.mailitem.display
- https://github.com/jmcnamara/XlsxWriter/blob/main/examples/vbaProject.bin

Automated verification covers the workbook package, VBA source extraction,
button linkage, recipient order, Unicode, long-body reconstruction, 76-message
batches, failure handling contracts, and the built app download flow.
Opening the windows itself must be tested on Windows with Excel, permitted VBA
macros, a configured Classic Outlook account, and the user's MIS policies.
