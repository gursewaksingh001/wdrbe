# Wdrbe Backend Architecture

## Overview

This document describes the architecture, design decisions, and data model for the Wdrbe Wardrobe Items backend service.

## System Architecture

### High-Level Design

```
┌─────────────┐
│   Client    │
│ Application │
└──────┬──────┘
       │ HTTPS
       ▼
┌─────────────────────────┐
│   API Gateway (REST)    │
│  - Request validation   │
│  - Throttling          │
│  - CORS                │
└──────────┬──────────────┘
           │
           ▼
┌──────────────────────────────────┐
│  Sync API Lambda (.NET 8)        │
│  ┌────────────────────────────┐  │
│  │  JWT Validator             │  │
│  └────────────┬───────────────┘  │
│               ▼                   │
│  ┌────────────────────────────┐  │
│  │  Request Handlers          │  │
│  │  - Create Item             │  │
│  │  - List Items              │  │
│  │  - Share Item              │  │
│  └────────────┬───────────────┘  │
│               ▼                   │
│  ┌────────────────────────────┐  │
│  │  Repository Layer          │  │
│  └────────────┬───────────────┘  │
└───────────────┼──────────────────┘
                │
        ┌───────┴────────┐
        │                │
        ▼                ▼
┌──────────────┐   ┌──────────────┐
│  DynamoDB    │   │  SQS Queue   │
│  (Items &    │   │  (Share      │
│  Activities) │   │  Events)     │
└──────────────┘   └──────┬───────┘
                          │
                          ▼
                   ┌──────────────────────────┐
                   │ Share Worker Lambda      │
                   │ (Python 3.12)            │
                   │  - Update shared count   │
                   │  - Create activity       │
                   └──────────┬───────────────┘
                          │
                          ▼
                   ┌──────────────┐
                   │  DynamoDB    │
                   │  (Update)    │
                   └──────────────┘
```

## Components

### 1. API Gateway

**Type**: REST API

**Responsibilities**:
- Entry point for all client requests
- TLS termination
- Request/response validation
- Rate limiting and throttling
- CORS handling

**Configuration**:
- Stage: `prod`
- Throttling: 500 req/s steady, 1000 burst
- CloudWatch logging enabled
- X-Ray tracing enabled

### 2. Sync API Lambda (.NET 8)

**Runtime**: .NET 8 on ARM64 (Graviton2)

**Responsibilities**:
- JWT token validation
- Request routing and handling
- Business logic execution
- Data validation
- Idempotency checking
- Enqueueing async operations

**Key Features**:
- **Idempotency**: Uses idempotency keys to prevent duplicate item creation
- **Pagination**: Cursor-based pagination for list operations
- **Filtering**: Support for season and category filters
- **Authorization**: Ensures users can only access their own data

**Memory**: 512 MB  
**Timeout**: 30 seconds  
**Architecture**: ARM64 (cost optimization)

### 3. Share Worker Lambda (Python 3.12)

**Runtime**: Python 3.12 on ARM64 (Graviton2)

**Responsibilities**:
- Process share events from SQS
- Update item shared count
- Mark items as public
- Create activity feed entries
- Handle partial batch failures

**Key Features**:
- **Batch Processing**: Processes up to 10 messages per invocation
- **Partial Failure Handling**: Reports individual message failures
- **Dead Letter Queue**: Failed messages sent to DLQ after 3 retries
- **Observability**: Comprehensive logging and metrics

**Memory**: 256 MB  
**Timeout**: 60 seconds  
**Concurrency**: Limited to 10 for cost control

### 4. DynamoDB Table

**Table Name**: `WardrobeTable`

**Billing Mode**: On-demand (pay-per-request)

**Features**:
- Point-in-time recovery enabled
- AWS-managed encryption
- DynamoDB Streams enabled
- GSI for efficient querying

## Data Model

### Single-Table Design

We use a single-table design pattern for optimal DynamoDB performance and cost efficiency.

#### Entity Types

##### 1. Item (Main Record)

```
PK: ITEM#{itemId}
SK: METADATA
Attributes:
  - UserId (string)
  - Name (string)
  - Category (string)
  - Season (string, optional)
  - Color (string, optional)
  - Brand (string, optional)
  - PurchaseDate (string, optional)
  - ImageUrl (string, optional)
  - SharedCount (number, default: 0)
  - IsPublic (boolean, default: false)
  - CreatedAt (ISO timestamp)
  - UpdatedAt (ISO timestamp)
  - IdempotencyKey (string, optional)
  - EntityType: "Item"
```

**Access Patterns**:
- Get item by ID: `GetItem(PK=ITEM#{itemId}, SK=METADATA)`

##### 2. User-Item Index

```
PK: USER#{userId}
SK: ITEM#{itemId}
GSI1PK: USER#{userId}#SEASON#{season}
GSI1SK: ITEM#{timestamp}
Attributes:
  - ItemId (string)
  - Name (string)
  - Category (string)
  - Season (string, optional)
  - EntityType: "UserItem"
```

**Access Patterns**:
- List all items for user: `Query(PK=USER#{userId}, SK begins_with "ITEM#")`
- List items by season: `Query GSI1(GSI1PK=USER#{userId}#SEASON#{season})`
- Filter by category: Apply filter expression on results

##### 3. Idempotency Record

```
PK: USER#{userId}
SK: IDEMPOTENCY#{idempotencyKey}
GSI1PK: USER#{userId}
GSI1SK: IDEMPOTENCY#{idempotencyKey}
Attributes:
  - ItemId (string)
  - CreatedAt (ISO timestamp)
  - EntityType: "Idempotency"
```

**Access Patterns**:
- Check idempotency: `Query GSI1(GSI1PK=USER#{userId}, GSI1SK=IDEMPOTENCY#{key})`

##### 4. Activity Feed

```
PK: USER#{userId}
SK: ACTIVITY#{activityId}
Attributes:
  - ActivityType (string: "ItemShared", "ItemCreated", etc.)
  - ItemId (string)
  - ItemName (string, optional)
  - Timestamp (ISO timestamp)
  - Metadata (map)
  - EntityType: "Activity"
```

**Access Patterns**:
- Get user activities: `Query(PK=USER#{userId}, SK begins_with "ACTIVITY#", sort desc)`

### Global Secondary Index (GSI1)

```
Partition Key: GSI1PK
Sort Key: GSI1SK
Projection: ALL
```

Used for:
- Querying items by user and season
- Idempotency lookups

## Security

### Authentication & Authorization

1. **JWT Validation**:
   - All endpoints require valid JWT Bearer token
   - Token must contain `sub` claim with user ID
   - Secret stored in AWS Systems Manager Parameter Store
   - Token validated on every request

2. **Authorization**:
   - Users can only access their own resources
   - Path parameters validated against authenticated user ID

3. **IAM Roles**:
   - Least privilege principle applied
   - Lambda execution roles have minimal required permissions
   - Separate roles for Sync API and Share Worker

### Network Security

- API Gateway enforces HTTPS only
- No public VPC resources
- Lambda functions run in AWS-managed VPC

### Data Protection

- Encryption at rest (DynamoDB AWS-managed keys)
- Encryption in transit (TLS 1.2+)
- Secrets in Parameter Store (encrypted)
- No sensitive data in logs

## Observability

### Logging

**CloudWatch Logs**:
- All Lambda invocations logged
- Structured JSON logging (AWS Powertools)
- Log retention: 7 days (configurable)
- Log levels: INFO (default), DEBUG, ERROR

**Log Groups**:
- `/aws/lambda/wdrbe-sync-api`
- `/aws/lambda/wdrbe-share-worker`

### Metrics

**Custom CloudWatch Metrics**:

Sync API:
- `ItemCreated` - Count of items created
- `ItemCreatedIdempotent` - Idempotent requests
- `ItemCreated_{category}` - Per-category counts
- `ItemsListed` - Items returned in queries
- `ShareEventsEnqueued` - Share events sent to SQS
- `UnhandledErrors` - Error count

Share Worker:
- `ShareEventsProcessed` - Successfully processed events
- `ItemNotFound` - Items not found
- `BatchSize` - Records per batch
- `SuccessfulRecords` - Per-batch successes
- `FailedRecords` - Per-batch failures

### Tracing

**AWS X-Ray**:
- End-to-end request tracing
- Enabled on API Gateway and both Lambdas
- Service map visualization
- Latency analysis

### Alarms

**CloudWatch Alarms**:
1. Sync API errors (threshold: 10 in 5 min)
2. Share Worker errors (threshold: 5 in 5 min)
3. DLQ messages (threshold: 1)
4. API Gateway 5xx errors (threshold: 10 in 5 min)

## Scalability

### Horizontal Scaling

- **Lambda**: Automatically scales to handle load
- **DynamoDB**: On-demand billing auto-scales
- **SQS**: No throughput limits
- **API Gateway**: Scales automatically

### Limits & Quotas

**Configurable Limits**:
- API throttling: 500 req/s steady, 1000 burst
- Share Worker concurrency: 10 (cost control)
- List items max limit: 100 per request
- Lambda timeout: 30s (API), 60s (worker)

**Optimization Strategies**:
1. Cursor-based pagination (not offset)
2. GSI for filtered queries (not scan)
3. Batch operations where possible
4. ARM64 architecture (better price/performance)

## Cost Optimization

### On-Demand Pricing

- **DynamoDB**: Pay per request (no idle capacity cost)
- **Lambda**: Pay per invocation + duration
- **SQS**: $0.40 per million requests
- **API Gateway**: Pay per request

### Cost-Saving Features

1. **ARM64 Architecture**: 20% cheaper than x86
2. **On-Demand DynamoDB**: No over-provisioning
3. **Batch Processing**: Process 10 messages per Lambda
4. **Log Retention**: 7 days (not indefinite)
5. **Concurrency Limits**: Prevent runaway costs

### Monitoring Costs

Use AWS Cost Explorer with tags:
- `Project: Wdrbe`
- `ManagedBy: CDK`

## Disaster Recovery

### Backup Strategy

- **DynamoDB**: Point-in-time recovery (35 days)
- **Infrastructure**: IaC in Git (CDK)
- **Retention**: Table has `RETAIN` removal policy

### Recovery Procedures

1. **Stack Deletion**: DynamoDB table retained
2. **Data Loss**: Restore from PITR
3. **Code Issues**: Rollback via CDK
4. **Region Failure**: Manual redeploy to new region (RTO: 1-2 hours)

## Future Enhancements

### Potential Improvements

1. **Multi-Region**: Active-active or active-passive
2. **Caching**: CloudFront + API Gateway caching
3. **Image Storage**: S3 integration for photos
4. **Search**: OpenSearch for full-text search
5. **Real-Time**: WebSocket API for live updates
6. **Analytics**: Data pipeline to analytics service
7. **OAuth**: Replace mock JWT with Cognito/Auth0

### Monitoring Enhancements

1. Dashboards (CloudWatch or Grafana)
2. SNS notifications for alarms
3. Anomaly detection
4. Cost anomaly alerts

## Development Guidelines

### Adding New Endpoints

1. Define route in CDK stack
2. Create handler in `Handlers/`
3. Update routing in `Function.cs`
4. Add tests
5. Update API documentation

### Modifying Data Model

1. Plan access patterns first
2. Test with sample data
3. Consider migration strategy
4. Update repository layer
5. Document changes

### Performance Testing

```bash
# Load test with Artillery or k6
artillery quick --count 100 --num 10 <API_URL>
```

## Appendix

### Technology Choices

| Component | Choice | Rationale |
|-----------|--------|-----------|
| API | API Gateway REST | Mature, feature-rich, better for CRUD |
| Sync API Runtime | .NET 8 | Strong typing, performance, good AWS SDK |
| Worker Runtime | Python 3.12 | Quick development, excellent AWS support |
| Database | DynamoDB | Serverless, scales automatically, low latency |
| Queue | SQS Standard | Reliable, cheap, decouples services |
| IaC | AWS CDK | Type-safe, excellent AWS support |

### References

- [DynamoDB Single-Table Design](https://aws.amazon.com/blogs/compute/creating-a-single-table-design-with-amazon-dynamodb/)
- [AWS Lambda Powertools](https://docs.powertools.aws.dev/)
- [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/)

