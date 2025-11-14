import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Duration } from 'aws-cdk-lib';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

const workerSourcePath = path.join(__dirname, '..', '..', 'worker');

export class WdrbeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const stage = this.node.tryGetContext('stage') ?? 'dev';
    const resourcePrefix = `wdrbe-${stage}`;

    // DynamoDB table (single-table design)
    const table = new dynamodb.Table(this, 'WardrobeTable', {
      tableName: `${resourcePrefix}-table`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // SQS queue + DLQ for share events
    const shareEventDlq = new sqs.Queue(this, 'ShareEventDLQ', {
      queueName: `${resourcePrefix}-share-dlq`,
      retentionPeriod: Duration.days(14),
      encryption: sqs.QueueEncryption.KMS_MANAGED,
    });

    const shareEventQueue = new sqs.Queue(this, 'ShareEventQueue', {
      queueName: `${resourcePrefix}-share-queue`,
      visibilityTimeout: Duration.seconds(300),
      retentionPeriod: Duration.days(4),
      encryption: sqs.QueueEncryption.KMS_MANAGED,
      deadLetterQueue: {
        queue: shareEventDlq,
        maxReceiveCount: 3,
      },
    });

    // JWT secret parameter (placeholder value overwritten post-deploy)
    const jwtSecret = new ssm.StringParameter(this, 'JwtSecret', {
      parameterName: `/${resourcePrefix}/jwt-secret`,
      stringValue: 'replace-me-in-ssm',
      description: 'JWT secret for validating tokens',
      tier: ssm.ParameterTier.STANDARD,
    });

    // .NET Lambda (Sync API)
    const syncApiLambda = new lambda.Function(this, 'SyncApiLambda', {
      functionName: `${resourcePrefix}-sync-api`,
      runtime: lambda.Runtime.DOTNET_8,
      handler: 'WardrobeItems.Api::WardrobeItems.Api.Function::FunctionHandler',
      code: lambda.Code.fromAsset('../api/bin/Release/net8.0/publish'),
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(30),
      logRetention: logs.RetentionDays.ONE_WEEK,
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        TABLE_NAME: table.tableName,
        QUEUE_URL: shareEventQueue.queueUrl,
        JWT_SECRET_PARAM: jwtSecret.parameterName,
        POWERTOOLS_SERVICE_NAME: 'wdrbe-sync-api',
        POWERTOOLS_LOG_LEVEL: stage === 'prod' ? 'INFO' : 'DEBUG',
      },
    });

    table.grantReadWriteData(syncApiLambda);
    shareEventQueue.grantSendMessages(syncApiLambda);
    jwtSecret.grantRead(syncApiLambda);

    syncApiLambda.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
      conditions: {
        StringEquals: { 'cloudwatch:namespace': 'Wdrbe' },
      },
    }));

    // Python Lambda (Share Worker)
    const shareWorkerLambda = new lambda.Function(this, 'ShareWorkerLambda', {
      functionName: 'wdrbe-share-worker',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.lambda_handler',
      code: lambda.Code.fromAsset(workerSourcePath, {
        bundling: {
          local: {
            tryBundle(outputDir: string) {
              try {
                const unixOutput = outputDir.replace(/\\/g, '/');
                execSync(`python -m pip install -r requirements.txt -t "${unixOutput}"`, {
                  cwd: workerSourcePath,
                  stdio: 'inherit',
                });
                fs.cpSync(workerSourcePath, outputDir, { recursive: true });
                return true;
              } catch (err) {
                console.warn('Local bundling for share worker failed, falling back to Docker bundling.', err);
                return false;
              }
            },
          },
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          command: [
            'bash',
            '-c',
            'pip install -r requirements.txt -t /asset-output && cp -au . /asset-output',
          ],
        },
      }),
      memorySize: 256,
      timeout: Duration.seconds(60),
      architecture: lambda.Architecture.ARM_64,
      environment: {
        TABLE_NAME: table.tableName,
        POWERTOOLS_SERVICE_NAME: 'wdrbe-share-worker',
        POWERTOOLS_LOG_LEVEL: 'INFO',
      },
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    table.grantReadWriteData(shareWorkerLambda);

    shareWorkerLambda.addEventSource(new lambdaEventSources.SqsEventSource(shareEventQueue, {
        batchSize: 10,
        maxBatchingWindow: Duration.seconds(5),
      reportBatchItemFailures: true,
    }));

    // API Gateway
    const api = new apigateway.RestApi(this, 'WdrbeApi', {
      restApiName: `${resourcePrefix}-api`,
      description: 'Wardrobe Items Sync API',
      deployOptions: {
        stageName: stage,
        tracingEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: stage !== 'prod',
        metricsEnabled: true,
        throttlingBurstLimit: 100,
        throttlingRateLimit: 50,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
      },
    });

    const integration = new apigateway.LambdaIntegration(syncApiLambda);

    const requestValidator = new apigateway.RequestValidator(this, 'RequestValidator', {
      restApi: api,
      validateRequestBody: true,
      validateRequestParameters: true,
    });

    const users = api.root.addResource('users');
    const user = users.addResource('{userId}');
    const items = user.addResource('items');

    items.addMethod('POST', integration, {
      authorizationType: apigateway.AuthorizationType.NONE,
      requestParameters: {
        'method.request.header.Authorization': true,
      },
      requestValidator,
    });

    items.addMethod('GET', integration, {
      authorizationType: apigateway.AuthorizationType.NONE,
      requestParameters: {
        'method.request.header.Authorization': true,
        'method.request.querystring.season': false,
        'method.request.querystring.category': false,
        'method.request.querystring.limit': false,
        'method.request.querystring.cursor': false,
      },
    });

    const itemsRoot = api.root.addResource('items');
    const itemById = itemsRoot.addResource('{itemId}');
    const share = itemById.addResource('share');

    share.addMethod('POST', integration, {
      authorizationType: apigateway.AuthorizationType.NONE,
      requestParameters: {
        'method.request.header.Authorization': true,
      },
      requestValidator,
    });

    // CloudWatch alarms
    new cloudwatch.Alarm(this, 'SyncApiErrorAlarm', {
      alarmName: `${resourcePrefix}-sync-api-errors`,
      metric: syncApiLambda.metricErrors({ period: Duration.minutes(5) }),
      threshold: 5,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new cloudwatch.Alarm(this, 'ShareWorkerErrorAlarm', {
      alarmName: `${resourcePrefix}-share-worker-errors`,
      metric: shareWorkerLambda.metricErrors({ period: Duration.minutes(5) }),
      threshold: 3,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new cloudwatch.Alarm(this, 'DlqMessagesAlarm', {
      alarmName: `${resourcePrefix}-dlq-messages`,
      metric: shareEventDlq.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new cloudwatch.Alarm(this, 'ApiGateway5xxAlarm', {
      alarmName: `${resourcePrefix}-api-5xx`,
      metric: api.metricServerError({ period: Duration.minutes(5) }),
      threshold: 5,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Outputs
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.url ?? 'n/a',
      exportName: `${resourcePrefix}-api-endpoint`,
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: table.tableName,
      exportName: `${resourcePrefix}-table-name`,
    });

    new cdk.CfnOutput(this, 'QueueUrl', {
      value: shareEventQueue.queueUrl,
      exportName: `${resourcePrefix}-share-queue-url`,
    });

    new cdk.CfnOutput(this, 'SyncApiLambdaArn', {
      value: syncApiLambda.functionArn,
      exportName: `${resourcePrefix}-sync-api-arn`,
    });

    new cdk.CfnOutput(this, 'ShareWorkerLambdaArn', {
      value: shareWorkerLambda.functionArn,
      exportName: `${resourcePrefix}-share-worker-arn`,
    });
  }
}

