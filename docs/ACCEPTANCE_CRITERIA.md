# Acceptance Criteria by Phase

Condensed, testable criteria per phase in `IMPLEMENTATION_PLAN.md`. A phase is not "done" until every criterion below is demonstrably true (via a test in `TESTING_STRATEGY.md`'s suites, not by inspection alone).

| Phase | Acceptance criteria |
|---|---|
| 1. Infrastructure | CI runs on every PR in both repos and fails the build on typecheck/lint/audit failure. App refuses to boot if a required secret is missing (no insecure fallback remains). Postgres reachable from a dev environment. |
| 2. Database | Every entity in `CURRENT_STATE.md` §3 has a migrated table. Restarting the API process does not lose any data. A transaction-wrapped multi-table write (registration) either fully commits or fully rolls back under a forced failure test. |
| 3. Auth/RBAC | Login rejects wrong passwords and disabled accounts. Passwords stored as bcrypt/argon2 hashes only. All routes identified in `AUTHORIZATION_MODEL.md` §3.1 reject cross-tenant access with 403 in an automated test. Login is rate-limited. |
| 4. Control Center | Every admin module performs CRUD against the real API with no `seedData.ts` import remaining in `AdminDataContext.tsx`. `switchUserRole()` no longer exists in the codebase. |
| 5. CRM | A single lead-creation code path exists (grep confirms no duplicate lead-insert logic across repos). Webhook endpoint rejects a request with a missing or invalid signature in an automated test (regression test for S3). |
| 6. Onboarding | New-tenant registration creates company + admin user + trial subscription atomically; a forced mid-write failure leaves zero partial records. |
| 7. Products | Both frontends read products from the same table; no product data remains duplicated in `seedData.ts`/`aiProductsData.ts`/`solutionsData.ts` as a runtime source. |
| 8. CMS | Publishing an article requires `blog.publish`; a `blog.create`-only user's publish attempt is rejected in a test. AI-authored drafts carry `provenance.createdByType: 'ai'` end to end. |
| 9. Media | Uploaded file type/size are enforced server-side (rejected upload has a test). Media metadata references a real object-storage URL, not a fabricated one. |
| 10. Billing/Portal | Subscription/invoice/API-key data for a logged-in user comes from the API, not `AuthContext.tsx` local fabrication (verified by removing the fabrication code path and confirming the portal still renders correctly from network data alone). |
| 11. Public site integration | `artifysolscom`'s server contains no business logic beyond static serving/sitemap/robots — confirmed by code review checklist, not test. CORS allow-list rejects a request from an unlisted origin in a test. |
| 12. AI Control Center | One Gemini model constant used everywhere (no drift like the `gemini-3.7-flash`/`gemini-2.5-flash`/`gemini-3.8-flash` split found in Phase 0). AI actions requiring approval are provably blocked until approved (test asserts a `WAITING_APPROVAL` task cannot reach `COMPLETED` without an approval call). |
| 13. Notifications/Jobs | `notificationService.dispatch` for at least one real channel (email or Slack) is verified against a test/sandbox account, not just `{ sent: true }`. Scheduled AI coworker tasks actually execute on their cron schedule in a staging environment. |
| 14. Reporting | Report figures are traceable to real query results (spot-checked against raw table counts), not hardcoded. |
| 15. Security/QA | Every finding in `SECURITY_MODEL.md` §1 marked "Blocks production" is closed. `tsconfig.json` `strict: true` in both repos with zero suppressed errors. Full testing pyramid (`TESTING_STRATEGY.md`) running in CI with the critical-workflow list at 100% coverage. |
| 16. Deployment | Staging environment mirrors production config. A rollback has been executed successfully at least once in staging. Health check endpoint genuinely fails when the DB is disconnected (verified by a chaos test). |
| 17. Production readiness | `PRODUCTION_READINESS_CHECKLIST.md` fully checked off; no "demo mode" affordance (mock login, fake data toggle) reachable in the production build. |
