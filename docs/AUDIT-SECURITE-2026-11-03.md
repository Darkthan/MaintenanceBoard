# Audit de sécurité MaintenanceBoard — 3 novembre 2026

## Conclusion et périmètre

La correction prioritaire concerne les téléversements publics (Multer), l'isolation des sessions MCP et le transport SMTP. Des dépendances vulnérables et des défauts de gestion des sessions justifient une mise à niveau avant de considérer l'application comme durcie pour Internet.

Audit du répertoire de travail local, incluant ses modifications non commitées. Référence Git : `8fd4e318581f2f686f1f12963e36bdb98b108485`. Les versions ci-dessous viennent de `package-lock.json`, avec vérification séparée du PDF.js distribué dans `public/js`. Ce document ne constitue pas une attestation de la version en production.

Méthode : revue ciblée du code, rapprochement des versions avec les avis des éditeurs, contrôles locaux isolés avec services simulés. Aucun test destructif, envoi d'email, scan de production ou accès à une base réelle. Aucun secret de `.env` n'a été lu pour cet audit. Aucun correctif applicatif n'a été appliqué.

Limites : `npm audit --omit=dev --json` a échoué (`ENOTFOUND registry.npmjs.org`). L'inventaire des vulnérabilités transitives n'est donc pas exhaustif. Les images déployées, paquets Alpine, certificats, règles de pare-feu et configuration effective du reverse proxy restent à contrôler. Les problèmes sans avis CVE sont des constats de code, pas des CVE inventées. P1 = traiter en priorité ; P2 = lot suivant ; P3 = durcissement planifié. Les priorités sont propres à cette application et ne remplacent pas les scores des éditeurs.

## Synthèse

| ID | Priorité | Constat | Niveau de preuve / condition |
|---|---|---|---|
| DEP-01 | P1 | Multer 1.4.5-lts.2 : arrêt possible du processus par multipart malformé | Version affectée et route de téléversement publique identifiées ; pas d'exploitation lancée |
| APP-01 | P1 | Sessions MCP liées au client sans liaison suffisante à l'utilisateur ni aux permissions courantes | Reproduit sur le gestionnaire réel avec transport simulé ; nécessite de connaître un identifiant de session |
| APP-02 | P1 | Certificats SMTP acceptés sans vérification | Configuration explicite ; interception conditionnée à un accès réseau adéquat |
| DEP-02 | P1 | SDK MCP 1.29.0 : déni de service sur validation / lots | Version affectée ; authentification préalable réduit l'exposition |
| INF-01 | P1 si configuration utilisée | PostgreSQL publié et mot de passe de repli connu | Compose local ; exposition réelle et remplacement du mot de passe non vérifiés |
| APP-03 | P2 | Refresh tokens non révoqués au changement de mot de passe ; déconnexion souvent sans révocation serveur | Code vérifié, absence de révocation au changement reproduite avec base simulée |
| APP-04 | P2 | Rotation des refresh tokens web non atomique | Deux successeurs émis lors d'un rejeu concurrent simulé |
| DEP-03 | P2 | PDF.js 3.11.174 vulnérable dans les aperçus | Version et appels confirmés ; CSP actuelle sans unsafe-eval atténue le mécanisme CVE-2024-4367 |
| DEP-04 | P2 | SheetJS xlsx 0.18.5 : pollution de prototype et ReDoS | Import Excel accessible aux administrateurs |
| DEP-05 | P2 | Nodemailer 6.10.1 : avis de sécurité sur analyse d'adresses | Version affectée ; contournement d'un destinataire applicatif non démontré |
| INF-02 | P2 | Image Node.js 20 arrivée en fin de support ; exécution root par défaut | Dockerfile local |
| APP-05 | P2 | OTP, concurrence et traçabilité des signatures à renforcer | Code ; pas de falsification de signature réalisée |
| APP-06 | P2 | Enregistrement OAuth public sans quotas propres, écritures synchrones cumulatives | Code ; pas de saturation lancée |
| HARD-01 | P3 | CSP permissive, ressources CDN et contrôles OAuth complémentaires | Durcissement et écarts de protocole ; pas de chaîne d'exploitation démontrée |

## DEP-01 — Téléversements Multer

**Preuves.** Le lockfile fixe Multer à `1.4.5-lts.2`. `src/middleware/ticketAttachment.js` utilise ce parseur et `src/routes/tickets.js` expose `POST /api/tickets` sans authentification, avant la validation métier du ticket. Les limites IP existantes n'empêchent pas un défaut pouvant être déclenché par une seule requête.

**Avis pertinents.** CVE-2026-3520 / GHSA-5528-5vmv-3xc2 concerne les versions antérieures à 2.1.1. CVE-2026-77078 / GHSA-wc9g-mqfw-jrwm concerne les versions antérieures à 2.3.0 : des noms de champs spécialement formés peuvent provoquer une exception non interceptée.

**Correction proposée.** Migrer vers une version maintenue au moins égale à `2.5.0`, régénérer le lockfile et vérifier les avis de cette version au moment du changement. Ne pas s'arrêter à 2.1.1 : des avis ultérieurs existent. L'avis GHSA-q7qp-rjg7-q26m, corrigé en 2.5.0, exige un filtre de fichier asynchrone et ne décrit pas les filtres synchrones examinés ici. Il ne doit pas être compté comme une exploitation supplémentaire confirmée de cette application.

Ajouter des limites explicites `files`, `fields`, `parts`, `fieldSize`, une taille maximale au reverse proxy, des quotas de stockage et une suppression des fichiers lors d'un abandon ou d'un rejet métier. Conserver le contrôle des types réels et l'authentification avant parsing sur les routes privées.

**Validation du correctif.** En processus de test isolé : multipart invalide et téléversement interrompu, vérification que le serveur reste vivant et ne laisse pas de fichiers ; vérifier aussi les pièces jointes normales, imports et signatures.

## APP-01 — Isolation des sessions MCP

**Preuves.** `src/mcp/server.js:823`, `:834`, `:859`, `:873` ne lient la session qu'à `ctx.id`. Pour l'OAuth direct, `src/middleware/mcpAuth.js:123` affecte `payload.clientId` à cet identifiant. Plusieurs utilisateurs du même client peuvent donc partager la même clé d'autorisation de session. Le serveur et les outils conservent le contexte de création, dont les scopes et l'utilisateur.

**Impact conditionnel.** Un utilisateur authentifié qui obtient l'identifiant d'une session d'un autre utilisateur du même client peut être dirigé vers le contexte initial de cet utilisateur. Le UUID aléatoire limite la découverte ; cet audit ne démontre pas de fuite permettant de l'obtenir. Une baisse des scopes peut aussi ne pas être répercutée dans un serveur déjà créé.

**Contrôle effectué.** Exécution du véritable `handleMcpRequest` extrait du fichier, avec une session et un transport simulés : une requête de `tech-B` avec le même client et un identifiant de session connu est transmise au transport associé à `admin-A`. Aucun outil réel n'est exécuté.

**Correction proposée.** Lier chaque session au principal, au client, au mode d'authentification et à un identifiant de grant/session. Vérifier ces attributs pour GET, POST et DELETE. Recalculer les permissions effectives à chaque appel, ou invalider la session dès que l'utilisateur, le grant ou ses droits changent. Une simple liaison au client ne suffit pas ; une liaison utilisateur/client seule ne couvre pas deux grants de scopes différents. Si les clients le permettent, privilégier le mode sans état.

**Validation.** Deux utilisateurs du même client, deux grants de scopes différents du même utilisateur, révocation et baisse de rôle : toutes les reprises non autorisées doivent échouer ; l'accès normal doit fonctionner.

## APP-02 — SMTP sans validation des certificats

**Preuve.** `src/utils/mail.js:15` impose `tls: { rejectUnauthorized: false }`. `requireTLS` n'est activé que si STARTTLS a été explicitement demandé. Ce transport est notamment utilisé pour les codes OTP et les liens de signature.

**Impact.** Un intermédiaire réseau capable d'intercepter la connexion peut présenter un certificat non fiable et récupérer des messages sensibles, voire les identifiants SMTP selon la méthode utilisée. Le risque dépend de la topologie ; aucune interception n'a été tentée.

**Correction proposée.** Rétablir `rejectUnauthorized: true`, installer l'autorité interne si nécessaire, et exiger TLS : TLS implicite en 465 ou STARTTLS obligatoire en 587 selon le relais. Éviter tout repli silencieux en clair pour le transport de codes de signature.

**Validation.** Certificat expiré, mauvais nom ou autorité inconnue : refus ; certificat valide ou autorité interne approuvée : envoi réussi en préproduction.

## DEP-02 — SDK MCP et consommation de ressources

**Preuves.** `@modelcontextprotocol/sdk` est verrouillé à `1.29.0`. Les serveurs privés et publics utilisent le transport HTTP. `src/app.js:80` parse du JSON jusqu'à 10 Mo avant les middlewares d'authentification MCP. Les deux routes MCP imposent ensuite une authentification ; le terme « public » ne signifie donc pas anonyme dans ce cas.

**Avis.** GHSA-f897-62hf-6gxq est corrigé en 1.30.1 pour les limites de corps/lots. CVE-2026-111768 / GHSA-46jr-4wx8-v453 concerne les versions antérieures à 1.32.0 et ajoute une limite des éléments d'entrée. Selon l'éditeur, la mise à jour seule ne suffit pas pour ce second problème.

**Correction proposée.** SDK au moins `1.32.0`, avec `maxToolInputElements` défini sur les deux serveurs, un plafond de lots et un parseur Express spécifique aux routes MCP dimensionné aux besoins. Exemple initial à mesurer : 256 Ko et 10 000 éléments. La limite du parseur Express est déterminante lorsque le JSON est déjà parsé avant le SDK. Ajouter plafonds de sessions actives et de requêtes concurrentes par principal, puis limiter également le trafic GET/SSE.

**Validation.** Rejet contrôlé des lots et entrées excessifs, stabilité mémoire, maintien des outils usuels et des connexions ChatGPT.

## INF-01 — Base PostgreSQL

**Preuves.** `docker-compose.yml:15` publie `5432:5432` sur les interfaces par défaut et les lignes 11/41 prévoient le mot de passe de repli `maintenance_pass`. Une variable externe peut le remplacer ; le mot de passe réellement déployé n'a pas été inspecté.

**Correction proposée.** Retirer `ports` du service DB si seule l'application l'utilise ; conserver le réseau Docker interne. Si une administration locale est nécessaire, lier explicitement `127.0.0.1:5432:5432` ou passer par un tunnel. Exiger `${POSTGRES_PASSWORD:?mot de passe requis}` et un secret aléatoire. Changer aussi le mot de passe dans PostgreSQL : modifier la variable seule ne modifie pas une base déjà initialisée dans le volume.

**Validation.** Absence d'écoute publique sur l'hôte, test des droits du compte applicatif et restauration de sauvegarde.

## APP-03 / APP-04 — Sessions web et refresh tokens

**Preuves.** `src/services/authService.js:163` conserve le refresh token brut. Le cookie de refresh est restreint au chemin `/api/auth/refresh` (`:180` environ), mais la déconnexion `/api/auth/logout` tente de lire ce cookie (`src/routes/auth.js:181`). Le navigateur ne l'envoie normalement pas sur ce chemin. Sans token explicitement fourni dans le corps, la révocation serveur n'a donc pas lieu, même si les cookies sont effacés. `changePassword` (`src/services/authService.js:398`) ne révoque pas les tokens existants.

La rotation (`:226`) fait `findUnique`, puis `deleteMany` sans contrôler son résultat, puis crée un successeur. Deux requêtes ayant lu le même jeton peuvent chacune obtenir un nouveau jeton. Le contrôle isolé a reproduit deux créations malgré des suppressions renvoyant successivement 1 et 0.

**Corrections proposées.**

- Stocker un hash SHA-256 du secret de refresh, avec identifiant de session/famille ; migrer ou invalider les anciens tokens bruts.
- Rendre la consommation atomique dans une transaction, avec une suppression/mise à jour conditionnelle dont le nombre de lignes doit être exactement 1 avant toute émission.
- Prévoir une déconnexion qui identifie et révoque la session serveur sans dépendre d'un cookie absent sur son chemin. Réduire le chemin et adapter les endpoints ensemble, ou élargir le chemin avec protections CSRF adaptées.
- Révoquer les sessions après changement/réinitialisation de mot de passe et proposer une révocation globale. Définir séparément le sort des grants MCP.
- Utiliser un identifiant/version de session dans le JWT si la révocation immédiate des access tokens est requise ; sinon documenter leur durée résiduelle de 15 minutes par défaut. Réévaluer la conservation de refresh tokens pendant 365 jours.

**Validation.** Rejeu après rotation, rejeu concurrent, refresh après logout ou changement de mot de passe, et comportement multi-onglets. Une seule rotation concurrente doit réussir ; prévoir un rafraîchissement coordonné côté navigateur pour éviter une déconnexion intempestive.

## DEP-03 — PDF.js dans le navigateur

**Preuves.** `pdfjs-dist` et `public/js/pdf.min.js` sont en `3.11.174`. Les appels `getDocument` de `public/orders.html:1593`, `:1688` et `public/signatures.html:502` ne fixent pas `isEvalSupported: false`.

**Avis.** CVE-2024-4367 affecte les versions jusqu'à 4.1.392 incluses ; correction en 4.2.67. Les fichiers malveillants peuvent entraîner une exécution JavaScript lors de leur rendu dans certaines configurations.

**Nuance essentielle.** La CSP de `src/app.js` n'autorise pas `unsafe-eval`. Elle constitue une mitigation du mécanisme connu fondé sur la génération dynamique de code. La présence de cette bibliothèque vulnérable ne prouve donc pas une exécution de code exploitable dans le navigateur avec les en-têtes actuels. Ce n'est pas non plus une preuve d'exécution de commandes sur le serveur.

**Correction proposée.** Fixer immédiatement `isEvalSupported: false` sur tous les appels, puis remplacer la bibliothèque ET le worker distribués au navigateur par une version maintenue compatible. Ne pas mettre à jour seulement le lockfile. Au choix d'une version récente, tenir compte de CVE-2026-16633 (branche >= 5.6.83 et < 6.2.108) : viser au moins 6.2.108 si l'on choisit cette branche et désactiver le scripting non nécessaire. L'avis 2026 ne concerne pas la version 3.11.174 actuellement livrée.

**Validation.** Rendu de PDF légitimes, signatures et aperçu de commandes ; vérifier les en-têtes CSP effectifs en préproduction et l'absence de génération dynamique autorisée.

## DEP-04 — Imports SheetJS

**Preuves.** `xlsx` 0.18.5 est utilisé dans `src/services/importService.js:40` via `XLSX.readFile`. La route d'import matériel exige un administrateur : il faut qu'un fichier malveillant soit importé, ce n'est pas un accès anonyme démontré. Les exports seuls ne suffisent pas à déclencher la pollution de prototype décrite par l'éditeur.

**Avis.** CVE-2023-30533 est corrigé en 0.19.3 ; CVE-2024-22363 en 0.20.2. Le vieux package npm ne fournit pas la mise à jour nécessaire.

**Correction proposée.** Choisir une distribution officielle SheetJS au moins 0.20.2 depuis son canal officiel, avec provenance/intégrité verrouillées, ou migrer vers un autre parseur maintenu après validation fonctionnelle. Limiter lignes, feuilles, taille décompressée et temps de traitement ; isoler les imports dans un worker/processus. À court terme, désactiver les imports Excel si leur usage est rare, et conserver CSV avec ses propres plafonds.

## DEP-05 — Nodemailer

**Preuve.** Version verrouillée `6.10.1`, utilisée pour les emails applicatifs. GHSA-rcmh-qjqh-p98v décrit un déni de service de l'analyseur d'adresses corrigé en 7.0.11. Des avis ultérieurs, dont GHSA-8c8m-p3m8-cjg8, concernent encore les versions antérieures à 10.1.4.

**Correction proposée.** Viser une version maintenue au moins `10.1.4`, après vérification de ses prérequis Node et des changements de comportement. Traiter les destinataires comme une adresse unique validée et normalisée ; éviter de passer directement une chaîne RFC 5322 complexe. Tester les emails de ticket, OTP, prêts et commandes.

**Limite d'applicabilité.** Plusieurs routes imposent déjà des expressions régulières d'email. Aucun contournement de ces validations et aucune livraison à un destinataire indu n'ont été reproduits. La version affectée est confirmée ; l'exploitation de chaque avis dans les parcours métier reste conditionnelle.

## INF-02 — Image et exécution

**Preuves.** `Dockerfile:1` utilise `node:20-alpine`. Node 20 est EOL à la date de cet audit. Aucun `USER` n'est défini dans le Dockerfile ou le Compose examiné : exécution root par défaut dans cette configuration. Les outils de compilation restent dans l'image, avec Ghostscript et FFmpeg.

**Correction proposée.** Migrer par exemple vers Node 24 LTS à jour, compatible avec les dépendances, reconstruire les modules natifs et scanner l'image finale. Utiliser un build multiétape, exécuter en utilisateur non privilégié, restreindre les écritures aux dossiers nécessaires, ajouter `no-new-privileges`, retirer les capacités inutiles, fixer des plafonds CPU/mémoire et isoler les conversions de fichiers non fiables. Aucun numéro de CVE Alpine/FFmpeg/Ghostscript n'est attribué sans inventaire de l'image réellement construite.

`docker-compose.yml:60` exécute aussi `prisma db push --accept-data-loss` au démarrage : c'est un risque d'intégrité lors d'une évolution du schéma, pas une faille distante démontrée. Le remplacer par des migrations versionnées, revues et testées après sauvegarde vérifiée.

## APP-05 — Signatures : OTP et traçabilité

**Preuves.** `src/routes/signatures.js:39` génère l'OTP avec `Math.random`. Le contrôle de cinq essais (`:608`) est suivi d'une comparaison et d'une écriture `otpAttempts: sigReq.otpAttempts + 1` (`:616`) : les requêtes concurrentes peuvent écraser le compteur. Le renvoi d'OTP le remet à zéro. La limitation globale d'API existe, mais ne remplace pas un budget atomique par demande. La prise de verrou `SIGNING` (`:624`) s'applique uniquement aux liens de prêt. Enfin l'IP enregistrée (`:634`) est lue directement dans `X-Forwarded-For` plutôt que depuis le résultat de la chaîne de confiance Express.

**Correction proposée.** Utiliser `crypto.randomInt(100000, 1000000)`, réserver atomiquement un essai avant le calcul bcrypt, définir un budget cumulé et des quotas d'envoi par demande/adresse/IP. Étendre la consommation atomique et idempotente aux signatures OTP pour éviter doubles traitements et incohérences. Utiliser `req.ip` avec un `trust proxy` limité aux proxys connus et une réécriture des en-têtes entrants au proxy.

Les liens de prêt sans OTP répondent au parcours demandé : ce n'est pas une faille en soi. Leur possession vaut autorisation ; préserver expiration, usage unique, `Cache-Control: no-store`, politique de référent stricte et masquage des tokens dans les journaux. Ne pas présenter une IP collectée comme une preuve forte d'identité.

**Validation.** Rafale concurrente d'essais invalides en environnement isolé, double soumission valide, renvoi d'OTP, expiration et falsification d'en-tête IP. Pas de signature de documents réels pour ce test.

## APP-06 / HARD-01 — OAuth et durcissement

**Enregistrement public.** `src/routes/oauth.js:283` ne possède pas de quota spécifique sur `/oauth/register`, hors du limiteur `/api`. Chaque appel alimente une Map et réécrit synchroniquement une configuration cumulée. Ajouter quotas IP/globaux, plafond de clients, expiration/purge, taille/nombre maximal des redirect URIs et stockage dédié avec écritures sûres. Le caractère public de l'enregistrement dynamique est normal ; son allocation de ressources doit être bornée.

**Redirections et liaison de code.** Le client direct sans URI enregistrée accepte toute URI HTTPS (`:261`). Le remplacer par des URI explicitement approuvées ; conserver l'enregistrement dynamique avec correspondance exacte pour les autres clients. Au token endpoint, vérifier explicitement le `client_id` et la présence/correspondance de `redirect_uri` avec le code. PKCE S256 est déjà obligatoire et constitue une protection importante ; son existence ne dispense pas de ces contrôles. Aucun vol de code n'a été démontré.

**CSRF OAuth.** `verifyOAuthCsrf` (`:184`) ne rend pas le cookie obligatoire et lie le jeton signé aux paramètres du client, sans identité de session. Renforcer la liaison au navigateur/session utilisateur, exiger un secret CSRF par session et inclure les paramètres de consentement pertinents. Vérifier les WebViews avant changement. Ce point nécessite une validation de scénario navigateur avant de conclure à un contournement exploitable.

**Permissions courantes.** Dans la branche OAuth avec token MCP enregistré, `src/middleware/mcpAuth.js:142` reprend les scopes du JWT sans recalcul complet de l'intersection actuelle rôle/client/grant. Harmoniser avec la branche directe et tester une baisse de rôle/scopes pendant la validité du JWT. Conserver des audiences, émetteurs et types de tokens explicites et distincts.

**Navigateur.** `src/app.js:29-30` autorise les scripts et attributs inline et plusieurs CDN. Ce constat n'est pas une preuve de XSS dans chaque utilisation d'innerHTML. Externaliser les scripts/gestionnaires, utiliser des nonces ou hashes, héberger les dépendances localement avec versions figées et conserver la désinfection des contenus riches. Ne pas ajouter `unsafe-eval` pour résoudre une migration PDF.js.

## Plan de correction proposé

1. **Premier lot, avant exposition large** : Multer, isolation MCP, certificats SMTP et contrôle du port PostgreSQL. Valider pièces jointes, SMTP et séparation des identités en préproduction.
2. **Deuxième lot** : SDK MCP avec limites explicites, Node LTS, mise à jour PDF.js côté navigateur, SheetJS et Nodemailer. Refaire le build et l'analyse des dépendances/images.
3. **Troisième lot** : révocation/rotation des sessions, concurrence OTP et signatures, quotas d'enregistrement OAuth, puis durcissement CSP et conteneurs.
4. **Contrôle de livraison** : tests fonctionnels ciblés et tests négatifs ci-dessus, restauration de sauvegarde, déploiement progressif et surveillance des erreurs/429/mémoire. Pas de `npm audit fix --force` global sans revue des migrations.

## Contrôles effectivement réalisés

- Lecture des versions verrouillées et identification de la bibliothèque PDF.js statique : 3.11.174 confirmée par son export `version`.
- Simulation locale du gestionnaire réel MCP : utilisateur différent, client commun, session connue → transport de l'ancien contexte atteint.
- Simulation locale du service réel de refresh : deux appels concurrents sur la même lecture → deux tokens successeurs.
- Simulation locale du changement de mot de passe : aucune opération de révocation des refresh tokens.
- Revue statique du SMTP, des cookies, des chemins publics, du Compose et des signatures.
- Recherche des avis primaires ci-dessous. `npm audit` tenté mais non abouti ; aucun total « zéro vulnérabilité » ou inventaire complet n'est revendiqué.

## Sources primaires consultées le 3 novembre 2026

- Multer, récursion / CVE-2026-3520 : https://github.com/expressjs/multer/security/advisories/GHSA-5528-5vmv-3xc2
- Multer, champs multipart / CVE-2026-77078 : https://github.com/expressjs/multer/security/advisories/GHSA-wc9g-mqfw-jrwm
- Multer, filtre asynchrone (conditions distinctes) : https://github.com/expressjs/multer/security/advisories/GHSA-q7qp-rjg7-q26m
- MCP, validation / CVE-2026-111768 : https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-46jr-4wx8-v453
- MCP, limites HTTP/lots : https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-f897-62hf-6gxq
- PDF.js / CVE-2024-4367 : https://github.com/advisories/GHSA-wgrm-67xf-hhpq
- PDF.js / CVE-2026-16633 : https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j
- SheetJS / CVE-2023-30533 : https://cdn.sheetjs.com/advisories/CVE-2023-30533
- SheetJS / CVE-2024-22363 : https://cdn.sheetjs.com/advisories/CVE-2024-22363
- Nodemailer, récursion : https://github.com/nodemailer/nodemailer/security/advisories/GHSA-rcmh-qjqh-p98v
- Nodemailer, adresses / correctif 10.1.4 : https://github.com/nodemailer/nodemailer/security/advisories/GHSA-8c8m-p3m8-cjg8
- Support Node.js : https://nodejs.org/en/about/previous-releases
