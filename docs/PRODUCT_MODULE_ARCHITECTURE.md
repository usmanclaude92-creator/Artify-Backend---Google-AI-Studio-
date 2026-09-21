# Product Module Architecture (Phase 7)

## Relationship to Product

```
Product (Artify HCMS)
  ├── Product Module (Employee Management) — isCore=true
  ├── Product Module (Payroll)
  ├── Product Module (Attendance)
  ├── Product Module (Leave Management)
  └── Product Module (Reports)
```

Every module belongs to exactly one product (`ProductModule.productId`, `onDelete: Cascade`, unchanged from Phase 2). This is a hard FK relationship, not a soft reference — a module can never exist without a parent product, and never be reassigned to a different product through any Phase 7 endpoint (no route accepts a `productId` change on an existing module).

## Fields

| Field | Notes |
|---|---|
| `code` | required, normalized (trim, uppercase), unique **within its product** (not globally — the same code may exist under two different products) |
| `name` | display name |
| `slug` | lowercase URL-safe, unique within its product, server-generated from `name` by default |
| `description` | plain text, length-capped |
| `status` | `DRAFT` \| `ACTIVE` \| `INACTIVE` — no separate `ARCHIVED` value (see Lifecycle below) |
| `displayOrder` | integer, explicit; new modules default to `max(displayOrder) + 1` within their product |
| `isCore` | boolean — a core module still uses the same archive/deactivate actions as any other, but a generic `PATCH` cannot flip a core module straight to `INACTIVE` (see Safety below) |

## Code normalization

`" PAYROLL "`, `"payroll"`, and `"PAYROLL"` all normalize to `"PAYROLL"` (trim, then uppercase) before the duplicate check, so they collide as the same module within one product — proven by a dedicated test. The `@@unique([productId, code])` database constraint is the backstop if two requests race past the application-level check.

## Lifecycle

Module status is a 3-value set (`DRAFT`/`ACTIVE`/`INACTIVE`), simpler than Product's 4-value lifecycle — modules have no separate "archived" state because their existence is already scoped to their parent product's own lifecycle (archiving the *product* is what makes its modules unreachable through the catalog; archiving the *module* individually just means "not currently offered as part of this product," which `INACTIVE` already expresses). "Archive a module" (§14/§19's "safe archive behavior") is therefore implemented as `POST /product-modules/:id/archive` → `status: INACTIVE` — never a physical delete, so a future `SubscriptionItem.productModuleId` reference always resolves.

**Safety guard on core modules**: a generic `PATCH /product-modules/:id { status: "INACTIVE" }` is rejected for a module where `isCore: true` — deactivating a product's core module is significant enough that it must go through the same explicit, separately-audited `POST .../archive` action as any other archive, not slip through as one field among several in a broader edit that a reviewer might miss.

## Ordering

`displayOrder` is a plain integer column — list order never depends on database insertion order (§13). `GET /products/:id/modules` always orders by `displayOrder ASC`.

### Reordering (§36) — the cross-product protection

`POST /products/:id/modules/reorder` takes `{ moduleIds: string[] }` — the *complete* new order for one product's modules. `productModuleService.reorderModules`:

1. Loads the product (404 if it doesn't exist).
2. Loads the product's current module id set.
3. Validates the request's `moduleIds` is **exactly** that set — same length, no duplicates, no missing id, no extra id (which also catches a module id belonging to a *different* product, since that id is by definition not in this product's set). Any mismatch → `400`, nothing written.
4. Applies every module's new `displayOrder` inside one `prisma.$transaction`, using Prisma's extended-where-unique (`where: { id, productId }`) on each update as a second, database-level guard — belt-and-suspenders against the set-equality check ever being bypassed.

A malicious or buggy request naming another product's module id is rejected before any write happens, and even in the transaction itself, a mismatched `productId` on any single update aborts the whole batch. Proven by a dedicated test that attempts to reorder a foreign module into a product's list and asserts both the rejection and that the foreign module's own `displayOrder` is untouched.

## Audit trail

Reuses the existing append-only `auditLogRepository.record()` — no second audit mechanism. Actions: `PRODUCT_MODULE_CREATED`, `PRODUCT_MODULE_UPDATED`, `PRODUCT_MODULE_ARCHIVED`, `PRODUCT_MODULE_REORDERED` (one event per reorder call, `afterData` carries the new id order — never a full dump of unrelated request data).

## API

```
GET    /api/v1/products/:id/modules              list, ordered by displayOrder
POST   /api/v1/products/:id/modules               create (validates product exists + not archived)
POST   /api/v1/products/:id/modules/reorder        transactional, validated reorder

GET    /api/v1/product-modules/:id                 standalone detail
PATCH  /api/v1/product-modules/:id                  standalone update
POST   /api/v1/product-modules/:id/archive          standalone archive (-> INACTIVE)
```

The standalone `/product-modules/:id` routes take no separate `productId` parameter, so there is no cross-product manipulation surface for them specifically — the id itself is authoritative for both the record and its true parent product (a bare primary-key lookup is safe there). The nested `/products/:id/modules*` routes are where a request supplies *two* ids that must be cross-checked against each other, which is what `findByIdForProduct` and the reorder validation above exist to do.

## Known limitations

- `isCore` currently only gates the single "can't deactivate via generic PATCH" rule — it does not yet prevent archiving a core module outright, since the brief doesn't ask for that and the archive action is already explicit/audited on its own.
- No per-module configuration schema exists yet (mirrors Product's `configuration` field limitation — see `docs/PRODUCT_CATALOG_ARCHITECTURE.md`).
