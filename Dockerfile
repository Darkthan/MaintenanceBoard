FROM node:20-alpine

WORKDIR /app

# Installer les dépendances système pour sharp et bcrypt
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    libc6-compat

# Copier les fichiers de dépendances
COPY package*.json ./
COPY prisma ./prisma/

# Installer les dépendances
RUN npm ci --only=production

# Générer le client Prisma
RUN npx prisma generate

# Copier le code source
COPY src ./src
COPY public ./public

# Créer le dossier uploads
RUN mkdir -p uploads

# Exposer le port
EXPOSE 3000

# Démarrer l'application
CMD ["node", "src/server.js"]
