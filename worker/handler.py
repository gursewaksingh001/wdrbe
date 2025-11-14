"""Share Worker Lambda entry point."""
from __future__ import annotations

import json
import os
from typing import Any, Dict

from aws_lambda_powertools import Logger, Metrics, Tracer
from aws_lambda_powertools.metrics import MetricUnit
from aws_lambda_powertools.utilities.batch import BatchProcessor, EventType, process_partial_response
from aws_lambda_powertools.utilities.data_classes.sqs_event import SQSRecord

from services.activity_service import ActivityService
from services.dynamodb_service import DynamoDBService

logger = Logger(service="share-worker")
tracer = Tracer(service="share-worker")
metrics = Metrics(namespace="Wdrbe", service="ShareWorker")
processor = BatchProcessor(event_type=EventType.SQS)

table_name = os.environ.get("TABLE_NAME")
if not table_name:
    raise RuntimeError("TABLE_NAME environment variable is required")

dynamodb_service = DynamoDBService(table_name)
activity_service = ActivityService(dynamodb_service)


@tracer.capture_method
def _process_record(record: SQSRecord) -> Dict[str, Any]:
    payload = json.loads(record.body or "{}")
    logger.append_keys(itemId=payload.get("itemId"), userId=payload.get("userId"))

    required = ["itemId", "userId", "timestamp", "requestId"]
    missing = [field for field in required if not payload.get(field)]
    if missing:
        metrics.add_metric("ValidationErrors", unit=MetricUnit.COUNT, value=1)
        logger.warning("Share event missing required fields", missing=missing)
        raise ValueError(f"Missing required fields: {', '.join(missing)}")

    item = dynamodb_service.get_item(payload["itemId"])
    if item is None:
        metrics.add_metric("ItemNotFound", unit=MetricUnit.COUNT, value=1)
        logger.warning("Item not found for share event")
        return {"status": "skipped"}

    dynamodb_service.increment_share_count(payload["itemId"], payload["userId"])
    activity_service.create_share_activity(
        user_id=payload["userId"],
        item_id=payload["itemId"],
        item_name=item.get("Name"),
        shared_at=payload["timestamp"],
        request_id=payload["requestId"],
    )

    metrics.add_metric("ShareEventsProcessed", unit=MetricUnit.COUNT, value=1)
    logger.info("Processed share event", requestId=payload["requestId"])
    return {"status": "processed"}


@tracer.capture_lambda_handler
@logger.inject_lambda_context(log_event=True)
@metrics.log_metrics(capture_cold_start_metric=True)
def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    batch_response = process_partial_response(
        event=event,
        record_handler=_process_record,
        processor=processor,
        context=context,
    )

    total = len(event.get("Records", []))
    failed = len(batch_response.get("batchItemFailures", []))
    metrics.add_metric("BatchSize", unit=MetricUnit.COUNT, value=total)
    metrics.add_metric("FailedRecords", unit=MetricUnit.COUNT, value=failed)
    metrics.add_metric("SuccessfulRecords", unit=MetricUnit.COUNT, value=total - failed)

    logger.info("Batch processed", totalRecords=total, failedRecords=failed)
    return batch_response

