# Share Worker Lambda (Python 3.12)

This is the async worker Lambda function that processes share events from SQS.

## Structure

```
ShareWorker/
├── services/
│   ├── __init__.py
│   ├── dynamodb_service.py   # DynamoDB operations
│   └── activity_service.py   # Activity feed logic
├── handler.py                # Lambda entry point
└── requirements.txt          # Python dependencies
```

## Functionality

The Share Worker:
1. Receives share events from SQS
2. Updates the item's shared count
3. Marks the item as public
4. Creates an activity feed entry
5. Reports batch processing results

## Event Flow

```
SQS Message → Lambda Trigger → Process Event → Update DynamoDB
                                      ↓
                                 Create Activity
```

## SQS Message Format

```json
{
  "itemId": "01JCWXYZ...",
  "userId": "user123",
  "sharedAt": "2025-11-13T10:30:00Z",
  "eventId": "550e8400-e29b-41d4-a716-446655440000"
}
```

## Development

### Prerequisites

- Python 3.12+
- pip

### Install Dependencies

```bash
pip install -r requirements.txt
```

### Local Testing

Create a test event file `test-event.json`:

```json
{
  "Records": [
    {
      "messageId": "test-123",
      "receiptHandle": "test-handle",
      "body": "{\"itemId\":\"test-item\",\"userId\":\"user123\",\"sharedAt\":\"2025-11-13T10:30:00Z\",\"eventId\":\"test-event\"}",
      "attributes": {
        "ApproximateReceiveCount": "1",
        "SentTimestamp": "1699876543000",
        "SenderId": "test-sender",
        "ApproximateFirstReceiveTimestamp": "1699876543000"
      },
      "messageAttributes": {},
      "md5OfBody": "test-md5",
      "eventSource": "aws:sqs",
      "eventSourceARN": "arn:aws:sqs:us-east-1:123456789012:test-queue",
      "awsRegion": "us-east-1"
    }
  ]
}
```

Test locally:

```python
import json
from handler import lambda_handler

with open('test-event.json') as f:
    event = json.load(f)

result = lambda_handler(event, None)
print(json.dumps(result, indent=2))
```

Or use AWS SAM:

```bash
sam local invoke ShareWorkerLambda -e test-event.json
```

## Environment Variables

Required:
- `TABLE_NAME` - DynamoDB table name

Optional:
- `POWERTOOLS_SERVICE_NAME` - Service name for logging
- `POWERTOOLS_LOG_LEVEL` - Log level (INFO, DEBUG, ERROR)

## Dependencies

Key packages:
- `boto3` - AWS SDK for Python
- `aws-lambda-powertools` - Logging, tracing, metrics, batch processing

## Architecture Patterns

### Service Layer

Business logic separated into services:

```python
# DynamoDB operations
dynamodb_service = DynamoDBService(table_name)

# Activity management
activity_service = ActivityService(dynamodb_service)
```

### Batch Processing

Uses Lambda Powertools for batch processing with partial failure support:

```python
from aws_lambda_powertools.utilities.batch import (
    BatchProcessor,
    process_partial_response
)

processor = BatchProcessor(event_type=EventType.SQS)

def lambda_handler(event, context):
    return process_partial_response(
        event=event,
        record_handler=process_share_event,
        processor=processor,
        context=context
    )
```

Benefits:
- Individual message failures don't fail the entire batch
- Failed messages returned to queue for retry
- Successful messages deleted from queue

### Error Handling

```python
try:
    # Process event
    result = process_share_event(record)
except ValueError as e:
    # Validation errors - log and raise (message goes to DLQ)
    logger.error("Validation error", extra={"error": str(e)})
    raise
except Exception as e:
    # Unexpected errors - log and raise (message will retry)
    logger.error("Processing error", extra={"error": str(e)})
    raise
```

## DynamoDB Operations

### Get Item

```python
item = dynamodb_service.get_item(item_id)
```

### Update Shared Count

```python
dynamodb_service.update_item_shared_count(item_id, user_id)
```

This increments the `SharedCount`, sets `IsPublic=True`, and updates `UpdatedAt`.

### Create Activity

```python
activity_service.create_share_activity(
    user_id=user_id,
    item_id=item_id,
    item_name=item_name,
    shared_at=shared_at
)
```

## Observability

### Logging

Structured logging with context:

```python
from aws_lambda_powertools import Logger

logger = Logger(service="share-worker")

logger.info("Processing event", extra={
    "item_id": item_id,
    "user_id": user_id
})
```

Logs include:
- Lambda request ID
- Cold start indicator
- Function name
- Service name

### Metrics

Custom CloudWatch metrics:

```python
from aws_lambda_powertools import Metrics

metrics = Metrics(namespace="Wdrbe", service="ShareWorker")

metrics.add_metric(name="ShareEventsProcessed", unit="Count", value=1)
```

Available metrics:
- `ShareEventsProcessed` - Successful events
- `ItemNotFound` - Item doesn't exist
- `BatchSize` - Records per invocation
- `SuccessfulRecords` - Per-batch successes
- `FailedRecords` - Per-batch failures
- `ProcessingErrors` - Unexpected errors

### Tracing

X-Ray tracing enabled:

```python
from aws_lambda_powertools import Tracer

tracer = Tracer(service="share-worker")

@tracer.capture_method
def process_share_event(record):
    # Method is traced
    pass
```

## Error Scenarios

### Item Not Found

If the item doesn't exist:
1. Log warning
2. Increment `ItemNotFound` metric
3. Return success (don't retry)

```python
if not item:
    logger.warning("Item not found", extra={"item_id": item_id})
    metrics.add_metric(name="ItemNotFound", unit="Count", value=1)
    return {"status": "skipped", "reason": "Item not found"}
```

### Validation Error

If message is invalid:
1. Log error
2. Increment `ValidationErrors` metric
3. Raise exception (message goes to DLQ after retries)

### Processing Error

If DynamoDB update fails:
1. Log error
2. Increment `ProcessingErrors` metric
3. Raise exception (message will retry)

## Dead Letter Queue (DLQ)

Messages that fail 3 times go to DLQ:
- Invalid message format
- Missing required fields
- Repeated processing errors

Monitor DLQ:
```bash
aws sqs receive-message --queue-url <dlq-url>
```

CloudWatch alarm triggers when DLQ has messages.

## Performance Optimization

1. **Batch Size**: 10 messages per invocation (configurable)
2. **Batching Window**: 5 seconds (collects messages before invoking)
3. **Concurrency Limit**: 10 concurrent executions (cost control)
4. **ARM64 Architecture**: Better price/performance

## Testing

### Unit Tests

```python
import pytest
from services.dynamodb_service import DynamoDBService

def test_get_item(mocker):
    # Mock boto3
    mock_table = mocker.Mock()
    mock_table.get_item.return_value = {'Item': {'PK': 'ITEM#123'}}
    
    service = DynamoDBService('test-table')
    service.table = mock_table
    
    item = service.get_item('123')
    assert item['PK'] == 'ITEM#123'
```

### Integration Tests

```python
import json
from handler import lambda_handler

def test_lambda_handler():
    event = {
        "Records": [
            {
                "body": json.dumps({
                    "itemId": "test-item",
                    "userId": "user123",
                    "sharedAt": "2025-11-13T10:30:00Z",
                    "eventId": "test-event"
                })
            }
        ]
    }
    
    result = lambda_handler(event, None)
    assert "batchItemFailures" in result
```

## Common Tasks

### Adding a New Activity Type

1. Update `ActivityService.create_*_activity()`
2. Define activity structure
3. Update activity queries if needed

### Changing Batch Size

Update in CDK:

```typescript
shareWorkerLambda.addEventSource(
  new lambdaEventSources.SqsEventSource(shareEventQueue, {
    batchSize: 20,  // Change from 10
    maxBatchingWindow: Duration.seconds(10),
  })
);
```

### Adding Retry Logic

Configure visibility timeout and max receives:

```typescript
const shareEventQueue = new sqs.Queue(this, 'ShareEventQueue', {
  visibilityTimeout: Duration.seconds(300),
  deadLetterQueue: {
    queue: shareEventDLQ,
    maxReceiveCount: 5,  // Change from 3
  },
});
```

## Monitoring

### View Logs

```bash
aws logs tail /aws/lambda/wdrbe-share-worker --follow
```

### View Metrics

```bash
aws cloudwatch get-metric-statistics \
  --namespace Wdrbe \
  --metric-name ShareEventsProcessed \
  --start-time 2025-11-13T00:00:00Z \
  --end-time 2025-11-13T23:59:59Z \
  --period 3600 \
  --statistics Sum
```

### Check Queue Depth

```bash
aws sqs get-queue-attributes \
  --queue-url <queue-url> \
  --attribute-names ApproximateNumberOfMessages
```

## Troubleshooting

### High Error Rate

Check logs for common errors:
```bash
aws logs filter-pattern ERROR \
  --log-group-name /aws/lambda/wdrbe-share-worker \
  --start-time 1h
```

### Messages Stuck in Queue

Check visibility timeout and Lambda timeout:
- Visibility timeout should be 6x Lambda timeout
- Increase Lambda timeout if processing is slow

### Memory Issues

Python Lambda memory usage is usually low. If issues occur:
1. Check for memory leaks
2. Increase Lambda memory
3. Profile with memory_profiler

## References

- [AWS Lambda Python](https://docs.aws.amazon.com/lambda/latest/dg/lambda-python.html)
- [Boto3 Documentation](https://boto3.amazonaws.com/v1/documentation/api/latest/index.html)
- [Lambda Powertools Python](https://docs.powertools.aws.dev/lambda/python/)
- [SQS Batch Processing](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)

