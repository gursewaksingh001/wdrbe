"""Activity feed operations."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Dict, Optional

from aws_lambda_powertools import Logger

from .dynamodb_service import DynamoDBService

logger = Logger(child=True)


class ActivityService:
    """Creates activity records for user feed."""

    def __init__(self, dynamodb_service: DynamoDBService) -> None:
        self._dynamodb = dynamodb_service

    def create_share_activity(
        self,
        *,
        user_id: str,
        item_id: str,
        item_name: Optional[str],
        shared_at: str,
        request_id: str,
    ) -> str:
        activity_id = str(uuid.uuid4())
        item: Dict[str, Any] = {
            "PK": f"USER#{user_id}",
            "SK": f"ACTIVITY#{activity_id}",
            "ActivityType": "ItemShared",
            "ItemId": item_id,
            "Timestamp": shared_at,
            "CreatedAt": datetime.utcnow().isoformat(),
            "EntityType": "Activity",
            "Metadata": {
                "action": "share",
                "requestId": request_id,
            },
        }

        if item_name:
            item["ItemName"] = item_name

        self._dynamodb.put_activity(item)
        logger.info("Activity record created", activityId=activity_id)
        return activity_id

