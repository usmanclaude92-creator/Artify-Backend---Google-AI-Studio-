/**
 * Phase 11 §19 — public website API: published-only CMS projection, active-only
 * product catalog, public lead intake, rate limiting, output projection
 * (no private/internal field leakage), tenant isolation.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { config } from "../../server/config/env";
import { resetDb } from "../helpers/db";

const PUBLIC_ORG_ID = config.publicWebsiteOrganizationId;

describe("public website API", () => {
  const app = createApp();
  finalizeApp(app);

  let publishedPageSlug: string;
  let draftPageSlug: string;
  let publishedPostSlug: string;
  let draftPostSlug: string;
  let scheduledPostSlug: string;
  let archivedPostSlug: string;
  let categorySlug: string;
  let activeProductSlug: string;
  let draftProductSlug: string;
  let archivedProductSlug: string;
  let otherOrgPageSlug: string;

  beforeAll(async () => {
    await resetDb();
    expect(PUBLIC_ORG_ID).toBeTruthy(); // .env.test must configure this — see .env.test

    await prisma.organization.create({ data: { id: PUBLIC_ORG_ID, name: "Public Test Agency", slug: "public-test-agency" } });
    const otherOrg = await prisma.organization.create({ data: { name: "Other Agency", slug: "other-agency-public-test" } });

    // A published page.
    const page = await prisma.page.create({ data: { organizationId: PUBLIC_ORG_ID, slug: "about-us", title: "About Us", status: "DRAFT" } });
    const pageRevision = await prisma.contentRevision.create({
      data: { pageId: page.id, version: 1, status: "PUBLISHED", title: "About Us", body: "<p>We build things.</p>", metadata: { metaTitle: "About Artify" } },
    });
    await prisma.page.update({ where: { id: page.id }, data: { status: "PUBLISHED", currentRevisionId: pageRevision.id, publishedAt: new Date() } });
    publishedPageSlug = page.slug;

    // A draft page — must never be publicly reachable.
    const draftPage = await prisma.page.create({ data: { organizationId: PUBLIC_ORG_ID, slug: "secret-draft-page", title: "Secret Draft", status: "DRAFT" } });
    draftPageSlug = draftPage.slug;

    // A page belonging to a DIFFERENT organization, same-looking slug — must never leak through the public org.
    const otherPage = await prisma.page.create({ data: { organizationId: otherOrg.id, slug: "other-org-page", title: "Other Org Page", status: "PUBLISHED" } });
    otherOrgPageSlug = otherPage.slug;

    const category = await prisma.category.create({ data: { organizationId: PUBLIC_ORG_ID, slug: "engineering", name: "Engineering" } });
    categorySlug = category.slug;

    // A published post with category/tags.
    const tag = await prisma.tag.create({ data: { organizationId: PUBLIC_ORG_ID, slug: "ai", name: "AI" } });
    const post = await prisma.post.create({
      data: { organizationId: PUBLIC_ORG_ID, slug: "hello-world", title: "Hello World", status: "DRAFT", categoryId: category.id },
    });
    const postRevision = await prisma.contentRevision.create({
      data: { postId: post.id, version: 1, status: "PUBLISHED", title: "Hello World", body: "<p>First post.</p>", metadata: {} },
    });
    await prisma.post.update({ where: { id: post.id }, data: { status: "PUBLISHED", currentRevisionId: postRevision.id, publishedAt: new Date() } });
    await prisma.postTag.create({ data: { postId: post.id, tagId: tag.id } });
    publishedPostSlug = post.slug;

    // Never-publicly-reachable posts: DRAFT, IN_REVIEW→SCHEDULED, ARCHIVED.
    const draftPost = await prisma.post.create({ data: { organizationId: PUBLIC_ORG_ID, slug: "draft-post", title: "Draft Post", status: "DRAFT" } });
    draftPostSlug = draftPost.slug;
    const scheduledPost = await prisma.post.create({
      data: { organizationId: PUBLIC_ORG_ID, slug: "scheduled-post", title: "Scheduled Post", status: "SCHEDULED", scheduledAt: new Date(Date.now() + 86400000) },
    });
    scheduledPostSlug = scheduledPost.slug;
    const archivedPost = await prisma.post.create({ data: { organizationId: PUBLIC_ORG_ID, slug: "archived-post", title: "Archived Post", status: "ARCHIVED" } });
    archivedPostSlug = archivedPost.slug;

    // Products: ACTIVE (visible), DRAFT (hidden), ARCHIVED (hidden).
    const activeProduct = await prisma.product.create({ data: { code: "PUB-ACTIVE", name: "Public Active Product", slug: "public-active-product", type: "PRODUCT", status: "ACTIVE" } });
    activeProductSlug = activeProduct.slug;
    await prisma.productModule.create({ data: { productId: activeProduct.id, code: "MOD-1", name: "Core Module", slug: "core-module", status: "ACTIVE", displayOrder: 0 } });
    await prisma.productModule.create({ data: { productId: activeProduct.id, code: "MOD-2", name: "Hidden Draft Module", slug: "hidden-draft-module", status: "DRAFT", displayOrder: 1 } });

    const draftProduct = await prisma.product.create({ data: { code: "PUB-DRAFT", name: "Public Draft Product", slug: "public-draft-product", type: "PRODUCT", status: "DRAFT" } });
    draftProductSlug = draftProduct.slug;
    const archivedProduct = await prisma.product.create({ data: { code: "PUB-ARCHIVED", name: "Public Archived Product", slug: "public-archived-product", type: "PRODUCT", status: "ARCHIVED" } });
    archivedProductSlug = archivedProduct.slug;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("GET /public/site reports configured=true when PUBLIC_WEBSITE_ORGANIZATION_ID is set", async () => {
    const res = await request(app).get("/api/v1/public/site");
    expect(res.status).toBe(200);
    expect(res.body.data.configured).toBe(true);
  });

  it("returns a published page by slug, with body/seo/featuredMedia projection, no internal fields", async () => {
    const res = await request(app).get(`/api/v1/public/pages/${publishedPageSlug}`);
    expect(res.status).toBe(200);
    expect(res.body.data.page.title).toBe("About Us");
    expect(res.body.data.page.body).toContain("We build things");
    expect(res.body.data.page.seo).toEqual({ metaTitle: "About Artify" });
    expect(res.body.data.page).not.toHaveProperty("organizationId");
    expect(res.body.data.page).not.toHaveProperty("id");
    expect(res.body.data.page).not.toHaveProperty("createdById");
  });

  it("rejects a DRAFT page with a clean 404 — never leaks unpublished content", async () => {
    const res = await request(app).get(`/api/v1/public/pages/${draftPageSlug}`);
    expect(res.status).toBe(404);
  });

  it("never leaks a page belonging to a different organization even with a matching-looking slug", async () => {
    const res = await request(app).get(`/api/v1/public/pages/${otherOrgPageSlug}`);
    expect(res.status).toBe(404);
  });

  it("returns a 404 for a nonexistent page slug (no stack trace, no raw error)", async () => {
    const res = await request(app).get("/api/v1/public/pages/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).not.toMatch(/prisma|stack|at Object/i);
  });

  it("lists only PUBLISHED posts, with category/tags/author projection", async () => {
    const res = await request(app).get("/api/v1/public/posts");
    expect(res.status).toBe(200);
    const slugs = res.body.data.posts.map((p: { slug: string }) => p.slug);
    expect(slugs).toContain(publishedPostSlug);
    expect(slugs).not.toContain(draftPostSlug);
    expect(slugs).not.toContain(scheduledPostSlug);
    expect(slugs).not.toContain(archivedPostSlug);

    const found = res.body.data.posts.find((p: { slug: string }) => p.slug === publishedPostSlug);
    expect(found.category.slug).toBe(categorySlug);
    expect(found.tags[0].slug).toBe("ai");
  });

  it("filters posts by category slug", async () => {
    const res = await request(app).get("/api/v1/public/posts").query({ category: categorySlug });
    expect(res.status).toBe(200);
    expect(res.body.data.posts.every((p: { category: { slug: string } | null }) => p.category?.slug === categorySlug)).toBe(true);
  });

  it("returns a published post by slug and rejects DRAFT/SCHEDULED/ARCHIVED by slug with 404", async () => {
    const ok = await request(app).get(`/api/v1/public/posts/${publishedPostSlug}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.post.title).toBe("Hello World");
    expect(ok.body.data.post).not.toHaveProperty("organizationId");

    for (const slug of [draftPostSlug, scheduledPostSlug, archivedPostSlug]) {
      const res = await request(app).get(`/api/v1/public/posts/${slug}`);
      expect(res.status).toBe(404);
    }
  });

  it("lists categories and tags", async () => {
    const categories = await request(app).get("/api/v1/public/categories");
    expect(categories.status).toBe(200);
    expect(categories.body.data.categories.some((c: { slug: string }) => c.slug === categorySlug)).toBe(true);

    const tags = await request(app).get("/api/v1/public/tags");
    expect(tags.status).toBe(200);
    expect(tags.body.data.tags.some((t: { slug: string }) => t.slug === "ai")).toBe(true);
  });

  it("lists only ACTIVE products, excluding DRAFT/ARCHIVED", async () => {
    const res = await request(app).get("/api/v1/public/products");
    expect(res.status).toBe(200);
    const slugs = res.body.data.products.map((p: { slug: string }) => p.slug);
    expect(slugs).toContain(activeProductSlug);
    expect(slugs).not.toContain(draftProductSlug);
    expect(slugs).not.toContain(archivedProductSlug);
  });

  it("returns an ACTIVE product by slug and rejects DRAFT/ARCHIVED by slug with 404", async () => {
    const ok = await request(app).get(`/api/v1/public/products/${activeProductSlug}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.product.name).toBe("Public Active Product");

    for (const slug of [draftProductSlug, archivedProductSlug]) {
      const res = await request(app).get(`/api/v1/public/products/${slug}`);
      expect(res.status).toBe(404);
    }
  });

  it("returns only ACTIVE modules for a product, excluding DRAFT modules", async () => {
    const res = await request(app).get(`/api/v1/public/products/${activeProductSlug}/modules`);
    expect(res.status).toBe(200);
    const slugs = res.body.data.modules.map((m: { slug: string }) => m.slug);
    expect(slugs).toContain("core-module");
    expect(slugs).not.toContain("hidden-draft-module");
  });

  // Each lead-intake test below sets a distinct simulated client IP
  // (X-Forwarded-For, honored via `trust proxy` — server/middleware/security.ts)
  // so they don't share a rate-limit bucket with each other or with the
  // dedicated rate-limiting test, which deliberately exhausts its own.
  it("creates a real CRM lead from a valid public submission, under the configured organization only", async () => {
    const res = await request(app)
      .post("/api/v1/public/leads")
      .set("X-Forwarded-For", "203.0.113.10")
      .send({
        name: "Jane Prospect",
        company: "Prospect Co",
        email: "jane@prospect-co.example",
        message: "We'd like a quote for an AI automation project.",
        source: "contact_form",
        consent: true,
      });
    expect(res.status).toBe(201);

    const lead = await prisma.lead.findFirst({ where: { email: "jane@prospect-co.example" } });
    expect(lead).not.toBeNull();
    expect(lead!.organizationId).toBe(PUBLIC_ORG_ID);
    expect(lead!.companyName).toBe("Prospect Co");
    expect(lead!.status).toBe("NEW");
    expect(lead!.assignedTo).toBeNull();
  });

  it("rejects an invalid lead submission (missing required fields, bad email, missing consent)", async () => {
    const missingFields = await request(app).post("/api/v1/public/leads").set("X-Forwarded-For", "203.0.113.11").send({ name: "X" });
    expect(missingFields.status).toBe(400);

    const badEmail = await request(app)
      .post("/api/v1/public/leads")
      .set("X-Forwarded-For", "203.0.113.11")
      .send({ name: "X", email: "not-an-email", message: "hello there", consent: true });
    expect(badEmail.status).toBe(400);

    const noConsent = await request(app)
      .post("/api/v1/public/leads")
      .set("X-Forwarded-For", "203.0.113.11")
      .send({ name: "X", email: "x@example.com", message: "hello there", consent: false });
    expect(noConsent.status).toBe(400);
  });

  it("rejects a malicious/oversized payload cleanly", async () => {
    const res = await request(app)
      .post("/api/v1/public/leads")
      .set("X-Forwarded-For", "203.0.113.12")
      .send({ name: "X", email: "x@example.com", message: "a".repeat(10000), consent: true });
    expect(res.status).toBe(400);
  });

  it("discards a honeypot-triggered submission without creating a lead, but returns the same success response", async () => {
    const res = await request(app)
      .post("/api/v1/public/leads")
      .set("X-Forwarded-For", "203.0.113.13")
      .send({
        name: "Bot",
        email: "bot@example.com",
        message: "I am a bot filling every field",
        consent: true,
        website: "http://spam.example",
      });
    expect(res.status).toBe(201);

    const lead = await prisma.lead.findFirst({ where: { email: "bot@example.com" } });
    expect(lead).toBeNull();
  });

  it("rate-limits public lead submissions per IP", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        request(app)
          .post("/api/v1/public/leads")
          .set("X-Forwarded-For", "203.0.113.99")
          .send({ name: "Rate Test", email: `rate-${i}@example.com`, message: "hello there rate limit test", consent: true })
      )
    );
    expect(attempts.some((r) => r.status === 429)).toBe(true);
  });

  it("never exposes storage credentials, internal ids, or organization data through any public response", async () => {
    const responses = await Promise.all([
      request(app).get(`/api/v1/public/pages/${publishedPageSlug}`),
      request(app).get(`/api/v1/public/posts/${publishedPostSlug}`),
      request(app).get(`/api/v1/public/products/${activeProductSlug}`),
    ]);
    for (const res of responses) {
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/storageKey|storageBucket|storageProvider|passwordHash|sessionToken/i);
    }
  });
});
