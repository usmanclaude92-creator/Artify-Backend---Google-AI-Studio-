# Public API Architecture (Phase 11)

`/api/v1/public/*` (`server/routes/v1/publicRoutes.ts`) is the only part of the Platform API an anonymous browser may call. No `authenticateToken` anywhere in this router — that is exactly why it is the most tightly bounded route file in the codebase.

## Endpoints
| Method | Path | Source |
|---|---|---|
| GET | `/site` | `{ configured: boolean }` — whether `PUBLIC_WEBSITE_ORGANIZATION_ID` is set |
| GET | `/pages/:slug` | Published `Page` only |
| GET | `/posts` | Published `Post` list — `search`, `category`, `tag`, `page`, `limit`, `sort`, `order` |
| GET | `/posts/:slug` | Published `Post` |
| GET | `/categories` | CMS categories |
| GET | `/tags` | CMS tags |
| GET | `/products` | `ACTIVE` products/services — `search`, `type`, `page`, `limit` |
| GET | `/products/:slug` | `ACTIVE` product |
| GET | `/products/:slug/modules` | `ACTIVE` modules of an `ACTIVE` product |
| POST | `/leads` | Creates a CRM `Lead`. Rate-limited (`publicLeadLimiter`, 5/15min/IP), honeypot, `consent` required |

## Tenant resolution
CMS content (`Page`/`Post`/`Category`/`Tag`) and `Lead` are organization-scoped. The public site has no session, so `config.publicWebsiteOrganizationId` (env `PUBLIC_WEBSITE_ORGANIZATION_ID`, optional) names the one agency organization the public site represents. Unset → `publicSiteService`/`publicLeadService` return empty results / disable lead intake rather than guess a tenant. `Product`/`ProductModule` are platform-global (Phase 7), so `publicProductService` needs no such resolution.

## Projection (never the raw row)
`publicSiteService.ts` and `publicProductService.ts` each hand-build a plain object per resource — see the field tables in `PUBLIC_WEBSITE_ARCHITECTURE.md` §Projection. Never present on a public response: `organizationId`, internal DB ids (slug is the public identifier), `createdById`, storage key/bucket/provider, password/session/permission/audit data, unpublished/draft/scheduled/archived content, revision history, or any Client Portal financial record.

## Media
`projectPublicMedia()` returns a signed read URL only for `status === "ACTIVE" && visibility === "PUBLIC"`; anything else (including a genuinely missing image) is `null`, never an error — reuses the existing `getStorageProvider().createSignedReadUrl()`, no new storage code.

## Lead intake anti-abuse
- `createPublicLeadSchema` (`server/schemas/publicSchemas.ts`): flat, small, no server-controlled field acceptable from the client (no `organizationId`/`status`/`ownerId`).
- Honeypot: `website` field, hidden via CSS on the frontend. A non-empty value is accepted-but-discarded — same 201 response as a real submission, so a bot cannot learn which field gave it away.
- Rate limit: `publicLeadLimiter` (`server/middleware/rateLimiter.ts`), keyed by `req.ip` only (there is no authenticated caller to key by).
- `consent: z.literal(true)` is required on every submission.

## Reused, not duplicated
Every public service composes the existing Phase 5/7/8/9 repositories (`pageRepository`, `postRepository`, `categoryRepository`, `tagRepository`, `productRepository`, `productModuleRepository`, `leadService`) — no new Prisma models, no parallel CMS/product/lead implementation.
