# SEO Architecture (Phase 11)

## Principle
Every piece of SEO metadata the public site emits is derived from real, published content returned by `/api/v1/public/*` — never invented copy, never a placeholder score presented as real.

## Sitemap / robots.txt (`artifysolscom/src/utils/sitemap.ts`)
`getSitemapUrlList()`/`generateSitemapXml()` are now async: they fetch published posts, `ACTIVE` products, and categories live from the Platform API (`resolveApiBaseUrl()` — `VITE_PLATFORM_API_BASE_URL` in the browser via `SitemapModal.tsx`, `PLATFORM_API_BASE_URL` server-side via `server.ts`/`api/index.ts`) and build entries only from that response. A handful of static core routes (`/`, `/blog`, `/solutions`, …) remain fixed since they're not backed by dynamic content. If the API is unreachable or unconfigured, dynamic entries are simply omitted — the sitemap degrades to the static core pages rather than fabricating article/product URLs. `robots.txt` disallows `/api/` and `/portal/admin/` and points at the dynamic sitemap.

## Per-page metadata
- **Blog**: `BlogPostPage.tsx` calls the pre-existing `generateBlogPostSeo(post, …)` unchanged — it already worked from the `BlogPost` shape, and `mapPostToBlogPost()` supplies that shape from real `Post` data (title/excerpt/tags/author/cover image straight from the CMS). `seo.seoScore` — a fabricated always-92/100 badge in the editor-only SEO Inspector — now shows `—` when the real post carries no score rather than a fake one.
- **Products**: `AiProductDetailPage.tsx` builds its own `updatePageSeo()` call directly from the real `Product` (`name`, `shortDescription`) — the old `generateProductSeo()` generator assumed the fictional `AiProductItem` shape and was not reused.

## No unpublished-content leakage
The sitemap and every SEO call source exclusively from `/api/v1/public/*`, which itself only ever returns `PUBLISHED` Pages/Posts and `ACTIVE` Products (see `PUBLIC_API_ARCHITECTURE.md`) — a draft, scheduled, or archived record can never reach a `<meta>` tag, JSON-LD block, or sitemap URL.
