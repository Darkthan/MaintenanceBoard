# Déployer et configurer un puller de supervision

Cette procédure décrit **le code audité le 20 septembre 2026**. Des défauts importants restent ouverts : [rapport de sécurité et fonctionnement](AUDIT-SUPERVISION-PULLERS.md). Utiliser d'abord un environnement pilote isolé. Le mode Linux avec systemd évite la dépendance Docker au jeton d'enregistrement à chaque redémarrage.

## 1. Préparer le déploiement

- Prévoir une machine Linux dédiée avec accès administrateur. Pour Docker, Docker Engine et Compose v2 doivent déjà être installés.
- La machine doit joindre MaintenanceBoard en HTTPS et les URL à superviser. Aucun port entrant du puller n'est nécessaire pour ce mécanisme. Autoriser aussi le DNS et les dépôts nécessaires à l'installation des dépendances.
- Vérifier le certificat de MaintenanceBoard et des cibles, ainsi que l'heure système. Ne pas utiliser `curl -k` pour l'installation.
- Côté MaintenanceBoard, `APP_URL` doit être l'adresse HTTPS réellement accessible depuis le puller.
- Dans **Agents**, avec un compte administrateur, créer un jeton d'enregistrement dédié au site. Lui donner un nom explicite, par exemple `Puller-site-A`. Ne pas le partager.
- Restreindre les accès par pare-feu/proxy : la liste IP applicative ne constitue pas actuellement une protection fiable à elle seule.
- Un jeton d'enregistrement sert au premier contact ; le serveur délivre ensuite un jeton machine conservé dans `machine-token`. **Ne pas copier ce fichier vers un second puller.**

## 2. Installer sous Linux avec systemd

Dans Agents, télécharger le bouton **.sh** du jeton choisi. Transférer ce fichier par un canal sûr vers la machine Linux. Il contient un secret.

Dans le dossier contenant le téléchargement :

```bash
chmod 600 install-maintenance-agent.sh
# Lire le script avant exécution, sans le coller dans un ticket ou un chat.
less install-maintenance-agent.sh
sudo bash install-maintenance-agent.sh
sudo systemctl status maintenance-agent --no-pager
sudo journalctl -u maintenance-agent -n 50 --no-pager
```

L'installateur crée `/etc/maintenance-agent/puller.yml` et le service `maintenance-agent`. Il démarre immédiatement, même sans sonde configurée. Vérifier la présence de `curl`, `jq`, `python3`, du module Python `yaml` et de `dmidecode` si une dépendance n'a pas été installée correctement.

## 3. Configurer les sondes

```bash
sudoedit /etc/maintenance-agent/puller.yml
```

Conserver les valeurs réelles `server_url` et `enrollment_token` générées par l'installateur ; remplacer la section `harvests` commentée par les sondes. Exemple complet, à adapter :

```yaml
server_url: "https://maintenance.exemple.fr"
enrollment_token: "REMPLACER_PAR_LE_JETON_DU_SITE"
interval_seconds: 300

harvests:
  - name: "Accueil intranet"
    equipment_name: "Serveur intranet"
    equipment_type: "Serveur"
    type: https
    url: "https://intranet.exemple.fr/"
    method: GET
    expected_status: 200
    timeout_seconds: 10
    insecure_skip_verify: false

  - name: "Interface switch"
    equipment_name: "Switch principal"
    equipment_type: "Switch"
    type: https
    url: "https://switch.exemple.fr/"
    method: GET
    expected_status: 200
    timeout_seconds: 5
    insecure_skip_verify: false
```

Utiliser des espaces, pas des tabulations. Choisir des URL de lecture sans effet de bord et ne mettre aucun mot de passe ou jeton dans leur URL : les cibles remontent dans l'application et les interventions. Une redirection 301/302 n'est pas suivie par l'agent actuel ; choisir l'URL finale ou le statut réellement attendu. Un succès HTTP ne vérifie pas le contenu de la page ni toutes les fonctions du service.

`equipment_name` est le libellé affiché, pas un rattachement automatique à une fiche d'inventaire. `equipment_type` sert aux regroupements et aux règles. Utiliser des noms de sondes distincts par équipement. Seules les sondes HTTP/HTTPS sont implémentées dans cet agent ; pas de ping, SNMP ou port TCP générique.

Commencer avec quelques sondes, un intervalle de 300 secondes et des délais de 5 à 10 secondes. Ne pas dépasser 50 sondes ; même en dessous, la limite totale de 20 Ko peut être atteinte. `inventory.enabled: false` n'a actuellement aucun effet.

Valider la syntaxe et appliquer :

```bash
sudo python3 -c 'import yaml; yaml.safe_load(open("/etc/maintenance-agent/puller.yml")); print("Syntaxe YAML OK")'
sudo chmod 700 /etc/maintenance-agent
sudo chmod 600 /etc/maintenance-agent/puller.yml
sudo systemctl restart maintenance-agent
sudo journalctl -u maintenance-agent -f
```

Cette validation contrôle seulement la syntaxe YAML. Vérifier manuellement les URL, valeurs positives et statuts. Les sondes sont relues au cycle suivant ; le redémarrage applique aussi un changement d'adresse serveur.

## 4. Variante Docker Compose

Le téléchargement Docker existe à l'adresse suivante, mais n'a pas de bouton dédié dans la page Agents actuelle :

```text
https://maintenance.exemple.fr/downloads/supervision-puller-docker?enrollmentToken=VOTRE_JETON
```

Télécharger le fichier dans un environnement privé : l'URL et le fichier contiennent le secret. Puis, sur la machine Linux :

```bash
chmod 600 install-supervision-puller-docker.sh
less install-supervision-puller-docker.sh
sudo bash install-supervision-puller-docker.sh
sudo chmod 700 /opt/maintenanceboard-puller
sudo chmod 600 /opt/maintenanceboard-puller/docker-compose.yml
sudoedit /opt/maintenanceboard-puller/config/puller.yml
```

Utiliser la configuration des sondes de l'étape 3. Contrôler puis redémarrer :

```bash
sudo docker compose -f /opt/maintenanceboard-puller/docker-compose.yml config --quiet
sudo docker compose -f /opt/maintenanceboard-puller/docker-compose.yml restart
sudo docker compose -f /opt/maintenanceboard-puller/docker-compose.yml ps
sudo docker compose -f /opt/maintenanceboard-puller/docker-compose.yml logs --tail=100 -f
```

Éviter `docker compose config` sans `--quiet` dans des journaux partagés : la configuration contient le jeton. Le répertoire `config/` conserve le jeton machine entre les recréations ; ne pas le supprimer. Le conteneur n'a pas la même vue réseau que l'hôte : `localhost` désigne le conteneur.

**Limite bloquante actuelle :** l'agent est retéléchargé à chaque démarrage avec l'enrollment. Un jeton expiré/désactivé empêche le redémarrage malgré un jeton machine valide. Le mode Docker ne permet donc pas encore le cycle sûr « enrôler puis désactiver l'enrollment ». Préférer systemd jusqu'au correctif, plutôt que conserver indéfiniment un secret actif.

Pour une future reconstruction contrôlée, exclure `config/` et `logs/` via `.dockerignore` avant le build. L'installateur actuel envoie déjà ces répertoires dans le contexte du premier build ; ne pas employer de constructeur distant avec cet installateur en l'état.

## 5. Vérifier le fonctionnement

1. Dans les logs, attendre **Token machine enregistré** puis **Check-in OK**. Sans sonde, un check-in peut réussir mais la page Supervision reste vide.
2. Dans **Agents**, vérifier l'identité et l'heure du dernier contact. Sur Linux, vérifier sans afficher le secret : `sudo test -s /etc/maintenance-agent/machine-token && echo "Jeton machine présent"`.
3. Dans **Supervision**, contrôler le nom, le type, le code HTTP, la latence et surtout la date du dernier contrôle.
4. Sur une sonde de test, mettre temporairement `expected_status: 201` alors que l'URL répond 200. Redémarrer ; vérifier l'état DOWN et la création d'une intervention. Rétablir 200, redémarrer et vérifier le retour UP. L'intervention reste à clôturer manuellement.
5. Pour tester un seuil, créer une règle de latence dans Supervision et vérifier son déclenchement. Les règles sont administrées par un administrateur.
6. Pour les notifications, configurer côté serveur `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, puis activer les notifications dans un navigateur compatible en HTTPS. Vérifier un envoi réel avec une nouvelle alerte. La déduplication multi-pullers et les destinations push doivent être corrigées avant d'en dépendre en production.
7. Tester un redémarrage de la machine Linux et la reprise des check-ins. **Arrêter le puller ne suffit pas actuellement à rendre ses sondes DOWN** : le dernier état reste affiché. Contrôler la date et prévoir une surveillance indépendante jusqu'au correctif.

## 6. Protéger les secrets et maintenir

En mode systemd, après plusieurs check-ins réussis avec le jeton machine, désactiver le jeton d'enregistrement dans Agents. Les check-ins machine restent autorisés. Retirer ensuite sa valeur de `puller.yml` et supprimer les copies du script téléchargé devenues inutiles. Ne pas faire cette désactivation sur le Docker actuel en espérant qu'il redémarre.

Sauvegarder de manière protégée la configuration et le jeton machine. Une restauration concerne **le même puller** ; un nouveau puller doit s'enrôler avec sa propre identité. Ne pas committer ces secrets dans Git.

Les installateurs réécrivent la configuration : ne pas les relancer pour une simple modification de sonde. Avant toute mise à jour, sauvegarder la configuration, vérifier les différences et prévoir le retour à la version précédente. Docker redéploie actuellement le script au redémarrage sans version figée : ce comportement doit être corrigé.

En cas de compromission, révoquer la **machine** dans Agents et désactiver le jeton d'enregistrement concerné. La révocation machine n'est pas une commande de redémarrage et bloque aussi le réenregistrement ; ne pas l'utiliser pour un dépannage ordinaire.

## Dépannage rapide

| Symptôme | Contrôle |
|---|---|
| Aucune sonde visible | `harvests` contient-il une liste active ? Les lignes d'exemple sont commentées par défaut. |
| Erreur connexion au serveur | Vérifier URL, DNS, certificat, accès réseau, token expiré/révoqué, liste IP et limites de débit. Consulter les logs serveur sans exposer les secrets. |
| DOWN avec erreur certificat | Installer la bonne autorité de certification, vérifier le nom DNS et la chaîne du certificat. |
| DOWN avec HTTP 301/302/401 | Choisir la bonne URL finale et vérifier le statut attendu ; ne pas annoncer 200 pour une page nécessitant une authentification. |
| Pas de notification | Vérifier VAPID, autorisation navigateur, abonnement et état de l'alerte. Les limites du rapport restent applicables. |
| Docker redémarre en boucle | Vérifier l'accès au téléchargement `agent.sh` et la validité de l'enrollment. |
| Remontées intermittentes sur un site | Le quota 60 requêtes/15 min est partagé par IP ; vérifier les autres agents derrière le même NAT. |
| UP malgré puller arrêté | Défaut connu de fraîcheur ; vérifier la date, ne pas interpréter les barres comme un historique réel. |
