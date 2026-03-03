import prisma from '../prisma/client';

let ensured = false;

/**
 * Stores optional profile fields without requiring Prisma schema changes.
 *
 * Table:
 *  - userId (PK)
 *  - avatarUrl (nullable)
 *  - lastSeenAtMs (nullable)
 */
export async function ensureProfileTable() {
  if (ensured) return;

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "UserProfile" (
      "userId" TEXT NOT NULL PRIMARY KEY,
      "avatarUrl" TEXT,
      "lastSeenAtMs" INTEGER,
      "updatedAtMs" INTEGER NOT NULL
    );
  `);

  // Older DBs may have been created without lastSeenAtMs.
  // SQLite doesn't support IF NOT EXISTS on ADD COLUMN, so swallow the error.
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "UserProfile" ADD COLUMN "lastSeenAtMs" INTEGER;`);
  } catch {
    // ignore
  }

  ensured = true;
}

export async function getAvatarUrl(userId: string): Promise<string | null> {
  await ensureProfileTable();

  const rows = await prisma.$queryRawUnsafe<Array<{ avatarUrl: string | null }>>(
    `SELECT "avatarUrl" as avatarUrl FROM "UserProfile" WHERE "userId" = ? LIMIT 1;`,
    userId,
  );

  if (!rows.length) return null;
  return rows[0].avatarUrl ?? null;
}

export async function setAvatarUrl(userId: string, avatarUrl: string | null): Promise<void> {
  await ensureProfileTable();

  await prisma.$executeRawUnsafe(
    `INSERT INTO "UserProfile" ("userId", "avatarUrl", "updatedAtMs") VALUES (?, ?, ?)
     ON CONFLICT("userId") DO UPDATE SET "avatarUrl" = excluded."avatarUrl", "updatedAtMs" = excluded."updatedAtMs";`,
    userId,
    avatarUrl,
    Date.now(),
  );
}

export async function setLastSeenAtMs(userId: string, lastSeenAtMs: number | null): Promise<void> {
  await ensureProfileTable();

  await prisma.$executeRawUnsafe(
    `INSERT INTO "UserProfile" ("userId", "lastSeenAtMs", "updatedAtMs") VALUES (?, ?, ?)
     ON CONFLICT("userId") DO UPDATE SET "lastSeenAtMs" = excluded."lastSeenAtMs", "updatedAtMs" = excluded."updatedAtMs";`,
    userId,
    lastSeenAtMs,
    Date.now(),
  );
}

export async function getLastSeenAtMs(userId: string): Promise<number | null> {
  await ensureProfileTable();

  const rows = await prisma.$queryRawUnsafe<Array<{ lastSeenAtMs: number | null }>>(
    `SELECT "lastSeenAtMs" as lastSeenAtMs FROM "UserProfile" WHERE "userId" = ? LIMIT 1;`,
    userId,
  );
  if (!rows.length) return null;
  const ms = rows[0].lastSeenAtMs;
  return typeof ms === 'number' ? ms : null;
}

export async function getAllLastSeenAtMsMap(): Promise<Record<string, number>> {
  await ensureProfileTable();

  const rows = await prisma.$queryRawUnsafe<Array<{ userId: string; lastSeenAtMs: number | null }>>(
    `SELECT "userId" as userId, "lastSeenAtMs" as lastSeenAtMs FROM "UserProfile" WHERE "lastSeenAtMs" IS NOT NULL;`,
  );

  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r?.userId && typeof r.lastSeenAtMs === 'number') out[r.userId] = r.lastSeenAtMs;
  }
  return out;
}

export async function getAvatarUrlMap(userIds: string[]): Promise<Record<string, string | null>> {
  await ensureProfileTable();

  const unique = Array.from(new Set((userIds ?? []).filter((x) => typeof x === 'string' && x.length > 0)));
  if (unique.length === 0) return {};

  const placeholders = unique.map(() => '?').join(',');
  const rows = await prisma.$queryRawUnsafe<Array<{ userId: string; avatarUrl: string | null }>>(
    `SELECT "userId" as userId, "avatarUrl" as avatarUrl FROM "UserProfile" WHERE "userId" IN (${placeholders});`,
    ...unique,
  );

  const out: Record<string, string | null> = {};
  for (const r of rows) out[r.userId] = r.avatarUrl ?? null;
  for (const id of unique) if (!(id in out)) out[id] = null;
  return out;
}
