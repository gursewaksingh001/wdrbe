# Sync API Lambda (.NET 8)

This is the main API Lambda function for the Wdrbe backend service, built with C# .NET 8.

## Structure

```
SyncApi/
├── Handlers/              # API endpoint handlers
│   ├── ItemHandler.cs     # Create & list items
│   └── ShareHandler.cs    # Share item logic
├── Middleware/            # Cross-cutting concerns
│   ├── JwtValidator.cs    # JWT authentication
│   └── IJwtValidator.cs
├── Models/                # Domain models & DTOs
│   └── WardrobeItem.cs    # Item, Activity, Request/Response models
├── Repositories/          # Data access layer
│   ├── DynamoDbRepository.cs
│   └── IRepository.cs
├── Services/              # Business logic services
│   ├── JwtService.cs      # JWT validation
│   ├── SqsQueueService.cs # SQS messaging
│   └── Interfaces
├── Function.cs            # Lambda entry point
└── SyncApi.csproj         # Project file
```

## API Endpoints

### POST /users/{userId}/items

Create a new wardrobe item.

**Request:**
```json
{
  "name": "Summer Dress",
  "category": "dresses",
  "season": "summer",
  "color": "blue",
  "brand": "Zara",
  "purchaseDate": "2025-01-15",
  "imageUrl": "https://example.com/image.jpg",
  "idempotencyKey": "uuid-v4"
}
```

**Response (201):**
```json
{
  "itemId": "01JCWXYZ...",
  "userId": "user123",
  "name": "Summer Dress",
  "category": "dresses",
  "season": "summer",
  "color": "blue",
  "brand": "Zara",
  "sharedCount": 0,
  "isPublic": false,
  "createdAt": "2025-11-13T10:30:00Z",
  "updatedAt": "2025-11-13T10:30:00Z"
}
```

### GET /users/{userId}/items

List wardrobe items with optional filters.

**Query Parameters:**
- `season` (optional): spring, summer, fall, winter, all-season
- `category` (optional): Filter by category
- `limit` (optional, default=20, max=100): Number of items
- `cursor` (optional): Pagination cursor

**Response (200):**
```json
{
  "items": [
    {
      "itemId": "01JCWXYZ...",
      "name": "Summer Dress",
      "category": "dresses",
      "season": "summer"
      // ... more fields
    }
  ],
  "nextCursor": "eyJQSyI6IlVTRVIj...",
  "hasMore": true
}
```

### POST /items/{itemId}/share

Enqueue a share event for async processing.

**Response (202):**
```json
{
  "itemId": "01JCWXYZ...",
  "status": "queued",
  "message": "Share event enqueued successfully",
  "eventId": "550e8400-e29b-41d4-a716-446655440000"
}
```

## Development

### Prerequisites

- .NET 8 SDK
- Visual Studio 2022 or VS Code with C# extension

### Build

```bash
dotnet restore
dotnet build
```

### Run Tests

```bash
dotnet test
```

### Publish for Deployment

```bash
dotnet publish -c Release -o bin/Release/net8.0/publish
```

### Local Development

For local testing, use AWS SAM:

```bash
sam local start-api
```

Or create a test harness:

```csharp
// Program.cs
var request = new APIGatewayProxyRequest
{
    HttpMethod = "POST",
    Path = "/users/user123/items",
    Body = """{"name": "Test Item", "category": "test"}"""
};

var function = new Function();
var response = await function.FunctionHandler(request, context);
Console.WriteLine(response.Body);
```

## Environment Variables

Required:
- `TABLE_NAME` - DynamoDB table name
- `QUEUE_URL` - SQS queue URL
- `JWT_SECRET_PARAM` - SSM parameter name for JWT secret

Optional:
- `POWERTOOLS_SERVICE_NAME` - Service name for logging
- `POWERTOOLS_LOG_LEVEL` - Log level (INFO, DEBUG, ERROR)

## Dependencies

Key NuGet packages:
- `Amazon.Lambda.Core` - Lambda runtime
- `Amazon.Lambda.APIGatewayEvents` - API Gateway event types
- `AWSSDK.DynamoDBv2` - DynamoDB client
- `AWSSDK.SQS` - SQS client
- `AWSSDK.SimpleSystemsManagement` - SSM client
- `System.IdentityModel.Tokens.Jwt` - JWT validation
- `AWS.Lambda.Powertools.*` - Logging, tracing, metrics

## Architecture Patterns

### Dependency Injection (Manual)

While .NET supports DI containers, this Lambda uses manual DI for simplicity:

```csharp
public Function()
{
    var repository = new DynamoDbRepository(tableName);
    var queueService = new SqsQueueService(queueUrl);
    _itemHandler = new ItemHandler(repository);
    _shareHandler = new ShareHandler(repository, queueService);
}
```

For larger projects, consider using `Microsoft.Extensions.DependencyInjection`.

### Repository Pattern

Data access is abstracted behind `IRepository`:

```csharp
public interface IRepository
{
    Task<WardrobeItem?> GetItemAsync(string itemId);
    Task<WardrobeItem> CreateItemAsync(WardrobeItem item);
    // ... more methods
}
```

### Handler Pattern

Each endpoint has a dedicated handler:

```csharp
public interface IItemHandler
{
    Task<APIGatewayProxyResponse> CreateItem(request, userId);
    Task<APIGatewayProxyResponse> ListItems(request, userId);
}
```

## Error Handling

Errors are caught and returned with appropriate HTTP status codes:

- `400 Bad Request` - Invalid input
- `401 Unauthorized` - Missing/invalid JWT
- `403 Forbidden` - User doesn't own resource
- `404 Not Found` - Resource not found
- `500 Internal Server Error` - Unexpected error

All errors return JSON:
```json
{
  "error": "Error Type",
  "message": "Detailed error message"
}
```

## Idempotency

The API supports idempotency for item creation via `idempotencyKey`:

```csharp
if (!string.IsNullOrEmpty(createRequest.IdempotencyKey))
{
    var existingItem = await _repository
        .GetItemByIdempotencyKeyAsync(userId, createRequest.IdempotencyKey);
    
    if (existingItem != null)
    {
        return CreateResponse(200, existingItem);
    }
}
```

This prevents duplicate items if the client retries a request.

## Security

### JWT Validation

All requests must include a valid JWT:

```
Authorization: Bearer <token>
```

The token must contain a `sub` claim with the user ID.

### Authorization

Users can only access their own resources:

```csharp
if (pathUserId != userId)
{
    return CreateResponse(403, new { error = "Forbidden" });
}
```

## Observability

### Logging

Uses AWS Lambda Powertools for structured logging:

```csharp
Logger.LogInformation("Item created", new { ItemId = item.ItemId });
```

### Metrics

Custom CloudWatch metrics:

```csharp
Metrics.AddMetric("ItemCreated", 1, MetricUnit.Count);
```

### Tracing

X-Ray tracing enabled via Powertools:

```csharp
[Tracing(CaptureMode = TracingCaptureMode.ResponseAndError)]
```

## Performance Optimization

1. **ARM64 Architecture**: 20% better price/performance
2. **Async/Await**: Non-blocking I/O operations
3. **Batch Operations**: DynamoDB BatchWriteItem for multiple records
4. **Cursor Pagination**: More efficient than offset pagination
5. **Lambda SnapStart**: Can be enabled for faster cold starts

## Testing Strategy

### Unit Tests

Test individual components in isolation:

```csharp
[Fact]
public async Task CreateItem_ValidRequest_ReturnsItem()
{
    // Arrange
    var mockRepo = new Mock<IRepository>();
    var handler = new ItemHandler(mockRepo.Object);
    
    // Act
    var response = await handler.CreateItem(request, userId);
    
    // Assert
    Assert.Equal(201, response.StatusCode);
}
```

### Integration Tests

Test with actual AWS services (use test environment).

### Load Tests

Use Artillery or k6 for load testing.

## Common Tasks

### Adding a New Endpoint

1. Define handler interface in `Handlers/`
2. Implement handler class
3. Update routing in `Function.cs`
4. Update API Gateway in CDK

### Adding a New Field to Items

1. Update `WardrobeItem` model
2. Update repository methods
3. Update validation logic
4. Update tests

### Adding a New Query Filter

1. Update `ListItemsAsync` signature
2. Add filter expression in DynamoDB query
3. Update GSI if needed

## Troubleshooting

### High Memory Usage

Increase Lambda memory or optimize code:
- Reduce object allocations
- Use `ArrayPool<T>` for large arrays
- Profile with dotMemory

### Slow Response Times

- Check DynamoDB query patterns
- Ensure GSI is being used
- Check X-Ray traces for bottlenecks

### Timeout Errors

- Increase Lambda timeout
- Optimize database queries
- Use pagination for large results

## References

- [AWS Lambda for .NET](https://docs.aws.amazon.com/lambda/latest/dg/lambda-csharp.html)
- [AWS SDK for .NET](https://aws.amazon.com/sdk-for-net/)
- [DynamoDB .NET Developer Guide](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DotNetSDKHighLevel.html)
- [Lambda Powertools .NET](https://docs.powertools.aws.dev/lambda/dotnet/)

