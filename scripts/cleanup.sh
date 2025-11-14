#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE=${1:-dev}
STACK="WdrbeStack-$STAGE"

cd "$ROOT_DIR/infra"

echo "Destroying $STACK (this removes AWS resources)."
read -rp "Type 'destroy' to confirm: " confirm

if [[ "$confirm" != "destroy" ]]; then
  echo "Cancelled."
  exit 0
fi

npx cdk destroy "$STACK" --force --context stage="$STAGE"

