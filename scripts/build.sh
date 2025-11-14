#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

printf '\n=== Building Wdrbe backend ===\n'

printf '\n[1/4] Building infrastructure (TypeScript/CDK)\n'
cd "$ROOT_DIR/infra"
npm install
npm run build

printf '\n[2/4] Restoring .NET dependencies\n'
cd "$ROOT_DIR/api"
dotnet restore

printf '\n[3/4] Publishing Sync API Lambda\n'
dotnet publish --configuration Release --output bin/Release/net8.0/publish

printf '\n[4/4] Preparing Python worker bundle\n'
cd "$ROOT_DIR/worker"
python -m pip install --upgrade pip >/dev/null
pip install -r requirements.txt -t package

printf '\nBuild complete. Artifacts ready for CDK deploy.\n'

