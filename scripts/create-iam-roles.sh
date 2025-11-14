#!/bin/bash
# Script to create IAM roles for GitHub Actions OIDC

set -e

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=${AWS_REGION:-us-east-1}

echo "Creating OIDC identity provider for GitHub Actions..."
echo "Account ID: $ACCOUNT_ID"
echo "Region: $REGION"
echo ""

# Create OIDC Identity Provider
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 \
  2>/dev/null || echo "Provider may already exist (this is OK)"

echo "✅ OIDC provider created/verified"
echo ""

# Create Dev Role
echo "Creating dev role..."
aws iam create-role \
  --role-name github-actions-wdrbe-dev \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": {
          "Federated": "arn:aws:iam::'$ACCOUNT_ID':oidc-provider/token.actions.githubusercontent.com"
        },
        "Action": "sts:AssumeRoleWithWebIdentity",
        "Condition": {
          "StringEquals": {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
          },
          "StringLike": {
            "token.actions.githubusercontent.com:sub": "repo:gursewaksingh001/wdrbe:*"
          }
        }
      }
    ]
  }' \
  2>/dev/null || echo "Dev role may already exist (this is OK)"

aws iam attach-role-policy \
  --role-name github-actions-wdrbe-dev \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess \
  2>/dev/null || echo "Policy may already be attached"

DEV_ROLE_ARN=$(aws iam get-role --role-name github-actions-wdrbe-dev --query 'Role.Arn' --output text)
echo "✅ Dev role created: $DEV_ROLE_ARN"
echo ""

# Create Prod Role
echo "Creating prod role..."
aws iam create-role \
  --role-name github-actions-wdrbe-prod \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": {
          "Federated": "arn:aws:iam::'$ACCOUNT_ID':oidc-provider/token.actions.githubusercontent.com"
        },
        "Action": "sts:AssumeRoleWithWebIdentity",
        "Condition": {
          "StringEquals": {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
          },
          "StringLike": {
            "token.actions.githubusercontent.com:sub": "repo:gursewaksingh001/wdrbe:*"
          }
        }
      }
    ]
  }' \
  2>/dev/null || echo "Prod role may already exist (this is OK)"

aws iam attach-role-policy \
  --role-name github-actions-wdrbe-prod \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess \
  2>/dev/null || echo "Policy may already be attached"

PROD_ROLE_ARN=$(aws iam get-role --role-name github-actions-wdrbe-prod --query 'Role.Arn' --output text)
echo "✅ Prod role created: $PROD_ROLE_ARN"
echo ""

echo "=========================================="
echo "✅ Setup Complete!"
echo "=========================================="
echo ""
echo "Add these to GitHub Secrets:"
echo "  AWS_DEV_ROLE_ARN = $DEV_ROLE_ARN"
echo "  AWS_PROD_ROLE_ARN = $PROD_ROLE_ARN"
echo ""
echo "Go to: https://github.com/gursewaksingh001/wdrbe/settings/secrets/actions"

