# Operability Notes

## Alerts
- **Sync API Lambda errors** (`wdrbe-<stage>-sync-api-errors`)
  - Triggers when errors ≥5 in 5 minutes
  - Action: investigate CloudWatch logs, X-Ray traces
- **Share Worker Lambda errors** (`wdrbe-<stage>-share-worker-errors`)
  - Threshold: ≥3 errors in 5 minutes
  - Action: check DLQ, payload validity, DynamoDB throttling
- **DLQ backlog** (`wdrbe-<stage>-dlq-messages`)
  - Fires when DLQ has ≥1 visible messages
  - Action: inspect DLQ message bodies, replay after fix
- **API Gateway 5xx** (`wdrbe-<stage>-api-5xx`)
  - Threshold: ≥5 server errors in 5 minutes
  - Action: correlate with Lambda errors, review recent deploys

## Logs & Tracing
- Structured JSON logs via AWS Powertools (`requestId`, `userId`, `itemId` context)
- X-Ray tracing enabled on API Gateway and both Lambdas
- Logs retained for 7 days (configurable per environment)

## Metrics
- `ItemCreated`, `ItemCreatedIdempotent`, `ItemsListed`
- `ShareEventsEnqueued`, `ShareEventsProcessed`, `ValidationErrors`, `ItemNotFound`
- Batch metrics: `BatchSize`, `FailedRecords`, `SuccessfulRecords`

## Runbooks
1. **Share failures**
   - Check DLQ alarm → inspect DLQ message
   - Review worker logs for `ValidationErrors`
   - Reprocess by moving message back to main queue after fix
2. **API 5xx spike**
   - Filter Sync API logs by `requestId`
   - Check DynamoDB for throttling or IAM errors
   - Roll back recent release if persistent
3. **JWT auth issues**
   - Validate SSM parameter `/wdrbe-<stage>/jwt-secret`
   - Ensure tokens include correct `sub`

## Deployment Safety
- CDK synth executed on each PR
- Git tags trigger production deploys (requires `AWS_PROD_ROLE_ARN`)
- Rollback: redeploy previous tag or run `npx cdk deploy --previous` from `infra`
