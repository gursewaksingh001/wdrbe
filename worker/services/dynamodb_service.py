"""DynamoDB access layer for the share worker."""
from __future__ import annotations

from typing import Any, Dict, Optional

import boto3
from aws_lambda_powertools import Logger

logger = Logger(child=True)


class DynamoDBService:
    """Encapsulates DynamoDB interactions."""

    def __init__(self, table_name: str) -> None:
        self.table_name = table_name
        self._resource = boto3.resource("dynamodb")
        self._table = self._resource.Table(table_name)

    def get_item(self, item_id: str) -> Optional[Dict[str, Any]]:
        response = self._table.get_item(Key={"PK": f"ITEM#{item_id}", "SK": "METADATA"})
        item = response.get("Item")
        if not item:
            return None
        logger.debug("Fetched item", itemId=item_id)
        return item

    def increment_share_count(self, item_id: str, user_id: str) -> None:
        logger.debug("Incrementing share count", itemId=item_id, userId=user_id)
        self._table.update_item(
            Key={"PK": f"ITEM#{item_id}", "SK": "METADATA"},
            ConditionExpression="UserId = :userId",
            UpdateExpression="SET SharedCount = if_not_exists(SharedCount, :zero) + :inc, "
            "IsPublic = :isPublic, UpdatedAt = :updated",
            ExpressionAttributeValues={
                ":userId": user_id,
                ":zero": 0,
                ":inc": 1,
                ":isPublic": True,
                ":updated": _timestamp(),
            },
        )

    def put_activity(self, item: Dict[str, Any]) -> None:
        logger.debug("Writing activity", activityId=item.get("SK"))
        self._table.put_item(Item=item)


def _timestamp() -> str:
    from datetime import datetime

    return datetime.utcnow().isoformat()

