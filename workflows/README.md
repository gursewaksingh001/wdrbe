# Workflows

This directory mirrors the CI/CD configuration stored under `.github/workflows/` for ease of discovery.

## ci.yml
- Trigger: `pull_request` and `push` to `main`
- Jobs:
  - Restore, build, and test the .NET Sync API
  - Lint (`ruff`) and test (`pytest`) the Python Share Worker
  - `cdk synth` to validate infrastructure changes

## deploy.yml
- Trigger: tags matching `v*.*.*`
- Assumes an AWS IAM role (`AWS_PROD_ROLE_ARN` secret)
- Publishes .NET Lambda and Python bundle
- Runs `cdk deploy` with `stage=prod`
