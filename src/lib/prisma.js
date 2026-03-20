'use strict';
/**
 * Client Prisma partagé — Prisma 7 avec driver adapters
 * SQLite (dev)  : @prisma/adapter-better-sqlite3
 * PostgreSQL (prod) : @prisma/adapter-pg
 */
const { PrismaClient } = require('@prisma/client');
const dbUrl = process.env.DATABASE_URL ?? 'file:./prisma/dev.db';
const isSQLite = dbUrl.startsWith('file:');

let prisma;

if (isSQLite) {
  const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
  // L'adapter gère lui-même la création du client better-sqlite3
  prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: dbUrl }) });
} else {
  const { PrismaPg } = require('@prisma/adapter-pg');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: dbUrl });
  prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
}

module.exports = prisma;
