# ADR-005: API Versioning — `/api/v1` Prefix, Additive-Only

## Status
Accepted (Phase 0)

## Context
`artifysolscom/server/routes/v1/index.ts` already mounts every real route under `/api/v1`, alongside two *unversioned* legacy endpoints (`/api/ai-consultant`, `/api/brief-submit`) duplicated across `server.ts` and `api/index.ts` with drifted behavior (`CURRENT_STATE.md` §2.6). `Artify-Backend/server.ts`'s demo routes are also unversioned.

## Decision
Formalize `/api/v1` as the only route namespace going forward. New, non-breaking additions (new endpoints, new optional response fields) land in v1. A genuine breaking change gets `/api/v2` mounted alongside v1 with a deprecation window for v1, rather than an in-place breaking edit. All unversioned legacy endpoints are retired during the Phase 1/11 consolidation (`API_DESIGN.md` §5).

## Consequences
- Both frontends (once rewired) always call a versioned path — no more silent behavior drift between two copies of "the same" endpoint at different model/config values.
- A future breaking change has a defined process instead of ad-hoc duplication (the exact failure mode that produced the `gemini-3.7-flash`/`gemini-2.5-flash` split found in Phase 0).

## Alternatives considered
- Header-based versioning (`Accept-Version`): rejected — path-based versioning is already the existing convention and requires no client change to adopt formally.
