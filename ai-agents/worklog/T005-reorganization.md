# T005: Reorganize src/ to Feature-Based Architecture

**Status:** ✅ COMPLETE

## Execution Summary

Reorganized 49 TypeScript files from flat `src/lib/` structure into feature-based modules.

### Files Moved

**Auth (3 files)**
- src/lib/auth.ts → src/auth/auth.ts
- src/lib/auth-client.ts → src/auth/client.ts
- src/lib/auth-session.ts → src/auth/session.ts

**RBAC/Authorization (3 files)**
- src/lib/authz-core.ts → src/rbac/core.ts
- src/lib/authz-core.test.ts → src/rbac/core.test.ts
- src/lib/authz.ts → src/rbac/index.ts

**Audit (2 files)**
- src/lib/student-audit.ts → src/audit/student.ts
- src/lib/student-audit.test.ts → src/audit/student.test.ts

**Shared Utilities (9 files)**
- src/lib/env.ts → src/shared/env.ts
- src/lib/logger.ts → src/shared/logger.ts
- src/lib/utils.ts → src/shared/utils.ts
- src/lib/prisma.ts → src/shared/prisma.ts
- src/lib/i18n.ts → src/shared/i18n.ts
- src/lib/i18n-shared.ts → src/shared/i18n-shared.ts
- src/lib/translation-store.ts → src/shared/translation-store.ts
- src/lib/seed-data.ts → src/shared/seed-data.ts
- src/lib/seed-data.test.ts → src/shared/seed-data.test.ts

**Features/Students (15 files)**
- src/lib/student-actions.ts → src/features/students/actions.ts
- src/lib/student-detail.ts → src/features/students/detail.ts
- src/lib/student-directory.ts → src/features/students/directory.ts
- src/lib/student-directory.test.ts → src/features/students/directory.test.ts
- src/lib/student-directory-filters.ts → src/features/students/directory-filters.ts
- src/lib/student-directory-filters.test.ts → src/features/students/directory-filters.test.ts
- src/lib/student-duplicate-policy.ts → src/features/students/duplicate-policy.ts
- src/lib/student-duplicate-policy.test.ts → src/features/students/duplicate-policy.test.ts
- src/lib/student-forms.ts → src/features/students/forms.ts
- src/lib/student-forms.test.ts → src/features/students/forms.test.ts
- src/lib/student-identity.ts → src/features/students/identity.ts
- src/lib/student-identity.test.ts → src/features/students/identity.test.ts
- src/lib/student-lifecycle.ts → src/features/students/lifecycle.ts
- src/lib/student-lifecycle.test.ts → src/features/students/lifecycle.test.ts
- src/lib/student-policy.ts → src/features/students/policy.ts

**Features/Organizations (8 files)**
- src/lib/organization-admin-action-core.ts → src/features/organizations/admin-action-core.ts
- src/lib/organization-admin-actions.ts → src/features/organizations/admin-actions.ts
- src/lib/organization-admin-actions.test.ts → src/features/organizations/admin-actions.test.ts
- src/lib/organization-admin.ts → src/features/organizations/admin.ts
- src/lib/organization-admin.test.ts → src/features/organizations/admin.test.ts
- src/lib/organization-selection-actions.ts → src/features/organizations/selection-actions.ts
- src/lib/sub-organization-admin-actions.ts → src/features/organizations/sub-admin-actions.ts
- src/lib/sub-organization-admin.ts → src/features/organizations/sub-admin.ts

**Features/Swimming Groups (4 files)**
- src/lib/swim-group-actions.ts → src/features/swimming-groups/actions.ts
- src/lib/swim-group-admin.ts → src/features/swimming-groups/admin.ts
- src/lib/swim-group-forms.ts → src/features/swimming-groups/forms.ts
- src/lib/swim-group-forms.test.ts → src/features/swimming-groups/forms.test.ts

**Features/User Admin & Miscellaneous (5 files)**
- src/lib/user-admin-actions.ts → src/features/user-admin-actions.ts
- src/lib/user-admin-actions.test.ts → src/features/user-admin-actions.test.ts
- src/lib/user-admin.ts → src/features/user-admin.ts
- src/lib/welcome-page.ts → src/features/welcome-page.ts
- src/lib/welcome-page.test.ts → src/features/welcome-page.test.ts

### Import Updates

- Updated 69 TypeScript files with corrected imports
- Replaced `@/lib/*` with appropriate feature paths (@/auth/, @/rbac/, @/features/*, @/shared/)
- Fixed relative imports in test files
- Updated prisma/seed.ts and dashboard translations test file

### Validation Results

✅ **Typecheck:** PASS (no TypeScript errors)
✅ **Lint:** PASS (eslint clean)
✅ **Tests:** 19/19 PASS (all units and integration tests passing)
✅ **Build:** PASS (Next.js build successful)

### New Directory Structure

```
src/
├── api/            (empty; reserved for API route handlers)
├── app/            (Next.js app directory - unchanged)
├── audit/          (audit logging: student.ts)
├── auth/           (authentication: auth.ts, client.ts, session.ts)
├── features/       (domain features)
│   ├── organizations/       (org admin, sub-orgs, selection)
│   ├── students/            (student management, directory, forms)
│   ├── swimming-groups/     (swim group management)
│   ├── user-admin-actions.ts
│   ├── welcome-page.ts
│   └── welcome-page.test.ts
├── privacy/        (empty; reserved for GDPR, consent, deletion)
├── rbac/           (role-based access control: core.ts, index.ts)
├── routes/         (empty; reserved for route config)
├── shared/         (utilities, env, i18n, seed data, prisma)
├── stores/         (empty; reserved for state management)
└── styles/         (empty; reserved for global styles)
```

### Impact

- **Zero behavior changes:** All tests pass, no functional modifications
- **Import paths fully updated:** 69 files updated with new paths
- **Scalable foundation:** Future features can follow same pattern
- **Better organization:** Related code grouped by concern/domain

### Next Steps

1. Commit changes with message: "refactor(src): reorganize into feature-based modules"
2. Start T006: Create CI/CD deployment workflows
3. Update documentation to reflect new structure
