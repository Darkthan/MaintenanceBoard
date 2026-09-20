# Audit de la supervision et des pullers

Date : 20 septembre 2026. Périmètre : code local MaintenanceBoard, agent Linux, installateurs Linux/Docker, authentification, ingestion, alertes et interface de supervision.

## Conclusion

Le parcours nominal est couvert par des tests réussis, mais **le module ne doit pas être considéré comme validé pour une supervision de production**. Deux défauts de sécurité importants et deux défauts de fiabilité sont reproduits localement. D'autres limites sont confirmées par lecture du code. Aucun correctif applicatif ni déploiement n'a été réalisé dans le cadre de cet audit.

La procédure associée décrit l'installation existante et ses précautions : [déployer les pullers](DEPLOIEMENT-PULLERS.md).

## Vérifications réalisées

- 4 suites Jest ciblées, **18 tests réussis** : `supervision`, `agents-monitoring`, `downloads-agent-install`, `import-service-equipment-agent`.
- Reproductions isolées : `node scripts/audit-supervision.cjs`. Quatre résultats `CONFIRME` : ce mot signifie qu'un **défaut** a été reproduit.
- Lecture des contrôles d'accès, de la révocation, des limites de charge utile, de la configuration TLS et des scripts d'installation.
- Aucun appel à un serveur de production, aucune écriture en base, aucune utilisation de vrai jeton pour ces reproductions. Le script charge le code réel avec des dépendances simulées.
- Les tests des routes simulent la base et, pour plusieurs suites existantes, l'authentification. Ils ne prouvent pas le bon fonctionnement du réseau, du service systemd, de Docker, des certificats ou des notifications réelles.
- Installation Linux/Docker et réception push sur navigateur **non exécutées**. Pas de scan de dépendances ni de test d'intrusion externe. La recette terrain reste nécessaire.

Commande des tests :

```text
node node_modules/jest/bin/jest.js --runInBand --forceExit tests/supervision.test.js tests/agents-monitoring.test.js tests/downloads-agent-install.test.js tests/import-service-equipment-agent.test.js
```

## Défauts prioritaires

### S1 — Élevé : récupération du jeton d'une machine par son numéro de série

Source : `src/routes/agents.js`, branche enrollment de `POST /api/agents/checkin`.

Le serveur recherche l'équipement par `serialNumber`, puis retourne son `agentToken` existant. Il ne demande pas de preuve de possession de ce jeton et ne vérifie pas que le jeton d'enregistrement appartient au même déploiement. Un détenteur d'un jeton d'enregistrement actif, connaissant un numéro de série existant, peut donc obtenir le secret machine et falsifier ses remontées. Le cas révoqué est bien refusé.

**Preuve :** la reproduction utilise deux identités de déploiement distinctes et reçoit le jeton de la machine existante.

**Correction attendue :** refuser le rattachement automatique à une machine déjà enrôlée ; prévoir une opération administrateur explicite de réenregistrement et de rotation. L'appartenance au même déploiement ne constitue pas, à elle seule, une preuve de possession. Tester aussi les enrollments concurrents.

### S2 — Élevé : filtrage IP contournable

Source : `src/middleware/agentAuth.js`, `getClientIp`.

La première valeur de `X-Forwarded-For` est utilisée directement, avant `req.ip`, indépendamment de la politique Express `trust proxy`. Un client ayant un jeton valide peut annoncer une adresse autorisée si le chemin réseau laisse passer cet en-tête. Cela contourne les listes IP, pas l'obligation de posséder un jeton.

**Preuve :** adresse cliente `203.0.113.7`, liste autorisant seulement `10.0.0.1`, en-tête falsifié `10.0.0.1` : authentification acceptée.

**Correction attendue :** utiliser l'adresse calculée par Express, configurer précisément le nombre de proxys de confiance, empêcher l'accès direct au backend et faire remplacer les en-têtes entrants par le proxy. Ajouter des tests avec accès direct et chaîne de proxys.

### F1 — Élevé : absence de détection du silence du puller

Sources : `src/routes/supervision.js`, `src/utils/supervision.js`, `buildSupervisionSnapshot`.

`lastSeenAt` est lu mais n'est pas utilisé pour invalider un état. Une sonde remontée UP reste UP après l'arrêt du puller. Aucun traitement périodique de perte de contact n'a été trouvé dans le périmètre inspecté.

**Preuve :** une remontée datant de 2020 apparaît encore dans le total UP.

**Correction attendue :** introduire un état inconnu/périmé après un délai tenant compte de l'intervalle et de la durée du cycle ; le distinguer d'une cible effectivement DOWN. Prévoir un contrôle périodique indépendant des check-ins pour alerter sur un puller absent.

### F2 — Moyen : les pullers interfèrent dans la déduplication des alertes

Sources : `src/routes/agents.js`, `maybeCreateHarvestInterventions` ; `src/utils/supervision.js`, `notifyNewAlertsOnce`.

Chaque check-in transmet uniquement ses alertes, alors que la fonction marque inactives toutes les clés globales absentes de cette liste. Le check-in sain de B réarme l'alerte persistante de A ; A peut notifier de nouveau à son prochain passage. Les lectures/écritures du fichier de paramètres autour d'opérations asynchrones exposent aussi à des pertes de mises à jour concurrentes.

**Preuve :** une alerte active de A devient inactive après l'appel correspondant à B sans alerte.

**Correction attendue :** stocker et réconcilier les états par puller, avec mises à jour atomiques. Ne pas marquer une notification comme livrée lorsqu'aucun abonnement n'a pu la recevoir ; prévoir délais et reprise des erreurs transitoires.

## Autres constats de sécurité

| Priorité | Constat et conséquence | Action attendue |
|---|---|---|
| Élevée, selon exposition réseau | `/api/supervision/push-subscriptions` accepte une destination arbitraire pour tout utilisateur connecté. `web-push` envoie ensuite une requête HTTPS vers cette destination ; aucune restriction de destination ni délai explicite n'est passé. Risque de requêtes serveur vers des services internes et de blocage prolongé. Analyse de code, pas d'exploitation réseau effectuée ; dépend de VAPID, de clés push valides et d'une alerte. | Autoriser les services push nécessaires, contrôler destinations/résolution IP et sorties réseau, valider les clés, limiter les délais et rattacher les abonnements à leur utilisateur. |
| Moyenne | Les installateurs et Compose contiennent le jeton d'enregistrement ; les téléchargements le passent dans l'URL. Il peut être conservé dans historique, logs de proxy, sauvegardes ou fichiers lisibles. L'installateur Docker n'impose pas de permissions privées à Compose. | Utiliser des secrets hors URL, `Cache-Control: no-store`, permissions restrictives et jetons à durée courte. Ne pas partager les scripts générés. |
| Moyenne | Le Dockerfile construit depuis `.` sans `.dockerignore`, alors que `config/puller.yml` a déjà été écrit. Les secrets entrent donc dans le contexte de construction, sans être explicitement copiés dans l'image. | Exclure `config/` et `logs/` du contexte. |
| Moyenne | Les scripts autorisent une URL serveur HTTP. TLS est vérifié par défaut pour HTTPS mais peut être désactivé par sonde. Les récoltes n'imposent pas les protocoles curl : le champ `type` ne contraint pas le schéma de l'URL. | Imposer HTTPS pour les secrets et téléchargements, limiter les sondes à HTTP(S), utiliser une autorité de certification interne plutôt que `insecure_skip_verify`. |
| Moyenne | Les scripts tournent en root ; Docker ne définit ni utilisateur dédié, ni réduction des capacités, ni système de fichiers en lecture seule. | Définir les droits minimaux nécessaires, limiter le réseau du puller et ses accès au système hôte. |
| Moyenne | Les listes IP des jetons sont enregistrées sans validation stricte. Le parseur CIDR emploie `parseInt` sans refuser explicitement un préfixe non numérique ; les listes ne prennent pas en charge IPv6 natif. | Valider les entrées à l'enregistrement et refuser les CIDR malformés ; ajouter des tests IPv4/IPv6. |

## Limites de fonctionnement et d'exploitation

- **Docker dépend du jeton d'enregistrement à chaque démarrage.** L'entrypoint télécharge de nouveau `agent.sh`. Si le jeton a expiré ou a été désactivé, le conteneur ne redémarre plus, même avec un `machine-token` valide. Il faut embarquer une version contrôlée du script dans l'image.
- **Réinstallation destructive pour la configuration.** Les deux installateurs réécrivent `puller.yml` ; ne pas les relancer comme procédure de mise à jour sans sauvegarde.
- **Identité Docker instable.** Pas de hostname fixe dans Compose ; le hostname peut changer lors d'une recréation. La lecture DMI échoue fréquemment en conteneur. Les pipelines sans `pipefail` peuvent renvoyer une chaîne vide sans déclencher le repli ; un numéro de série vide ou partagé compromet la déduplication après perte du jeton machine.
- **`inventory.enabled` n'est jamais lu** par `agent.sh`. Le mettre à `false` ne désactive pas l'inventaire.
- **Rechargement partiel.** Le YAML est relu à chaque cycle pour les sondes et l'intervalle, mais `SERVER_URL` est fixé au démarrage. Redémarrer après un changement de serveur.
- **Validation insuffisante du YAML.** Pas de schéma ni de bornes pour l'intervalle, les délais, les méthodes ou le nombre de sondes. Un `sleep` invalide peut provoquer une boucle rapide ; un délai curl à zéro peut laisser une requête sans limite temporelle.
- **Collecte séquentielle.** Période réelle = durée des sondes + envoi + sommeil. Cinquante sondes à dix secondes peuvent prendre plus de huit minutes avant même le sommeil de cinq minutes.
- **Limites serveur.** Au plus 50 récoltes retenues, puis rejet si l'ensemble `agentInfo` dépasse 20 Ko. Limiteur agents : 60 requêtes par IP sur 15 minutes, par instance applicative. Environ 20 pullers à cinq minutes derrière la même IP atteignent déjà cette limite, sans marge pour les autres agents/sessions ni les rafales.
- **Pas de file durable.** Une transmission échouée perd les mesures du cycle. Le journal résume les erreurs serveur par « Erreur connexion au serveur » sans distinguer 401, 403, 429 ou 500.
- **Historique visuel fictif.** `randomSegments()` dans `public/supervision.html` dessine des barres calculées à partir du seul dernier état. Ce n'est pas un historique mesuré ni une disponibilité sur 24 périodes.
- **Interventions non clôturées automatiquement.** Le code évite de créer une nouvelle intervention de même titre encore ouverte, mais ne ferme pas celles dont la cible est revenue UP.
- **Révocation à distinguer de l'expiration.** Désactiver l'enrollment n'arrête pas les machines déjà enrôlées. Révoquer la machine bloque ses check-ins et son réenregistrement ; aucune route dédiée de réactivation n'a été trouvée dans `agents.js`.

## Points déjà présents

Jetons obligatoires aux check-ins, refus des machines révoquées, validation de la syntaxe du hostname, limites de taille des remontées, droits administrateur pour les jetons et règles, TLS vérifié par défaut, secrets machine en fichier mode 600, YAML chargé avec `safe_load`, valeurs textuelles principales échappées dans l'interface de supervision. Ces protections ne compensent pas les défauts ci-dessus.

## Ordre de remédiation proposé

1. Corriger S1 et S2 ; ajouter des tests de non-régression prouvant le refus des attaques.
2. Restreindre les destinations push et borner la durée des envois.
3. Corriger la fraîcheur des mesures et isoler les états d'alerte par puller.
4. Embarquer l'agent Docker, protéger les secrets et stabiliser l'identité ; valider la configuration et son cycle de mise à jour.
5. Réaliser la recette réseau, panne/reprise, révocation, redémarrage Docker après désactivation de l'enrollment et essais multi-pullers derrière NAT. Ne qualifier la production qu'après cette recette.
