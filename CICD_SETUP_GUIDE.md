# Complete CI/CD Setup Guide - Step by Step

This guide walks you through setting up the entire CI/CD pipeline for Wdrbe backend service.

---

## Part 1: Create IAM Roles for GitHub Actions (OIDC)

### Step 1.1: Create OIDC Identity Provider (One-time per AWS Account)

1. **Open AWS Console** → Go to **IAM** → **Identity providers**
2. Click **Add provider**
3. Select **OpenID Connect**
4. **Provider URL**: `https://token.actions.githubusercontent.com`
5. Click **Get thumbprint** (AWS will fetch it automatically)
6. **Audience**: `sts.amazonaws.com`
7. Click **Add provider**

**Note**: If the provider already exists, skip to Step 1.2.

---

### Step 1.2: Create IAM Role for Dev Environment

1. **Go to IAM** → **Roles** → **Create role**
2. **Trust relationship**:
   - Select **Web identity**
   - **Identity provider**: `token.actions.githubusercontent.com`
   - **Audience**: `sts.amazonaws.com`
   - Click **Next**

3. **Add conditions** (click "Add condition"):
   - **Condition key**: `token.actions.githubusercontent.com:sub`
   - **Operator**: `StringLike`
   - **Value**: `repo:gursewaksingh001/wdrbe:*`
   - Click **Next**

4. **Attach permissions**:
   - Search and attach: `AdministratorAccess` (for full CDK deployment)
   - OR create a custom policy with:
     - CloudFormation (full access)
     - Lambda (full access)
     - DynamoDB (full access)
     - SQS (full access)
     - API Gateway (full access)
     - IAM (create/update roles)
     - SSM (read/write parameters)
     - CloudWatch (logs, metrics)
     - S3 (for CDK bootstrap bucket)
   - Click **Next**

5. **Role name**: `github-actions-wdrbe-dev`
6. **Description**: `GitHub Actions role for Wdrbe dev deployments`
7. Click **Create role**

8. **Copy the Role ARN** (you'll need it for GitHub secrets):
   - Format: `arn:aws:iam::<ACCOUNT_ID>:role/github-actions-wdrbe-dev`

---

### Step 1.3: Create IAM Role for Production Environment

Repeat Step 1.2, but:
- **Role name**: `github-actions-wdrbe-prod`
- **Description**: `GitHub Actions role for Wdrbe production deployments`
- **Copy the Role ARN**: `arn:aws:iam::<ACCOUNT_ID>:role/github-actions-wdrbe-prod`

---

## Part 2: Add GitHub Secrets

### Step 2.1: Navigate to GitHub Secrets

1. Go to: **https://github.com/gursewaksingh001/wdrbe**
2. Click **Settings** (top right, under your profile)
3. In the left sidebar, click **Secrets and variables** → **Actions**
4. Click **New repository secret**

### Step 2.2: Add Dev Role ARN Secret

1. **Name**: `AWS_DEV_ROLE_ARN`
2. **Secret**: Paste the dev role ARN from Step 1.2
   - Example: `arn:aws:iam::101859807817:role/github-actions-wdrbe-dev`
3. Click **Add secret**

### Step 2.3: Add Production Role ARN Secret

1. Click **New repository secret** again
2. **Name**: `AWS_PROD_ROLE_ARN`
3. **Secret**: Paste the prod role ARN from Step 1.3
   - Example: `arn:aws:iam::101859807817:role/github-actions-wdrbe-prod`
4. Click **Add secret**

**Verify**: You should now see both secrets listed:
- `AWS_DEV_ROLE_ARN`
- `AWS_PROD_ROLE_ARN`

---

## Part 3: Push Code to GitHub

### Step 3.1: Stage All Changes

```powershell
cd C:\xampp\htdocs\Wdrbe
git add .
```

### Step 3.2: Commit Changes

```powershell
git commit -m "feat: Add CI/CD pipelines and complete backend service"
```

### Step 3.3: Push to Feature Branch

```powershell
git push origin feature/aws-demo
```

If you get authentication errors:
- Use a **Personal Access Token** (not password)
- Create one at: https://github.com/settings/tokens
- Select scopes: `repo` (full control)
- Use the token as your password when prompted

---

## Part 4: Test the CI Pipeline

### Step 4.1: Create a Pull Request

1. Go to: **https://github.com/gursewaksingh001/wdrbe**
2. You should see a banner: **"feature/aws-demo had recent pushes"**
3. Click **Compare & pull request**
4. **Title**: `Add CI/CD pipelines and backend service`
5. **Description**: 
   ```
   - Complete Wdrbe backend service
   - AWS CDK infrastructure
   - .NET Lambda Sync API
   - Python Lambda Share Worker
   - CI/CD workflows
   ```
6. Click **Create pull request**

### Step 4.2: Monitor CI Workflow

1. In the PR page, click the **Checks** tab
2. You should see: **"ci / build-and-test"** running
3. Wait for it to complete (usually 2-3 minutes)
4. **Expected results**:
   - ✅ Build .NET Lambda
   - ✅ Run .NET tests (may skip if no tests)
   - ✅ Lint Python worker
   - ✅ Test Python worker
   - ✅ CDK synth

If any step fails, click on it to see the error logs.

---

## Part 5: Merge PR and Test Dev Deployment

### Step 5.1: Merge the Pull Request

1. Once CI passes, click **Merge pull request**
2. Click **Confirm merge**
3. Optionally delete the feature branch

### Step 5.2: Monitor Dev Deployment

1. Go to **Actions** tab: https://github.com/gursewaksingh001/wdrbe/actions
2. You should see **"deploy-dev / deploy"** workflow running
3. Click on it to see progress
4. **Expected steps**:
   - ✅ Checkout code
   - ✅ Configure AWS credentials
   - ✅ Setup Node.js, .NET, Python
   - ✅ Install CDK dependencies
   - ✅ Restore & publish .NET Lambda
   - ✅ Prepare Python worker bundle
   - ✅ CDK deploy (dev)

5. **Wait for completion** (usually 5-10 minutes)

### Step 5.3: Verify Dev Deployment

1. Check AWS CloudFormation console:
   - Stack: `WdrbeStack-dev` should be `UPDATE_COMPLETE` or `CREATE_COMPLETE`
2. Check API endpoint:
   - Go to API Gateway console → Find your API → Copy the invoke URL
   - Test with a POST request (use the JWT token generator)

---

## Part 6: Deploy to Production (Tag-Based)

### Step 6.1: Create a Release Tag

```powershell
cd C:\xampp\htdocs\Wdrbe
git checkout main
git pull origin main
git tag v1.0.0
git push origin v1.0.0
```

### Step 6.2: Monitor Production Deployment

1. Go to **Actions** tab
2. You should see **"deploy-prod / deploy"** workflow running
3. Click on it to monitor progress
4. **Expected steps**:
   - ✅ Checkout code
   - ✅ Configure AWS credentials (using `AWS_PROD_ROLE_ARN`)
   - ✅ Setup tools
   - ✅ Build artifacts
   - ✅ CDK deploy (prod)

5. **Wait for completion** (usually 5-10 minutes)

### Step 6.3: Verify Production Deployment

1. Check AWS CloudFormation console:
   - Stack: `WdrbeStack-prod` should be `CREATE_COMPLETE`
2. Check API endpoint:
   - Production API URL will be different from dev
   - Test with a POST request

---

## Troubleshooting

### Issue: "Role ARN not found" in GitHub Actions

**Solution**:
- Verify secrets are set: Go to Settings → Secrets → Actions
- Check the role ARN format: Must start with `arn:aws:iam::`
- Ensure the IAM role exists in AWS

### Issue: "Access Denied" during deployment

**Solution**:
- Check IAM role permissions (needs CloudFormation, Lambda, DynamoDB, etc.)
- Verify OIDC trust relationship includes your repository
- Check condition: `repo:gursewaksingh001/wdrbe:*`

### Issue: CI workflow fails on "dotnet test"

**Solution**:
- This is expected if you don't have test projects
- The workflow will skip tests and continue
- To add tests later, create a test project and the workflow will run them

### Issue: CDK synth fails

**Solution**:
- Check that `infra/package.json` has all dependencies
- Ensure TypeScript compiles: `cd infra && npm run build`
- Check for syntax errors in `infra/lib/wdrbe-stack.ts`

### Issue: Deployment fails with "Stack not found"

**Solution**:
- First deployment needs the stack to exist
- Manually deploy once: `cd infra && npx cdk deploy WdrbeStack-dev --context stage=dev`
- Or ensure CDK bootstrap is done: `npx cdk bootstrap`

---

## Quick Reference

### Workflow Triggers

| Workflow | Trigger | What It Does |
|----------|---------|--------------|
| `ci.yml` | PR to `main` | Build, test, lint, synth |
| `deploy-dev.yml` | Push to `main` | Deploy to dev environment |
| `deploy.yml` | Tag `v*.*.*` | Deploy to production |

### GitHub Secrets Required

- `AWS_DEV_ROLE_ARN` - IAM role for dev
- `AWS_PROD_ROLE_ARN` - IAM role for prod

### Manual Commands

```powershell
# View workflows
gh workflow list

# View workflow runs
gh run list

# View specific run logs
gh run view <run-id>

# Re-run a failed workflow
gh run rerun <run-id>
```

---

## Next Steps

After CI/CD is set up:

1. ✅ **Monitor workflows** in the Actions tab
2. ✅ **Set up notifications** (GitHub will email on failures)
3. ✅ **Add branch protection** (require CI to pass before merge)
4. ✅ **Create more test coverage** (so CI actually tests your code)
5. ✅ **Set up staging environment** (optional intermediate environment)

---

## Summary Checklist

- [ ] OIDC identity provider created in AWS
- [ ] IAM role for dev created (`github-actions-wdrbe-dev`)
- [ ] IAM role for prod created (`github-actions-wdrbe-prod`)
- [ ] GitHub secret `AWS_DEV_ROLE_ARN` added
- [ ] GitHub secret `AWS_PROD_ROLE_ARN` added
- [ ] Code pushed to `feature/aws-demo` branch
- [ ] PR created and CI workflow passes
- [ ] PR merged, dev deployment succeeds
- [ ] Production tag created (`v1.0.0`)
- [ ] Production deployment succeeds

Once all checkboxes are complete, your CI/CD pipeline is fully operational! 🎉


