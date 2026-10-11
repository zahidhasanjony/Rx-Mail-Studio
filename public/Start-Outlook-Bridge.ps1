param([string]$ConfigPath = (Join-Path $PSScriptRoot 'bridge-config.json'))
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 47851)
$opened = @{}
$journalPath = Join-Path $PSScriptRoot 'opened-messages.json'
if (Test-Path -LiteralPath $journalPath) {
  $existing = Get-Content -LiteralPath $journalPath -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($key in $existing) { $opened[[string]$key] = $true }
}
function Write-Response($stream, $status, $body, $includeCors) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
  $headers = "HTTP/1.1 $status`r`nContent-Type: application/json; charset=utf-8`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`nCache-Control: no-store`r`n"
  if ($includeCors) {
    $headers += "Access-Control-Allow-Origin: $($config.origin)`r`nAccess-Control-Allow-Methods: GET, POST, OPTIONS`r`nAccess-Control-Allow-Headers: Authorization, Content-Type`r`nAccess-Control-Allow-Private-Network: true`r`nVary: Origin`r`n"
  }
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers + "`r`n")
  $stream.Write($headerBytes,0,$headerBytes.Length)
  $stream.Write($bytes,0,$bytes.Length)
  $stream.Flush()
}
try {
 $listener.Start()
 Write-Host 'Rx Mail Studio Outlook bridge is running on this PC.'
 Write-Host ('Allowed app: ' + $config.origin)
 Write-Host 'Keep this window running. Close it to disconnect the app.'
 while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
   $stream = $client.GetStream()
   $stream.ReadTimeout = 10000
   $buffer = [System.Collections.Generic.List[byte]]::new()
   while ($true) {
    $b = $stream.ReadByte()
    if ($b -lt 0) { throw 'Incomplete HTTP request' }
    $buffer.Add([byte]$b)
    $n = $buffer.Count
    if ($n -ge 4 -and $buffer[$n-4] -eq 13 -and $buffer[$n-3] -eq 10 -and $buffer[$n-2] -eq 13 -and $buffer[$n-1] -eq 10) { break }
    if ($n -gt 16384) { throw 'Headers too large' }
   }
   $lines = [System.Text.Encoding]::ASCII.GetString($buffer.ToArray()).Split([string[]]@("`r`n"),[System.StringSplitOptions]::None)
   $request = $lines[0].Split(' ')
   $headers = @{}
   foreach ($line in $lines[1..($lines.Length-1)]) { $colon = $line.IndexOf(':'); if ($colon -gt 0) { $headers[$line.Substring(0,$colon).ToLowerInvariant()] = $line.Substring($colon+1).Trim() } }
   if ($headers['origin'] -cne $config.origin) { Write-Response $stream '403 Forbidden' '{"error":"Origin denied"}' $false; continue }
   if ($request[0] -eq 'OPTIONS') { Write-Response $stream '200 OK' '{}' $true; continue }
   if ($headers['authorization'] -cne ('Bearer ' + $config.token)) { Write-Response $stream '401 Unauthorized' '{"error":"Pairing token denied"}' $true; continue }
   if ($request[0] -eq 'GET' -and $request[1] -eq '/health') { Write-Response $stream '200 OK' '{"ready":true,"version":1}' $true; continue }
   if ($request[0] -ne 'POST' -or $request[1] -ne '/open') { Write-Response $stream '404 Not Found' '{}' $true; continue }
   $length = 0
   if (-not [int]::TryParse([string]$headers['content-length'],[ref]$length) -or $length -lt 1 -or $length -gt 50000000) { throw 'Invalid message size' }
   $body = New-Object byte[] $length
   $read = 0
   while ($read -lt $length) { $count = $stream.Read($body,$read,$length-$read); if ($count -le 0) { throw 'Incomplete message body' }; $read += $count }
   $batch = [System.Text.Encoding]::UTF8.GetString($body) | ConvertFrom-Json
   if ($batch.schemaVersion -ne 1 -or -not $batch.batchId -or $batch.mails.Count -gt 500 -or $batch.mails.Count -eq 0) { throw 'Invalid batch' }
   $outlook = New-Object -ComObject Outlook.Application
   $results = @()
   foreach ($mail in $batch.mails) {
    $messageKey = [string]$batch.batchId + ':' + [string]$mail.id
    try {
     if ($opened.ContainsKey($messageKey)) { $results += @{id=$mail.id;status='Opened'}; continue }
     if ([string]$mail.to -notmatch '^[^\s@;,<>]+@[^\s@;,<>]+\.[^\s@;,<>]+$') { throw 'Invalid To address' }
     foreach ($address in $mail.cc) { if ([string]$address -notmatch '^[^\s@;,<>]+@[^\s@;,<>]+\.[^\s@;,<>]+$') { throw 'Invalid CC address' } }
     $item = $outlook.CreateItem(0)
     $recipient = $item.Recipients.Add([string]$mail.to); $recipient.Type = 1
     foreach ($address in $mail.cc) { $recipient = $item.Recipients.Add([string]$address); $recipient.Type = 2 }
     if (-not $item.Recipients.ResolveAll()) { throw 'Outlook could not resolve a recipient' }
     $item.Subject = [string]$mail.subject
     $item.BodyFormat = 2
     $item.HTMLBody = [string]$mail.html
     $item.Display($false)
     $opened[$messageKey] = $true
     @($opened.Keys) | ConvertTo-Json | Set-Content -LiteralPath $journalPath -Encoding UTF8
     $results += @{id=$mail.id;status='Opened'}
     Start-Sleep -Milliseconds 150
    } catch { $results += @{id=$mail.id;status='Failed';error=$_.Exception.Message} }
   }
   $result = @{schemaVersion=1;batchId=$batch.batchId;results=$results}
   $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'outlook-results.json') -Encoding UTF8
   Write-Response $stream '200 OK' ($result | ConvertTo-Json -Depth 6 -Compress) $true
  } catch {
   try { Write-Response $stream '400 Bad Request' (@{error=$_.Exception.Message} | ConvertTo-Json -Compress) $true } catch {}
   Write-Host ('Request failed: ' + $_.Exception.Message) -ForegroundColor Yellow
  } finally { $client.Close() }
 }
} catch { Write-Host ('Bridge stopped: ' + $_.Exception.Message) -ForegroundColor Red; Read-Host 'Press Enter to close' }
finally { $listener.Stop() }
