import { zipSync, strToU8 } from "fflate";
import type { Batch } from "./types";
export function download(
  content: BlobPart,
  name: string,
  type = "application/octet-stream",
) {
  const u = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 30000);
}
export function outlookPackage(batch: Batch) {
  const data = {
    schemaVersion: 1,
    batchId: batch.id,
    mails: batch.mails.map((m) => ({
      id: m.id,
      to: m.to.email,
      cc: m.cc.map((c) => c.email),
      subject: m.subject,
      html: m.html,
    })),
  };
  const script = `param([string]$BatchPath = (Join-Path $PSScriptRoot 'batch.rxmail.json'))
$ErrorActionPreference = 'Stop'
try {
  $batch = Get-Content -LiteralPath $BatchPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($batch.schemaVersion -ne 1) { throw 'Unsupported batch format' }
  $outlook = New-Object -ComObject Outlook.Application
  $results = @()
  foreach ($mail in $batch.mails) {
    try {
      $item = $outlook.CreateItem(0)
      $to = $item.Recipients.Add([string]$mail.to)
      $to.Type = 1
      foreach ($address in $mail.cc) { $recipient = $item.Recipients.Add([string]$address); $recipient.Type = 2 }
      if (-not $item.Recipients.ResolveAll()) { throw 'Outlook could not resolve a recipient. This message was not opened.' }
      $item.Subject = [string]$mail.subject
      $item.BodyFormat = 2
      $item.HTMLBody = [string]$mail.html
      $item.Display($false)
      $results += @{ id = $mail.id; status = 'Opened' }
      Start-Sleep -Milliseconds 150
    } catch { $results += @{ id = $mail.id; status = 'Failed'; error = $_.Exception.Message } }
  }
  @{ schemaVersion = 1; batchId = $batch.batchId; results = $results } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'outlook-results.json') -Encoding UTF8
  Write-Host 'Finished. Import outlook-results.json into Rx Mail Studio to update opening status.'
  Write-Host 'Review and send each message in Outlook. This launcher only displays messages.'
} catch { Write-Host ('Unable to open Classic Outlook: ' + $_.Exception.Message) -ForegroundColor Red; Write-Host 'This requires Windows and Microsoft Classic Outlook, not New Outlook.' }
Read-Host 'Press Enter to close'
`;
  const readme = `Rx Mail Studio — Outlook launcher\r\n\r\n1. Extract this ZIP into a folder on your Windows PC.\r\n2. Double-click Open-Outlook.cmd with Classic Outlook installed and your account configured.\r\n3. All prepared emails open as editable Outlook compose windows. Review and send them manually.\r\n4. Upload outlook-results.json on the History page to record the real opening results.\r\n\r\nThis launcher never calls Save or Send. Outlook itself may autosave open messages according to your Outlook settings. New Outlook and mobile Outlook do not support this Windows COM launcher.\r\nKeep this package private: it contains your recipients and prescriber tables.\r\n`;
  return zipSync({
    "batch.rxmail.json": strToU8(JSON.stringify(data)),
    "Open-Outlook.ps1": strToU8(script),
    "Open-Outlook.cmd": strToU8(
      '@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Open-Outlook.ps1"\r\n',
    ),
    "README.txt": strToU8(readme),
  });
}
