import { defineConfig } from 'prisma/config'

export default defineConfig({
  datasource: {
    // Requis pour db push / db execute / studio
    url: process.env.DATABASE_URL ?? 'file:./prisma/dev.db'
  },
  migrate: {
    async adapter(env) {
      const dbUrl: string = env.DATABASE_URL ?? 'file:./prisma/dev.db'

      if (dbUrl.startsWith('file:')) {
        const { PrismaBetterSqlite3 } = await import('@prisma/adapter-better-sqlite3')
        return new PrismaBetterSqlite3({ url: dbUrl })
      } else {
        const { PrismaPg } = await import('@prisma/adapter-pg')
        const { Pool } = await import('pg')
        const pool = new Pool({ connectionString: dbUrl })
        return new PrismaPg(pool)
      }
    }
  }
})
