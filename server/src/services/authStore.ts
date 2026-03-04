import prisma from '../prisma/client';
import crypto from 'crypto';

export type AuthTokenType = 'EMAIL_VERIFY' | 'PASSWORD_RESET';

let ensured = false;

export async function ensureAuthTables() {
  if (ensured) return;

  // Keep these tables separate from Prisma models so we don't need to regenerate Prisma Client.
  // This makes the project easier to run out-of-the-box even when Prisma engines can't be downloaded in the sandbox.
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "UserAuth" (
      "userId" TEXT NOT NULL PRIMARY KEY,
      "emailVerified" INTEGER NOT NULL DEFAULT 0
    );
  `);
 
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AuthToken" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "tokenHash" TEXT NOT NULL UNIQUE,
      "expiresAtMs" INTEGER NOT NULL,
      "createdAtMs" INTEGER NOT NULL,
      CONSTRAINT "AuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "AuthToken_userId_type_idx" ON "AuthToken"("userId", "type");
  `);

  ensured = true;
}

export async function getEmailVerified(userId: string): Promise<boolean> {
  await ensureAuthTables();

  const rows = (await prisma.$queryRawUnsafe<
    Array<{ emailVerified: number }>
  >(`SELECT "emailVerified" as emailVerified FROM "UserAuth" WHERE "userId" = ? LIMIT 1;`, userId));

  // Backwards compat: if row doesn't exist (old DB), treat as verified.
  if (!rows.length) return true;
  return !!rows[0].emailVerified;
}

export async function setEmailVerified(userId: string, verified: boolean): Promise<void> {
  await ensureAuthTables();

  await prisma.$executeRawUnsafe(
    `INSERT INTO "UserAuth" ("userId", "emailVerified") VALUES (?, ?)
     ON CONFLICT("userId") DO UPDATE SET "emailVerified" = excluded."emailVerified";`,
    userId,
    verified ? 1 : 0,
  );
}

export async function createAuthToken(params: {
  userId: string;
  type: AuthTokenType;
  tokenHash: string;
  expiresAtMs: number;
}): Promise<void> {
  await ensureAuthTables();

  // Allow only one active token per user+type.
  await prisma.$executeRawUnsafe(`DELETE FROM "AuthToken" WHERE "userId" = ? AND "type" = ?;`, params.userId, params.type);

  const id = crypto.randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "AuthToken" ("id", "userId", "type", "tokenHash", "expiresAtMs", "createdAtMs") VALUES (?, ?, ?, ?, ?, ?);`,
    id,
    params.userId,
    params.type,
    params.tokenHash,
    params.expiresAtMs,
    Date.now(),
  );
}

export async function consumeAuthToken(params: {
  type: AuthTokenType;
  tokenHash: string;
}): Promise<{ userId: string } | null> {
  await ensureAuthTables();

  const now = Date.now();
  const rows = await prisma.$queryRawUnsafe<
    Array<{ id: string; userId: string }>
  >(
    `SELECT "id" as id, "userId" as userId FROM "AuthToken" WHERE "type" = ? AND "tokenHash" = ? AND "expiresAtMs" > ? LIMIT 1;`,
    params.type,
    params.tokenHash,
    now,
  );

  if (!rows.length) return null;

  await prisma.$executeRawUnsafe(`DELETE FROM "AuthToken" WHERE "id" = ?;`, rows[0].id);
  return { userId: rows[0].userId };
}
