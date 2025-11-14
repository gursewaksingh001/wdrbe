# PowerShell script to create IAM roles for GitHub Actions OIDC

$ErrorActionPreference = "Stop"

Write-Host "Creating IAM roles for GitHub Actions..." -ForegroundColor Cyan
Write-Host ""

# Get account ID (use profile if provided)
$profile = $args[0]

if ($profile) {
    $accountId = (aws sts get-caller-identity --profile $profile --query Account --output text).Trim()
} else {
    $accountId = (aws sts get-caller-identity --query Account --output text).Trim()
}

if (-not $accountId) {
    Write-Host "Error: Unable to get AWS account ID. Make sure AWS CLI is configured." -ForegroundColor Red
    Write-Host "Run: aws configure --profile my-profile" -ForegroundColor Yellow
    Write-Host "Then run: .\scripts\create-iam-roles.ps1 my-profile" -ForegroundColor Yellow
    exit 1
}
Write-Host "Account ID: $accountId" -ForegroundColor Yellow
Write-Host ""

# Create OIDC Identity Provider
Write-Host "Creating OIDC identity provider..." -ForegroundColor Yellow
try {
    if ($profile) {
        aws iam create-open-id-connect-provider --profile $profile --url "https://token.actions.githubusercontent.com" --client-id-list "sts.amazonaws.com" --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1" 2>&1 | Out-Null
    } else {
        aws iam create-open-id-connect-provider --url "https://token.actions.githubusercontent.com" --client-id-list "sts.amazonaws.com" --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1" 2>&1 | Out-Null
    }
    Write-Host "✅ OIDC provider created" -ForegroundColor Green
} catch {
    Write-Host "⚠️  Provider may already exist (this is OK)" -ForegroundColor Yellow
}
Write-Host ""

# Create Dev Role
Write-Host "Creating dev role..." -ForegroundColor Yellow
$devTrustPolicyJson = @"
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::${accountId}:oidc-provider/token.actions.githubusercontent.com"
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
}
"@
[System.IO.File]::WriteAllText("$env:TEMP\dev-trust-policy.json", $devTrustPolicyJson, [System.Text.UTF8Encoding]::new($false))

$createRoleOutput = if ($profile) {
    aws iam create-role --profile $profile --role-name "github-actions-wdrbe-dev" --assume-role-policy-document "file://$env:TEMP\dev-trust-policy.json" 2>&1
} else {
    aws iam create-role --role-name "github-actions-wdrbe-dev" --assume-role-policy-document "file://$env:TEMP\dev-trust-policy.json" 2>&1
}

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Dev role created" -ForegroundColor Green
} elseif ($createRoleOutput -match "EntityAlreadyExists") {
    Write-Host "⚠️  Dev role already exists (this is OK)" -ForegroundColor Yellow
} else {
    Write-Host "⚠️  Error creating dev role: $createRoleOutput" -ForegroundColor Yellow
}

try {
    if ($profile) {
        aws iam attach-role-policy --profile $profile --role-name "github-actions-wdrbe-dev" --policy-arn "arn:aws:iam::aws:policy/AdministratorAccess" 2>&1 | Out-Null
    } else {
        aws iam attach-role-policy --role-name "github-actions-wdrbe-dev" --policy-arn "arn:aws:iam::aws:policy/AdministratorAccess" 2>&1 | Out-Null
    }
} catch {
    Write-Host "⚠️  Policy may already be attached" -ForegroundColor Yellow
}

if ($profile) {
    $devRoleArnOutput = aws iam get-role --profile $profile --role-name "github-actions-wdrbe-dev" --query 'Role.Arn' --output text 2>&1
} else {
    $devRoleArnOutput = aws iam get-role --role-name "github-actions-wdrbe-dev" --query 'Role.Arn' --output text 2>&1
}

if ($LASTEXITCODE -eq 0) {
    $devRoleArn = $devRoleArnOutput.Trim()
    Write-Host "Dev Role ARN: $devRoleArn" -ForegroundColor Cyan
} else {
    Write-Host "❌ Error: Dev role not found. Please check the error above." -ForegroundColor Red
    exit 1
}
Write-Host ""

# Create Prod Role
Write-Host "Creating prod role..." -ForegroundColor Yellow
$prodTrustPolicyJson = @"
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::${accountId}:oidc-provider/token.actions.githubusercontent.com"
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
}
"@
[System.IO.File]::WriteAllText("$env:TEMP\prod-trust-policy.json", $prodTrustPolicyJson, [System.Text.UTF8Encoding]::new($false))

$createRoleOutput = if ($profile) {
    aws iam create-role --profile $profile --role-name "github-actions-wdrbe-prod" --assume-role-policy-document "file://$env:TEMP\prod-trust-policy.json" 2>&1
} else {
    aws iam create-role --role-name "github-actions-wdrbe-prod" --assume-role-policy-document "file://$env:TEMP\prod-trust-policy.json" 2>&1
}

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Prod role created" -ForegroundColor Green
} elseif ($createRoleOutput -match "EntityAlreadyExists") {
    Write-Host "⚠️  Prod role already exists (this is OK)" -ForegroundColor Yellow
} else {
    Write-Host "⚠️  Error creating prod role: $createRoleOutput" -ForegroundColor Yellow
}

try {
    if ($profile) {
        aws iam attach-role-policy --profile $profile --role-name "github-actions-wdrbe-prod" --policy-arn "arn:aws:iam::aws:policy/AdministratorAccess" 2>&1 | Out-Null
    } else {
        aws iam attach-role-policy --role-name "github-actions-wdrbe-prod" --policy-arn "arn:aws:iam::aws:policy/AdministratorAccess" 2>&1 | Out-Null
    }
} catch {
    Write-Host "⚠️  Policy may already be attached" -ForegroundColor Yellow
}

if ($profile) {
    $prodRoleArnOutput = aws iam get-role --profile $profile --role-name "github-actions-wdrbe-prod" --query 'Role.Arn' --output text 2>&1
} else {
    $prodRoleArnOutput = aws iam get-role --role-name "github-actions-wdrbe-prod" --query 'Role.Arn' --output text 2>&1
}

if ($LASTEXITCODE -eq 0) {
    $prodRoleArn = $prodRoleArnOutput.Trim()
    Write-Host "Prod Role ARN: $prodRoleArn" -ForegroundColor Cyan
} else {
    Write-Host "❌ Error: Prod role not found. Please check the error above." -ForegroundColor Red
    exit 1
}
Write-Host ""

Write-Host "==========================================" -ForegroundColor Green
Write-Host "✅ Setup Complete!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Add these to GitHub Secrets:" -ForegroundColor Yellow
Write-Host "  AWS_DEV_ROLE_ARN = $devRoleArn" -ForegroundColor White
Write-Host "  AWS_PROD_ROLE_ARN = $prodRoleArn" -ForegroundColor White
Write-Host ""
Write-Host "Go to: https://github.com/gursewaksingh001/wdrbe/settings/secrets/actions" -ForegroundColor Cyan

