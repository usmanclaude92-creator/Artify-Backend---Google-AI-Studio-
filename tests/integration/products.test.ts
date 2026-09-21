/** Phase 7 §49 — product catalog CRUD: create/read/update/archive, duplicate code/slug, search/filter/pagination/sorting, concurrency, permissions. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("product catalog", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "product-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Product",
      lastName: "Admin",
      organizationName: "Product Admin Co",
    });
    adminToken = reg.body.data.session.token;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "product-viewer@example.com", password: "ViewerPassword123", firstName: "V", lastName: "W", roleKey: "VIEWER" });
    const viewerLogin = await request(app).post("/api/v1/auth/login").send({ email: "product-viewer@example.com", password: "ViewerPassword123" });
    viewerToken = viewerLogin.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("creates a product with a server-generated slug and normalizes/uppercases the code, and audits PRODUCT_CREATED", async () => {
    const res = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: " hcms-01 ", name: "Artify HCMS", type: "PRODUCT", shortDescription: "HR & payroll suite" });
    expect(res.status).toBe(201);
    expect(res.body.data.product.code).toBe("HCMS-01");
    expect(res.body.data.product.slug).toBe("artify-hcms");
    expect(res.body.data.product.status).toBe("DRAFT");

    const audit = await prisma.auditLog.findFirst({ where: { action: "PRODUCT_CREATED", resourceId: res.body.data.product.id } });
    expect(audit).not.toBeNull();
  });

  it("rejects a duplicate product code with a clear 409 conflict", async () => {
    await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "PAYROLL-01", name: "Payroll One", type: "PRODUCT" });
    const dupe = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "PAYROLL-01", name: "Payroll Two", type: "PRODUCT" });
    expect(dupe.status).toBe(409);
  });

  it("rejects a duplicate product slug with a clear 409 conflict", async () => {
    await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "CRM-A", name: "CRM Alpha", type: "SERVICE", slug: "shared-slug" });
    const dupe = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "CRM-B", name: "CRM Beta", type: "SERVICE", slug: "shared-slug" });
    expect(dupe.status).toBe(409);
  });

  it("updates a product, validates lifecycle transitions server-side, and rejects setting ARCHIVED via generic update", async () => {
    const created = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "CONSULT-01", name: "Consulting", type: "SERVICE" });
    const id = created.body.data.product.id;

    const activate = await request(app).patch(`/api/v1/products/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "ACTIVE" });
    expect(activate.status).toBe(200);
    expect(activate.body.data.product.status).toBe("ACTIVE");

    const badArchive = await request(app).patch(`/api/v1/products/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "ARCHIVED" });
    expect(badArchive.status).toBe(400);

    const deactivate = await request(app).patch(`/api/v1/products/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "INACTIVE" });
    expect(deactivate.status).toBe(200);

    const audit = await prisma.auditLog.findFirst({ where: { action: "PRODUCT_UPDATED", resourceId: id } });
    expect(audit).not.toBeNull();
  });

  it("archives a product via the dedicated endpoint, preserving the row and rejecting further edits", async () => {
    const created = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "ARCHIVE-01", name: "Archive Me", type: "PRODUCT" });
    const id = created.body.data.product.id;

    const archive = await request(app).post(`/api/v1/products/${id}/archive`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(archive.status).toBe(200);
    expect(archive.body.data.product.status).toBe("ARCHIVED");

    const stillExists = await prisma.product.findUnique({ where: { id } });
    expect(stillExists).not.toBeNull();

    const editAttempt = await request(app).patch(`/api/v1/products/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ name: "Renamed" });
    expect(editAttempt.status).toBe(409);

    const reArchive = await request(app).post(`/api/v1/products/${id}/archive`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(reArchive.status).toBe(409);

    const audit = await prisma.auditLog.findFirst({ where: { action: "PRODUCT_ARCHIVED", resourceId: id } });
    expect(audit).not.toBeNull();
  });

  it("searches/filters/paginates/sorts the catalog server-side", async () => {
    await request(app).post("/api/v1/products").set("Authorization", `Bearer ${adminToken}`).send({ code: "SEARCH-A", name: "Findable Alpha", type: "PRODUCT" });
    await request(app).post("/api/v1/products").set("Authorization", `Bearer ${adminToken}`).send({ code: "SEARCH-B", name: "Findable Beta", type: "SERVICE" });

    const search = await request(app).get("/api/v1/products").query({ search: "Findable" }).set("Authorization", `Bearer ${adminToken}`);
    expect(search.status).toBe(200);
    expect(search.body.data.products.length).toBeGreaterThanOrEqual(2);

    const filtered = await request(app).get("/api/v1/products").query({ type: "SERVICE", search: "Findable" }).set("Authorization", `Bearer ${adminToken}`);
    expect(filtered.body.data.products.every((p: { type: string }) => p.type === "SERVICE")).toBe(true);

    const paged = await request(app).get("/api/v1/products").query({ page: 1, limit: 1 }).set("Authorization", `Bearer ${adminToken}`);
    expect(paged.body.data.products).toHaveLength(1);
    expect(paged.body.meta.pagination.limit).toBe(1);

    const sorted = await request(app).get("/api/v1/products").query({ sort: "name", order: "asc", limit: 100 }).set("Authorization", `Bearer ${adminToken}`);
    const names = sorted.body.data.products.map((p: { name: string }) => p.name);
    expect(names).toEqual([...names].sort());
  });

  it("rejects an unsafe sort field", async () => {
    const res = await request(app).get("/api/v1/products").query({ sort: "1; DROP TABLE products;--" }).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it("enforces permissions: a VIEWER can read but not create/update/archive", async () => {
    const created = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "PERM-01", name: "Permission Test", type: "PRODUCT" });
    const id = created.body.data.product.id;

    const list = await request(app).get("/api/v1/products").set("Authorization", `Bearer ${viewerToken}`);
    expect(list.status).toBe(200);

    const createRes = await request(app).post("/api/v1/products").set("Authorization", `Bearer ${viewerToken}`).send({ code: "PERM-02", name: "X", type: "PRODUCT" });
    expect(createRes.status).toBe(403);

    const updateRes = await request(app).patch(`/api/v1/products/${id}`).set("Authorization", `Bearer ${viewerToken}`).send({ name: "Y" });
    expect(updateRes.status).toBe(403);

    const archiveRes = await request(app).post(`/api/v1/products/${id}/archive`).set("Authorization", `Bearer ${viewerToken}`).send();
    expect(archiveRes.status).toBe(403);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/v1/products");
    expect(res.status).toBe(401);
  });

  it("concurrency: two simultaneous creates with the same product code produce exactly one success and one clean conflict", async () => {
    const payload = { code: "RACE-01", name: "Race Condition Co", type: "PRODUCT" as const };
    const [first, second] = await Promise.all([
      request(app).post("/api/v1/products").set("Authorization", `Bearer ${adminToken}`).send(payload),
      request(app).post("/api/v1/products").set("Authorization", `Bearer ${adminToken}`).send(payload),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const count = await prisma.product.count({ where: { code: "RACE-01" } });
    expect(count).toBe(1);
  });

  it("concurrency: two simultaneous creates with the same explicit slug produce exactly one success and one clean conflict", async () => {
    const [first, second] = await Promise.all([
      request(app).post("/api/v1/products").set("Authorization", `Bearer ${adminToken}`).send({ code: "SLUGRACE-A", name: "A", type: "PRODUCT", slug: "race-slug" }),
      request(app).post("/api/v1/products").set("Authorization", `Bearer ${adminToken}`).send({ code: "SLUGRACE-B", name: "B", type: "PRODUCT", slug: "race-slug" }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const count = await prisma.product.count({ where: { slug: "race-slug" } });
    expect(count).toBe(1);
  });
});
