# CI/CD Workflows

This repository contains three GitHub Actions workflows for continuous integration and deployment.

## Workflows Overview

### 1. `ci.yml` - Continuous Integration
**Triggers:**
- Pull requests to `main` branch
- Pushes to `main` branch

**What it does:**
- ✅ Builds .NET Lambda API
- ✅ Runs .NET tests (if any exist)
- ✅ Lints Python worker code (using `ruff`)
- ✅ Runs Python worker tests (if any exist)
- ✅ Synthesizes CDK stack (validates infrastructure)

**No deployment** - This workflow only validates code and infrastructure.

---

### 2. `deploy-dev.yml` - Development Deployment
**Triggers:**
- Pushes to `main` branch
- Ignores changes to `.md`, `.gitignore`, `.editorconfig` files

**What it does:**
- ✅ Builds and publishes .NET Lambda
- ✅ Deploys CDK stack to **dev** environment (`WdrbeStack-dev`)
- ✅ Uses `AWS_DEV_ROLE_ARN` secret for authentication

**Required Secrets:**
- `AWS_DEV_ROLE_ARN` - IAM role ARN for dev deployments

---

### 3. `deploy.yml` - Production Deployment
**Triggers:**
- Pushes of tags matching `v*.*.*` (e.g., `v1.0.0`, `v2.3.1`)

**What it does:**
- ✅ Builds and publishes .NET Lambda
- ✅ Deploys CDK stack to **prod** environment (`WdrbeStack-prod`)
- ✅ Uses `AWS_PROD_ROLE_ARN` secret for authentication

**Required Secrets:**
- `AWS_PROD_ROLE_ARN` - IAM role ARN for production deployments

---

## Setup Instructions

### 1. Create IAM Roles (Already Done ✅)
The IAM roles have been created using the script:
- `github-actions-wdrbe-dev`
- `github-actions-wdrbe-prod`

### 2. Add GitHub Secrets
Go to: https://github.com/gursewaksingh001/wdrbe/settings/secrets/actions

Add these secrets:
- **Name:** `AWS_DEV_ROLE_ARN`  
  **Value:** `arn:aws:iam::101859807817:role/github-actions-wdrbe-dev`

- **Name:** `AWS_PROD_ROLE_ARN`  
  **Value:** `arn:aws:iam::101859807817:role/github-actions-wdrbe-prod`

### 3. Push Code
```bash
git add .
git commit -m "feat: Add CI/CD pipelines"
git push origin feature/aws-demo
```

### 4. Create PR to Main
- Create a pull request from `feature/aws-demo` to `main`
- The `ci.yml` workflow will run automatically
- Review the CI results before merging

### 5. Merge to Main (Triggers Dev Deploy)
- After merging the PR, `deploy-dev.yml` will automatically deploy to dev
- Monitor the deployment in the Actions tab

### 6. Deploy to Production
To deploy to production, create and push a version tag:
```bash
git tag v1.0.0
git push origin v1.0.0
```
This will trigger `deploy.yml` to deploy to production.

---

## Workflow Details

### Environment Variables
- `DOTNET_CLI_TELEMETRY_OPTOUT: 1` - Disables .NET telemetry
- `DOTNET_NOLOGO: 1` - Hides .NET logo
- `CDK_NEW_BOOTSTRAP: 1` - Uses new CDK bootstrap format

### AWS Configuration
- **Region:** `us-east-1`
- **Authentication:** OIDC (no access keys needed)
- **Stack Names:**
  - Dev: `WdrbeStack-dev`
  - Prod: `WdrbeStack-prod`

### Build Steps
1. **Checkout** code
2. **Setup** Node.js 18, .NET 8.0, Python 3.12
3. **Install** CDK dependencies (`npm ci` in `infra/`)
4. **Build** .NET Lambda (`dotnet publish` in `api/`)
5. **Deploy** CDK stack (`npx cdk deploy`)

---

## Monitoring

### View Workflow Runs
- Go to: https://github.com/gursewaksingh001/wdrbe/actions

### Check Deployment Status
- Green checkmark ✅ = Success
- Red X ❌ = Failed (check logs)
- Yellow circle ⏳ = In progress

### View Logs
1. Click on a workflow run
2. Click on the job (e.g., "deploy")
3. Expand steps to see detailed logs

---

## Troubleshooting

### Workflow Fails with "Role not found"
- Verify GitHub secrets are set correctly
- Check IAM role ARNs match the secrets

### CDK Deploy Fails
- Check AWS credentials are configured
- Verify CDK bootstrap: `cdk bootstrap aws://ACCOUNT_ID/REGION`
- Check CloudFormation console for detailed errors

### .NET Build Fails
- Verify `WardrobeItems.Api.csproj` exists in `api/` directory
- Check for missing NuGet packages

### Python Lint Fails
- Install `ruff` locally: `pip install ruff`
- Run: `ruff check worker/`

---

## Best Practices

1. **Always create PRs** - Let CI validate before merging
2. **Review CI results** - Don't merge if CI fails
3. **Use semantic versioning** - Tags like `v1.0.0`, `v1.1.0`, `v2.0.0`
4. **Monitor deployments** - Check Actions tab after deployment
5. **Test in dev first** - Deploy to dev before production

---

## Workflow Files

- `.github/workflows/ci.yml` - CI pipeline
- `.github/workflows/deploy-dev.yml` - Dev deployment
- `.github/workflows/deploy.yml` - Prod deployment
