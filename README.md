# Wdrbe Wardrobe Items Service

A lightweight, AWS-first backend slice that powers Wardrobe Items management and sharing. The MVP pairs a Sync API (C# .NET Lambda) with an async Share Worker (Python Lambda) stitched together with CDK infrastructure and CI/CD.

```
Clients ─▶ API Gateway ─▶ Lambda (.NET) ─▶ DynamoDB
                      \
                       └─▶ SQS ─▶ Lambda (Python) ─▶ DynamoDB (Activity)
```

---

## Repository Layout

```
.
├── README.md
├── infra/               # AWS CDK stack (TypeScript)
├── api/                 # .NET 8 Lambda (Sync API)
├── worker/              # Python 3.12 Lambda (Share Worker)
├── workflows/           # CI/CD workflow definitions (mirrored to .github/workflows)
└── .github/workflows/   # GitHub Actions (CI, deploy)
```

Key directories:
- `infra/` provisions API Gateway, Lambdas, SQS, DynamoDB, IAM, and CloudWatch alarms.
- `api/` exposes REST endpoints for items (create/list/share) with idempotency, validation, pagination.
- `worker/` processes share events from SQS, updates items, writes activity feed entries.
- `workflows/` documents the CI/CD pipelines (duplicate of live YAML under `.github/workflows`).

---

## Quick Start

### Prerequisites
- Node.js 18+
- .NET SDK 8.0
- Python 3.12+
- AWS CLI (configured)
- AWS CDK CLI (`npm install -g aws-cdk`)

### 1. Install Dependencies
```bash
# Infrastructure
cd infra
npm install

# .NET Sync API
cd ../api
 dotnet restore

# Python worker
cd ../worker
pip install -r requirements.txt -t .venv
```

### 2. Build & Package
```bash
# From repo root
./scripts/build.sh   # Linux/macOS
# or
powershell -ExecutionPolicy Bypass -File scripts\build.ps1
```

### 3. Deploy
```bash
# Deploy dev stack
aws sts get-caller-identity  # sanity check creds
cd infra
cdk bootstrap                # first time only
cdk deploy                   # deploy to default env
```

For production, tag a release (see CI/CD section). Outputs include API endpoint, table name, and queue URL.

---

## API Reference

All endpoints require a JWT Bearer token (`Authorization: Bearer <token>`). The token `sub` must match the `{userId}` path parameter.

### POST `/users/{userId}/items`
Create or upsert an item with idempotency support.

Request:
```json
{
  "itemId": "itm_123",
  "name": "Navy Blazer",
  "category": "outerwear",
  "season": "autumn",
  "color": "navy",
  "idempotencyKey": "req-123"
}
```

Response `201`:
```json
{
  "itemId": "itm_123",
  "userId": "usr_abc",
  "name": "Navy Blazer",
  "category": "outerwear",
  "season": "autumn",
  "sharedCount": 0,
  "createdAt": "2025-11-05T10:00:00Z"
}
```

Idempotent repeat returns `200` with same payload.

### GET `/users/{userId}/items?season=&category=&limit=&cursor=`
List items with filters and pagination.

```bash
curl "$API_URL/users/usr_abc/items?season=autumn&limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

Response:
```json
{
  "items": [ ... ],
  "nextCursor": "eyJQSyI6IlVTRSN1c3JfYWJjIiwiU0siOiJJVEVNIzAx" ,
  "hasMore": true
}
```

`nextCursor` can be supplied to the next request as `cursor`.

### POST `/items/{itemId}/share`
Queues a share event for async processing.

```bash
curl -X POST "$API_URL/items/itm_123/share" \
  -H "Authorization: Bearer $TOKEN"
```

Response `202`:
```json
{
  "itemId": "itm_123",
  "status": "queued",
  "eventId": "req-xyz"
}
```

---

## Share Event Payload

SQS message produced by the Sync API:
```json
{
  "type": "SHARE_ITEM",
  "userId": "usr_abc",
  "itemId": "itm_123",
  "timestamp": "2025-11-05T10:00:00Z",
  "requestId": "req-xyz"
}
```

The worker updates `SharedCount`, marks the item public, and appends an activity record.

---

## CI/CD Workflows

Workflows live in `.github/workflows/` (mirrored in `workflows/`):

1. **CI (pull_request)**
   - `dotnet restore/build/test` for the Sync API
   - `ruff` lint + `pytest` for the worker
   - `cdk synth` (plan) to validate infrastructure

2. **Deploy Dev (pull_request → main)**
   - Optional manual approval to `cdk deploy` into dev

3. **Deploy Prod (tag push)**
   - On semver tag (`v*`), builds artifacts and deploys to prod via `cdk deploy --context stage=prod`

See `workflows/CI.md` for details.

---

## Infrastructure Notes

- **API Gateway** REST API with request validation and throttling
- **Lambdas** on ARM64 to reduce cost (512MB Sync API, 256MB Share Worker)
- **DynamoDB** single-table design with GSI for filters and idempotency tracking
- **SQS + DLQ** for share events with partial failure handling
- **CloudWatch Alarms**: Lambda errors, DLQ spikes, API 5xx
- **Metrics**: Custom business metrics via Powertools (items created, shares processed)

Synth/plan outputs captured in `infra/PLAN.md`.

---

## Operability

- Structured JSON logs via AWS Powertools (traceable with `requestId`)
- X-Ray tracing on both lambdas and API Gateway
- CloudWatch metrics: `ItemCreated`, `ShareEventsProcessed`, `UnhandledErrors`
- Alarms dispatch to SNS (placeholder) for error spikes / DLQ backlog
- Deployment scripts (`scripts/`) for build, deploy, and cleanup

---

## Acceptance Checklist

- ✅ Idempotent item creation (via idempotency key + DynamoDB record)
- ✅ Filtered, paginated listing (season/category + cursor)
- ✅ Share flow: API → SQS → Worker → DynamoDB updates
- ✅ Structured logs & metrics using AWS Powertools
- ✅ Minimal, production-shaped IaC (CDK synth verified)

---

## Local Testing

```bash
# .NET unit tests
cd api
dotnet test

# Python lint + tests
cd ../worker
ruff check .
pytest

# cdk synth
cd ../infra
npm run build
cdk synth
```

---

## License

MIT
