import { createHash } from 'crypto';
import type { DBExecutor } from '../../database/database.module';
import { authIdentityHistory } from './schema/auth-identity-history.schema';
import type { AuthIdentity } from './schema/auth-identity.schema';

type AuthIdentityHistorySource = Pick<
  AuthIdentity,
  'id' | 'userId' | 'type' | 'identifier' | 'verifiedAt' | 'lastUsedAt'
>;

export function hashAuthIdentityIdentifier(
  type: AuthIdentity['type'],
  identifier: string,
) {
  return createHash('sha256')
    .update(`${type}:${normalizeAuthIdentityIdentifier(type, identifier)}`)
    .digest('hex');
}

export function maskAuthIdentityIdentifier(
  type: AuthIdentity['type'],
  identifier: string,
) {
  const normalized = normalizeAuthIdentityIdentifier(type, identifier);
  if (type === 'email') return maskEmail(normalized);
  if (type === 'phone') return maskPhone(normalized);
  return maskGeneric(normalized);
}

export async function archiveAuthIdentityHistory(
  tx: DBExecutor,
  identities: AuthIdentityHistorySource[],
  deletedAt = new Date(),
) {
  if (identities.length === 0) return;

  await tx.insert(authIdentityHistory).values(
    identities.map((identity) => ({
      userId: identity.userId,
      identityId: identity.id,
      type: identity.type,
      identifierHash: hashAuthIdentityIdentifier(
        identity.type,
        identity.identifier,
      ),
      identifierMasked: maskAuthIdentityIdentifier(
        identity.type,
        identity.identifier,
      ),
      verifiedAt: identity.verifiedAt,
      lastUsedAt: identity.lastUsedAt,
      deletedAt,
      createdAt: deletedAt,
      updatedAt: deletedAt,
    })),
  );
}

function normalizeAuthIdentityIdentifier(
  type: AuthIdentity['type'],
  identifier: string,
) {
  const trimmed = identifier.trim();
  return type === 'email' ? trimmed.toLowerCase() : trimmed;
}

function maskEmail(identifier: string) {
  const [local, domain] = identifier.split('@');
  if (!local || !domain) return maskGeneric(identifier);

  const visibleLocal = local.slice(0, 1);
  return `${visibleLocal}${'*'.repeat(Math.max(local.length - 1, 3))}@${domain}`;
}

function maskPhone(identifier: string) {
  if (identifier.length <= 4) return '*'.repeat(identifier.length);

  const prefixLength = identifier.startsWith('+')
    ? Math.min(4, identifier.length - 4)
    : 0;
  const prefix = identifier.slice(0, prefixLength);
  const suffix = identifier.slice(-4);
  const maskedLength = Math.max(
    identifier.length - prefix.length - suffix.length,
    1,
  );
  return `${prefix}${'*'.repeat(maskedLength)}${suffix}`;
}

function maskGeneric(identifier: string) {
  if (identifier.length <= 4) return '*'.repeat(identifier.length);
  return `${identifier.slice(0, 1)}${'*'.repeat(identifier.length - 2)}${identifier.slice(-1)}`;
}
