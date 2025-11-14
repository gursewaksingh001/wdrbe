#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v cdk >/dev/null; then
  echo "AWS CDK CLI not found. Install via npm install -g aws-cdk" >&2
  exit 1
fi

"$ROOT_DIR/scripts/build.sh"

cd "$ROOT_DIR/infra"

STAGE=${1:-dev}

if [[ "$STAGE" == "dev" ]]; then
  STACK="WdrbeStack-dev"
else
  STACK="WdrbeStack-$STAGE"
fi

echo "Deploying stack: $STACK"

npm run synth
npx cdk deploy "$STACK" --require-approval never --context stage="$STAGE"

