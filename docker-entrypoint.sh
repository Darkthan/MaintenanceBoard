#!/bin/sh
set -e

echo "🔍 Vérification de l'état des migrations..."

# Résoudre les migrations en état "failed" (survient si un déploiement précédent a planté)
FAILED=$(npx prisma migrate status 2>&1 | grep "(failed)" | sed 's/.*• //' | sed 's/ (failed).*//' | xargs)

if [ -n "$FAILED" ]; then
  echo "⚠️  Migrations échouées détectées — résolution en cours..."
  for migration in $FAILED; do
    echo "  → Rollback : $migration"
    npx prisma migrate resolve --rolled-back "$migration" || true
  done
fi

echo "🚀 Application des migrations..."
npx prisma migrate deploy

echo "🌱 Initialisation de la base de données..."
node prisma/seed.js

echo "✅ Démarrage du serveur..."
exec node src/server.js
