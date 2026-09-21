/**
 * Media metadata data access (Phase 9 — docs/MEDIA_ARCHITECTURE.md).
 * Organization-scoped, same findByIdInOrg-only convention as every other
 * tenant-owned repository since Phase 5. `sizeBytes` is `BigInt` in
 * Postgres/Prisma (the schema's own §33 note: "metadata only") but every
 * value returned to a route handler is converted to a plain `number` here
 * — Express's `res.json()` cannot serialize a native BigInt, and no file
 * this platform accepts (`MEDIA_MAX_*_SIZE_BYTES`, low tens of MB) comes
 * remotely close to `Number.MAX_SAFE_INTEGER`.
 */
import type { MediaAsset, MediaStatus, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

export interface ApiMediaAsset extends Omit<MediaAsset, "sizeBytes"> {
  sizeBytes: number;
}

export function toApiMedia(row: MediaAsset): ApiMediaAsset {
  return { ...row, sizeBytes: Number(row.sizeBytes) };
}

export interface MediaFilters {
  search?: string;
  status?: MediaStatus;
  mimeType?: string;
  uploadedById?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

function buildWhere(organizationId: string, filters: MediaFilters): Prisma.MediaAssetWhereInput {
  const where: Prisma.MediaAssetWhereInput = { organizationId, deletedAt: null };
  if (filters.status) where.status = filters.status;
  if (filters.mimeType) where.mimeType = filters.mimeType;
  if (filters.uploadedById) where.uploadedById = filters.uploadedById;
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
    };
  }
  if (filters.search) {
    where.OR = [
      { originalFilename: { contains: filters.search, mode: "insensitive" } },
      { displayName: { contains: filters.search, mode: "insensitive" } },
    ];
  }
  return where;
}

export const mediaRepository = {
  async list(organizationId: string, filters: MediaFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    const where = buildWhere(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.mediaAsset.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit }),
      prisma.mediaAsset.count({ where }),
    ]);
    return { rows: rows.map(toApiMedia), total };
  },

  /** The only lookup-by-id this module exposes — always organization-scoped (§11). */
  async findByIdInOrg(id: string, organizationId: string): Promise<MediaAsset | null> {
    return prisma.mediaAsset.findFirst({ where: { id, organizationId, deletedAt: null } });
  },

  async create(data: {
    id: string;
    organizationId: string;
    originalFilename: string;
    displayName?: string;
    storageProvider: string;
    storageBucket: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    altText?: string;
    caption?: string;
    uploadedById: string;
  }): Promise<MediaAsset> {
    return prisma.mediaAsset.create({
      data: { ...data, sizeBytes: BigInt(data.sizeBytes), status: "PENDING" },
    });
  },

  async update(id: string, data: Prisma.MediaAssetUpdateInput): Promise<MediaAsset> {
    return prisma.mediaAsset.update({ where: { id }, data });
  },

  /**
   * Race-safe conditional update — `WHERE id = ? AND status IN (...)`, the
   * same conditional-updateMany-plus-row-count pattern used for lead
   * conversion, workspace provisioning, and CMS optimistic concurrency
   * (Phases 5-8). Returns the affected row count so the caller can tell a
   * genuine race (0 rows — someone else already completed/archived it)
   * from success (1 row), never trusting a prior JS-level status check
   * alone against a concurrent request.
   */
  async updateWhereStatus(id: string, fromStatuses: MediaStatus[], data: Prisma.MediaAssetUpdateInput): Promise<number> {
    const result = await prisma.mediaAsset.updateMany({ where: { id, status: { in: fromStatuses } }, data });
    return result.count;
  },

  async markActive(id: string, data: { sizeBytes: number; mimeType?: string; checksum?: string; width?: number; height?: number }): Promise<number> {
    return this.updateWhereStatus(id, ["PENDING"], {
      status: "ACTIVE",
      sizeBytes: BigInt(data.sizeBytes),
      mimeType: data.mimeType,
      checksum: data.checksum,
      width: data.width,
      height: data.height,
    });
  },

  async markFailed(id: string): Promise<void> {
    await prisma.mediaAsset.updateMany({ where: { id, status: { in: ["PENDING", "FAILED"] } }, data: { status: "FAILED" } });
  },

  async softDelete(id: string): Promise<void> {
    await prisma.mediaAsset.update({ where: { id }, data: { deletedAt: new Date() } });
  },

  /** How many non-deleted Page/Post rows currently use this media as their featured image — used to block a hard delete of referenced media (§19). */
  async countContentReferences(id: string): Promise<number> {
    const [pages, posts] = await Promise.all([
      prisma.page.count({ where: { featuredMediaId: id, deletedAt: null } }),
      prisma.post.count({ where: { featuredMediaId: id, deletedAt: null } }),
    ]);
    return pages + posts;
  },
};
