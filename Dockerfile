FROM node:20-alpine

WORKDIR /app

# Installer les dépendances système pour sharp et bcrypt
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    libc6-compat

# Copier les fichiers de dépendances
COPY package*.json .npmrc ./
COPY prisma.config.ts ./
COPY prisma ./prisma/

# Installer toutes les dépendances (dev inclus — nécessaire pour prisma CLI)
RUN npm ci

# Générer le client Prisma
RUN npx prisma generate

# Supprimer les devDependencies après génération
RUN npm prune --omit=dev

# Copier le code source
COPY src ./src
COPY public ./public
COPY docker-entrypoint.sh ./

# Créer le dossier uploads + rendre le script exécutable
RUN mkdir -p uploads && chmod +x docker-entrypoint.sh

# Exposer le port
EXPOSE 3000

CMD ["./docker-entrypoint.sh"]
