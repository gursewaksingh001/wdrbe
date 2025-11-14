# AWS IAM Setup for GitHub Actions - Step by Step

## Part 1: Create OIDC Identity Provider (One-time Setup)

### Step 1.1: Navigate to Identity Providers

1. **Open AWS Console**: https://console.aws.amazon.com/
2. **Go to IAM**: Search for "IAM" in the top search bar
3. **Click "Identity providers"** in the left sidebar (under "Access management")

### Step 1.2: Add OpenID Connect Provider

1. Click **"Add provider"** button (top right)
2. Select **"OpenID Connect"** tab
3. **Provider URL**: Enter exactly:
   ```
   https://token.actions.githubusercontent.com
   ```
4. Click **"Get thumbprint"** button (AWS will automatically fetch it)
5. **Audience**: Enter:
   ```
   sts.amazonaws.com
   ```
6. Click **"Add provider"**

**Note**: If you see "Provider already exists", that's fine - skip to Part 2.

---

## Part 2: Create IAM Role for Dev Environment

### Step 2.1: Start Creating Role

1. In IAM console, click **"Roles"** (left sidebar)
2. Click **"Create role"** button (top right)

### Step 2.2: Select Trust Entity

1. Under **"Trusted entity type"**, select **"Web identity"**
2. Under **"Web identity"**:
   - **Identity provider**: Select `token.actions.githubusercontent.com` (the one you just created)
   - **Audience**: Select `sts.amazonaws.com`
3. Click **"Next"**

### Step 2.3: Add Condition (Important!)

1. You'll see a section **"Attribute conditions (optional)"**
2. Click **"Add condition"**
3. **Condition key**: Select `token.actions.githubusercontent.com:sub`
4. **Operator**: Select `StringLike`
5. **Value**: Enter:
   ```
   repo:gursewaksingh001/wdrbe:*
   ```
   (This restricts the role to only your repository)
6. Click **"Next"**

### Step 2.4: Attach Permissions

1. **Search for**: `AdministratorAccess`
2. **Check the box** next to `AdministratorAccess` policy
3. Click **"Next"**

**Alternative (More Secure)**: If you want least-privilege, create a custom policy with:
- CloudFormation (full access)
- Lambda (full access)
- DynamoDB (full access)
- SQS (full access)
- API Gateway (full access)
- IAM (create/update roles)
- SSM (read/write parameters)
- CloudWatch (logs, metrics)
- S3 (for CDK bootstrap)

### Step 2.5: Name and Create Role

1. **Role name**: `github-actions-wdrbe-dev`
2. **Description**: `GitHub Actions role for Wdrbe dev deployments`
3. Click **"Create role"**

### Step 2.6: Copy Role ARN

1. After creation, you'll see the role details page
2. **Copy the Role ARN** (looks like: `arn:aws:iam::101859807817:role/github-actions-wdrbe-dev`)
3. **Save this** - you'll need it for GitHub secrets

---

## Part 3: Create IAM Role for Production

Repeat **Part 2** with these changes:

- **Step 2.5**: Role name: `github-actions-wdrbe-prod`
- **Step 2.5**: Description: `GitHub Actions role for Wdrbe production deployments`
- **Step 2.6**: Copy the prod Role ARN

---

## Visual Guide (What You Should See)

### Identity Provider Page:
```
Identity providers
└── token.actions.githubusercontent.com
    └── Audience: sts.amazonaws.com
```

### Role Trust Relationship (after creation):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::YOUR_ACCOUNT:oidc-provider/token.actions.githubusercontent.com"
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
```

---

## Troubleshooting

### "Identity provider not found" when creating role

**Solution**: Make sure you completed Part 1 first. The provider must exist before you can use it in a role.

### "Invalid provider URL"

**Solution**: 
- Use exactly: `https://token.actions.githubusercontent.com`
- Don't include trailing slashes
- Make sure "Get thumbprint" completed successfully

### Can't find "Web identity" option

**Solution**:
- Make sure you're in the IAM console (not other services)
- Look for "Trusted entity type" section
- "Web identity" should be the second option after "AWS service"

---

## Quick Verification

After creating both roles, verify:

1. **Go to IAM → Roles**
2. You should see:
   - `github-actions-wdrbe-dev`
   - `github-actions-wdrbe-prod`
3. Click on each role → **"Trust relationships"** tab
4. Verify the condition includes: `repo:gursewaksingh001/wdrbe:*`

---

## Next: Add to GitHub Secrets

Once you have both Role ARNs:
1. Go to: https://github.com/gursewaksingh001/wdrbe/settings/secrets/actions
2. Add `AWS_DEV_ROLE_ARN` = `<dev-role-arn>`
3. Add `AWS_PROD_ROLE_ARN` = `<prod-role-arn>`

Then your CI/CD pipelines will work! 🚀

