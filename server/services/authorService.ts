/**
 * Author profile management (Phase 8 — docs/CMS_ARCHITECTURE.md §Authors).
 * An Author is a thin CMS profile over an existing User — it never creates
 * or authenticates an identity itself (no password/session fields), so
 * linking a userId here can never grant that user elevated permissions;
 * it only attaches a bio/avatar for byline display. Platform-global, like
 * Product — no archive endpoint (see docs/CMS_ARCHITECTURE.md for why: the
 * underlying User's own status already governs whether the account is
 * active, and published content keeps its historical Author row/name
 * regardless of that status — see postRepository/pageRepository's
 * SetNull-on-user-delete FK behavior).
 */
import { authorRepository, type AuthorWithUser } from "../repositories/authorRepository";
import { userRepository } from "../repositories/userRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { ConflictError, NotFoundError, ValidationError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { CreateAuthorInput, UpdateAuthorInput } from "../schemas/authorSchemas";
import type { RequestMeta } from "./authService";

async function loadAuthorOrThrow(id: string): Promise<AuthorWithUser> {
  const author = await authorRepository.findById(id);
  if (!author) throw new NotFoundError("Author not found.");
  return author;
}

export const authorService = {
  async listAuthors(): Promise<AuthorWithUser[]> {
    return authorRepository.list();
  },

  async getAuthor(id: string): Promise<AuthorWithUser> {
    return loadAuthorOrThrow(id);
  },

  async createAuthor(caller: SanitizedUser, input: CreateAuthorInput, meta: RequestMeta = {}): Promise<AuthorWithUser> {
    const user = await userRepository.findById(input.userId);
    if (!user) throw new ValidationError("userId does not refer to an existing user.");

    const existing = await authorRepository.findByUserId(input.userId);
    if (existing) throw new ConflictError("This user already has an author profile.", { existingAuthorId: existing.id });

    const author = await authorRepository.create({ userId: input.userId, bio: input.bio, avatarUrl: input.avatarUrl });

    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "AUTHOR_CREATED",
      resourceType: "author",
      resourceId: author.id,
      afterData: { userId: input.userId },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return author;
  },

  async updateAuthor(caller: SanitizedUser, id: string, input: UpdateAuthorInput, meta: RequestMeta = {}): Promise<AuthorWithUser> {
    const existing = await loadAuthorOrThrow(id);

    const patch: Record<string, unknown> = {};
    if (input.bio !== undefined) patch.bio = input.bio;
    if (input.avatarUrl !== undefined) patch.avatarUrl = input.avatarUrl;

    const updated = await authorRepository.update(id, patch);

    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "AUTHOR_UPDATED",
      resourceType: "author",
      resourceId: id,
      beforeData: { bio: existing.bio, avatarUrl: existing.avatarUrl },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return updated;
  },
};
