# CDK Synth Output (Sample)

```
$ cd infra
$ npm run build
$ npx cdk synth --context stage=dev

Resources:
  WdrbeStack-dev/WardrobeTable/Resource
  WdrbeStack-dev/ShareEventQueue/Resource
  WdrbeStack-dev/ShareEventDLQ/Resource
  WdrbeStack-dev/SyncApiLambda/Resource
  WdrbeStack-dev/ShareWorkerLambda/Resource
  WdrbeStack-dev/WdrbeApi/Resource
  WdrbeStack-dev/WdrbeApi/Deployment/Resource
  WdrbeStack-dev/WdrbeApi/DeploymentStage.prod/Resource
  WdrbeStack-dev/RequestValidator/Resource
  WdrbeStack-dev/ShareWorkerLambdaEventSource/Resource
  WdrbeStack-dev/SyncApiErrorAlarm/Resource
  WdrbeStack-dev/ShareWorkerErrorAlarm/Resource
  WdrbeStack-dev/DlqMessagesAlarm/Resource
  WdrbeStack-dev/ApiGateway5xxAlarm/Resource
  WdrbeStack-dev/JwtSecret/Resource

Outputs:
  WdrbeStack-dev.ApiEndpoint = https://xxxxx.execute-api.us-east-1.amazonaws.com/dev/
  WdrbeStack-dev.TableName = wdrbe-dev-table
  WdrbeStack-dev.QueueUrl = https://sqs.us-east-1.amazonaws.com/123456789012/wdrbe-dev-share-queue
  WdrbeStack-dev.SyncApiLambdaArn = arn:aws:lambda:us-east-1:123456789012:function:wdrbe-dev-sync-api
  WdrbeStack-dev.ShareWorkerLambdaArn = arn:aws:lambda:us-east-1:123456789012:function:wdrbe-dev-share-worker
```
