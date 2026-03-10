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
# 1. Copier la configuration
cp .env.example .env

# 2. Démarrer l'application (DB + App)
docker-compose up -d

# L'app effectue automatiquement les migrations et le seed au démarrage
# Attendre ~30 secondes pour la 1ère initialisation
```

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

| Rôle | Email | Mot de passe |
|------|-------|--------------|
| Admin | admin@maintenance.local | Admin@1234 |
| Tech | tech@maintenance.local | Tech@1234 |

> ⚠️ **Changez ces mots de passe en production !**

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
