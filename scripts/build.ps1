Param()

$ErrorActionPreference = "Stop"

Write-Host "`n=== Building Wdrbe backend ===" -ForegroundColor Cyan

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Join-Path $root ".."

Write-Host "`n[1/4] Building infrastructure (TypeScript/CDK)" -ForegroundColor Yellow
Set-Location "$root\infra"
npm install | Out-Null
npm run build

Write-Host "`n[2/4] Restoring .NET dependencies" -ForegroundColor Yellow
Set-Location "$root\api"
dotnet restore

Write-Host "`n[3/4] Publishing Sync API Lambda" -ForegroundColor Yellow
dotnet publish --configuration Release --output "bin\Release\net8.0\publish"

Write-Host "`n[4/4] Preparing Python worker bundle" -ForegroundColor Yellow
Set-Location "$root\worker"
python -m pip install --upgrade pip | Out-Null
pip install -r requirements.txt -t package

Write-Host "`nBuild complete. Artifacts ready for CDK deploy." -ForegroundColor Green

