# CMS Architecture (Phase 8)

## Schema reuse — no new tables

Phase 2 already built the complete CMS schema and it was never referenced by application code until now: `Page`, `Post`, `Category`, `Tag`, `PostTag`, `ContentRevision`, `Author`, and the `ContentStatus` enum. Phase 8 adds **zero** new tables and **zero** new columns to any of them. The only schema change is two additive index migrations (`organizationId, status` on `Page`/`Post`, `categoryId`/`authorId` on `Post`, `tagId` on `PostTag`) to match the query patterns the new endpoints actually run — see `docs/PHASE_8_IMPLEMENTATION.md`.

## Ownership decision: organization-scoped, not platform-global

```
Organization
     │
     ├── Page (organization-owned)
     ├── Post (organization-owned)
     │      ├── Category (organization-owned)
     │      └── Tag (organization-owned, many-to-many via PostTag)
     └── (Author is the one exception — see below)
```

Unlike `Product` (Phase 7, deliberately platform-global — see `docs/PRODUCT_CATALOG_ARCHITECTURE.md`), `Page`/`Post`/`Category`/`Tag` all carry `organizationId` in the Phase 2 schema, with `@@unique([organizationId, slug])`. This was a schema decision made before Phase 8 existed, not one made this phase — Phase 8 follows it. CMS content is tenant data: one organization's pages and blog posts, exactly like `Client`/`Lead`/`Contact` (Phase 5), never a shared catalog. Every repository (`pageRepository`, `postRepository`, `categoryRepository`, `tagRepository`) exposes exactly one by-id lookup, `findByIdInOrg(id, organizationId)`, never a bare `findById` — the same structural-IDOR-prevention convention used throughout the platform since Phase 5.

## Author: the one platform-global CMS entity

`Author` has no `organizationId` in the Phase 2 schema — it is a thin byline profile over `User` (`userId @unique`, `bio`, `avatarUrl`), and `User` itself is not organization-owned (a user reaches an organization through `OrganizationMembership`). Phase 8 preserves this: `authorRepository`/`authorService` are permission-gated only (`authors.read/create/update`), mirroring `Product`'s global-entity pattern, not the tenant-scoped one.

**Identity-escalation safety**: creating or updating an Author row never touches `User.roleId`, `User.passwordHash`, or any session/authentication field — it only ever writes `bio`/`avatarUrl` to a new `authors` row. Linking a `userId` to an Author profile cannot grant that user elevated permissions; `tests/integration/authors.test.ts` asserts this directly (a USER-role account gains no new capability after being linked as an Author).

**No archive/delete endpoint for Author.** The Phase 2 schema has no status/archived column on `Author`, and there is nothing meaningful to archive independently: a User's own `status` (ACTIVE/INVITED/DISABLED) already governs whether the account is active, and `Post.authorId` is `SetNull` on delete, so removing the underlying User's account safely detaches historical posts rather than corrupting them — they keep their content, just lose the live author link. Adding a second, redundant "author disabled" flag would duplicate `User.status` rather than reuse it, which the brief explicitly warns against.

## Authorization model

Permission-gated (`content.read/create/update/publish/delete`, unchanged from Phase 2's seed — Phase 8 adds no new content permission keys) **and** row-scoped via `findByIdInOrg` on every Page/Post/Category/Tag mutation. A caller from Organization B requesting a Page id that belongs to Organization A gets a 404, identical to the Lead/Client/Product-module IDOR protections from Phases 5-7 — `tests/integration/pages.test.ts`, `posts.test.ts`, and `categoriesAndTags.test.ts` each have a dedicated cross-organization test.

Three new permission keys were added, all under the `authors.*` module: `authors.read`, `authors.create`, `authors.update` (no `authors.archive` — see above). Granted ADMIN full, MANAGER read+update, USER/VIEWER read-only, matching the existing tier shape for every other resource.

## Archive vs. soft-delete — two distinct mechanisms

Following the exact precedent set for `Client` in Phase 5:

- **`status: ARCHIVED`** is a visible lifecycle state, reachable only through the dedicated `POST /pages/:id/archive` / `POST /posts/:id/archive` endpoints (never the generic PATCH — see `docs/CONTENT_WORKFLOW_ARCHITECTURE.md`). An archived page/post is hidden from the *default* list (still counted/listed if a caller explicitly filters `status=ARCHIVED`) and its content becomes read-only until restored.
- **`deletedAt`** is a genuine soft-delete, set only by `DELETE /pages/:id` / `DELETE /posts/:id` (`content.delete`). It is a separate column from `status` and hides the row from every listing/lookup unconditionally, including `status=ARCHIVED` filters. Never a physical delete, matching every other soft-deletable model in the platform.

## Categories and Tags: no archive/inactive state

Unlike Page/Post (which do have a meaningful in-between "archived but visible in history" state because they carry versioned content), `Category` and `Tag` in the Phase 2 schema are pure lookup rows with no `status` column — a category or tag either exists or it doesn't. Phase 8 exposes a real `DELETE` for both. This is safe without a soft-delete/archive layer because the FK from `Post` is `SetNull` (`onDelete: SetNull` on `Post.categoryId` and `Post.authorId`, `onDelete: Cascade` on `PostTag`), so deleting a category/tag detaches it from existing posts instead of corrupting or blocking the delete — historical posts keep their title/body/revisions, they just lose that one category/tag reference. This matches the brief's "do not hard-delete categories/tags required for historical integrity" instruction by relying on the schema's own SetNull behavior rather than inventing a second archived-state column Phase 2 never defined.

## See also

- `docs/CONTENT_WORKFLOW_ARCHITECTURE.md` — the publish/schedule/revision/revert state machine and optimistic-concurrency design.
- `docs/PHASE_8_IMPLEMENTATION.md` — endpoints, migration, audit events, tests.
- `docs/PHASE_8_COMPLETION_REPORT.md` — final status.
