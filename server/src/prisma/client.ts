import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Prisma adapter selection
 * - Local dev: SQLite (better-sqlite3)
 * - Render/prod: Postgres (@prisma/adapter-pg)
 *
 * We pick the adapter based on DATABASE_URL protocol.
 */

const url = process.env.DATABASE_URL || 'file:./dev.db';

function isPostgres(u: string) {
  return u.startsWith('postgres://') || u.startsWith('postgresql://');
}

let prisma: PrismaClient;

if (isPostgres(url)) {
  // Lazy-require so local SQLite dev doesn't care about pg binaries unless needed.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PrismaPg } = require('@prisma/adapter-pg');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Pool } = require('pg');

  const pool = new Pool({
    connectionString: url,
    // Render Postgres requires SSL.
    ssl: { rejectUnauthorized: false },
  });

  const adapter = new PrismaPg(pool);
  prisma = new PrismaClient({ adapter });
} else {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');

  const adapter = new PrismaBetterSqlite3({
    url,
  });

  prisma = new PrismaClient({ adapter });
}

export { prisma };
export default prisma;
