#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { WdrbeStack } from '../lib/wdrbe-stack';

const app = new cdk.App();

const stage = app.node.tryGetContext('stage') ?? 'dev';

new WdrbeStack(app, `WdrbeStack-${stage}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  description: `Wdrbe Wardrobe Items Service (${stage})`,
  tags: {
    Project: 'Wdrbe',
    Environment: stage,
    ManagedBy: 'CDK',
  },
});

