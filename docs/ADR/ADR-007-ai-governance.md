# ADR-007: AI Governance — Sandboxed Tools, Human Approval, Cost Tracking

## Status
Accepted (Phase 0)

## Context
`artifysolscom/server/ai/{tools.ts,coworkerService.ts,provider.ts}` already implements a genuinely sound pattern (`CURRENT_STATE.md` §2.2, unused by any frontend today): AI models never execute arbitrary code or queries — every action goes through a typed, permission-checked `AiToolDefinition` registry (`tools.ts:12-98`); mutating actions can be marked `APPROVAL_REQUIRED` per tool per coworker (`AiCoworker.approvalPolicy`), pausing the task in a `WAITING_APPROVAL` state until a permitted human calls the approval endpoint (`aiRoutes.ts` `/tasks/:id/approval`); each coworker tracks `metrics.estimatedCostUsd` and task counts.

## Decision
Formalize and keep this pattern as the platform's AI governance model: every AI-invoked action is a registered tool with an explicit `requiredPermission` and `approvalPolicy`, never free-form code/query execution; publish-type actions default to `APPROVAL_REQUIRED`; cost/usage metrics are tracked per coworker and rolled up per company against `Company.settings.maxAiMonthlyBudgetUsd` (already modeled, `db.ts:69`, but never enforced anywhere — enforcement is new work for Phase 12).

## Consequences
- Phase 12 hardens rather than redesigns this subsystem: add real budget enforcement (reject/pause execution once `maxAiMonthlyBudgetUsd` is hit — currently just a stored number with no check against it), and resolve the Gemini model-string drift (`gemini-3.7-flash` vs `gemini-2.5-flash` vs the non-existent `gemini-3.8-flash`) into one constant.
- API keys/secrets for the AI provider remain server-side only — confirmed no `GEMINI_API_KEY` is ever sent to the browser in either repo's current code.
- Any future AI provider swap (or multi-provider support) goes through the existing `AiProvider` interface (`provider.ts:15-18`) rather than a rewrite.

## Alternatives considered
- Giving AI coworkers direct database/tool access without the sandbox layer: rejected outright — this is precisely the governance failure mode the brief asks to guard against ("Determine whether AI actions are safely isolated"), and the existing tool-registry pattern already avoids it.
