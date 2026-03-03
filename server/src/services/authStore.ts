import crypto from 'crypto';

import { prisma } from '../prisma/client';

// We keep using raw SQL for auth token tables because these were originally added
// as "runtime" tables while iterating. In production we run Postgres, so raw
// query placeholders MUST be $1, $2... (SQLite used ?).

let ensured = false;

export async function ensureAuthTables() {
  if (ensured) return;

  // Create tables if they don't exist.
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "UserAuth" (
      "userId" TEXT PRIMARY KEY,
      "emailVerified" INTEGER NOT NULL DEFAULT 0
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AuthToken" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "tokenHash" TEXT NOT NULL,
      "expiresAtMs" BIGINT NOT NULL,
      "createdAtMs" BIGINT NOT NULL
    );
  `);

  ensured = true;
}

export async function getEmailVerified(userId: string): Promise<boolean> {
  await ensureAuthTables();

  const rows = await prisma.$queryRawUnsafe<Array<{ emailVerified: number }>>(
    `SELECT "emailVerified" as emailVerified FROM "UserAuth" WHERE "userId" = $1 LIMIT 1;`,
    userId,
  );

  return rows.length ? !!rows[0].emailVerified : false;
}

export async function setEmailVerified(userId: string, verified: boolean): Promise<void> {
  await ensureAuthTables();

  await prisma.$executeRawUnsafe(
    `INSERT INTO "UserAuth" ("userId", "emailVerified") VALUES ($1, $2)
     ON CONFLICT("userId") DO UPDATE SET "emailVerified" = excluded."emailVerified";`,
    userId,
    verified ? 1 : 0,
  );
}

export async function createAuthToken(params: {
  userId: string;
  type: string;
  tokenHash: string;
  expiresAtMs: number;
}): Promise<void> {
  await ensureAuthTables();

  // Allow only one active token per user+type.
  await prisma.$executeRawUnsafe(
    `DELETE FROM "AuthToken" WHERE "userId" = $1 AND "type" = $2;`,
    params.userId,
    params.type,
  );

  const id = crypto.randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "AuthToken" ("id", "userId", "type", "tokenHash", "expiresAtMs", "createdAtMs")
     VALUES ($1, $2, $3, $4, $5, $6);`,
    id,
    params.userId,
    params.type,
    params.tokenHash,
    params.expiresAtMs,
    Date.now(),
  );
}

export async function consumeAuthToken(params: {
  type: string;
  tokenHash: string;
}): Promise<{ userId: string } | null> {
  await ensureAuthTables();

  const now = Date.now();
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; userId: string }>>(
    `SELECT "id" as id, "userId" as userId
     FROM "AuthToken"
     WHERE "type" = $1 AND "tokenHash" = $2 AND "expiresAtMs" > $3
     LIMIT 1;`,
    params.type,
    params.tokenHash,
    now,
  );

  if (!rows.length) return null;

  await prisma.$executeRawUnsafe(`DELETE FROM "AuthToken" WHERE "id" = $1;`, rows[0].id);
  return { userId: rows[0].userId };
}
