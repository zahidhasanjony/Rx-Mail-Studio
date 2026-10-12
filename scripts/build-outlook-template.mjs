// Run in a temporary directory linked to CODEX_PRIMARY_RUNTIME_NODE_MODULES.
import fs from 'node:fs/promises';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const output = process.argv[2];
const workbook = Workbook.create();
const emails = workbook.worksheets.add('Emails');
const bodies = workbook.worksheets.add('Email bodies');
emails.showGridLines = false;
bodies.showGridLines = false;
emails.getRange('A1:K12').format.font = { name: 'Arial', size: 10, color: '#18263B' };
emails.getRange('A1:K12').format.rowHeight = 24;
emails.getRange('A2:G2').merge();
emails.getRange('A2').values = [['Rx Mail Studio - Outlook emails']];
emails.getRange('A2').format.font = { name: 'Arial', size: 16, bold: true, color: '#17365D' };
emails.getRange('A3:G3').merge();
emails.getRange('A3').values = [['Prepared batch']];
const instructions = [
  'Open this workbook in Excel for Windows. Use macros only if your MIS permits them.',
  'Classic Outlook is required. The button opens editable emails with To, CC and the formatted body.',
  'Click again to retry remaining rows. Save this workbook to keep opening status after closing Excel.',
  'Review and send manually. Outlook may autosave open emails. Downloads do not change app history.',
];
for (let i = 0; i < instructions.length; i++) {
  emails.getRange(`A${i + 4}:G${i + 4}`).merge();
  emails.getRange(`A${i + 4}`).values = [[instructions[i]]];
}
emails.getRange('A10:K10').values = [['#', 'Region', 'To', 'CC', 'Subject', 'Status', 'Details', 'Mail ID', 'Body start', 'Body parts', 'Body length']];
emails.getRange('A10:K10').format = { fill: '#17365D', font: { name: 'Arial', size: 10, bold: true, color: '#FFFFFF' }, rowHeight: 28 };
emails.getRange('A11:K11').values = [[1, 'ACD A1', 'rse@example.com', 'boss@example.com; team@example.com', "Ketotifen (Tofen) Prescriber List of A1 Region for July'26", 'Prepared', '', 'template-mail', 2, 1, 29]];
emails.getRange('A11:K12').format.wrapText = true;
emails.getRange('A11:K12').format.verticalAlignment = 'top';
emails.getRange('A11:K12').format.rowHeight = 48;
for (const [col, width] of [['A', 5], ['B', 12], ['C', 28], ['D', 42], ['E', 64], ['F', 13], ['G', 44], ['H', 18], ['I', 12], ['J', 12], ['K', 12]]) emails.getRange(`${col}1:${col}12`).format.columnWidth = width;
emails.freezePanes.freezeRows(10);
bodies.getRange('A1:C2').values = [['Mail ID', 'Part', 'HTML body chunk'], ['template-mail', 1, '<html><body>Mail</body></html>']];
bodies.getRange('A1:C2').format.font = { name: 'Arial', size: 10 };
bodies.getRange('A1:C2').format.columnWidth = 28;
bodies.getRange('C1:C2').format.columnWidth = 90;
bodies.getRange('A1:C1').format = { fill: '#17365D', font: { bold: true, color: '#FFFFFF' } };
workbook.recalculate();
console.log((await workbook.inspect({ kind: 'table', range: 'Emails!A10:G11', maxChars: 1800, tableMaxCols: 7 })).ndjson);
await fs.writeFile(output.replace(/\.xlsx$/, '.png'), new Uint8Array(await (await workbook.render({ sheetName: 'Emails', range: 'A1:G12', scale: 1, format: 'png' })).arrayBuffer()));
await (await SpreadsheetFile.exportXlsx(workbook)).save(output);
