export const apiTokenScopeRegistry = [
  {
    id: "goals:read:own",
    label: "Read my goals",
    description: "Read goals owned by the token owner.",
    default: true,
    capabilities: ["goals.read.own"]
  },
  {
    id: "goals:write:own",
    label: "Write my goals",
    description: "Create, update, and delete goals owned by the token owner.",
    default: false,
    capabilities: ["goals.write.own"]
  },
  {
    id: "goals:read:all",
    label: "Read all goals",
    description: "Read every goal visible to the token owner.",
    default: false,
    capabilities: ["goals.read.own", "goals.read.all"]
  },
  {
    id: "goals:write:all",
    label: "Write all goals",
    description: "Create, update, and delete every goal writable by the token owner.",
    default: false,
    capabilities: ["goals.write.own", "goals.write.all"]
  }
] as const;

export type ApiTokenScope = (typeof apiTokenScopeRegistry)[number]["id"];
export type ApiTokenCapability =
  (typeof apiTokenScopeRegistry)[number]["capabilities"][number];

export const apiTokenScopes = apiTokenScopeRegistry.map(
  (scope) => scope.id
) as ApiTokenScope[];

export const defaultApiTokenScopes = apiTokenScopeRegistry
  .filter((scope) => scope.default)
  .map((scope) => scope.id) as ApiTokenScope[];

export type ApiTokenScopeDefinition = {
  id: ApiTokenScope;
  label: string;
  description: string;
  default: boolean;
};

export type ApiToken = {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiTokenScope[];
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type ApiTokenPrincipal = {
  kind: "apiToken";
  tokenId: string;
  userId: string;
  sessionId: null;
  scopes: ApiTokenScope[];
};

export type ApiTokenRecord = {
  id: string;
  ownerUserId: string;
  name: string;
  prefix: string;
  tokenHash: string;
  scopes: ApiTokenScope[];
  expiresAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

export type NewApiTokenRecord = Omit<
  ApiTokenRecord,
  "id" | "lastUsedAt" | "revokedAt"
>;

export interface ApiTokenRepository {
  listActive(ownerUserId: string, now: Date): Promise<ApiTokenRecord[]>;
  insert(record: NewApiTokenRecord): Promise<ApiTokenRecord>;
  findActiveByHash(tokenHash: string, now: Date): Promise<ApiTokenRecord | null>;
  revoke(
    ownerUserId: string,
    tokenId: string,
    revokedAt: Date
  ): Promise<ApiTokenRecord | null>;
  touchLastUsed(tokenId: string, usedAt: Date, staleBefore: Date): Promise<void>;
}
