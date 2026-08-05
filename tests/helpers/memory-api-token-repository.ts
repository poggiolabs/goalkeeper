import type {
  ApiTokenRecord,
  ApiTokenRepository,
  NewApiTokenRecord
} from "../../services/api/src/api-tokens/types";

export class MemoryApiTokenRepository implements ApiTokenRepository {
  readonly records: ApiTokenRecord[] = [];

  async listActive(
    ownerUserId: string,
    organizationId: string,
    now: Date
  ): Promise<ApiTokenRecord[]> {
    return this.records
      .filter(
        (record) =>
          record.ownerUserId === ownerUserId &&
          record.organizationId === organizationId &&
          record.revokedAt === null &&
          record.expiresAt > now
      )
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }

  async insert(record: NewApiTokenRecord): Promise<ApiTokenRecord> {
    const inserted: ApiTokenRecord = {
      ...record,
      id: crypto.randomUUID(),
      lastUsedAt: null,
      revokedAt: null
    };
    this.records.push(inserted);
    return inserted;
  }

  async findActiveByHash(
    tokenHash: string,
    now: Date
  ): Promise<ApiTokenRecord | null> {
    return (
      this.records.find(
        (record) =>
          record.tokenHash === tokenHash &&
          record.revokedAt === null &&
          record.expiresAt > now
      ) ?? null
    );
  }

  async revoke(
    ownerUserId: string,
    organizationId: string,
    tokenId: string,
    revokedAt: Date
  ): Promise<ApiTokenRecord | null> {
    const record = this.records.find(
      (candidate) =>
        candidate.ownerUserId === ownerUserId &&
        candidate.organizationId === organizationId &&
        candidate.id === tokenId
    );
    if (!record) return null;
    record.revokedAt ??= revokedAt;
    return record;
  }

  async touchLastUsed(
    tokenId: string,
    usedAt: Date,
    staleBefore: Date
  ): Promise<void> {
    const record = this.records.find((candidate) => candidate.id === tokenId);
    if (record && (!record.lastUsedAt || record.lastUsedAt < staleBefore)) {
      record.lastUsedAt = usedAt;
    }
  }
}
