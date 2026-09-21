# Content Workflow Architecture (Phase 8)

Covers `Page` and `Post` identically — `pageService.ts` and `postService.ts` are deliberately parallel, independently-written files (no shared generic "content workflow" abstraction), matching the established convention of keeping structurally-similar services separate (`leadService`/`clientService`, `productService`/`productModuleService`).

## State machine

```
DRAFT ──submit-review──> IN_REVIEW ──publish──> PUBLISHED ──archive──> ARCHIVED
  │                          │                       │                    │
  │                       schedule                unpublish            restore
  │                          ↓                    (→ DRAFT, PATCH)   (→ DRAFT, PATCH)
  │                      SCHEDULED ──publish──> PUBLISHED
  │                          │
  │                       (PATCH → DRAFT: cancel)
  └──────────archive (from DRAFT/IN_REVIEW/SCHEDULED/PUBLISHED)────> ARCHIVED
```

Every **forward** move (`DRAFT → IN_REVIEW`, `→ SCHEDULED`, `→ PUBLISHED`, `→ ARCHIVED`) is its own dedicated, permission-gated, content-validated endpoint. The generic `PATCH /pages/:id` / `PATCH /posts/:id` can only ever set `status: "DRAFT"` — every other value is rejected by the Zod schema itself (`patchableContentStatusSchema = z.enum(["DRAFT"])`, `server/schemas/contentSchemas.ts`) before it reaches the service layer. This extends the `leads.CONVERTED` / `products.ARCHIVED` "dedicated endpoint for the terminal transition" precedent to *every* forward step, not just the last one, because the brief explicitly required that an arbitrary `PATCH {status: "PUBLISHED"}` never bypass authorization or content validation.

| Endpoint | Permission | Allowed from | Validates |
|---|---|---|---|
| `POST /pages/:id/submit-review` | `content.update` | `DRAFT` only | body non-empty |
| `POST /pages/:id/schedule` | `content.publish` | `DRAFT`/`IN_REVIEW`/`SCHEDULED` | `scheduledAt` in the future (Zod `.refine`), title+body non-empty |
| `POST /pages/:id/publish` | `content.publish` | `DRAFT`/`IN_REVIEW`/`SCHEDULED` | title+body non-empty |
| `POST /pages/:id/archive` | `content.delete` | any non-`ARCHIVED` status | — |
| `PATCH /pages/:id` with `status: "DRAFT"` | `content.update` | `IN_REVIEW`/`SCHEDULED`/`PUBLISHED`/`ARCHIVED` | — (this is the "reopen for editing" / restore / unpublish / cancel-schedule move) |

(`posts/:id/...` is identical.)

**Permission tiers**: `submit-review` and the DRAFT-reopen PATCH use `content.update` (ADMIN+MANAGER — the same tier that can already edit content). `publish`/`schedule` use `content.publish` (ADMIN only, unchanged from Phase 2's seed). `archive` uses `content.delete` (ADMIN only) — archiving is treated at the same tier as delete because, like delete, it's a terminal action that removes the item from active use; this mirrors `products.archive`'s ADMIN-only tier from Phase 7. No new permission keys were introduced for pages/posts — all five reuse the exact `content.*` set Phase 2 already seeded.

## Content validation per status

Never trusted from the frontend — enforced in `pageService`/`postService` on every state-changing call:

- **DRAFT**: no requirement (a brand-new page starts as an empty-body DRAFT; `createPageSchema`/`createPostSchema` default `body` to `""`).
- **IN_REVIEW** (`submitForReview`): body must be non-empty after `.trim()`, or a 400 `ValidationError`.
- **SCHEDULED** / **PUBLISHED**: title and body must both be non-empty (`assertHasPublishableContent`), or a 400. Slug is always present by construction (server-generated if omitted) so it needs no separate check.
- **ARCHIVED**: unreachable via content edit — the generic PATCH rejects any content field change while `status` is `PUBLISHED` or `ARCHIVED` (`CONTENT_EDIT_BLOCKED_STATUSES`), so archived content can never "accidentally become published through an arbitrary field update," per the brief's explicit requirement.

## Revisions: immutability, cloning, and revert

Anchor: `ContentRevision`'s own pre-existing schema.prisma doc comment — "Revisions are immutable once published at the application layer." Phase 8 implements exactly this, nothing more:

- **A content edit mutates the current revision in place** (no new row, `version` unchanged) *unless* the current revision's own `status` is `PUBLISHED` — checked on the **revision**, not the page/post's own status field. This distinction matters for one specific edge case: a page can be restored from `ARCHIVED` back to `DRAFT` (via the PATCH-to-DRAFT move) while its `currentRevision.status` is still `PUBLISHED`, because archiving from `PUBLISHED` does not itself clone (archiving preserves history exactly as it was, it doesn't rewrite it). The edit-time check catches this: the very next edit after such a restore still clones rather than mutating an already-published, supposedly-immutable row.
- **Unpublishing** (`PATCH {status: "DRAFT"}` from `PUBLISHED`) always clones immediately, even without an accompanying content edit — this keeps `Page.updatedAt`/the current revision meaningfully "fresh" for the next edit and guarantees the outgoing published revision is never touched again.
- **`publishPage`/`publishPost`** flips the *current* revision's own `status` to `PUBLISHED` and stamps `publishedAt` — it does not create a new revision (there's nothing to clone from; the current DRAFT/IN_REVIEW revision simply becomes the published one).
- **Revert** (`POST /pages/:id/revert` / `posts/:id/revert`, body `{ revisionId }`) **always** creates a new revision — `version = current + 1`, `status: DRAFT`, content copied from the target historical revision — and repoints `currentRevisionId` at it. It never mutates or deletes the target revision or the outgoing current one, so the full history survives every revert, per the brief's explicit "revert MUST create a new revision" / "NEVER overwrite historical revisions" requirement. If the page/post was `PUBLISHED` at the time of revert, reverting also moves it back to `DRAFT` (clears `publishedAt`) — the reverted content is never silently substituted underneath a still-live PUBLISHED status; it must be explicitly re-published. Reverting a target revision that belongs to a *different* page/post (an IDOR attempt) is rejected with 404 — `revertPage`/`revertPost` scope the lookup by both `revisionId` and the owning `pageId`/`postId`.
- The `content_revisions_exactly_one_parent` CHECK constraint (`num_nonnulls(page_id, post_id) = 1`, Phase 2) is respected by every revision-creating code path — each one sets exactly `pageId` or exactly `postId`, never both/neither.

## Optimistic concurrency (§12)

`Page.updatedAt`/`Post.updatedAt` doubles as the resource's version. `updatePageSchema`/`updatePostSchema` accept an optional `expectedUpdatedAt`. When supplied, the write becomes the same **conditional `updateMany` + affected-row-count check** pattern used throughout the platform for TOCTOU-safe transitions (lead conversion, workspace provisioning, invitation acceptance — Phases 5-6): `UPDATE pages SET ... WHERE id = ? AND updated_at = ?`, and if the row count comes back `0`, the request is rejected with a 409 `ConflictError` rather than silently overwriting whatever the concurrent writer just saved. This is a genuine database-level compare-and-swap, not a check-then-write race — Postgres evaluates the `WHERE` clause atomically against the row as it exists at write time, regardless of transaction isolation level.

One subtlety this required: an edit that changes only the *current revision's* fields (title/body/metadata, when mutating in place) would otherwise never touch the `Page`/`Post` row at all, leaving `updatedAt` stale and useless as a version. `updatePage`/`updatePost` explicitly bump `updatedAt` on the parent row for every content edit, even a revision-only one, specifically so it stays a reliable single version number for "this page/post and its current draft" as a whole. `tests/integration/pages.test.ts`'s and `posts.test.ts`'s "optimistic concurrency" tests exercise the full lost-update scenario: load → concurrent write → stale write rejected with 409 → a write with the fresh `updatedAt` succeeds.

## Scheduled publishing — data only, no worker (Phase 13 boundary)

`schedulePage`/`schedulePost` persist `status: SCHEDULED` and `scheduledAt` correctly, and the Control Center surfaces the scheduled time in the page/post detail view. **No cron, polling loop, or background job auto-transitions a SCHEDULED item to PUBLISHED at the scheduled time** — Phase 8 does not implement the background-job/worker infrastructure that would do this (explicitly out of scope, deferred to Phase 13). A SCHEDULED page/post stays SCHEDULED until an authorized caller explicitly hits `POST /pages/:id/publish` (or the schedule is cancelled via the DRAFT-reopen PATCH). This is a deliberate, documented limitation, not an oversight — building an ad-hoc cron here was explicitly disallowed.
