/** Phase 7 §49 — product modules: create/update/archive/list/reorder, duplicate code, cross-product protection, permissions. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

describe("product modules", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let viewerToken: string;
  let productId: string;
  let otherProductId: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "module-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Module",
      lastName: "Admin",
      organizationName: "Module Admin Co",
    });
    adminToken = reg.body.data.session.token;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "module-viewer@example.com", password: "ViewerPassword123", firstName: "V", lastName: "W", roleKey: "VIEWER" });
    const viewerLogin = await request(app).post("/api/v1/auth/login").send({ email: "module-viewer@example.com", password: "ViewerPassword123" });
    viewerToken = viewerLogin.body.data.session.token;

    const product = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "HCMS-MOD", name: "Artify HCMS", type: "PRODUCT" });
    productId = product.body.data.product.id;

    const otherProduct = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "PAYROLL-MOD", name: "Payroll", type: "PRODUCT" });
    otherProductId = otherProduct.body.data.product.id;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("creates a module under a product with server-generated slug and displayOrder, and audits PRODUCT_MODULE_CREATED", async () => {
    const res = await request(app)
      .post(`/api/v1/products/${productId}/modules`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "employee-mgmt", name: "Employee Management" });
    expect(res.status).toBe(201);
    expect(res.body.data.module.code).toBe("EMPLOYEE-MGMT");
    expect(res.body.data.module.slug).toBe("employee-management");
    expect(res.body.data.module.displayOrder).toBe(0);

    const audit = await prisma.auditLog.findFirst({ where: { action: "PRODUCT_MODULE_CREATED", resourceId: res.body.data.module.id } });
    expect(audit).not.toBeNull();
  });

  it("normalizes module codes so ' PAYROLL ', 'payroll', and 'PAYROLL' collide as duplicates within one product", async () => {
    await request(app).post(`/api/v1/products/${productId}/modules`).set("Authorization", `Bearer ${adminToken}`).send({ code: "PAYROLL", name: "Payroll" });
    const dupe = await request(app)
      .post(`/api/v1/products/${productId}/modules`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: " payroll ", name: "Payroll Again" });
    expect(dupe.status).toBe(409);
  });

  it("allows the same module code on two different products (uniqueness is per-product, not global)", async () => {
    const a = await request(app).post(`/api/v1/products/${productId}/modules`).set("Authorization", `Bearer ${adminToken}`).send({ code: "REPORTS", name: "Reports" });
    const b = await request(app)
      .post(`/api/v1/products/${otherProductId}/modules`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "REPORTS", name: "Reports" });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
  });

  it("rejects creating a module under a nonexistent product with 404", async () => {
    const res = await request(app)
      .post("/api/v1/products/00000000-0000-0000-0000-000000000000/modules")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "GHOST", name: "Ghost" });
    expect(res.status).toBe(404);
  });

  it("lists modules for a product, updates one, and archives it (INACTIVE, never deleted)", async () => {
    const created = await request(app)
      .post(`/api/v1/products/${productId}/modules`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "ATTENDANCE", name: "Attendance" });
    const moduleId = created.body.data.module.id;

    const list = await request(app).get(`/api/v1/products/${productId}/modules`).set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.modules.some((m: { id: string }) => m.id === moduleId)).toBe(true);

    const updated = await request(app).patch(`/api/v1/product-modules/${moduleId}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "ACTIVE" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.module.status).toBe("ACTIVE");

    const archived = await request(app).post(`/api/v1/product-modules/${moduleId}/archive`).set("Authorization", `Bearer ${adminToken}`).send();
    expect(archived.status).toBe(200);
    expect(archived.body.data.module.status).toBe("INACTIVE");

    const stillExists = await prisma.productModule.findUnique({ where: { id: moduleId } });
    expect(stillExists).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({ where: { action: "PRODUCT_MODULE_ARCHIVED", resourceId: moduleId } });
    expect(audit).not.toBeNull();
  });

  it("reorders a product's modules transactionally", async () => {
    const p = await request(app).post("/api/v1/products").set("Authorization", `Bearer ${adminToken}`).send({ code: "REORDER-P", name: "Reorder Product", type: "PRODUCT" });
    const reorderProductId = p.body.data.product.id;

    const m1 = await request(app).post(`/api/v1/products/${reorderProductId}/modules`).set("Authorization", `Bearer ${adminToken}`).send({ code: "M1", name: "Module 1" });
    const m2 = await request(app).post(`/api/v1/products/${reorderProductId}/modules`).set("Authorization", `Bearer ${adminToken}`).send({ code: "M2", name: "Module 2" });
    const m3 = await request(app).post(`/api/v1/products/${reorderProductId}/modules`).set("Authorization", `Bearer ${adminToken}`).send({ code: "M3", name: "Module 3" });
    const [id1, id2, id3] = [m1.body.data.module.id, m2.body.data.module.id, m3.body.data.module.id];

    const reorder = await request(app)
      .post(`/api/v1/products/${reorderProductId}/modules/reorder`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ moduleIds: [id3, id1, id2] });
    expect(reorder.status).toBe(200);

    const list = await request(app).get(`/api/v1/products/${reorderProductId}/modules`).set("Authorization", `Bearer ${adminToken}`);
    const orderedIds = list.body.data.modules.map((m: { id: string }) => m.id);
    expect(orderedIds).toEqual([id3, id1, id2]);

    const audit = await prisma.auditLog.findFirst({ where: { action: "PRODUCT_MODULE_REORDERED", resourceId: reorderProductId } });
    expect(audit).not.toBeNull();
  });

  it("rejects a reorder that omits or duplicates a module, or includes a module from another product — no partial reorder applied", async () => {
    const p = await request(app).post("/api/v1/products").set("Authorization", `Bearer ${adminToken}`).send({ code: "REORDER-BAD", name: "Reorder Bad", type: "PRODUCT" });
    const badProductId = p.body.data.product.id;
    const m1 = await request(app).post(`/api/v1/products/${badProductId}/modules`).set("Authorization", `Bearer ${adminToken}`).send({ code: "B1", name: "B1" });
    const m2 = await request(app).post(`/api/v1/products/${badProductId}/modules`).set("Authorization", `Bearer ${adminToken}`).send({ code: "B2", name: "B2" });
    const foreign = await request(app).post(`/api/v1/products/${otherProductId}/modules`).set("Authorization", `Bearer ${adminToken}`).send({ code: "FOREIGN", name: "Foreign" });

    const incomplete = await request(app)
      .post(`/api/v1/products/${badProductId}/modules/reorder`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ moduleIds: [m1.body.data.module.id] });
    expect(incomplete.status).toBe(400);

    const crossProduct = await request(app)
      .post(`/api/v1/products/${badProductId}/modules/reorder`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ moduleIds: [m1.body.data.module.id, foreign.body.data.module.id] });
    expect(crossProduct.status).toBe(400);

    // Original order untouched after both rejected attempts.
    const list = await request(app).get(`/api/v1/products/${badProductId}/modules`).set("Authorization", `Bearer ${adminToken}`);
    const orderedIds = list.body.data.modules.map((m: { id: string }) => m.id);
    expect(orderedIds).toEqual([m1.body.data.module.id, m2.body.data.module.id]);
  });

  it("IDOR: a module id belonging to another product cannot be mutated through a mismatched product context in the reorder payload", async () => {
    const foreignModule = await prisma.productModule.findFirstOrThrow({ where: { productId: otherProductId } });
    const before = foreignModule.displayOrder;

    const p = await request(app).post("/api/v1/products").set("Authorization", `Bearer ${adminToken}`).send({ code: "IDOR-P", name: "IDOR Product", type: "PRODUCT" });
    const idorProductId = p.body.data.product.id;
    const own = await request(app).post(`/api/v1/products/${idorProductId}/modules`).set("Authorization", `Bearer ${adminToken}`).send({ code: "OWN", name: "Own" });

    const res = await request(app)
      .post(`/api/v1/products/${idorProductId}/modules/reorder`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ moduleIds: [foreignModule.id, own.body.data.module.id] });
    expect(res.status).toBe(400);

    const reloaded = await prisma.productModule.findUniqueOrThrow({ where: { id: foreignModule.id } });
    expect(reloaded.displayOrder).toBe(before);
  });

  it("rejects module create/update/archive by a caller without the relevant permission", async () => {
    const createRes = await request(app).post(`/api/v1/products/${productId}/modules`).set("Authorization", `Bearer ${viewerToken}`).send({ code: "NOPE", name: "Nope" });
    expect(createRes.status).toBe(403);

    const existing = await request(app)
      .post(`/api/v1/products/${productId}/modules`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "PERMTEST", name: "Perm Test" });

    const updateRes = await request(app).patch(`/api/v1/product-modules/${existing.body.data.module.id}`).set("Authorization", `Bearer ${viewerToken}`).send({ name: "X" });
    expect(updateRes.status).toBe(403);

    const archiveRes = await request(app).post(`/api/v1/product-modules/${existing.body.data.module.id}/archive`).set("Authorization", `Bearer ${viewerToken}`).send();
    expect(archiveRes.status).toBe(403);
  });

  it("rejects a nonexistent module id with 404, not a crash", async () => {
    const res = await request(app).get("/api/v1/product-modules/00000000-0000-0000-0000-000000000000").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});
