# Deployment Guide

This guide walks you through deploying the Wdrbe backend service to AWS.

## Prerequisites

Before deploying, ensure you have the following installed and configured:

### Required Tools

1. **Node.js 18+** - For CDK
   ```bash
   node --version  # Should be 18.x or higher
   ```

2. **.NET 8 SDK** - For C# Lambda
   ```bash
   dotnet --version  # Should be 8.0.x
   ```

3. **Python 3.12+** - For Python Lambda
   ```bash
   python3 --version  # Should be 3.12.x
   ```

4. **AWS CLI** - For AWS access
   ```bash
   aws --version
   aws configure  # Set up your credentials
   ```

5. **AWS CDK CLI** - For infrastructure deployment
   ```bash
   npm install -g aws-cdk
   cdk --version  # Should be 2.114.0 or higher
   ```

### AWS Account Setup

1. **AWS Account**: Active AWS account with appropriate permissions
2. **AWS Credentials**: Configure credentials via `aws configure`
3. **AWS Region**: Default region set (e.g., `us-east-1`)

Required IAM permissions:
- CloudFormation (create/update/delete stacks)
- Lambda (create/update functions)
- API Gateway (create/manage APIs)
- DynamoDB (create/manage tables)
- SQS (create/manage queues)
- IAM (create/manage roles)
- Systems Manager (Parameter Store)
- CloudWatch (logs, metrics, alarms)

## Quick Start

### Option 1: Automated Deployment (Recommended)

For Linux/macOS:
```bash
chmod +x scripts/*.sh
./scripts/deploy.sh
```

For Windows (PowerShell):
```powershell
powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1
```

The script will:
1. Verify prerequisites
2. Build .NET Lambda
3. Build Python Lambda
4. Build CDK infrastructure
5. Bootstrap CDK (if needed)
6. Deploy to AWS

### Option 2: Manual Step-by-Step Deployment

#### Step 1: Install Dependencies

```bash
# CDK dependencies
cd infra
npm install

# .NET dependencies
cd ../api
dotnet restore

# Python dependencies
cd ../worker
pip install -r requirements.txt
```

#### Step 2: Build Projects

```bash
# Build .NET Lambda
cd api
dotnet build -c Release
dotnet publish -c Release -o bin/Release/net8.0/publish

# Build Python Lambda
cd ../worker
pip install -r requirements.txt -t .

# Build CDK
cd ../../infra
npm run build
```

#### Step 3: Bootstrap CDK (First Time Only)

```bash
cd infra
cdk bootstrap
```

This creates the CDK staging bucket and roles in your AWS account.

#### Step 4: Review Infrastructure

```bash
cd infra
cdk synth
```

This generates CloudFormation template. Review the output.

#### Step 5: Deploy

```bash
cd infra
cdk deploy
```

Confirm the deployment when prompted. This will:
- Create DynamoDB table
- Create SQS queues (main + DLQ)
- Create Lambda functions
- Create API Gateway
- Create IAM roles
- Create CloudWatch alarms
- Create SSM parameters

#### Step 6: Save Outputs

After deployment, note the stack outputs:
```
Outputs:
WdrbeStack.ApiEndpoint = https://xxxxx.execute-api.us-east-1.amazonaws.com/prod/
WdrbeStack.TableName = WardrobeTable
WdrbeStack.QueueUrl = https://sqs.us-east-1.amazonaws.com/xxxxx/wdrbe-share-events
```

Save these values - you'll need them for testing.

## Post-Deployment Configuration

### 1. Update JWT Secret (Production)

The default JWT secret is for testing only. Update it for production:

```bash
aws ssm put-parameter \
  --name /wdrbe/jwt-secret \
  --value "your-secure-secret-here" \
  --type SecureString \
  --overwrite
```

### 2. Configure Custom Domain (Optional)

Add a custom domain to API Gateway:

```typescript
// In infra/lib/wdrbe-stack.ts
const api = new apigateway.RestApi(this, 'WdrbeApi', {
  domainName: {
    domainName: 'api.yourdomain.com',
    certificate: certificate,
  },
  // ... other config
});
```

### 3. Set Up Monitoring Dashboard (Optional)

Create a CloudWatch dashboard:

```bash
cd infra
cdk deploy --context create-dashboard=true
```

## Testing the Deployment

### 1. Generate Test JWT

```bash
node scripts/generate-jwt.js user123
```

Copy the generated token.

### 2. Test API Endpoints

Set environment variables:
```bash
export API_URL="<your-api-endpoint>"
export USER_ID="user123"
```

Run automated tests:
```bash
chmod +x scripts/test-api.sh
./scripts/test-api.sh
```

Or test manually:

**Create an item:**
```bash
curl -X POST $API_URL/users/user123/items \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "itemId": "itm_123",
    "name": "Navy Blazer",
    "category": "outerwear",
    "season": "autumn"
  }'
```

**List items:**
```bash
curl $API_URL/users/user123/items?season=summer&limit=10 \
  -H "Authorization: Bearer <your-token>"
```

**Share an item:**
```bash
curl -X POST $API_URL/items/<item-id>/share \
  -H "Authorization: Bearer <your-token>"
```

### 3. Verify Backend Processing

Check that the share worker processed the event:

```bash
# View Lambda logs
aws logs tail /aws/lambda/wdrbe-share-worker --follow

# Check DynamoDB for activity
aws dynamodb query \
  --table-name WardrobeTable \
  --key-condition-expression "PK = :pk AND begins_with(SK, :sk)" \
  --expression-attribute-values '{
    ":pk": {"S": "USER#user123"},
    ":sk": {"S": "ACTIVITY#"}
  }'
```

## Updating the Deployment

### Update Application Code

1. Make changes to Lambda code
2. Rebuild:
   ```bash
   ./scripts/build.sh  # or build.ps1 on Windows
   ```
3. Deploy:
   ```bash
   cd infra
   cdk deploy
   ```

### Update Infrastructure

1. Modify `infra/lib/wdrbe-stack.ts`
2. Review changes:
   ```bash
   cdk diff
   ```
3. Deploy:
   ```bash
   cdk deploy
   ```

## Rollback

### Rollback to Previous Version

```bash
cd infra
cdk deploy --previous-version
```

### Complete Rollback (Git)

```bash
git checkout <previous-commit>
./scripts/build.sh
cd infra
cdk deploy
```

## Troubleshooting

### Common Issues

#### 1. CDK Bootstrap Error

**Error**: "CDK bootstrap required"

**Solution**:
```bash
cd infra
cdk bootstrap aws://<account-id>/<region>
```

#### 2. Lambda Build Fails

**Error**: "Assembly not found" or "Module not found"

**Solution**:
```bash
# For .NET
cd api
dotnet clean
dotnet restore
dotnet build -c Release

# For Python
cd worker
pip install -r requirements.txt -t . --upgrade
```

#### 3. Deployment Timeout

**Error**: "Stack deployment timed out"

**Solution**: Check CloudFormation console for specific resource causing delay. Common causes:
- Lambda package too large (>250MB uncompressed)
- DynamoDB table creating with GSI
- IAM policy propagation delay

#### 4. Lambda Execution Errors

**Error**: "Task timed out" or "Memory exceeded"

**Solution**: Increase Lambda memory/timeout in CDK:
```typescript
const syncApiLambda = new lambda.Function(this, 'SyncApiLambda', {
  memorySize: 1024,  // Increase from 512
  timeout: Duration.seconds(60),  // Increase from 30
  // ...
});
```

#### 5. API Gateway 403 Errors

**Error**: "Missing Authentication Token"

**Solution**: Ensure you're using the correct endpoint URL and including the stage name (`/prod/`).

### Viewing Logs

**Sync API logs:**
```bash
aws logs tail /aws/lambda/wdrbe-sync-api --follow
```

**Share Worker logs:**
```bash
aws logs tail /aws/lambda/wdrbe-share-worker --follow
```

**API Gateway logs:**
```bash
aws logs tail /aws/apigateway/WdrbeStack-WdrbeApi --follow
```

### Viewing Metrics

```bash
# Lambda invocations
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=wdrbe-sync-api \
  --start-time 2025-11-13T00:00:00Z \
  --end-time 2025-11-13T23:59:59Z \
  --period 3600 \
  --statistics Sum

# Custom metrics
aws cloudwatch get-metric-statistics \
  --namespace Wdrbe \
  --metric-name ItemCreated \
  --start-time 2025-11-13T00:00:00Z \
  --end-time 2025-11-13T23:59:59Z \
  --period 3600 \
  --statistics Sum
```

## Cleanup

To remove all resources:

```bash
chmod +x scripts/cleanup.sh
./scripts/cleanup.sh
```

Or manually:
```bash
cd infra
cdk destroy
```

**Note**: The DynamoDB table has a `RETAIN` removal policy and won't be automatically deleted. To delete it:

```bash
aws dynamodb delete-table --table-name WardrobeTable
```

## Cost Estimation

### Monthly Cost (Low Traffic)

Assuming:
- 100,000 API requests/month
- 10,000 share events/month
- 1 GB data in DynamoDB
- Minimal data transfer

| Service | Cost |
|---------|------|
| API Gateway | ~$0.35 |
| Lambda (Sync API) | ~$0.20 |
| Lambda (Worker) | ~$0.05 |
| DynamoDB | ~$1.25 |
| SQS | ~$0.04 |
| CloudWatch | ~$1.00 |
| **Total** | **~$2.89** |

### Monthly Cost (Medium Traffic)

Assuming:
- 1,000,000 API requests/month
- 100,000 share events/month
- 10 GB data in DynamoDB

| Service | Cost |
|---------|------|
| API Gateway | ~$3.50 |
| Lambda (Sync API) | ~$2.00 |
| Lambda (Worker) | ~$0.50 |
| DynamoDB | ~$5.00 |
| SQS | ~$0.40 |
| CloudWatch | ~$3.00 |
| **Total** | **~$14.40** |

Use AWS Cost Explorer for accurate tracking.

## CI/CD Integration

### GitHub Actions Example

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy Wdrbe Backend

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Setup .NET
        uses: actions/setup-dotnet@v3
        with:
          dotnet-version: '8.0.x'
      
      - name: Setup Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.12'
      
      - name: Configure AWS
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      
      - name: Install CDK
        run: npm install -g aws-cdk
      
      - name: Build and Deploy
        run: ./scripts/deploy.sh
```

## Security Best Practices

1. **Rotate JWT Secret** regularly
2. **Use AWS Secrets Manager** for sensitive data (upgrade from Parameter Store)
3. **Enable AWS WAF** on API Gateway for DDoS protection
4. **Set up GuardDuty** for threat detection
5. **Enable CloudTrail** for audit logging
6. **Use separate AWS accounts** for dev/staging/prod
7. **Implement least-privilege IAM** policies
8. **Enable MFA** for AWS console access

## Support

For issues or questions:
1. Check CloudWatch Logs
2. Review CloudFormation events
3. Check AWS Service Health Dashboard
4. Review this documentation
5. Check X-Ray traces for request flows

## Next Steps

After successful deployment:
1. Set up monitoring dashboards
2. Configure alarms and notifications
3. Implement CI/CD pipeline
4. Add integration tests
5. Set up staging environment
6. Document API for clients
7. Implement proper OAuth/OIDC
8. Add rate limiting per user
9. Implement data retention policies
10. Set up regular backups

