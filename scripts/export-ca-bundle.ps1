# Exports trusted Root + Intermediate CA certificates from the Windows
# certificate store into a single PEM bundle. This lets Node/npm verify TLS
# connections that are intercepted by a corporate proxy or antivirus whose
# CA is already trusted by the operating system.
param(
  [string]$OutFile = "$PSScriptRoot\..\certs\ca-bundle.pem"
)

$dir = Split-Path -Parent $OutFile
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

$stores = @(
  'Cert:\LocalMachine\Root',
  'Cert:\LocalMachine\CA',
  'Cert:\CurrentUser\Root',
  'Cert:\CurrentUser\CA'
)

$sb = New-Object System.Text.StringBuilder
$count = 0
foreach ($store in $stores) {
  if (-not (Test-Path $store)) { continue }
  Get-ChildItem $store -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $bytes = $_.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
      $b64 = [System.Convert]::ToBase64String($bytes, 'InsertLineBreaks')
      [void]$sb.AppendLine("# Subject: $($_.Subject)")
      [void]$sb.AppendLine('-----BEGIN CERTIFICATE-----')
      [void]$sb.AppendLine($b64)
      [void]$sb.AppendLine('-----END CERTIFICATE-----')
      $count++
    } catch {}
  }
}

Set-Content -Path $OutFile -Value $sb.ToString() -Encoding ascii
Write-Output "Exported $count certificates to $OutFile"
