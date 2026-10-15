# Suggestions de résolution et base de connaissances

La page **Base de connaissance** (`/knowledge-base.html`) existe déjà : un administrateur peut y créer des articles (titre, résumé, catégorie, mots-clés et contenu Markdown). Cocher **Proposer cette procédure lors d’un signalement** pour la rendre disponible aux demandeurs sans connexion. Les articles internes, plans réseau et plans d’adressage sont exclus des suggestions et des calculs de similarité.

Dans **Faire une demande → Signaler un problème**, la recherche utilise le problème et ses détails après une pause de 600 ms. Elle propose jusqu’à trois procédures consultables dans le formulaire. Une modification de la saisie annule la requête précédente et masque les anciens résultats. Aucun résultat ne remplit ou n’envoie la demande automatiquement.

## Service local économe en mémoire

La recherche par sens utilise Ollama et `embeddinggemma:300m-qat-q4_0`, un modèle multilingue compact. Aucun service cloud ni clé API n’est nécessaire. Le modèle est téléchargé explicitement par l’administrateur, puis chargé seulement au premier calcul. Sans configuration, les suggestions existantes par mots-clés restent actives.

Avec Docker Compose, définir dans `.env` :

```env
KNOWLEDGE_OLLAMA_URL=http://ollama:11434
KNOWLEDGE_EMBEDDING_MODEL=embeddinggemma:300m-qat-q4_0
KNOWLEDGE_MODEL_KEEP_ALIVE=30s
```

Puis démarrer le service facultatif, télécharger le modèle et recréer l’application pour prendre en compte la configuration :

```sh
docker compose --profile semantic up -d ollama
docker compose exec ollama ollama pull embeddinggemma:300m-qat-q4_0
docker compose up -d --build app
```

Le service Ollama n’expose pas de port sur l’hôte. Le profil le limite à **1 Go de RAM**, deux CPU, un modèle chargé et un calcul en parallèle. Le modèle pèse environ **239 Mo sur disque** ; la RAM réellement utilisée est supérieure et dépend de l’environnement. Si 1 Go ne suffit pas sur la machine cible, l’application revient aux mots-clés ; vérifier les journaux du conteneur avant d’ajuster la limite.

Hors Docker, installer Ollama sur le serveur de l’application, exécuter `ollama pull embeddinggemma:300m-qat-q4_0` et utiliser `KNOWLEDGE_OLLAMA_URL=http://127.0.0.1:11434`. La limite Docker de 1 Go ne s’applique pas à une installation native. Pour une instance Ollama dédiée, définir `OLLAMA_NUM_PARALLEL=1`, `OLLAMA_MAX_LOADED_MODELS=1` et `OLLAMA_MAX_QUEUE=2` dans son environnement.

Le modèle se décharge après 30 secondes d’inactivité ; `KNOWLEDGE_MODEL_KEEP_ALIVE=0` le décharge après chaque appel, au prix de rechargements plus fréquents. Aucun modèle n’est exécuté dans le processus Node.js. Son cache contient au plus 512 vecteurs compacts (environ 1,5 Mio pour 768 dimensions, hors métadonnées), uniquement en mémoire. Aucun index supplémentaire à installer.

## Classement et fonctionnement dégradé

Les articles longs sont découpés en passages avec chevauchement ; les calculs se font par lots de quatre maximum, avec deux threads. Les vecteurs sont réutilisés tant que le texte et le modèle restent identiques. Toute modification est prise en compte dès la recherche suivante ; toute suppression ou dépublication retire immédiatement l’article des candidats. Le cache est reconstruit après un redémarrage.

Le classement utilise la similarité cosinus et un seuil de 0,65. Ce score n’est pas une probabilité de résolution et doit être évalué avec les vraies procédures. Il peut y avoir zéro suggestion. La recherche ne génère aucune procédure : elle restitue uniquement des articles existants.

Le délai total de calcul est limité à huit secondes. Si le service est occupé, indisponible, renvoie des vecteurs invalides ou dépasse ce délai (notamment au premier chargement), l’application utilise les mots-clés et attend 30 secondes avant de réessayer après une erreur. Pour une grande base, plusieurs saisies peuvent être nécessaires à froid pour remplir le cache. L’envoi de la demande reste indépendant de la recherche.

L’API publique `/api/tickets/knowledge-suggestions?q=...&description=...` est limitée à 90 recherches par minute et par IP et renvoie `mode: semantic` ou `mode: lexical`. Les réponses ne sont pas mises en cache HTTP. Les textes saisis et les passages publiés sont transmis uniquement à l’URL Ollama configurée côté serveur ; les pièces jointes ne sont pas indexées.

Références : [API et recherche par embeddings Ollama](https://docs.ollama.com/capabilities/embeddings), [variantes et taille du modèle](https://ollama.com/library/embeddinggemma/tags).
