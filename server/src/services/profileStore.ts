import { Prisma } from '@prisma/client';
import prisma from '../prisma/client';

/**
 * Profile metadata storage.
 *
 * The codebase previously used SQLite-style `?` placeholders with `$queryRawUnsafe`.
 * That breaks on Postgres (Render).
 *
 * ✅ Fix: use Prisma's `$queryRaw` / `$executeRaw` tagged templates (provider-safe).
 */

const TABLE = '"UserProfile"';

export async function ensureProfileTable() {
  await prisma.$executeRaw(
    Prisma.sql`
      CREATE TABLE IF NOT EXISTS ${Prisma.raw(TABLE)} (
        "userId" TEXT PRIMARY KEY,
        "avatarUrl" TEXT,
        "lastSeenAt" BIGINT
      )
    `,
  );

  // Some older builds also reference an email column.
  await prisma.$executeRaw(
    Prisma.sql`ALTER TABLE ${Prisma.raw(TABLE)} ADD COLUMN IF NOT EXISTS "email" TEXT`,
  );
}

export async function getAvatarUrl(userId: string): Promise<string | null> {
  await ensureProfileTable();

  const rows = await prisma.$queryRaw<{ avatarUrl: string | null }[]>(
    Prisma.sql`
      SELECT "avatarUrl"
      FROM ${Prisma.raw(TABLE)}
      WHERE "userId" = ${userId}
      LIMIT 1
    `,
  );

  return rows[0]?.avatarUrl ?? null;
}

export async function setAvatarUrl(userId: string, avatarUrl: string) {
  await ensureProfileTable();

  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO ${Prisma.raw(TABLE)} ("userId", "avatarUrl")
      VALUES (${userId}, ${avatarUrl})
      ON CONFLICT ("userId") DO UPDATE
      SET "avatarUrl" = EXCLUDED."avatarUrl"
    `,
  );
}

export async function setLastSeenAtMs(userId: string, lastSeenAt: number) {
  await ensureProfileTable();

  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO ${Prisma.raw(TABLE)} ("userId", "lastSeenAt")
      VALUES (${userId}, ${BigInt(lastSeenAt)})
      ON CONFLICT ("userId") DO UPDATE
      SET "lastSeenAt" = EXCLUDED."lastSeenAt"
    `,
  );
}

export async function getLastSeenAtMs(userId: string): Promise<number | null> {
  await ensureProfileTable();

  const rows = await prisma.$queryRaw<{ lastSeenAt: bigint | number | null }[]>(
    Prisma.sql`
      SELECT "lastSeenAt"
      FROM ${Prisma.raw(TABLE)}
      WHERE "userId" = ${userId}
      LIMIT 1
    `,
  );

  const v = rows[0]?.lastSeenAt;
  if (v === null || v === undefined) return null;
  return typeof v === 'bigint' ? Number(v) : v;
}

export async function getAllLastSeenAtMsMap(userIds: string[]) {
  await ensureProfileTable();
  const map = new Map<string, number>();
  if (!userIds.length) return map;

  const rows = await prisma.$queryRaw<{ userId: string; lastSeenAt: bigint | number | null }[]>(
    Prisma.sql`
      SELECT "userId", "lastSeenAt"
      FROM ${Prisma.raw(TABLE)}
      WHERE "userId" IN (${Prisma.join(userIds)})
    `,
  );

  for (const r of rows) {
    const v = r.lastSeenAt;
    if (v === null || v === undefined) continue;
    map.set(r.userId, typeof v === 'bigint' ? Number(v) : v);
  }
  return map;
}

export async function getAvatarUrlMap(userIds: string[]) {
  await ensureProfileTable();
  const map = new Map<string, string | null>();
  if (!userIds.length) return map;

  const rows = await prisma.$queryRaw<{ userId: string; avatarUrl: string | null }[]>(
    Prisma.sql`
      SELECT "userId", "avatarUrl"
      FROM ${Prisma.raw(TABLE)}
      WHERE "userId" IN (${Prisma.join(userIds)})
    `,
  );

  for (const r of rows) {
    map.set(r.userId, r.avatarUrl ?? null);
  }
  return map;
}
