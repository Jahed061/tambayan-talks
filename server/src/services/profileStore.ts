import { prisma } from '../prisma/client';

let ensured = false;

export async function ensureProfileTables() {
  if (ensured) return;

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "UserProfile" (
      "userId" TEXT PRIMARY KEY,
      "username" TEXT UNIQUE,
      "avatarUrl" TEXT,
      "lastSeenAtMs" BIGINT
    );
  `);

  // Keep compatibility with older SQLite dev setups while still working on Postgres.
  // Postgres supports IF NOT EXISTS; SQLite does not.
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "lastSeenAtMs" BIGINT;`,
    );
  } catch {
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "UserProfile" ADD COLUMN "lastSeenAtMs" INTEGER;`);
    } catch {
      // ignore
    }
  }

  ensured = true;
}

export async function upsertProfile(params: {
  userId: string;
  username: string;
  avatarUrl?: string | null;
}): Promise<void> {
  await ensureProfileTables();

  await prisma.$executeRawUnsafe(
    `INSERT INTO "UserProfile" ("userId", "username", "avatarUrl", "lastSeenAtMs")
     VALUES ($1, $2, $3, $4)
     ON CONFLICT("userId") DO UPDATE SET
       "username" = excluded."username",
       "avatarUrl" = excluded."avatarUrl",
       "lastSeenAtMs" = excluded."lastSeenAtMs";`,
    params.userId,
    params.username,
    params.avatarUrl ?? null,
    Date.now(),
  );
}

export async function getProfile(userId: string): Promise<{
  userId: string;
  username: string | null;
  avatarUrl: string | null;
  lastSeenAtMs: number | null;
} | null> {
  await ensureProfileTables();

  const rows = await prisma.$queryRawUnsafe<
    Array<{ userId: string; username: string | null; avatarUrl: string | null; lastSeenAtMs: any }>
  >(
    `SELECT "userId" as "userId", "username" as "username", "avatarUrl" as "avatarUrl", "lastSeenAtMs" as "lastSeenAtMs"
     FROM "UserProfile" WHERE "userId" = $1 LIMIT 1;`,
    userId,
  );

  if (!rows.length) return null;

  const r = rows[0];
  return {
    userId: r.userId,
    username: r.username,
    avatarUrl: r.avatarUrl,
    lastSeenAtMs: r.lastSeenAtMs == null ? null : Number(r.lastSeenAtMs),
  };
}

export async function searchUsers(query: string, limit = 10): Promise<Array<{ userId: string; username: string }>> {
  await ensureProfileTables();

  const q = `%${query}%`;

  const rows = await prisma.$queryRawUnsafe<Array<{ userId: string; username: string }>>(
    `SELECT "userId" as "userId", "username" as "username"
     FROM "UserProfile"
     WHERE "username" ILIKE $1
     ORDER BY "username" ASC
     LIMIT $2;`,
    q,
    limit,
  );

  return rows;
}

export async function getAvatarUrl (userId: string): Promise<string | null> {
  await ensureProfileTables();

  const rows = await prisma.$queryRawUnsafe<Array<{ avatarUrl: string | null }>>(
    `SELECT "avatarUrl" as "avatarUrl" FROM "UserProfile" WHERE "userId" = $1 LIMIT 1;`,
    userId,
  );

  return rows.length ? rows[0].avatarUrl : null;
}

export async function getAvatarUrls(userIds: string[]): Promise<Record<string, string | null>> {
  await ensureProfileTables();

  if (userIds.length === 0) return {};

  // Build ($1,$2,...) placeholders for Postgres.
  const placeholders = userIds.map((_, i) => `$${i + 1}`).join(',');

  const rows = await prisma.$queryRawUnsafe<Array<{ userId: string; avatarUrl: string | null }>>(
    `SELECT "userId" as "userId", "avatarUrl" as "avatarUrl"
     FROM "UserProfile"
     WHERE "userId" IN (${placeholders});`,
    ...userIds,
  );

  const result: Record<string, string | null> = {};
  for (const id of userIds) result[id] = null;
  for (const r of rows) result[r.userId] = r.avatarUrl;
  return result;
}

export async function setLastSeen(userId: string): Promise<void> {
  await ensureProfileTables();

  await prisma.$executeRawUnsafe(
    `INSERT INTO "UserProfile" ("userId", "lastSeenAtMs") VALUES ($1, $2)
     ON CONFLICT("userId") DO UPDATE SET "lastSeenAtMs" = excluded."lastSeenAtMs";`,
    userId,
    Date.now(),
  );
}
