# Public Website Architecture (Phase 11)

## Data flow (non-negotiable, unchanged from Phase 1's boundary)
```
Public Browser → artifysolscom frontend → Artify Platform API (/api/v1/public/*) → Services/Repositories → Prisma → PostgreSQL
```
The browser never touches Postgres, Prisma, or a Supabase service-role key. `artifysolscom`'s own legacy `server/` Express app (a deprecated local backend, see that directory's `README.md`) is not this site's data source for CMS/products/leads — `src/lib/publicApi.ts` calls the real Artify-Backend platform API directly, configured via `VITE_PLATFORM_API_BASE_URL`.

## Frontend (`artifysolscom`)
- `src/lib/publicApi.ts` — typed client over `src/lib/apiClient.ts`, one function per public endpoint, plus `mapPostToBlogPost()`: an honest compatibility mapper from the real `Post` projection to the pre-existing `BlogPost` UI type. Fields the CMS doesn't track (views/likes/ratings/comments) are left at an honest zero/empty default, never a fabricated seed number.
- **Blog** (`BlogPage.tsx`/`BlogPostPage.tsx`): now fetch published posts/categories from `publicApi` instead of `data/blogData.ts`. The page's former in-browser "Composer & SEO" / "Drafts Desk" authoring UI (`CreateArticleModal`, `DraftsManagerDrawer`) wrote fake "published" posts to `localStorage` with no real backend behind them — a direct violation of the platform's CMS/authority boundary (CMS authoring belongs to the Control Center, with real RBAC, not the anonymous public site) — so it was removed from the live page rather than wired to a new endpoint. `BlogPostPage.tsx`'s fabricated seed engagement stats (a hardcoded 4.9★/142-rating default, two named fake comments, fixed reaction counts) were replaced with honest zero/empty defaults.
- **Products** (`AiSolutionsPage.tsx`, `AiProductDetailPage.tsx`, `SolutionsCatalogPage.tsx`): rewritten against the real `Product`/`ProductModule` shape. The previous versions rendered a rich, entirely fictional `AiProductItem` (problem/solution/features/benefits/useCases/workflow/techStack/metrics) that has no counterpart in the real schema — honestly mapping it was impossible without inventing content, so the pages were replaced rather than patched. `/solutions` now renders the same real catalog as `/ai-solutions` (`SolutionsCatalogPage` is a thin wrapper around `AiSolutionsPage`) instead of a second, fictional "24 modular systems" catalog.
- **Leads** (`ContactAndBrief.tsx`): now calls `publicApi.submitLead()` → real `POST /api/v1/public/leads`. Previously it called a local, non-persisting `/api/brief-submit` route (deleted from `server.ts` and `api/index.ts`) that only `console.log`s and always fabricates a success response — including a `catch` block that reported success even when the network request itself failed. Both are fixed: a failed submission now shows an honest error, never a fake confirmation.
- **Footer** quick-links and the sitemap (`src/utils/sitemap.ts`) were similarly switched from the static fictional data files to the real API.

## What deliberately did not change
- Client Portal (Phase 10) keeps its own session-based auth; the public site never gains a second authentication system, and a contact-form visitor is never a platform user.
- The legacy `artifysolscom/server/` Express backend is untouched — its two still-live routes (`/api/v1/cms/seo-telemetry`, `/optimize-meta`) back an internal admin tool, out of this phase's scope, already marked deprecated.
- No schema changes were required in Artify-Backend for this phase; Phase 11 reuses Phase 5/7/8/9 models as-is.
