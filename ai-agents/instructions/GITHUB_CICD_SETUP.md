# GitHub CI/CD Setup Guide

**Purpose:** Configure GitHub repository environments, secrets, and branch protection rules for SplashTrack CI/CD pipelines.

**Status:** Ready for implementation

---

## Quick Setup Checklist

- [ ] Create GitHub Environments (dev, staging, production)
- [ ] Configure Environment Protection Rules
- [ ] Add Repository Secrets
- [ ] Enable Branch Protection for main
- [ ] Test deploy-dev workflow
- [ ] Verify all workflows appear in Actions tab

---

## Step 1: Create GitHub Environments

### Location
GitHub Web UI → Repository Settings → Environments

### Create Three Environments

#### Environment 1: development

```
Name: development
Deployment branches: All branches
Wait timer: 0 minutes
Reviewers: None
```

#### Environment 2: staging

```
Name: staging
Deployment branches: main
Wait timer: 5 minutes (optional; allows review time)
Reviewers: Recommended - add QA team members
Deploy only from these branches: main
```

#### Environment 3: production

```
Name: production
Deployment branches: main
Wait timer: 5 minutes
Reviewers: REQUIRED - add Release managers/DevOps team
Deploy only from these branches: main
Prevent reviewers from approving their own deployments: YES
Require status checks to pass before deployment: YES
```

---

## Step 2: Configure Branch Protection Rules

### Location
GitHub Web UI → Repository Settings → Branches → Branch protection rules

### Create Rule for `main`

```
Branch name pattern: main

Required status checks to pass before merging:
  ✓ Enable "Require status checks to pass before merging"
  ✓ Require branches to be up to date before merging
  
Status checks required:
  - web-build (from ci-cd.yaml)
  - validate (from deploy-dev.yml)
  - validate (from deploy-uat.yml)
  - validate (from deploy-prd.yml)

Require code review:
  ✓ Require a pull request before merging
  ✓ Require approvals: 1 (or more)
  ✓ Require review from Code Owners: NO (optional)
  ✓ Dismiss stale pull request approvals when new commits are pushed: YES
  ✓ Require approval of the latest reviewable push: YES

Require deployment status checks:
  ✓ Require status checks to pass before merging
  ✓ Require branches to be up to date before merging

Require conversation resolution:
  ✓ Require all conversations on code to be resolved: YES

Require linear history:
  ✓ Require a linear history: YES (optional; prevents merge commits)

Restrict who can push to matching branches:
  ✓ Allow force pushes: NO
  ✓ Allow deletions: NO
```

---

## Step 3: Add Repository Secrets

### Location
GitHub Web UI → Repository Settings → Secrets and variables → Actions

### Required Secrets

#### Development Secrets

```
Secret Name: DEV_APP_URL
Value: http://localhost:3000
Visibility: All workflows
```

#### UAT/Staging Secrets

```
Secret Name: UAT_APP_URL
Value: https://uat.splashtrack.local (or your UAT domain)
Visibility: All workflows

Secret Name: UAT_DATABASE_URL
Value: postgresql://user:password@uat-db.local:5432/splashtrack_uat
Visibility: Selected repositories / All workflows
```

#### Production Secrets

```
Secret Name: PRD_APP_URL
Value: https://splashtrack.local (or your production domain)
Visibility: All workflows

Secret Name: PRD_DATABASE_URL
Value: postgresql://user:password@prd-db.local:5432/splashtrack
Visibility: Selected repositories / All workflows
```

### Notes on Secrets

- **NEVER commit secrets to git**
- Use GitHub Secrets for all sensitive values
- Mark DATABASE_URL secrets as sensitive (GitHub will mask in logs)
- Consider using GitHub OIDC for cloud provider authentication (AWS, GCP, Azure)

---

## Step 4: Verify Workflows

### Location
GitHub Web UI → Actions tab

### Expected Workflows

You should see:
- [x] ci-cd (existing - runs on push/PR)
- [x] CI/CD (should appear after main branch update)
- [x] Deploy Dev (runs automatically on push to main)
- [x] Deploy UAT (manual trigger via workflow_dispatch)
- [x] Deploy Production (manual trigger via workflow_dispatch)

### Test Deploy Dev Workflow

1. Create a test branch: `git checkout -b test/workflow`
2. Make a small change (e.g., update README)
3. Push to origin: `git push origin test/workflow`
4. Open a Pull Request to main
5. Verify ci-cd workflow runs (should pass all checks)
6. Merge PR to main
7. Watch Deploy Dev workflow trigger automatically
8. Verify deployment succeeds (or shows expected TODO failures)

---

## Step 5: Configure Secrets for Workflows

### GitHub UI Path
Settings → Secrets and variables → Actions

### For Each Environment Secret

The workflows reference secrets like:
```yaml
env:
  DATABASE_URL: ${{ secrets.DEV_DATABASE_URL }}
  NEXT_PUBLIC_APP_URL: ${{ secrets.DEV_APP_URL }}
```

Map these to GitHub Secrets you create.

---

## Step 6: Implementation Checklist

After basic GitHub setup, implement these TODO items in workflows:

### In deploy-dev.yml

```yaml
- name: Deploy to DEV
  # TODO: Add actual deployment logic
  # - SSH to dev server
  # - Pull latest code
  # - Run migrations
  # - Restart application
```

### In deploy-uat.yml

```yaml
- name: Deploy to UAT
  # TODO: Add actual UAT deployment logic
  
- name: Run smoke tests
  # TODO: Add smoke test suite
  # curl -f https://uat.splashtrack.local/api/health || exit 1
```

### In deploy-prd.yml

```yaml
- name: Create production backup
  # TODO: Implement backup strategy
  # - Database backup
  # - Filesystem snapshot

- name: Deploy to Production
  # TODO: Add production deployment logic
  
- name: Run production smoke tests
  # TODO: Add production health checks
```

---

## Step 7: Test Each Workflow

### Test Deploy Dev (Automatic)

```bash
git push origin main
# Workflow should trigger automatically
# Monitor in Actions tab
```

### Test Deploy UAT (Manual)

1. Go to GitHub Web UI → Actions
2. Select "Deploy UAT" workflow
3. Click "Run workflow"
4. Enter deployment reason
5. Approve when prompted
6. Monitor execution

### Test Deploy Production (Manual)

1. Go to GitHub Web UI → Actions
2. Select "Deploy Production" workflow
3. Click "Run workflow"
4. Enter version (e.g., "1.0.0")
5. Enter deployment reason
6. Request approval (may require multiple reviewers)
7. Monitor execution

---

## Troubleshooting

### Workflow Not Appearing

**Problem:** Deploy workflows not showing in Actions tab

**Solution:**
1. Ensure workflows are in `.github/workflows/`
2. Ensure YAML syntax is valid (GitHub will show error)
3. Wait a few minutes for GitHub to refresh
4. Hard refresh browser (Ctrl+Shift+R)

### Secrets Not Available

**Problem:** `Workflow run canceled with error: Error in template substitution on 'env'`

**Solution:**
1. Verify secret names match exactly in workflow files
2. Ensure secret is added to correct repository
3. Secrets are case-sensitive
4. Check secret visibility settings

### Status Checks Not Blocking PR

**Problem:** PRs can merge without all checks passing

**Solution:**
1. Go to Branch Protection Rules for main
2. Verify "Require status checks to pass" is enabled
3. Add correct status check names (from workflow jobs)
4. Verify status checks actually ran

### Environment Protection Rules Not Enforcing

**Problem:** Workflow deploys without approval

**Solution:**
1. Verify environment created in Settings → Environments
2. Verify "Required reviewers" is configured
3. Ensure job uses `environment: production` (or correct name)
4. Check that user has permission to approve

---

## Security Best Practices

1. **Use GitHub Secrets for all sensitive data**
   - Never hardcode passwords, API keys, tokens
   - Use `${{ secrets.SECRET_NAME }}`

2. **Use OIDC for cloud provider authentication**
   - Avoid long-lived tokens when possible
   - AWS, GCP, Azure all support OIDC

3. **Require approval for sensitive deployments**
   - UAT and PRD environments require reviewers
   - Consider requiring multiple approvers for production

4. **Use Branch Protection Rules**
   - Require PR reviews before merge
   - Require status checks pass
   - Prevent force pushes to main

5. **Audit workflow runs**
   - Review Actions tab periodically
   - Check deployment logs for errors
   - Keep audit trail of production changes

6. **Rotate secrets regularly**
   - Database passwords every 90 days
   - API keys every 180 days
   - Update GitHub Secrets when changed

---

## Next Steps

1. **Complete GitHub Setup** (this checklist)
2. **Implement Deployment Scripts** (in workflows)
3. **Test Each Workflow** (dev → uat → prd)
4. **Configure Monitoring** (add error tracking, metrics)
5. **Document Runbooks** (disaster recovery, rollback procedures)

---

## Reference Links

- [GitHub Environments](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment)
- [Branch Protection Rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [GitHub Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)

---

**Setup by:** JackGPT
**Date:** 2025-05-04
