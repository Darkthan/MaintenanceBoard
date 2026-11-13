module.exports = document => {
  const topic = { type: 'object', additionalProperties: false, required: ['id', 'title', 'checked', 'notes', 'links'], properties: {
    id: { type: 'string', format: 'uuid' }, title: { type: 'string', minLength: 1, maxLength: 300 },
    checked: { type: 'boolean' }, notes: { type: 'string', maxLength: 20000 },
    links: { type: 'array', maxItems: 10, items: { type: 'object', additionalProperties: false, required: ['type', 'id'], properties: {
      type: { type: 'string', enum: ['orders', 'equipment', 'rooms', 'interventions', 'projects'] }, id: { type: 'string', format: 'uuid' }
    } } }
  } };
  const meeting = { type: 'object', additionalProperties: false, required: ['title', 'scheduledAt', 'status', 'topics'], properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 }, scheduledAt: { type: 'string', format: 'date-time', nullable: true },
    status: { type: 'string', enum: ['PLANNED', 'IN_PROGRESS', 'COMPLETED'] },
    topics: { type: 'array', maxItems: 100, description: 'Ordre des sujets ; 100 liens maximum au total. Ne jamais renvoyer preview dans une sauvegarde.', items: topic }
  } };
  const operation = (summary, responses, extra = {}) => ({ tags: ['Réunions'], summary,
    description: 'Comptes ADMIN et TECH actifs. Réunions partagées avec le service technique. Réponses non mises en cache.',
    responses: { ...responses, 401: { description: 'Non authentifié' }, 403: { description: 'Accès refusé' } }, ...extra });
  const body = schema => ({ requestBody: { required: true, content: { 'application/json': { schema } } } });
  document.paths['/meetings'] = {
    get: operation('Historique paginé des réunions', { 200: { description: 'data et pagination (30 réunions/page), sans notes ni aperçus' } }, {
      parameters: [{ name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } }, { name: 'status', in: 'query', schema: meeting.properties.status }]
    }),
    post: operation('Créer une réunion', { 201: { description: 'Réunion créée, version initiale 1' }, 400: { description: 'Document invalide' }, 404: { description: 'Référence indisponible' } }, body(meeting))
  };
  document.paths['/meetings/{id}'] = {
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    get: operation('Consulter une réunion et ses aperçus autorisés', { 200: { description: 'Sujets ordonnés ; chaque lien comporte preview (null si objet indisponible ou accès refusé)' }, 404: { description: 'Réunion introuvable' } }),
    patch: operation('Enregistrer le document complet avec sa version', { 200: { description: 'Version incrémentée et aperçus recalculés' }, 400: { description: 'Document invalide' }, 404: { description: 'Réunion ou référence indisponible' }, 409: { description: 'MEETING_CONFLICT : recharger après avoir conservé les notes locales' } }, body({ ...meeting, required: [...meeting.required, 'version'], properties: { ...meeting.properties, version: { type: 'integer', minimum: 1 } } }))
  };
  document.paths['/meetings/link-preview'] = {
    post: operation('Résoudre un lien interne sans requête réseau externe', { 200: { description: 'type, id, preview (titre, statut, référence, URL canonique ; montant TTC et devise pour les commandes)' }, 400: { description: 'URL non admise' }, 404: { description: 'Objet absent ou accès refusé, même réponse' } }, body({ type: 'object', required: ['url'], properties: { url: { type: 'string', maxLength: 2048, example: '/orders.html?id=00000000-0000-4000-8000-000000000000' } } }))
  };
  document.paths['/meetings/link-search'] = {
    get: operation('Rechercher une fiche à mentionner dans une réunion', { 200: { description: 'data (10 références avec aperçu autorisé au maximum) et hasMore ; aucune donnée de fiche non autorisée' }, 400: { description: 'Type, recherche ou page invalide' } }, {
      parameters: [
        { name: 'type', in: 'query', required: true, schema: topic.properties.links.items.properties.type },
        { name: 'q', in: 'query', schema: { type: 'string', maxLength: 100 }, description: 'Nom, fournisseur, identifiant ou référence de commande' },
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 10000, default: 1 } }
      ]
    })
  };
};
