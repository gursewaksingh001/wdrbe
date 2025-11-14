#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${API_URL:-}" ]]; then
  echo "API_URL env var required" >&2
  exit 1
fi

USER_ID=${USER_ID:-usr_abc}
TOKEN=${TOKEN:-$(node "$(dirname "$0")"/generate-jwt.js "$USER_ID" | tail -n 1)}

printf '\nAPI URL: %s\n' "$API_URL"
printf 'User ID: %s\n' "$USER_ID"

payload='{ "itemId": "itm_123", "name": "Navy Blazer", "category": "outerwear", "season": "autumn", "idempotencyKey": "req-xyz" }'

echo "\nCreating item..."
create=$(curl -s -X POST "$API_URL/users/$USER_ID/items" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$payload")

echo "$create" | jq .

sleep 2

echo "\nListing items (season=autumn)..."
curl -s "$API_URL/users/$USER_ID/items?season=autumn&limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq .

echo "\nSharing item..."
share=$(curl -s -X POST "$API_URL/items/itm_123/share" \
  -H "Authorization: Bearer $TOKEN")

echo "$share" | jq .

