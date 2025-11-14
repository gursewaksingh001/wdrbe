# DynamoDB Data Model

This document describes the single-table design for the Wdrbe backend service.

## Table Overview

**Table Name**: `WardrobeTable`

**Keys**:
- Partition Key (PK): String
- Sort Key (SK): String

**Global Secondary Index (GSI1)**:
- GSI1PK: String (Partition Key)
- GSI1SK: String (Sort Key)
- Projection: ALL

**Configuration**:
- Billing: On-Demand
- Encryption: AWS Managed
- Point-in-Time Recovery: Enabled
- Streams: NEW_AND_OLD_IMAGES

## Entity Relationships

```
┌─────────────┐
│    User     │
└──────┬──────┘
       │ has many
       ▼
┌─────────────┐
│    Item     │
└──────┬──────┘
       │ generates
       ▼
┌─────────────┐
│  Activity   │
└─────────────┘
```

## Entity Definitions

### 1. Item (Main Record)

Stores the primary item data.

**Keys**:
```
PK: ITEM#{itemId}
SK: METADATA
```

**Attributes**:
| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| UserId | String | Yes | Owner of the item |
| Name | String | Yes | Item name (max 200 chars) |
| Category | String | Yes | Item category (max 100 chars) |
| Season | String | No | spring, summer, fall, winter, all-season |
| Color | String | No | Color description |
| Brand | String | No | Brand name |
| PurchaseDate | String | No | ISO date |
| ImageUrl | String | No | URL to item image |
| SharedCount | Number | Yes | Number of times shared (default: 0) |
| IsPublic | Boolean | Yes | Whether item is public (default: false) |
| CreatedAt | String | Yes | ISO timestamp |
| UpdatedAt | String | Yes | ISO timestamp |
| IdempotencyKey | String | No | Idempotency key for creation |
| EntityType | String | Yes | "Item" |

**Example**:
```json
{
  "PK": "ITEM#01JCWXYZABCDEF1234567890",
  "SK": "METADATA",
  "UserId": "user123",
  "Name": "Summer Beach Dress",
  "Category": "dresses",
  "Season": "summer",
  "Color": "blue",
  "Brand": "Zara",
  "PurchaseDate": "2025-01-15",
  "SharedCount": 3,
  "IsPublic": true,
  "CreatedAt": "2025-11-13T10:30:00.000Z",
  "UpdatedAt": "2025-11-13T15:45:00.000Z",
  "EntityType": "Item"
}
```

**Access Patterns**:
- Get item by ID: `GetItem(PK=ITEM#{itemId}, SK=METADATA)`

---

### 2. User-Item Index

Enables querying all items for a user.

**Keys**:
```
PK: USER#{userId}
SK: ITEM#{itemId}
```

**GSI1** (for season filtering):
```
GSI1PK: USER#{userId}#SEASON#{season}
GSI1SK: ITEM#{timestamp}
```

**Attributes**:
| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| ItemId | String | Yes | Reference to main item |
| Name | String | Yes | Denormalized for quick display |
| Category | String | Yes | Denormalized for filtering |
| Season | String | No | Denormalized for filtering |
| EntityType | String | Yes | "UserItem" |

**Example**:
```json
{
  "PK": "USER#user123",
  "SK": "ITEM#01JCWXYZABCDEF1234567890",
  "GSI1PK": "USER#user123#SEASON#summer",
  "GSI1SK": "ITEM#2025-11-13T10:30:00.000Z",
  "ItemId": "01JCWXYZABCDEF1234567890",
  "Name": "Summer Beach Dress",
  "Category": "dresses",
  "Season": "summer",
  "EntityType": "UserItem"
}
```

**Access Patterns**:
- List all items for user: `Query(PK=USER#{userId}, SK begins_with "ITEM#", ScanIndexForward=false)`
- List items by season: `Query GSI1(GSI1PK=USER#{userId}#SEASON#{season}, ScanIndexForward=false)`
- Filter by category: Apply `FilterExpression` on query results

**Why Denormalize?**
- Faster queries (no need to fetch full item)
- Reduces read capacity units
- Enables filtering without additional queries

---

### 3. Idempotency Record

Prevents duplicate item creation.

**Keys**:
```
PK: USER#{userId}
SK: IDEMPOTENCY#{idempotencyKey}
```

**GSI1** (for efficient lookups):
```
GSI1PK: USER#{userId}
GSI1SK: IDEMPOTENCY#{idempotencyKey}
```

**Attributes**:
| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| ItemId | String | Yes | Reference to created item |
| CreatedAt | String | Yes | ISO timestamp |
| EntityType | String | Yes | "Idempotency" |

**Example**:
```json
{
  "PK": "USER#user123",
  "SK": "IDEMPOTENCY#550e8400-e29b-41d4-a716-446655440000",
  "GSI1PK": "USER#user123",
  "GSI1SK": "IDEMPOTENCY#550e8400-e29b-41d4-a716-446655440000",
  "ItemId": "01JCWXYZABCDEF1234567890",
  "CreatedAt": "2025-11-13T10:30:00.000Z",
  "EntityType": "Idempotency"
}
```

**Access Patterns**:
- Check idempotency: `Query GSI1(GSI1PK=USER#{userId}, GSI1SK=IDEMPOTENCY#{key})`

**Cleanup Strategy**:
- Optional: Use TTL to auto-delete after 24-48 hours
- Keeps table size manageable
- Add `TTL` attribute with expiration timestamp

---

### 4. Activity Feed

Records user activities for the feed.

**Keys**:
```
PK: USER#{userId}
SK: ACTIVITY#{activityId}
```

**Attributes**:
| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| ActivityType | String | Yes | "ItemShared", "ItemCreated", etc. |
| ItemId | String | Yes | Related item ID |
| ItemName | String | No | Denormalized item name |
| Timestamp | String | Yes | ISO timestamp of activity |
| Metadata | Map | No | Additional activity data |
| EntityType | String | Yes | "Activity" |

**Example**:
```json
{
  "PK": "USER#user123",
  "SK": "ACTIVITY#550e8400-e29b-41d4-a716-446655440000",
  "ActivityType": "ItemShared",
  "ItemId": "01JCWXYZABCDEF1234567890",
  "ItemName": "Summer Beach Dress",
  "Timestamp": "2025-11-13T15:45:00.000Z",
  "Metadata": {
    "action": "share",
    "platform": "web"
  },
  "EntityType": "Activity"
}
```

**Access Patterns**:
- Get user activities: `Query(PK=USER#{userId}, SK begins_with "ACTIVITY#", ScanIndexForward=false, Limit=20)`

**Future Enhancements**:
- Add GSI for global activity feed
- Filter by activity type
- Add follower notifications

---

## Access Patterns Summary

| Access Pattern | Method | Keys | Index |
|----------------|--------|------|-------|
| Get item by ID | GetItem | PK=ITEM#{id}, SK=METADATA | Main |
| Create item | BatchWriteItem | Multiple records | Main |
| List user items (all) | Query | PK=USER#{userId}, SK^=ITEM# | Main |
| List user items (by season) | Query | GSI1PK=USER#{userId}#SEASON#{season} | GSI1 |
| Filter by category | Query + Filter | FilterExpression on Category | Main/GSI1 |
| Check idempotency | Query | GSI1PK=USER#{userId}, GSI1SK=IDEMPOTENCY#{key} | GSI1 |
| Update shared count | UpdateItem | PK=ITEM#{id}, SK=METADATA | Main |
| Create activity | PutItem | PK=USER#{userId}, SK=ACTIVITY#{id} | Main |
| Get user activities | Query | PK=USER#{userId}, SK^=ACTIVITY# | Main |

**Legend**: `^=` means "begins_with"

---

## Key Design Decisions

### 1. Single-Table Design

**Why?**
- Fewer network calls
- Lower latency
- Cost efficient (fewer tables)
- Transactional consistency within table

**Trade-offs**:
- More complex than multi-table
- Requires careful design
- Schema changes need migration strategy

### 2. Composite Keys with Prefixes

**Pattern**: `ENTITY_TYPE#{id}`

**Benefits**:
- Namespace entities within same table
- Self-documenting keys
- Prevents collisions
- Enables efficient queries

**Example**: `ITEM#01JCW...` vs `USER#user123`

### 3. GSI for Season Filtering

**Why separate GSI?**
- Season is a common filter
- Avoids scanning all user items
- Supports efficient pagination

**Composite GSI1PK**: `USER#{userId}#SEASON#{season}`
- Groups items by user AND season
- Single query retrieves filtered results

### 4. Denormalization

**What's denormalized?**
- Item name in UserItem record
- Item name in Activity record
- Category in UserItem record

**Why?**
- Faster list queries (no additional GetItem calls)
- Reduces read capacity
- Acceptable for read-heavy workloads

**Trade-off**: Must update multiple records when item name changes

### 5. Sort Keys with Timestamps

**Pattern**: `ITEM#{timestamp}` for GSI1SK

**Benefits**:
- Natural chronological ordering
- Recent items first (with `ScanIndexForward=false`)
- Efficient pagination

### 6. Idempotency Tracking

**Why track?**
- Prevents duplicate items from retries
- Critical for reliable API
- Required for distributed systems

**Implementation**: Separate record type with GSI lookup

---

## Capacity Planning

### Read Capacity

**Estimates** (per operation):

| Operation | RCUs | Notes |
|-----------|------|-------|
| Get item | 1 | 4KB strongly consistent |
| List items (20) | 20 | 20 items × 1 RCU each |
| Check idempotency | 1 | GSI query |
| Get activities | 20 | 20 activities × 1 RCU each |

**Monthly estimates** (1M requests/month):

- 500K item creates → 500K WCUs (writes) + 500K RCUs (idempotency checks)
- 400K item lists → 8M RCUs (avg 20 items per request)
- 100K shares → 200K WCUs (item update + activity)

**Cost**: ~$5-10/month for medium traffic with on-demand billing

### Write Capacity

**Estimates** (per operation):

| Operation | WCUs | Notes |
|-----------|------|-------|
| Create item | 3 | 3 records (Item, UserItem, Idempotency) |
| Update shared count | 1 | Single UpdateItem |
| Create activity | 1 | Single PutItem |
| Share item | 2 | Update + Activity |

### Optimization Tips

1. **Use batch operations** where possible
2. **On-demand billing** for variable traffic
3. **Eventually consistent reads** for non-critical queries
4. **Projection expressions** to fetch only needed attributes
5. **TTL** for temporary data (idempotency records)

---

## Migration Strategy

### Adding a New Attribute

**Safe approach**:
1. Add attribute to new items only
2. Update application to handle missing attribute (null)
3. Backfill existing items if needed

**Example**: Adding `Tags` field
```python
# Application handles both
tags = item.get('Tags', [])
```

### Changing Key Structure

**Requires migration**:
1. Create new table with new structure
2. Dual-write to both tables
3. Backfill data from old to new
4. Switch reads to new table
5. Stop writing to old table
6. Delete old table

**Avoid if possible** - design keys carefully upfront

### Adding a New GSI

**Safe approach**:
1. Add GSI to table (takes time to build)
2. New items automatically indexed
3. Existing items backfilled automatically
4. Start querying GSI when ready

---

## Testing Data Model

### Sample Queries

**Get item**:
```python
response = table.get_item(
    Key={
        'PK': 'ITEM#01JCWXYZ',
        'SK': 'METADATA'
    }
)
```

**List all items for user**:
```python
response = table.query(
    KeyConditionExpression='PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues={
        ':pk': 'USER#user123',
        ':sk': 'ITEM#'
    },
    ScanIndexForward=False,
    Limit=20
)
```

**List items by season**:
```python
response = table.query(
    IndexName='GSI1',
    KeyConditionExpression='GSI1PK = :gsi1pk',
    ExpressionAttributeValues={
        ':gsi1pk': 'USER#user123#SEASON#summer'
    },
    ScanIndexForward=False,
    Limit=20
)
```

**Check idempotency**:
```python
response = table.query(
    IndexName='GSI1',
    KeyConditionExpression='GSI1PK = :gsi1pk AND GSI1SK = :gsi1sk',
    ExpressionAttributeValues={
        ':gsi1pk': 'USER#user123',
        ':gsi1sk': 'IDEMPOTENCY#550e8400-...'
    },
    Limit=1
)
```

---

## References

- [AWS DynamoDB Best Practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html)
- [Single-Table Design](https://aws.amazon.com/blogs/compute/creating-a-single-table-design-with-amazon-dynamodb/)
- [DynamoDB Partition Keys](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.Partitions.html)
- [GSI Best Practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-indexes-general.html)

