# Security Policy

This document tracks SplashTrack security expectations and implementation policies.

## Role-Based Access Control (RBAC)

- Access should be granted by role and organization context.
- Privileged workflows must enforce authorization server-side.
- New features should reuse existing RBAC helpers where available.

## GDPR and Data Protection

- Personal data should be collected and retained only when required for swim school operations.
- Data handling changes should consider consent, access, correction, deletion, and export requirements.
- Environment-specific secrets or personal data must not be committed to source control.

## Audit Logging

- Security-sensitive and administrative actions should be auditable.
- Audit entries should include enough context to support investigation without exposing secrets.
- New privileged actions should identify whether audit logging is required.
