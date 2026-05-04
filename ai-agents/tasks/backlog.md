# Backlog

## T007: Configure GitHub Environments & Protection Rules

- Status: Ready
- Priority: High (required before workflows are functional)
- Owner: Jack (manual GitHub UI configuration)
- Effort: 30-45 minutes

**Tasks:**
1. Create three GitHub environments: dev, staging, production
2. Configure branch protection rules for main branch
3. Add required secrets (DATABASE_URL, APP_URL)
4. Enable status checks requirement
5. Test deploy-dev workflow on next push
6. Verify all three workflows appear in Actions tab

**Reference:** ai-agents/instructions/GITHUB_CICD_SETUP.md

---

## T008: Implement Deployment Scripts

- Status: Backlog
- Priority: High (required for actual deployments)
- Owner: Backend/DevOps agent
- Effort: 4-6 hours (per environment)

**Tasks:**
1. Implement deploy-dev.yml deployment logic
2. Implement deploy-uat.yml deployment logic  
3. Implement deploy-prd.yml deployment logic
4. Add health check endpoints (/api/health)
5. Implement backup/restore scripts for PRD

**Acceptance Criteria:**
- Deployments actually run (not just placeholder echo statements)
- Health checks verify deployment success
- Rollback works on failure
- Logs are captured and archived

---

## T009: Configure Monitoring & Alerts

- Status: Backlog
- Priority: Medium
- Owner: DevOps/Infrastructure agent
- Effort: 2-3 hours

**Tasks:**
1. Set up error tracking (Sentry, Rollbar, etc.)
2. Configure performance metrics (New Relic, Datadog, etc.)
3. Add Slack notifications to workflows
4. Set up PagerDuty for production alerts
5. Create runbooks for common issues

---

## T010: RUG Phase 1 - Mobile Login Stabilization

- Status: Backlog
- Priority: Critical (from RUG plan)
- Owner: splashtrack-frontend agent
- Effort: TBD

**Description:** Ensure Jack can log in from phone via LAN URL and/or splashtrack.jack.ldam.nl using demo owner credentials with robust auth trusted-origin config.

**Success Criteria:**
- Jack logs in from mobile phone
- Works on http://10.2.1.13:3000 (LAN)
- Works on https://splashtrack.jack.ldam.nl (domain)
- Auth config is robust (not brittle one-off hacks)
- Typecheck/lint/build/smoke all pass

**Reference:** PROJECTS.md RUG Phase 1
