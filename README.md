# MaintenanceBoard

Application de gestion du parc informatique scolaire/entreprise.

## Fonctionnalités

- **Authentification** : Passkeys (WebAuthn/biométrie) + mot de passe + JWT
- **Gestion des salles** : CRUD + import CSV/Excel + QR codes imprimables
- **Gestion des équipements** : inventaire, statuts, assignation aux salles, QR codes
- **Interventions** : suivi complet avec photos, historique par salle/équipement
- **Commandes** : workflow PENDING → ORDERED → RECEIVED avec lignes de détail
- **Scanner QR mobile** : page dédiée pour signaler un problème depuis le terrain
- **API documentée** : Swagger UI intégré

## Démarrage rapide avec Docker

```bash
# 1. Copier et adapter la configuration
cp .env.example .env
# Éditer .env : JWT_SECRET, SESSION_SECRET, SEED_ADMIN_PASSWORD, SEED_TECH_PASSWORD, APP_URL

# 2. Démarrer l'application (DB + App)
docker-compose up -d

# L'app effectue automatiquement les migrations et le seed au démarrage
# Attendre ~30 secondes pour la 1ère initialisation
```

> Le fichier `.env` est **optionnel** — si absent, les variables doivent être définies via la plateforme de déploiement (Portainer, Docker Swarm, etc.). Les variables sans valeur par défaut qui doivent impérativement être configurées sont : `JWT_SECRET`, `SESSION_SECRET`, `SEED_ADMIN_PASSWORD`, `SEED_TECH_PASSWORD`.

### Déploiement via Portainer (Stack)

Dans l'interface Portainer → Stacks → Add stack → Web editor, collez le contenu de `docker-compose.yml` puis définissez les variables d'environnement dans la section **Environment variables** :

| Variable | Valeur |
|----------|--------|
| `JWT_SECRET` | Chaîne aléatoire ≥ 32 caractères |
| `SESSION_SECRET` | Chaîne aléatoire ≥ 32 caractères |
| `POSTGRES_PASSWORD` | Mot de passe PostgreSQL |
| `SEED_ADMIN_PASSWORD` | Mot de passe du compte admin |
| `SEED_TECH_PASSWORD` | Mot de passe du compte technicien |
| `APP_URL` | URL publique (ex: `https://maintenance.mondomaine.fr`) |
| `WEBAUTHN_RP_ID` | Domaine sans protocole (ex: `maintenance.mondomaine.fr`) |
| `WEBAUTHN_ORIGIN` | URL complète (ex: `https://maintenance.mondomaine.fr`) |

## Démarrage en développement (sans Docker)

### Prérequis
- Node.js 20+
- PostgreSQL 14+ (ou Docker pour la DB seule)

```bash
# 1. Démarrer uniquement la base de données
docker-compose up -d db

# 2. Installer les dépendances
npm install

# 3. Configurer l'environnement
cp .env.example .env
# Éditer .env avec vos paramètres

# 4. Migrer la base de données
npx prisma migrate deploy

# 5. Charger les données initiales
node prisma/seed.js

# 6. Démarrer l'application
npm run dev        # Mode développement (rechargement auto)
# ou
npm start          # Mode production
```

## Accès

| URL | Description |
|-----|-------------|
| http://localhost:3000 | Dashboard principal |
| http://localhost:3000/login.html | Connexion |
| http://localhost:3000/api-docs | Documentation API (Swagger) |
| http://localhost:3000/health | Healthcheck |

## Comptes par défaut (seed)

Les credentials du seed sont définis via des variables d'environnement (voir `.env.example`).

| Variable | Défaut | Description |
|----------|--------|-------------|
| `SEED_ADMIN_EMAIL` | `admin@maintenance.local` | Email du compte admin |
| `SEED_ADMIN_PASSWORD` | `Admin@1234` | Mot de passe admin |
| `SEED_ADMIN_NAME` | `Administrateur` | Nom affiché admin |
| `SEED_TECH_EMAIL` | `tech@maintenance.local` | Email du compte technicien |
| `SEED_TECH_PASSWORD` | `Tech@1234` | Mot de passe technicien |
| `SEED_TECH_NAME` | `Technicien Démo` | Nom affiché technicien |
| `SEED_DEMO_DATA` | `true` | `false` pour créer uniquement les comptes, sans données de démo |

> ⚠️ **Définissez `SEED_ADMIN_PASSWORD` et `SEED_TECH_PASSWORD` dans votre `.env` avant le premier démarrage en production.**

## Import CSV en masse

### Salles
```csv
name,building,floor,number,description
Salle 101,Bâtiment A,1,101,Laboratoire informatique
Salle 102,Bâtiment A,1,102,Salle de formation
```

### Équipements
```csv
name,type,brand,model,serialNumber,roomNumber,status
PC-101-01,PC,Dell,OptiPlex 7090,SN123456,101,ACTIVE
SWITCH-B1,Réseau,Cisco,Catalyst 2960,SN789012,,ACTIVE
```

## Flux QR Code

1. Admin génère un QR code depuis la page Salles ou Équipements
2. Imprime le PNG et l'affiche dans la salle
3. Technicien scanne avec smartphone → page `scan.html`
4. Formulaire pré-rempli avec le contexte (salle/équipement)
5. Soumission de l'intervention + photo optionnelle

## Architecture

```
src/
├── server.js           # Point d'entrée
├── app.js              # Config Express (middlewares, routes)
├── config/index.js     # Variables d'environnement
├── middleware/
│   ├── auth.js         # Vérification JWT
│   ├── roles.js        # RBAC (ADMIN/TECH)
│   └── upload.js       # Multer (photos + imports)
├── routes/
│   ├── auth.js         # /api/auth (login, passkeys, refresh)
│   ├── rooms.js        # /api/rooms (CRUD + import + QR)
│   ├── equipment.js    # /api/equipment (CRUD + import + QR)
│   ├── interventions.js # /api/interventions
│   ├── orders.js       # /api/orders
│   ├── qrcode.js       # /api/qrcode/resolve/:token
│   └── users.js        # /api/users
└── services/
    ├── authService.js  # WebAuthn + bcrypt + JWT
    ├── importService.js # Parsing CSV/Excel
    └── qrService.js    # Génération QR codes PNG
```

## Variables d'environnement importantes

```env
DATABASE_URL=postgresql://user:pass@localhost:5432/db
JWT_SECRET=<min 32 caractères aléatoires>
SESSION_SECRET=<min 32 caractères aléatoires>
WEBAUTHN_RP_ID=votre-domaine.com   # En production
WEBAUTHN_ORIGIN=https://votre-domaine.com
```

### Toutes les variables disponibles

| Variable | Défaut | Description |
|----------|--------|-------------|
| `NODE_ENV` | `development` | `production` en prod (active HTTPS cookies, masque les erreurs) |
| `PORT` | `3000` | Port d'écoute du serveur |
| `APP_URL` | `http://localhost:3000` | URL publique de l'application |
| `DATABASE_URL` | — | URL Prisma (`postgresql://...` ou `file:./prisma/dev.db`) |
| `JWT_SECRET` | *(fallback insecure)* | Clé de signature JWT — **obligatoire en prod** (≥ 32 cars) |
| `JWT_ACCESS_EXPIRES` | `15m` | Durée de vie du token d'accès |
| `JWT_REFRESH_EXPIRES` | `7d` | Durée de vie du refresh token |
| `SESSION_SECRET` | *(fallback insecure)* | Secret des sessions WebAuthn — **obligatoire en prod** |
| `SESSION_MAX_AGE` | `86400000` | Durée de vie session en ms (24h par défaut) |
| `WEBAUTHN_RP_NAME` | `MaintenanceBoard` | Nom affiché lors de l'enregistrement d'une passkey |
| `WEBAUTHN_RP_ID` | `localhost` | Domaine WebAuthn — doit correspondre au domaine réel en prod |
| `WEBAUTHN_ORIGIN` | `http://localhost:3000` | Origine autorisée pour WebAuthn |
| `UPLOAD_DIR` | `./uploads` | Dossier de stockage des fichiers uploadés |
| `MAX_FILE_SIZE` | `10485760` | Taille max des uploads en octets (10 Mo par défaut) |
| `SMTP_HOST` | — | Serveur SMTP (requis pour magic links tickets et signatures) |
| `SMTP_PORT` | `587` | Port SMTP |
| `SMTP_USER` | — | Identifiant SMTP |
| `SMTP_PASS` | — | Mot de passe SMTP |
| `SMTP_FROM` | `noreply@maintenance.local` | Adresse expéditeur des emails |
| `POSTGRES_DB` | `maintenance_db` | Nom de la base (Docker Compose) |
| `POSTGRES_USER` | `maintenance_user` | Utilisateur PostgreSQL (Docker Compose) |
| `POSTGRES_PASSWORD` | `maintenance_pass` | Mot de passe PostgreSQL (Docker Compose) |
| `SEED_ADMIN_EMAIL` | `admin@maintenance.local` | Email du compte admin initial |
| `SEED_ADMIN_PASSWORD` | `Admin@1234` | Mot de passe admin initial — **à changer en prod** |
| `SEED_ADMIN_NAME` | `Administrateur` | Nom affiché du compte admin |
| `SEED_TECH_EMAIL` | `tech@maintenance.local` | Email du compte technicien initial |
| `SEED_TECH_PASSWORD` | `Tech@1234` | Mot de passe technicien initial — **à changer en prod** |
| `SEED_TECH_NAME` | `Technicien Démo` | Nom affiché du compte technicien |
| `SEED_DEMO_DATA` | `true` | `false` pour créer uniquement les comptes sans données de démo |
| `AGENT_ENROLLMENT_MAX_AGE` | `0` | Durée de validité des tokens d'enrollment agent en ms (0 = illimité) |

## RBAC

| Action | ADMIN | TECH |
|--------|-------|------|
| Voir salles/équipements | ✅ | ✅ |
| Créer/modifier/supprimer salles | ✅ | ❌ |
| Import CSV | ✅ | ❌ |
| Créer interventions | ✅ | ✅ (propres) |
| Voir toutes les interventions | ✅ | ❌ (propres) |
| Gérer utilisateurs | ✅ | ❌ |
| Commandes | ✅ | ✅ (créer/voir) |
