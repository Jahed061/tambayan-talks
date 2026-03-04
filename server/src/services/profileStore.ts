import prisma from '../prisma/client';

let ensured = false;

/**
 * Stores optional profile fields without requiring Prisma schema changes.
 *
 * Table: "UserProfile"
 *  - userId (PK)
 *  - avatarUrl (nullable)
 *  - lastSeenAtMs (nullable)   // preferred column name
 *  - lastSeenAt (nullable)     // backward-compat column name (older code/logs)
 *  - updatedAtMs (not null)
 *
 * IMPORTANT:
 * - Render uses Postgres. Prisma raw queries must not use "?" placeholders.
 * - This module uses parameterized tagged templates for portability and safety.
 */
export async function ensureProfileTable() {
  if (ensured) return;

  // Create table (safe if it already exists).
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "UserProfile" (
      "userId" TEXT NOT NULL PRIMARY KEY,
      "avatarUrl" TEXT,
      "lastSeenAtMs" BIGINT,
      "lastSeenAt" BIGINT,
      "updatedAtMs" BIGINT NOT NULL
    );
  `);

  // Ensure columns exist for older DBs created with fewer columns.
  // Postgres supports IF NOT EXISTS for ADD COLUMN; wrap for safety across engines.
  const addColumnStatements = [
    `ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT;`,
    `ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "lastSeenAtMs" BIGINT;`,
    `ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "lastSeenAt" BIGINT;`,
    `ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "updatedAtMs" BIGINT;`,
  ];

  // If the table/columns existed with INT/INTEGER types (older deployments),
// upgrade them to BIGINT so millisecond timestamps don't overflow.
const alterTypeStatements = [
  `ALTER TABLE "UserProfile" ALTER COLUMN "lastSeenAtMs" TYPE BIGINT USING "lastSeenAtMs"::bigint;`,
  `ALTER TABLE "UserProfile" ALTER COLUMN "lastSeenAt" TYPE BIGINT USING "lastSeenAt"::bigint;`,
  `ALTER TABLE "UserProfile" ALTER COLUMN "updatedAtMs" TYPE BIGINT USING "updatedAtMs"::bigint;`,
];

for (const stmt of alterTypeStatements) {
  try {
    await prisma.$executeRawUnsafe(stmt);
  } catch {
    // ignore (already BIGINT / column missing / etc.)
  }
}

  for (const stmt of addColumnStatements) {
    try {
      await prisma.$executeRawUnsafe(stmt);
    } catch {
      // ignore (e.g., some engines don't support IF NOT EXISTS)
      try {
        // Fallback without IF NOT EXISTS.
        const fallback = stmt.replace(' IF NOT EXISTS', '');
        await prisma.$executeRawUnsafe(fallback);
      } catch {
        // ignore
      }
    }
  }

  ensured = true;
}

export async function getAvatarUrl(userId: string): Promise<string | null> {
  await ensureProfileTable();

  const rows = await prisma.$queryRaw<Array<{ avatarUrl: string | null }>>`
    SELECT "avatarUrl" AS "avatarUrl"
    FROM "UserProfile"
    WHERE "userId" = ${userId}
    LIMIT 1;
  `;

  if (!rows.length) return null;
  return rows[0].avatarUrl ?? null;
}

export async function getAvatarUrlMap(userIds: string[]): Promise<Record<string, string | null>> {
  await ensureProfileTable();

  const map: Record<string, string | null> = {};
  if (!userIds.length) return map;

  const rows = await prisma.$queryRaw<Array<{ userId: string; avatarUrl: string | null }>>`
    SELECT "userId" AS "userId", "avatarUrl" AS "avatarUrl"
    FROM "UserProfile"
    WHERE "userId" = ANY(${userIds}::text[]);
  `;

  for (const r of rows) map[r.userId] = r.avatarUrl ?? null;
  return map;
}

export async function setAvatarUrl(userId: string, avatarUrl: string | null): Promise<void> {
  await ensureProfileTable();

  const now = Date.now();

  await prisma.$executeRaw`
    INSERT INTO "UserProfile" ("userId", "avatarUrl", "updatedAtMs")
    VALUES (${userId}, NULL, NULL, ${BigInt(now)})
    ON CONFLICT("userId") DO UPDATE
      SET "avatarUrl" = EXCLUDED."avatarUrl",
          "updatedAtMs" = EXCLUDED."updatedAtMs";
  `;
}

export async function setLastSeenAtMs(userId: string, lastSeenAtMs: number | null): Promise<void> {
  await ensureProfileTable();

  const now = Date.now();

  if (lastSeenAtMs === null) {
    // Clear last-seen when the user comes back online.
    await prisma.$executeRaw`
      INSERT INTO "UserProfile" ("userId", "lastSeenAtMs", "lastSeenAt", "updatedAtMs")
      VALUES (${userId}, NULL, NULL, ${now})
      ON CONFLICT("userId") DO UPDATE
        SET "lastSeenAtMs" = NULL,
            "lastSeenAt" = NULL,
            "updatedAtMs" = EXCLUDED."updatedAtMs";
    `;
    return;
  } 

  // Write both columns to be backward compatible with any older code expecting "lastSeenAt".
  await prisma.$executeRaw`
    INSERT INTO "UserProfile" ("userId", "lastSeenAtMs", "lastSeenAt", "updatedAtMs")
    VALUES (${userId}, ${BigInt(lastSeenAtMs)}, ${BigInt(lastSeenAtMs)}, ${BigInt(now)})
    ON CONFLICT("userId") DO UPDATE
      SET "lastSeenAtMs" = EXCLUDED."lastSeenAtMs",
          "lastSeenAt" = EXCLUDED."lastSeenAt",
          "updatedAtMs" = EXCLUDED."updatedAtMs";
  `;
}

export async function getAllLastSeenAtMsMap(): Promise<Record<string, number>> {
  await ensureProfileTable();

  // Prefer lastSeenAtMs; fall back to lastSeenAt if present.
  const rows = await prisma.$queryRaw<Array<{ userId: string; lastSeenAtMs: bigint | null; lastSeenAt: bigint | null }>>`
    SELECT "userId" AS "userId",
           "lastSeenAtMs" AS "lastSeenAtMs",
           "lastSeenAt" AS "lastSeenAt"
    FROM "UserProfile";
  `;

  const map: Record<string, number> = {};
  for (const r of rows) {
    const v = r.lastSeenAtMs ?? r.lastSeenAt;
    if (v !== null && v !== undefined) map[r.userId] = Number(v);
  }
  return map;
}
