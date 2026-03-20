#!/bin/sh
set -e

echo "🔍 Vérification de l'état des migrations..."

# Résoudre les migrations "failed" en interrogeant directement _prisma_migrations
# (finished_at IS NULL ET applied_steps_count > 0 = migration démarrée mais non terminée)
node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function run() {
  try {
    const res = await pool.query(
      'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND applied_steps_count > 0'
    );
    res.rows.forEach(r => process.stdout.write(r.migration_name + '\n'));
  } catch (e) {
    // Table inexistante (premier démarrage) : rien à faire
  } finally {
    await pool.end();
  }
}
run();
" 2>/dev/null | while IFS= read -r migration; do
  echo "  ⚠️  Migration échouée détectée : $migration"
  npx prisma migrate resolve --rolled-back "$migration" || true
done

echo "🚀 Application des migrations..."
npx prisma migrate deploy

echo "🌱 Initialisation de la base de données..."
node prisma/seed.js

echo "✅ Démarrage du serveur..."
exec node src/server.js
