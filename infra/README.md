# Wdrbe Infrastructure (AWS CDK)

This directory contains the AWS CDK infrastructure code for the Wdrbe backend service.

## Structure

```
infra/
├── bin/
│   └── wdrbe.ts          # CDK app entry point
├── lib/
│   └── wdrbe-stack.ts    # Main stack definition
├── cdk.json              # CDK configuration
├── package.json          # Dependencies
└── tsconfig.json         # TypeScript config
```

## Prerequisites

- Node.js 18+
- AWS CDK CLI: `npm install -g aws-cdk`
- Configured AWS credentials

## Commands

### Install Dependencies

```bash
npm install
```

### Build TypeScript

```bash
npm run build
```

### Synthesize CloudFormation

```bash
npm run synth
# Or
cdk synth
```

This generates the CloudFormation template to `cdk.out/`.

### View Differences

```bash
npm run diff
# Or
cdk diff
```

Shows what will change in your infrastructure.

### Deploy

```bash
npm run deploy
# Or
cdk deploy
```

Deploys the stack to AWS.

### Destroy

```bash
npm run destroy
# Or
cdk destroy
```

Removes all resources (except DynamoDB table which is retained).

## Stack Resources

The `WdrbeStack` creates:

### Compute
- 2 Lambda functions (Sync API, Share Worker)

### Storage
- 1 DynamoDB table with GSI
- DynamoDB Streams enabled

### API
- 1 API Gateway REST API
- 3 endpoints with CORS

### Messaging
- 1 SQS standard queue
- 1 SQS dead-letter queue

### Security
- 2 IAM execution roles
- 1 SSM parameter (JWT secret)

### Monitoring
- 4 CloudWatch alarms
- CloudWatch Logs (2 log groups)
- X-Ray tracing

## Configuration

### Environment Variables

Set via CDK context:

```bash
cdk deploy -c stage=prod -c region=us-east-1
```

### Customization

Edit `lib/wdrbe-stack.ts` to customize:
- Lambda memory/timeout
- API throttling limits
- Alarm thresholds
- DynamoDB billing mode
- Log retention period

## Useful CDK Commands

- `cdk ls` - List all stacks
- `cdk synth` - Synthesize CloudFormation template
- `cdk diff` - Compare deployed stack with current state
- `cdk deploy` - Deploy stack to AWS
- `cdk destroy` - Remove stack from AWS
- `cdk doctor` - Check CDK environment
- `cdk docs` - Open CDK documentation

## Outputs

After deployment, the stack exports:

- `ApiEndpoint` - API Gateway URL
- `TableName` - DynamoDB table name
- `QueueUrl` - SQS queue URL
- `SyncApiLambdaArn` - Sync API Lambda ARN
- `ShareWorkerLambdaArn` - Worker Lambda ARN

Access outputs:

```bash
aws cloudformation describe-stacks \
  --stack-name WdrbeStack \
  --query 'Stacks[0].Outputs'
```

Or save to file:

```bash
cdk deploy --outputs-file outputs.json
```

## Troubleshooting

### CDK Bootstrap Error

If you see "CDK bootstrap required":

```bash
cdk bootstrap
```

### Build Errors

Clean and rebuild:

```bash
rm -rf node_modules cdk.out
npm install
npm run build
```

### Deployment Fails

Check CloudFormation console for detailed error:

```bash
aws cloudformation describe-stack-events \
  --stack-name WdrbeStack \
  --max-items 20
```

## Development

### Local Testing

CDK doesn't support local Lambda testing directly. Use:
- AWS SAM CLI for local Lambda testing
- LocalStack for local AWS services

### Adding Resources

1. Import the construct:
   ```typescript
   import * as service from 'aws-cdk-lib/aws-service';
   ```

2. Add to stack:
   ```typescript
   const resource = new service.Resource(this, 'MyResource', {
     // configuration
   });
   ```

3. Grant permissions:
   ```typescript
   resource.grantReadWrite(lambda);
   ```

### Adding Alarms

```typescript
new cloudwatch.Alarm(this, 'MyAlarm', {
  metric: lambda.metricErrors(),
  threshold: 10,
  evaluationPeriods: 2,
});
```

## Cost Optimization Tips

1. Use ARM64 architecture (already configured)
2. Keep Lambda memory appropriately sized
3. Use on-demand DynamoDB (already configured)
4. Set log retention (already set to 7 days)
5. Monitor with AWS Cost Explorer

## Security Best Practices

1. Never commit AWS credentials
2. Use least-privilege IAM roles
3. Enable encryption at rest and in transit
4. Store secrets in SSM/Secrets Manager
5. Enable CloudTrail logging
6. Use AWS WAF for API protection (optional)

## Updating the Stack

After modifying the code:

```bash
npm run build
cdk diff  # Review changes
cdk deploy  # Apply changes
```

CDK will automatically create a changeset and apply it.

## Multi-Environment Setup

Create separate stacks for different environments:

```typescript
// bin/wdrbe.ts
new WdrbeStack(app, 'WdrbeDevStack', {
  env: { account: '123', region: 'us-east-1' },
  stage: 'dev',
});

new WdrbeStack(app, 'WdrbeProdStack', {
  env: { account: '456', region: 'us-east-1' },
  stage: 'prod',
});
```

Deploy specific stack:
```bash
cdk deploy WdrbeDevStack
```

## References

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [AWS CDK API Reference](https://docs.aws.amazon.com/cdk/api/v2/)
- [AWS CDK Examples](https://github.com/aws-samples/aws-cdk-examples)

