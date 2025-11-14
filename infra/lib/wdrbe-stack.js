"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.WdrbeStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const dynamodb = __importStar(require("aws-cdk-lib/aws-dynamodb"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const apigateway = __importStar(require("aws-cdk-lib/aws-apigateway"));
const sqs = __importStar(require("aws-cdk-lib/aws-sqs"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const ssm = __importStar(require("aws-cdk-lib/aws-ssm"));
const lambdaEventSources = __importStar(require("aws-cdk-lib/aws-lambda-event-sources"));
const cloudwatch = __importStar(require("aws-cdk-lib/aws-cloudwatch"));
const aws_cdk_lib_1 = require("aws-cdk-lib");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
const workerSourcePath = path.join(__dirname, '..', '..', 'worker');
class WdrbeStack extends cdk.Stack {
    constructor(scope, id, props) {
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
            retentionPeriod: aws_cdk_lib_1.Duration.days(14),
            encryption: sqs.QueueEncryption.KMS_MANAGED,
        });
        const shareEventQueue = new sqs.Queue(this, 'ShareEventQueue', {
            queueName: `${resourcePrefix}-share-queue`,
            visibilityTimeout: aws_cdk_lib_1.Duration.seconds(300),
            retentionPeriod: aws_cdk_lib_1.Duration.days(4),
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
            timeout: aws_cdk_lib_1.Duration.seconds(30),
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
                        tryBundle(outputDir) {
                            try {
                                const unixOutput = outputDir.replace(/\\/g, '/');
                                (0, child_process_1.execSync)(`python -m pip install -r requirements.txt -t "${unixOutput}"`, {
                                    cwd: workerSourcePath,
                                    stdio: 'inherit',
                                });
                                fs.cpSync(workerSourcePath, outputDir, { recursive: true });
                                return true;
                            }
                            catch (err) {
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
            timeout: aws_cdk_lib_1.Duration.seconds(60),
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
            maxBatchingWindow: aws_cdk_lib_1.Duration.seconds(5),
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
            metric: syncApiLambda.metricErrors({ period: aws_cdk_lib_1.Duration.minutes(5) }),
            threshold: 5,
            evaluationPeriods: 1,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        new cloudwatch.Alarm(this, 'ShareWorkerErrorAlarm', {
            alarmName: `${resourcePrefix}-share-worker-errors`,
            metric: shareWorkerLambda.metricErrors({ period: aws_cdk_lib_1.Duration.minutes(5) }),
            threshold: 3,
            evaluationPeriods: 1,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        new cloudwatch.Alarm(this, 'DlqMessagesAlarm', {
            alarmName: `${resourcePrefix}-dlq-messages`,
            metric: shareEventDlq.metricApproximateNumberOfMessagesVisible({ period: aws_cdk_lib_1.Duration.minutes(5) }),
            threshold: 1,
            evaluationPeriods: 1,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        new cloudwatch.Alarm(this, 'ApiGateway5xxAlarm', {
            alarmName: `${resourcePrefix}-api-5xx`,
            metric: api.metricServerError({ period: aws_cdk_lib_1.Duration.minutes(5) }),
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
exports.WdrbeStack = WdrbeStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2RyYmUtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJ3ZHJiZS1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxpREFBbUM7QUFFbkMsbUVBQXFEO0FBQ3JELCtEQUFpRDtBQUNqRCx1RUFBeUQ7QUFDekQseURBQTJDO0FBQzNDLHlEQUEyQztBQUMzQywyREFBNkM7QUFDN0MseURBQTJDO0FBQzNDLHlGQUEyRTtBQUMzRSx1RUFBeUQ7QUFDekQsNkNBQXVDO0FBQ3ZDLDJDQUE2QjtBQUM3Qix1Q0FBeUI7QUFDekIsaURBQXlDO0FBRXpDLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxRQUFRLENBQUMsQ0FBQztBQUVwRSxNQUFhLFVBQVcsU0FBUSxHQUFHLENBQUMsS0FBSztJQUN2QyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXNCO1FBQzlELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLE9BQU8sQ0FBQyxJQUFJLEtBQUssQ0FBQztRQUN4RCxNQUFNLGNBQWMsR0FBRyxTQUFTLEtBQUssRUFBRSxDQUFDO1FBRXhDLHVDQUF1QztRQUN2QyxNQUFNLEtBQUssR0FBRyxJQUFJLFFBQVEsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLGVBQWUsRUFBRTtZQUN0RCxTQUFTLEVBQUUsR0FBRyxjQUFjLFFBQVE7WUFDcEMsWUFBWSxFQUFFLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBQyxNQUFNLEVBQUU7WUFDakUsT0FBTyxFQUFFLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsUUFBUSxD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Z0NBa1FDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiJztcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCAqIGFzIGFwaWdhdGV3YXkgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknO1xuaW1wb3J0ICogYXMgc3FzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zcXMnO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgKiBhcyBzc20gZnJvbSAnYXdzLWNkay1saWIvYXdzLXNzbSc7XG5pbXBvcnQgKiBhcyBsYW1iZGFFdmVudFNvdXJjZXMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ldmVudC1zb3VyY2VzJztcbmltcG9ydCAqIGFzIGNsb3Vkd2F0Y2ggZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3Vkd2F0Y2gnO1xuaW1wb3J0IHsgRHVyYXRpb24gfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xuaW1wb3J0IHsgZXhlY1N5bmMgfSBmcm9tICdjaGlsZF9wcm9jZXNzJztcblxuY29uc3Qgd29ya2VyU291cmNlUGF0aCA9IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicsICcuLicsICd3b3JrZXInKTtcblxuZXhwb3J0IGNsYXNzIFdkcmJlU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IGNkay5TdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCBzdGFnZSA9IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdzdGFnZScpID8/ICdkZXYnO1xuICAgIGNvbnN0IHJlc291cmNlUHJlZml4ID0gYHdkcmJlLSR7c3RhZ2V9YDtcblxuICAgIC8vIER5bmFtb0RCIHRhYmxlIChzaW5nbGUtdGFibGUgZGVzaWduKVxuICAgIGNvbnN0IHRhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdXYXJkcm9iZVRhYmxlJywge1xuICAgICAgdGFibGVOYW1lOiBgJHtyZXNvdXJjZVByZWZpeH0tdGFibGVgLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdQSycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICdTSycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgZW5jcnlwdGlvbjogZHluYW1vZGIuVGFibGVFbmNyeXB0aW9uLkFXU19NQU5BR0VELFxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeTogdHJ1ZSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IHN0YWdlID09PSAncHJvZCcgPyBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4gOiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgc3RyZWFtOiBkeW5hbW9kYi5TdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVMsXG4gICAgfSk7XG5cbiAgICB0YWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICBpbmRleE5hbWU6ICdHU0kxJyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnR1NJMVBLJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ0dTSTFTSycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuQUxMLFxuICAgIH0pO1xuXG4gICAgLy8gU1FTIHF1ZXVlICsgRExRIGZvciBzaGFyZSBldmVudHNcbiAgICBjb25zdCBzaGFyZUV2ZW50RGxxID0gbmV3IHNxcy5RdWV1ZSh0aGlzLCAnU2hhcmVFdmVudERMUScsIHtcbiAgICAgIHF1ZXVlTmFtZTogYCR7cmVzb3VyY2VQcmVmaXh9LXNoYXJlLWRscWAsXG4gICAgICByZXRlbnRpb25QZXJpb2Q6IER1cmF0aW9uLmRheXMoMTQpLFxuICAgICAgZW5jcnlwdGlvbjogc3FzLlF1ZXVlRW5jcnlwdGlvbi5LTVNfTUFOQUdFRCxcbiAgICB9KTtcblxuICAgIGNvbnN0IHNoYXJlRXZlbnRRdWV1ZSA9IG5ldyBzcXMuUXVldWUodGhpcywgJ1NoYXJlRXZlbnRRdWV1ZScsIHtcbiAgICAgIHF1ZXVlTmFtZTogYCR7cmVzb3VyY2VQcmVmaXh9LXNoYXJlLXF1ZXVlYCxcbiAgICAgIHZpc2liaWxpdHlUaW1lb3V0OiBEdXJhdGlvbi5zZWNvbmRzKDMwMCksXG4gICAgICByZXRlbnRpb25QZXJpb2Q6IER1cmF0aW9uLmRheXMoNCksXG4gICAgICBlbmNyeXB0aW9uOiBzcXMuUXVldWVFbmNyeXB0aW9uLktNU19NQU5BR0VELFxuICAgICAgZGVhZExldHRlclF1ZXVlOiB7XG4gICAgICAgIHF1ZXVlOiBzaGFyZUV2ZW50RGxxLFxuICAgICAgICBtYXhSZWNlaXZlQ291bnQ6IDMsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gSldUIHNlY3JldCBwYXJhbWV0ZXIgKHBsYWNlaG9sZGVyIHZhbHVlIG92ZXJ3cml0dGVuIHBvc3QtZGVwbG95KVxuICAgIGNvbnN0IGp3dFNlY3JldCA9IG5ldyBzc20uU3RyaW5nUGFyYW1ldGVyKHRoaXMsICdKd3RTZWNyZXQnLCB7XG4gICAgICBwYXJhbWV0ZXJOYW1lOiBgLyR7cmVzb3VyY2VQcmVmaXh9L2p3dC1zZWNyZXRgLFxuICAgICAgc3RyaW5nVmFsdWU6ICdyZXBsYWNlLW1lLWluLXNzbScsXG4gICAgICBkZXNjcmlwdGlvbjogJ0pXVCBzZWNyZXQgZm9yIHZhbGlkYXRpbmcgdG9rZW5zJyxcbiAgICAgIHRpZXI6IHNzbS5QYXJhbWV0ZXJUaWVyLlNUQU5EQVJELFxuICAgIH0pO1xuXG4gICAgLy8gLk5FVCBMYW1iZGEgKFN5bmMgQVBJKVxuICAgIGNvbnN0IHN5bmNBcGlMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdTeW5jQXBpTGFtYmRhJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiBgJHtyZXNvdXJjZVByZWZpeH0tc3luYy1hcGlgLFxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuRE9UTkVUXzgsXG4gICAgICBoYW5kbGVyOiAnV2FyZHJvYmVJdGVtcy5BcGk6OldhcmRyb2JlSXRlbXMuQXBpLkZ1bmN0aW9uOjpGdW5jdGlvbkhhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCcuLi9hcGkvYmluL1JlbGVhc2UvbmV0OC4wL3B1Ymxpc2gnKSxcbiAgICAgIGFyY2hpdGVjdHVyZTogbGFtYmRhLkFyY2hpdGVjdHVyZS5BUk1fNjQsXG4gICAgICBtZW1vcnlTaXplOiA1MTIsXG4gICAgICB0aW1lb3V0OiBEdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgICAgdHJhY2luZzogbGFtYmRhLlRyYWNpbmcuQUNUSVZFLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgVEFCTEVfTkFNRTogdGFibGUudGFibGVOYW1lLFxuICAgICAgICBRVUVVRV9VUkw6IHNoYXJlRXZlbnRRdWV1ZS5xdWV1ZVVybCxcbiAgICAgICAgSldUX1NFQ1JFVF9QQVJBTTogand0U2VjcmV0LnBhcmFtZXRlck5hbWUsXG4gICAgICAgIFBPV0VSVE9PTFNfU0VSVklDRV9OQU1FOiAnd2RyYmUtc3luYy1hcGknLFxuICAgICAgICBQT1dFUlRPT0xTX0xPR19MRVZFTDogc3RhZ2UgPT09ICdwcm9kJyA/ICdJTkZPJyA6ICdERUJVRycsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHN5bmNBcGlMYW1iZGEpO1xuICAgIHNoYXJlRXZlbnRRdWV1ZS5ncmFudFNlbmRNZXNzYWdlcyhzeW5jQXBpTGFtYmRhKTtcbiAgICBqd3RTZWNyZXQuZ3JhbnRSZWFkKHN5bmNBcGlMYW1iZGEpO1xuXG4gICAgc3luY0FwaUxhbWJkYS5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogWydjbG91ZHdhdGNoOlB1dE1ldHJpY0RhdGEnXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgICBjb25kaXRpb25zOiB7XG4gICAgICAgIFN0cmluZ0VxdWFsczogeyAnY2xvdWR3YXRjaDpuYW1lc3BhY2UnOiAnV2RyYmUnIH0sXG4gICAgICB9LFxuICAgIH0pKTtcblxuICAgIC8vIFB5dGhvbiBMYW1iZGEgKFNoYXJlIFdvcmtlcilcbiAgICBjb25zdCBzaGFyZVdvcmtlckxhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1NoYXJlV29ya2VyTGFtYmRhJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiAnd2RyYmUtc2hhcmUtd29ya2VyJyxcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzEyLFxuICAgICAgaGFuZGxlcjogJ2hhbmRsZXIubGFtYmRhX2hhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHdvcmtlclNvdXJjZVBhdGgsIHtcbiAgICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgICBsb2NhbDoge1xuICAgICAgICAgICAgdHJ5QnVuZGxlKG91dHB1dERpcjogc3RyaW5nKSB7XG4gICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdW5peE91dHB1dCA9IG91dHB1dERpci5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG4gICAgICAgICAgICAgICAgZXhlY1N5bmMoYHB5dGhvbiAtbSBwaXAgaW5zdGFsbCAtciByZXF1aXJlbWVudHMudHh0IC10IFwiJHt1bml4T3V0cHV0fVwiYCwge1xuICAgICAgICAgICAgICAgICAgY3dkOiB3b3JrZXJTb3VyY2VQYXRoLFxuICAgICAgICAgICAgICAgICAgc3RkaW86ICdpbmhlcml0JyxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICBmcy5jcFN5bmMod29ya2VyU291cmNlUGF0aCwgb3V0cHV0RGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS53YXJuKCdMb2NhbCBidW5kbGluZyBmb3Igc2hhcmUgd29ya2VyIGZhaWxlZCwgZmFsbGluZyBiYWNrIHRvIERvY2tlciBidW5kbGluZy4nLCBlcnIpO1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGltYWdlOiBsYW1iZGEuUnVudGltZS5QWVRIT05fM18xMi5idW5kbGluZ0ltYWdlLFxuICAgICAgICAgIGNvbW1hbmQ6IFtcbiAgICAgICAgICAgICdiYXNoJyxcbiAgICAgICAgICAgICctYycsXG4gICAgICAgICAgICAncGlwIGluc3RhbGwgLXIgcmVxdWlyZW1lbnRzLnR4dCAtdCAvYXNzZXQtb3V0cHV0ICYmIGNwIC1hdSAuIC9hc3NldC1vdXRwdXQnLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICAgIG1lbW9yeVNpemU6IDI1NixcbiAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLnNlY29uZHMoNjApLFxuICAgICAgYXJjaGl0ZWN0dXJlOiBsYW1iZGEuQXJjaGl0ZWN0dXJlLkFSTV82NCxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIFRBQkxFX05BTUU6IHRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgUE9XRVJUT09MU19TRVJWSUNFX05BTUU6ICd3ZHJiZS1zaGFyZS13b3JrZXInLFxuICAgICAgICBQT1dFUlRPT0xTX0xPR19MRVZFTDogJ0lORk8nLFxuICAgICAgfSxcbiAgICAgIHRyYWNpbmc6IGxhbWJkYS5UcmFjaW5nLkFDVElWRSxcbiAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgIH0pO1xuXG4gICAgdGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHNoYXJlV29ya2VyTGFtYmRhKTtcblxuICAgIHNoYXJlV29ya2VyTGFtYmRhLmFkZEV2ZW50U291cmNlKG5ldyBsYW1iZGFFdmVudFNvdXJjZXMuU3FzRXZlbnRTb3VyY2Uoc2hhcmVFdmVudFF1ZXVlLCB7XG4gICAgICBiYXRjaFNpemU6IDEwLFxuICAgICAgbWF4QmF0Y2hpbmdXaW5kb3c6IER1cmF0aW9uLnNlY29uZHMoNSksXG4gICAgICByZXBvcnRCYXRjaEl0ZW1GYWlsdXJlczogdHJ1ZSxcbiAgICB9KSk7XG5cbiAgICAvLyBBUEkgR2F0ZXdheVxuICAgIGNvbnN0IGFwaSA9IG5ldyBhcGlnYXRld2F5LlJlc3RBcGkodGhpcywgJ1dkcmJlQXBpJywge1xuICAgICAgcmVzdEFwaU5hbWU6IGAke3Jlc291cmNlUHJlZml4fS1hcGlgLFxuICAgICAgZGVzY3JpcHRpb246ICdXYXJkcm9iZSBJdGVtcyBTeW5jIEFQSScsXG4gICAgICBkZXBsb3lPcHRpb25zOiB7XG4gICAgICAgIHN0YWdlTmFtZTogc3RhZ2UsXG4gICAgICAgIHRyYWNpbmdFbmFibGVkOiB0cnVlLFxuICAgICAgICBsb2dnaW5nTGV2ZWw6IGFwaWdhdGV3YXkuTWV0aG9kTG9nZ2luZ0xldmVsLklORk8sXG4gICAgICAgIGRhdGFUcmFjZUVuYWJsZWQ6IHN0YWdlICE9PSAncHJvZCcsXG4gICAgICAgIG1ldHJpY3NFbmFibGVkOiB0cnVlLFxuICAgICAgICB0aHJvdHRsaW5nQnVyc3RMaW1pdDogMTAwLFxuICAgICAgICB0aHJvdHRsaW5nUmF0ZUxpbWl0OiA1MCxcbiAgICAgIH0sXG4gICAgICBkZWZhdWx0Q29yc1ByZWZsaWdodE9wdGlvbnM6IHtcbiAgICAgICAgYWxsb3dPcmlnaW5zOiBhcGlnYXRld2F5LkNvcnMuQUxMX09SSUdJTlMsXG4gICAgICAgIGFsbG93TWV0aG9kczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9NRVRIT0RTLFxuICAgICAgICBhbGxvd0hlYWRlcnM6IFsnQXV0aG9yaXphdGlvbicsICdDb250ZW50LVR5cGUnLCAnWC1SZXF1ZXN0LUlkJ10sXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgY29uc3QgaW50ZWdyYXRpb24gPSBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihzeW5jQXBpTGFtYmRhKTtcblxuICAgIGNvbnN0IHJlcXVlc3RWYWxpZGF0b3IgPSBuZXcgYXBpZ2F0ZXdheS5SZXF1ZXN0VmFsaWRhdG9yKHRoaXMsICdSZXF1ZXN0VmFsaWRhdG9yJywge1xuICAgICAgcmVzdEFwaTogYXBpLFxuICAgICAgdmFsaWRhdGVSZXF1ZXN0Qm9keTogdHJ1ZSxcbiAgICAgIHZhbGlkYXRlUmVxdWVzdFBhcmFtZXRlcnM6IHRydWUsXG4gICAgfSk7XG5cbiAgICBjb25zdCB1c2VycyA9IGFwaS5yb290LmFkZFJlc291cmNlKCd1c2VycycpO1xuICAgIGNvbnN0IHVzZXIgPSB1c2Vycy5hZGRSZXNvdXJjZSgne3VzZXJJZH0nKTtcbiAgICBjb25zdCBpdGVtcyA9IHVzZXIuYWRkUmVzb3VyY2UoJ2l0ZW1zJyk7XG5cbiAgICBpdGVtcy5hZGRNZXRob2QoJ1BPU1QnLCBpbnRlZ3JhdGlvbiwge1xuICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuTk9ORSxcbiAgICAgIHJlcXVlc3RQYXJhbWV0ZXJzOiB7XG4gICAgICAgICdtZXRob2QucmVxdWVzdC5oZWFkZXIuQXV0aG9yaXphdGlvbic6IHRydWUsXG4gICAgICB9LFxuICAgICAgcmVxdWVzdFZhbGlkYXRvcixcbiAgICB9KTtcblxuICAgIGl0ZW1zLmFkZE1ldGhvZCgnR0VUJywgaW50ZWdyYXRpb24sIHtcbiAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLk5PTkUsXG4gICAgICByZXF1ZXN0UGFyYW1ldGVyczoge1xuICAgICAgICAnbWV0aG9kLnJlcXVlc3QuaGVhZGVyLkF1dGhvcml6YXRpb24nOiB0cnVlLFxuICAgICAgICAnbWV0aG9kLnJlcXVlc3QucXVlcnlzdHJpbmcuc2Vhc29uJzogZmFsc2UsXG4gICAgICAgICdtZXRob2QucmVxdWVzdC5xdWVyeXN0cmluZy5jYXRlZ29yeSc6IGZhbHNlLFxuICAgICAgICAnbWV0aG9kLnJlcXVlc3QucXVlcnlzdHJpbmcubGltaXQnOiBmYWxzZSxcbiAgICAgICAgJ21ldGhvZC5yZXF1ZXN0LnF1ZXJ5c3RyaW5nLmN1cnNvcic6IGZhbHNlLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGl0ZW1zUm9vdCA9IGFwaS5yb290LmFkZFJlc291cmNlKCdpdGVtcycpO1xuICAgIGNvbnN0IGl0ZW1CeUlkID0gaXRlbXNSb290LmFkZFJlc291cmNlKCd7aXRlbUlkfScpO1xuICAgIGNvbnN0IHNoYXJlID0gaXRlbUJ5SWQuYWRkUmVzb3VyY2UoJ3NoYXJlJyk7XG5cbiAgICBzaGFyZS5hZGRNZXRob2QoJ1BPU1QnLCBpbnRlZ3JhdGlvbiwge1xuICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuTk9ORSxcbiAgICAgIHJlcXVlc3RQYXJhbWV0ZXJzOiB7XG4gICAgICAgICdtZXRob2QucmVxdWVzdC5oZWFkZXIuQXV0aG9yaXphdGlvbic6IHRydWUsXG4gICAgICB9LFxuICAgICAgcmVxdWVzdFZhbGlkYXRvcixcbiAgICB9KTtcblxuICAgIC8vIENsb3VkV2F0Y2ggYWxhcm1zXG4gICAgbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ1N5bmNBcGlFcnJvckFsYXJtJywge1xuICAgICAgYWxhcm1OYW1lOiBgJHtyZXNvdXJjZVByZWZpeH0tc3luYy1hcGktZXJyb3JzYCxcbiAgICAgIG1ldHJpYzogc3luY0FwaUxhbWJkYS5tZXRyaWNFcnJvcnMoeyBwZXJpb2Q6IER1cmF0aW9uLm1pbnV0ZXMoNSkgfSksXG4gICAgICB0aHJlc2hvbGQ6IDUsXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgIH0pO1xuXG4gICAgbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ1NoYXJlV29ya2VyRXJyb3JBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogYCR7cmVzb3VyY2VQcmVmaXh9LXNoYXJlLXdvcmtlci1lcnJvcnNgLFxuICAgICAgbWV0cmljOiBzaGFyZVdvcmtlckxhbWJkYS5tZXRyaWNFcnJvcnMoeyBwZXJpb2Q6IER1cmF0aW9uLm1pbnV0ZXMoNSkgfSksXG4gICAgICB0aHJlc2hvbGQ6IDMsXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgIH0pO1xuXG4gICAgbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ0RscU1lc3NhZ2VzQWxhcm0nLCB7XG4gICAgICBhbGFybU5hbWU6IGAke3Jlc291cmNlUHJlZml4fS1kbHEtbWVzc2FnZXNgLFxuICAgICAgbWV0cmljOiBzaGFyZUV2ZW50RGxxLm1ldHJpY0FwcHJveGltYXRlTnVtYmVyT2ZNZXNzYWdlc1Zpc2libGUoeyBwZXJpb2Q6IER1cmF0aW9uLm1pbnV0ZXMoNSkgfSksXG4gICAgICB0aHJlc2hvbGQ6IDEsXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgIH0pO1xuXG4gICAgbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ0FwaUdhdGV3YXk1eHhBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogYCR7cmVzb3VyY2VQcmVmaXh9LWFwaS01eHhgLFxuICAgICAgbWV0cmljOiBhcGkubWV0cmljU2VydmVyRXJyb3IoeyBwZXJpb2Q6IER1cmF0aW9uLm1pbnV0ZXMoNSkgfSksXG4gICAgICB0aHJlc2hvbGQ6IDUsXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgIH0pO1xuXG4gICAgLy8gT3V0cHV0c1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBcGlFbmRwb2ludCcsIHtcbiAgICAgIHZhbHVlOiBhcGkudXJsID8/ICduL2EnLFxuICAgICAgZXhwb3J0TmFtZTogYCR7cmVzb3VyY2VQcmVmaXh9LWFwaS1lbmRwb2ludGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVGFibGVOYW1lJywge1xuICAgICAgdmFsdWU6IHRhYmxlLnRhYmxlTmFtZSxcbiAgICAgIGV4cG9ydE5hbWU6IGAke3Jlc291cmNlUHJlZml4fS10YWJsZS1uYW1lYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdRdWV1ZVVybCcsIHtcbiAgICAgIHZhbHVlOiBzaGFyZUV2ZW50UXVldWUucXVldWVVcmwsXG4gICAgICBleHBvcnROYW1lOiBgJHtyZXNvdXJjZVByZWZpeH0tc2hhcmUtcXVldWUtdXJsYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTeW5jQXBpTGFtYmRhQXJuJywge1xuICAgICAgdmFsdWU6IHN5bmNBcGlMYW1iZGEuZnVuY3Rpb25Bcm4sXG4gICAgICBleHBvcnROYW1lOiBgJHtyZXNvdXJjZVByZWZpeH0tc3luYy1hcGktYXJuYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTaGFyZVdvcmtlckxhbWJkYUFybicsIHtcbiAgICAgIHZhbHVlOiBzaGFyZVdvcmtlckxhbWJkYS5mdW5jdGlvbkFybixcbiAgICAgIGV4cG9ydE5hbWU6IGAke3Jlc291cmNlUHJlZml4fS1zaGFyZS13b3JrZXItYXJuYCxcbiAgICB9KTtcbiAgfVxufVxuXG4iXX0=