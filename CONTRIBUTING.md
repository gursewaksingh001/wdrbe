# Contributing to Wdrbe Backend

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

### Prerequisites

Install the required tools:
- Node.js 18+ (for CDK)
- .NET 8 SDK (for Sync API)
- Python 3.12+ (for Share Worker)
- AWS CLI (configured with credentials)
- Git

### Clone and Setup

```bash
# Clone the repository
git clone <repository-url>
cd Wdrbe

# Install dependencies
cd infra && npm install
cd ../api && dotnet restore
cd ../worker && pip install -r requirements.txt
```

### Local Development Environment

#### Option 1: AWS Services (Recommended)

Deploy to a development AWS account:

```bash
# Set AWS profile for dev account
export AWS_PROFILE=dev

# Deploy
./scripts/deploy.sh
```

#### Option 2: LocalStack

Use LocalStack for local AWS services:

```bash
# Install LocalStack
pip install localstack

# Start LocalStack
localstack start

# Configure AWS CLI for LocalStack
export AWS_ENDPOINT_URL=http://localhost:4566
```

## Project Structure

```
Wdrbe/
├── infra/                  # AWS CDK (TypeScript)
├── api/                    # C# .NET Lambda
├── worker/                 # Python Lambda
├── scripts/                # Build & deployment scripts
├── .github/workflows/      # CI/CD pipelines
├── docs/                   # Additional documentation
├── tests/                  # Integration tests (future)
└── *.md                    # Documentation
```

## Development Workflow

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/bug-description
```

Branch naming conventions:
- `feature/` - New features
- `fix/` - Bug fixes
- `refactor/` - Code refactoring
- `docs/` - Documentation changes
- `test/` - Test additions/changes

### 2. Make Changes

Follow the coding standards below.

### 3. Test Your Changes

#### .NET Tests

```bash
cd api
dotnet test
```

#### Python Tests

```bash
cd worker
pytest
```

#### Integration Tests

Deploy to dev environment and run:

```bash
export API_URL=<your-dev-api-url>
export USER_ID=test-user
./scripts/test-api.sh
```

### 4. Commit Your Changes

Use clear, descriptive commit messages:

```bash
git commit -m "feat: add image upload support for wardrobe items"
git commit -m "fix: handle null season in item queries"
git commit -m "docs: update API documentation with new endpoints"
```

Commit message prefixes:
- `feat:` - New feature
- `fix:` - Bug fix
- `refactor:` - Code refactoring
- `docs:` - Documentation changes
- `test:` - Test additions/changes
- `chore:` - Build/tooling changes

### 5. Push and Create Pull Request

```bash
git push origin feature/your-feature-name
```

Create a PR with:
- Clear title
- Description of changes
- Related issue number (if applicable)
- Screenshots (for UI changes)
- Testing notes

## Coding Standards

### C# (.NET)

Follow [Microsoft C# Coding Conventions](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/coding-style/coding-conventions):

```csharp
// Good
public async Task<WardrobeItem> GetItemAsync(string itemId)
{
    if (string.IsNullOrEmpty(itemId))
        throw new ArgumentException("Item ID is required", nameof(itemId));
    
    return await _repository.GetItemAsync(itemId);
}

// Use PascalCase for public members
public string ItemName { get; set; }

// Use camelCase for private fields
private readonly IRepository _repository;

// Use descriptive names
public class ItemHandler : IItemHandler
{
    // Implementation
}
```

**Key principles**:
- Use async/await for I/O operations
- Proper exception handling
- Interface-based design
- XML documentation for public APIs
- Unit test coverage

### Python

Follow [PEP 8](https://peps.python.org/pep-0008/):

```python
# Good
async def get_item(item_id: str) -> Optional[Dict[str, Any]]:
    """
    Get item by ID.
    
    Args:
        item_id: Item ID
        
    Returns:
        Item data or None if not found
    """
    if not item_id:
        raise ValueError("Item ID is required")
    
    return await repository.get_item(item_id)

# Use snake_case for functions and variables
def process_share_event(record: SQSRecord) -> Dict[str, Any]:
    pass

# Use type hints
def create_activity(user_id: str, item_id: str) -> str:
    pass
```

**Key principles**:
- Type hints for all function signatures
- Docstrings for all public functions
- Use dataclasses for structured data
- Error handling with specific exceptions
- Unit test coverage

### TypeScript (CDK)

Follow [TypeScript style guide](https://google.github.io/styleguide/tsguide.html):

```typescript
// Good
const syncApiLambda = new lambda.Function(this, 'SyncApiLambda', {
  functionName: 'wdrbe-sync-api',
  runtime: lambda.Runtime.DOTNET_8,
  handler: 'SyncApi::SyncApi.Function::FunctionHandler',
  memorySize: 512,
  timeout: Duration.seconds(30),
});

// Use camelCase for variables
const tableName = 'WardrobeTable';

// Use PascalCase for classes and interfaces
class WdrbeStack extends cdk.Stack {
  // Implementation
}
```

## Adding New Features

### Adding a New API Endpoint

1. **Define in CDK** (`infra/lib/wdrbe-stack.ts`):
   ```typescript
   const newResource = api.root.addResource('new-endpoint');
   newResource.addMethod('GET', syncApiIntegration);
   ```

2. **Add Handler** (`api/Handlers/NewHandler.cs`):
   ```csharp
   public class NewHandler : INewHandler
   {
       public async Task<APIGatewayProxyResponse> HandleRequest(...)
       {
           // Implementation
       }
   }
   ```

3. **Update Routing** (`api/Function.cs`):
   ```csharp
   var response = (request.Path, request.HttpMethod) switch
   {
       (var p, "GET") when p.Contains("/new-endpoint") 
           => await _newHandler.HandleRequest(request, authResult.UserId!),
       // ... existing routes
   };
   ```

4. **Add Tests**
5. **Update Documentation**

### Adding a New Worker Function

1. **Create Lambda** in CDK
2. **Add SQS Queue** (if needed)
3. **Implement Handler** in Python
4. **Connect Event Source**
5. **Add Monitoring**

### Modifying Data Model

1. **Plan Access Patterns**
   - What queries do you need?
   - Can existing GSI support it?
   - Do you need a new GSI?

2. **Update Repository Layer**
   - Add new methods
   - Handle backward compatibility

3. **Migration Strategy**
   - How will existing data be handled?
   - Do you need a backfill script?

4. **Update Documentation** (DATA_MODEL.md)

## Testing Guidelines

### Unit Tests

Test individual components in isolation:

**C# Example**:
```csharp
[Fact]
public async Task CreateItem_ValidRequest_ReturnsCreatedItem()
{
    // Arrange
    var mockRepo = new Mock<IRepository>();
    mockRepo.Setup(r => r.CreateItemAsync(It.IsAny<WardrobeItem>()))
            .ReturnsAsync(new WardrobeItem { ItemId = "123" });
    
    var handler = new ItemHandler(mockRepo.Object);
    
    // Act
    var result = await handler.CreateItem(request, "user123");
    
    // Assert
    Assert.Equal(201, result.StatusCode);
}
```

**Python Example**:
```python
def test_process_share_event(mocker):
    # Arrange
    mock_dynamodb = mocker.Mock()
    mock_dynamodb.get_item.return_value = {'Name': 'Test Item'}
    
    # Act
    result = process_share_event(record)
    
    # Assert
    assert result['status'] == 'success'
```

### Integration Tests

Test with actual AWS services (dev environment):

```bash
# Deploy to dev
export AWS_PROFILE=dev
./scripts/deploy.sh

# Run integration tests
export API_URL=<dev-api-url>
./scripts/test-api.sh
```

### Load Tests

Use Artillery or k6:

```bash
# Install Artillery
npm install -g artillery

# Run load test
artillery quick --count 100 --num 10 $API_URL/users/user123/items
```

## Documentation

### Code Documentation

**C#**: Use XML comments
```csharp
/// <summary>
/// Creates a new wardrobe item.
/// </summary>
/// <param name="request">API Gateway request</param>
/// <param name="userId">Authenticated user ID</param>
/// <returns>API Gateway response with created item</returns>
public async Task<APIGatewayProxyResponse> CreateItem(
    APIGatewayProxyRequest request, 
    string userId)
{
    // Implementation
}
```

**Python**: Use docstrings
```python
def create_activity(user_id: str, item_id: str) -> str:
    """
    Create a share activity entry.
    
    Args:
        user_id: User ID who shared the item
        item_id: Item ID that was shared
        
    Returns:
        Activity ID
        
    Raises:
        ValueError: If required fields are missing
    """
    pass
```

### Markdown Documentation

Update relevant `.md` files when:
- Adding new features
- Changing APIs
- Modifying architecture
- Updating deployment process

## Pull Request Guidelines

### Before Submitting

- [ ] Code builds successfully
- [ ] Tests pass
- [ ] No linter errors
- [ ] Documentation updated
- [ ] Commit messages are clear
- [ ] Branch is up to date with main

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
How was this tested?

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex logic
- [ ] Documentation updated
- [ ] Tests added/updated
- [ ] No new warnings generated
```

### Review Process

1. **Automated Checks**: CI/CD runs tests
2. **Code Review**: At least one approval required
3. **Manual Testing**: Deploy to staging
4. **Merge**: Squash and merge to main

## Common Tasks

### Running Locally

```bash
# Build all
./scripts/build.sh

# Build individually
cd api && dotnet build
cd worker && pip install -r requirements.txt
cd infra && npm run build
```

### Deploying Changes

```bash
# Deploy everything
./scripts/deploy.sh

# Deploy infrastructure only
cd infra && cdk deploy
```

### Viewing Logs

```bash
# Sync API logs
aws logs tail /aws/lambda/wdrbe-sync-api --follow

# Share Worker logs
aws logs tail /aws/lambda/wdrbe-share-worker --follow
```

### Running Tests

```bash
# .NET tests
cd api && dotnet test

# Python tests
cd worker && pytest

# Integration tests
./scripts/test-api.sh
```

## Troubleshooting

### Build Errors

**C# build fails**:
```bash
cd api
dotnet clean
dotnet restore
dotnet build
```

**Python dependencies**:
```bash
cd worker
pip install -r requirements.txt --upgrade
```

**CDK issues**:
```bash
cd infra
rm -rf node_modules cdk.out
npm install
npm run build
```

### Deployment Issues

Check CloudFormation events:
```bash
aws cloudformation describe-stack-events \
  --stack-name WdrbeStack \
  --max-items 20
```

### Testing Issues

Check Lambda logs for errors:
```bash
aws logs tail /aws/lambda/<function-name> --follow
```

## Getting Help

- **Documentation**: Check README.md, ARCHITECTURE.md, DEPLOYMENT.md
- **Issues**: Search existing issues or create a new one
- **Discussions**: Use GitHub Discussions for questions
- **AWS Documentation**: [AWS Developer Guide](https://docs.aws.amazon.com/)

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Help others learn and grow
- Focus on what's best for the project

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to Wdrbe! 🎉

