import { defineConfig } from 'prisma/config'

const dbUrl: string = process.env.DATABASE_URL ?? 'file:./prisma/dev.db'
const isSQLite = dbUrl.startsWith('file:')

export default defineConfig({
  schema: isSQLite
    ? './prisma/schema.prisma'
    : './prisma/schema.postgresql.prisma',

  datasource: {
    url: dbUrl
  },

  migrate: {
    async adapter(env) {
      const url: string = env.DATABASE_URL ?? 'file:./prisma/dev.db'

      if (url.startsWith('file:')) {
        const { PrismaBetterSqlite3 } = await import('@prisma/adapter-better-sqlite3')
        return new PrismaBetterSqlite3({ url })
      } else {
        const { PrismaPg } = await import('@prisma/adapter-pg')
        const { Pool } = await import('pg')
        return new PrismaPg(new Pool({ connectionString: url }))
      }
    }
  }
})
