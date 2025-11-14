Param(
  [string]$Stage = "dev"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Join-Path $root ".."

if (-not (Get-Command cdk -ErrorAction SilentlyContinue)) {
  Write-Error "AWS CDK CLI not found. Install via npm install -g aws-cdk"
}

& "$root\scripts\build.ps1"

Set-Location "$root\infra"

$stack = "WdrbeStack-$Stage"

Write-Host "Deploying stack: $stack" -ForegroundColor Cyan
npm run synth | Out-Null
npx cdk deploy $stack --require-approval never --context stage=$Stage

