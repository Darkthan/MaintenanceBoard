const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { readSettings } = require('../utils/settings');

const router = express.Router();
const prisma = require('../lib/prisma');
const orderAttachmentModel = prisma.orderAttachment;
const signatureRequestModel = prisma.signatureRequest;

const EQUIPMENT_STATUS_LABELS = {
  ACTIVE: 'Actif',
  INACTIVE: 'Inactif',
  REPAIR: 'En reparation',
  DECOMMISSIONED: 'Declasse'
};

const INTERVENTION_STATUS_LABELS = {
  OPEN: 'Ouvert',
  IN_PROGRESS: 'En cours',
  RESOLVED: 'Resolu',
  CLOSED: 'Ferme'
};

const ORDER_STATUS_LABELS = {
  PENDING: 'En attente',
  ORDERED: 'Commande',
  PARTIAL: 'Partielle',
  RECEIVED: 'Recue',
  CANCELLED: 'Annulee'
};

const ATTACHMENT_CATEGORY_LABELS = {
  INVOICE: 'Facture',
  SIGNED_PO: 'BC signe',
  QUOTE_TO_SIGN: 'Devis a signer',
  SIGNED_QUOTE: 'Devis signe',
  TO_ENTER: 'A saisir',
  OTHER: 'Autre'
};

const SIGNATURE_REQUEST_STATUS_LABELS = {
  PENDING: 'A signer',
  SIGNED: 'Signe',
  EXPIRED: 'Expire',
  CANCELLED: 'Annule'
};

const PRIORITY_LABELS = {
  LOW: 'Basse',
  NORMAL: 'Normale',
  HIGH: 'Haute',
  CRITICAL: 'Critique'
};

const ACTIONS = [
  {
    id: 'action:new-intervention',
    title: 'Nouvelle intervention',
    subtitle: 'Creer et assigner une intervention',
    href: '/interventions.html?action=create',
    keywords: ['intervention', 'ticket', 'incident', 'panne', 'creer'],
    roles: ['ADMIN', 'TECH'],
    preview: {
      title: 'Creation rapide',
      description: 'Ouvre directement le formulaire de creation d intervention.'
    }
  },
  {
    id: 'action:new-order',
    title: 'Nouvelle commande',
    subtitle: 'Creer un bon de commande',
    href: '/orders.html?action=create',
    keywords: ['commande', 'achat', 'bon', 'fournisseur', 'creer'],
    roles: ['ADMIN', 'TECH'],
    preview: {
      title: 'Creation rapide',
      description: 'Ouvre directement le formulaire de creation de commande.'
    }
  },
  {
    id: 'action:repair-equipment',
    title: 'Equipements en reparation',
    subtitle: 'Voir les equipements avec le statut REPAIR',
    href: '/equipment.html?status=REPAIR',
    keywords: ['equipement', 'materiel', 'reparation', 'panne', 'repair'],
    roles: ['ADMIN', 'TECH'],
    preview: {
      title: 'Filtre rapide',
      description: 'Affiche la liste des equipements actuellement en reparation.'
    }
  },
  {
    id: 'action:pending-discovery',
    title: 'Validations d agents',
    subtitle: 'Voir les equipements detectes en attente',
    href: '/equipment.html?discoveryStatus=PENDING',
    keywords: ['agent', 'validation', 'pending', 'detection', 'inventaire'],
    roles: ['ADMIN', 'TECH'],
    preview: {
      title: 'Filtre rapide',
      description: 'Ouvre la file des equipements detectes a confirmer.'
    }
  },
  {
    id: 'action:dashboard',
    title: 'Tableau de bord',
    subtitle: 'Revenir a la vue d ensemble',
    href: '/index.html',
    keywords: ['dashboard', 'accueil', 'tableau de bord', 'home'],
    roles: ['ADMIN', 'TECH'],
    preview: {
      title: 'Navigation',
      description: 'Revient sur la vue synthese de MaintenanceBoard.'
    }
  },
  {
    id: 'action:downloads',
    title: 'Telechargements agent',
    subtitle: 'Acceder aux scripts et packages de deploiement',
    href: '/downloads.html',
    keywords: ['document', 'documents', 'telechargement', 'download', 'agent', 'script', 'package'],
    roles: ['ADMIN', 'TECH'],
    preview: {
      title: 'Documents techniques',
      description: 'Ouvre la page des scripts et packages de deploiement agent.'
    }
  },
  {
    id: 'action:agents',
    title: 'Agents',
    subtitle: 'Superviser les machines remontees par agent',
    href: '/agents.html',
    keywords: ['agent', 'agents', 'monitoring', 'supervision', 'machine', 'poste', 'espace disque', 'disque'],
    roles: ['ADMIN', 'TECH'],
    preview: {
      title: 'Supervision agent',
      description: 'Ouvre la vue des agents, du dernier check-in et des alertes de supervision.'
    }
  },
  {
    id: 'action:signatures',
    title: 'Signatures',
    subtitle: 'Voir les documents signes ou a signer',
    href: '/signatures.html',
    keywords: ['signature', 'document', 'documents', 'signe', 'signer', 'pdf'],
    roles: ['ADMIN', 'TECH'],
    preview: {
      title: 'Documents',
      description: 'Ouvre la liste des documents en signature et deja signes.'
    }
  },
  {
    id: 'action:stock',
    title: 'Stock',
    subtitle: 'Consulter le stock et les alertes de seuil',
    href: '/stock.html',
    keywords: ['stock', 'consommable', 'article', 'inventaire', 'alerte', 'seuil'],
    roles: ['ADMIN', 'TECH'],
    preview: {
      title: 'Stock',
      description: 'Ouvre la gestion de stock et les alertes de seuil.'
    }
  },
  {
    id: 'action:suppliers',
    title: 'Fournisseurs',
    subtitle: 'Consulter les fournisseurs et leurs contacts',
    href: '/suppliers.html',
    keywords: ['fournisseur', 'fournisseurs', 'contact', 'achat', 'commande', 'societe'],
    roles: ['ADMIN', 'TECH'],
    preview: {
      title: 'Fournisseurs',
      description: 'Ouvre l annuaire fournisseurs et leurs informations de contact.'
    }
  },
  {
    id: 'action:assign-rooms',
    title: 'Affectation des salles',
    subtitle: 'Traiter les equipements a rattacher a une salle',
    href: '/assign-rooms.html',
    keywords: ['affectation', 'salle', 'salles', 'rattacher', 'assigner', 'agent', 'decouverte'],
    roles: ['ADMIN', 'TECH'],
    preview: {
      title: 'Affectation',
      description: 'Ouvre l outil d affectation manuelle des salles.'
    }
  },
  {
    id: 'action:settings',
    title: 'Parametres',
    subtitle: 'Configurer l application et les integrations',
    href: '/settings.html',
    keywords: ['parametre', 'parametres', 'configuration', 'smtp', 'application', 'reglage'],
    roles: ['ADMIN'],
    preview: {
      title: 'Configuration',
      description: 'Ouvre les parametres globaux de MaintenanceBoard.'
    }
  },
  {
    id: 'action:settings-users',
    title: 'Parametres - Utilisateurs',
    subtitle: 'Gerer les comptes et les acces',
    href: '/settings.html?tab=users',
    keywords: ['parametres', 'utilisateur', 'utilisateurs', 'compte', 'acces', 'role', 'admin', 'tech'],
    roles: ['ADMIN'],
    preview: {
      title: 'Onglet utilisateurs',
      description: 'Ouvre les parametres sur la gestion des comptes utilisateurs.'
    }
  },
  {
    id: 'action:settings-email',
    title: 'Parametres - Emails',
    subtitle: 'Configurer SMTP, SSL/TLS et STARTTLS',
    href: '/settings.html?tab=email',
    keywords: ['parametres', 'email', 'emails', 'smtp', 'starttls', 'ssl', 'tls', 'expediteur', 'notification'],
    roles: ['ADMIN'],
    preview: {
      title: 'Onglet emails',
      description: 'Ouvre la configuration SMTP et le test d envoi.'
    }
  },
  {
    id: 'action:settings-database',
    title: 'Parametres - Base de donnees',
    subtitle: 'Export et import des donnees',
    href: '/settings.html?tab=database',
    keywords: ['parametres', 'base de donnees', 'database', 'export', 'import', 'sauvegarde', 'restauration'],
    roles: ['ADMIN'],
    preview: {
      title: 'Onglet base de donnees',
      description: 'Ouvre les outils d export, d import et les statistiques de donnees.'
    }
  },
  {
    id: 'action:settings-po',
    title: 'Parametres - Bon de commande',
    subtitle: 'Configurer le modele et les emails compta',
    href: '/settings.html?tab=po',
    keywords: ['parametres', 'bon de commande', 'commande', 'po', 'modele', 'compta', 'facture', 'devis'],
    roles: ['ADMIN'],
    preview: {
      title: 'Onglet bon de commande',
      description: 'Ouvre la configuration du modele de bon de commande et des documents comptables.'
    }
  },
  {
    id: 'action:settings-security',
    title: 'Parametres - Securite',
    subtitle: 'WebAuthn, passkeys et fail2ban',
    href: '/settings.html?tab=security',
    keywords: ['parametres', 'securite', 'webauthn', 'passkey', 'passkeys', 'fail2ban', 'ip', 'liste blanche', 'liste noire'],
    roles: ['ADMIN'],
    preview: {
      title: 'Onglet securite',
      description: 'Ouvre les parametres WebAuthn et la protection fail2ban.'
    }
  },
  {
    id: 'action:users',
    title: 'Utilisateurs',
    subtitle: 'Gerer les comptes et les acces',
    href: '/settings.html?tab=users',
    keywords: ['utilisateur', 'utilisateurs', 'compte', 'acces', 'role', 'admin', 'tech'],
    roles: ['ADMIN'],
    preview: {
      title: 'Gestion des acces',
      description: 'Ouvre la liste des utilisateurs et leurs droits.'
    }
  },
  {
    id: 'action:new-room',
    title: 'Nouvelle salle',
    subtitle: 'Ajouter une salle au parc',
    href: '/rooms.html?action=create',
    keywords: ['salle', 'piece', 'batiment', 'creer'],
    roles: ['ADMIN'],
    preview: {
      title: 'Creation rapide',
      description: 'Ouvre le formulaire de creation d une nouvelle salle.'
    }
  },
  {
    id: 'action:new-equipment',
    title: 'Nouvel equipement',
    subtitle: 'Ajouter un equipement a l inventaire',
    href: '/equipment.html?action=create',
    keywords: ['equipement', 'ordinateur', 'inventaire', 'creer'],
    roles: ['ADMIN'],
    preview: {
      title: 'Creation rapide',
      description: 'Ouvre le formulaire de creation d un equipement.'
    }
  },
  {
    id: 'action:new-supplier',
    title: 'Nouveau fournisseur',
    subtitle: 'Ajouter un fournisseur',
    href: '/suppliers.html?action=create',
    keywords: ['fournisseur', 'creer', 'ajouter', 'contact', 'societe'],
    roles: ['ADMIN'],
    preview: {
      title: 'Creation rapide',
      description: 'Ouvre le formulaire de creation d un fournisseur.'
    }
  },
  {
    id: 'action:report',
    title: 'Signaler un incident',
    subtitle: 'Ouvrir le formulaire public de signalement',
    href: '/report.html',
    keywords: ['signalement', 'incident', 'ticket', 'declarer', 'formulaire', 'report'],
    roles: ['ADMIN', 'TECH'],
    preview: {
      title: 'Formulaire public',
      description: 'Ouvre le formulaire public de signalement d incident.'
    }
  },
  {
    id: 'action:my-tickets',
    title: 'Mes signalements',
    subtitle: 'Suivre les tickets publics par lien magique',
    href: '/my-tickets.html',
    keywords: ['tickets', 'ticket', 'signalements', 'suivi', 'public', 'mes tickets'],
    roles: ['ADMIN', 'TECH'],
    preview: {
      title: 'Suivi public',
      description: 'Ouvre la page de suivi des tickets publics.'
    }
  },
  {
    id: 'action:api-docs',
    title: 'Documentation API',
    subtitle: 'Consulter Swagger et les routes disponibles',
    href: '/api-docs',
    keywords: ['api', 'swagger', 'documentation', 'docs', 'routes', 'integration'],
    roles: ['ADMIN', 'TECH'],
    preview: {
      title: 'API Docs',
      description: 'Ouvre la documentation Swagger de l application.'
    }
  },
  {
    id: 'action:export-suppliers',
    title: 'Export fournisseurs',
    subtitle: 'Telecharger les donnees fournisseurs',
    href: '/downloads/export/suppliers',
    keywords: ['export', 'fichier', 'csv', 'excel', 'download', 'telecharger', 'fournisseurs'],
    roles: ['ADMIN', 'TECH'],
    preview: {
      title: 'Fichier export',
      description: 'Telecharge l export des fournisseurs.'
    }
  },
  {
    id: 'action:export-stock',
    title: 'Export stock',
    subtitle: 'Telecharger les articles de stock',
    href: '/downloads/export/stock',
    keywords: ['export', 'fichier', 'csv', 'excel', 'download', 'telecharger', 'stock', 'articles'],
    roles: ['ADMIN', 'TECH'],
    preview: {
      title: 'Fichier export',
      description: 'Telecharge l export du stock.'
    }
  },
  {
    id: 'action:export-stock-movements',
    title: 'Export mouvements de stock',
    subtitle: 'Telecharger l historique de stock',
    href: '/downloads/export/stock-movements',
    keywords: ['export', 'fichier', 'csv', 'excel', 'download', 'telecharger', 'stock', 'mouvements', 'historique'],
    roles: ['ADMIN', 'TECH'],
    preview: {
      title: 'Fichier export',
      description: 'Telecharge l historique des mouvements de stock.'
    }
  },
  {
    id: 'action:export-equipment',
    title: 'Export equipements',
    subtitle: 'Telecharger l inventaire materiel',
    href: '/downloads/export/equipment',
    keywords: ['export', 'fichier', 'csv', 'excel', 'download', 'telecharger', 'equipements', 'inventaire'],
    roles: ['ADMIN', 'TECH'],
    preview: {
      title: 'Fichier export',
      description: 'Telecharge l export des equipements.'
    }
  }
];

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function buildSearchBlob(parts) {
  return normalizeText(parts.filter(Boolean).join(' '));
}

function scoreMatch(query, ...parts) {
  if (!query) return 0;
  const haystack = buildSearchBlob(parts);
  if (!haystack) return 0;
  if (haystack === query) return 120;
  if (haystack.startsWith(query)) return 95;
  if (haystack.includes(` ${query}`)) return 78;
  if (haystack.includes(query)) return 64;

  const words = query.split(/\s+/).filter(Boolean);
  if (!words.length) return 0;

  let score = 0;
  for (const word of words) {
    if (haystack.startsWith(word)) score += 20;
    else if (haystack.includes(` ${word}`)) score += 14;
    else if (haystack.includes(word)) score += 8;
  }
  return score;
}

function formatDate(date) {
  if (!date) return null;
  return new Date(date).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

function filterAndRank(results, query, limit) {
  if (!query) return results.slice(0, limit);

  return results
    .map(result => ({
      ...result,
      score: scoreMatch(query, result.title, result.subtitle, result.searchText)
    }))
    .filter(result => !query || result.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.title).localeCompare(String(b.title), 'fr');
    })
    .slice(0, limit);
}

function getOrderNumber(order, poPrefix) {
  return `${poPrefix}${new Date(order.createdAt).getFullYear()}-${String(order.id).slice(-6).toUpperCase()}`;
}

function extractOrderIdHint(rawQuery, poPrefix) {
  const compactQuery = String(rawQuery || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const compactPrefix = String(poPrefix || 'BC-').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!compactQuery) return '';

  if (compactPrefix && compactQuery.startsWith(compactPrefix) && compactQuery.length >= compactPrefix.length + 4) {
    return compactQuery.slice(-6);
  }

  if (/^BC[0-9A-Z]+$/.test(compactQuery) && compactQuery.length >= 6) {
    return compactQuery.slice(-6);
  }

  if (!/\d/.test(compactQuery)) return '';

  const trailingToken = compactQuery.match(/([A-Z0-9]{4,6})$/);
  return trailingToken ? trailingToken[1] : '';
}

function buildActions(query, role, limit) {
  const base = ACTIONS
    .filter(action => action.roles.includes(role))
    .map(action => ({
      id: action.id,
      type: 'action',
      group: 'Actions rapides',
      title: action.title,
      subtitle: action.subtitle,
      href: action.href,
      openMode: 'direct',
      preview: action.preview,
      searchText: action.keywords.join(' ')
    }));

  return filterAndRank(base, query, limit);
}

function stripDocumentKeywords(value) {
  return normalizeText(
    String(value || '')
      .replace(/\b(non\s+sign[ée]s?|a\s+signer|documents?|pdf|bons?|commandes?|bc|signatures?|signer|sign[ée]s?|devis|factures?|pi[eè]ces?\s+jointes?|fichiers?)\b/gi, ' ')
  ).trim();
}

function detectDocumentStateIntent(value) {
  const normalized = normalizeText(value);
  if (
    normalized.includes('non signe') ||
    normalized.includes('a signer') ||
    normalized.includes('a faire signer') ||
    normalized.includes('en attente de signature')
  ) {
    return 'unsigned';
  }
  if (
    /\bsigne\b/.test(normalized) ||
    /\bsignee\b/.test(normalized) ||
    /\bsignes\b/.test(normalized) ||
    /\bsigned\b/.test(normalized)
  ) {
    return 'signed';
  }
  return null;
}

function getAttachmentSignatureMeta(category) {
  if (category === 'SIGNED_PO' || category === 'SIGNED_QUOTE') {
    return { label: 'Signe', keywords: ['document signe', 'signature valide', 'signe'] };
  }
  if (category === 'QUOTE_TO_SIGN') {
    return { label: 'A signer', keywords: ['document non signe', 'a signer', 'signature en attente'] };
  }
  return { label: null, keywords: [] };
}

function getAttachmentCategoryFilter(stateIntent) {
  if (stateIntent === 'signed') return ['SIGNED_PO', 'SIGNED_QUOTE'];
  if (stateIntent === 'unsigned') return ['QUOTE_TO_SIGN'];
  return null;
}

function buildDocumentRequestHref(sigReq) {
  if (sigReq.status === 'SIGNED' && sigReq.signedFileStoredAs) {
    return { href: `/api/signatures/${sigReq.id}/download`, target: '_blank', openMode: 'direct' };
  }
  if (sigReq.sourceFileStoredAs && sigReq.token) {
    return { href: `/api/sign/${sigReq.token}/source`, target: '_blank', openMode: 'direct' };
  }
  return { href: '/signatures.html', target: null, openMode: 'preview' };
}

function tableMissing(err) {
  return err?.code === 'P2021';
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const rawQuery = String(req.query.q || '').trim();
    const query = normalizeText(rawQuery);
    const poTemplate = readSettings().poTemplate || {};
    const poPrefix = String(poTemplate.poPrefix || 'BC-');
    const orderIdHint = extractOrderIdHint(rawQuery, poPrefix);
    const strippedQuery = stripDocumentKeywords(rawQuery);
    const documentStateIntent = detectDocumentStateIntent(rawQuery);
    const documentIntent = /\b(document|documents|pdf|bons?|commandes?|bc|signature|signer|signe|signee|signes|devis|facture|piece|pieces|jointe|jointes|fichier|fichiers)\b/.test(query) || !!documentStateIntent;
    const limit = Math.min(8, Math.max(4, parseInt(req.query.limit, 10) || 6));
    const actionLimit = query ? Math.min(5, limit) : limit;
    const floorQuery = parseInt(rawQuery, 10);
    const orderSearchTerm = strippedQuery || rawQuery;
    const broadDocumentMode = documentIntent && !strippedQuery;
    const attachmentCategoryFilter = getAttachmentCategoryFilter(documentStateIntent);
    const candidateLimit = Math.min(160, Math.max(limit * 12, 72));

    const actions = buildActions(query, req.user.role, actionLimit);

    if (!query) {
      return res.json({ query: '', results: actions });
    }

    const techRestriction = req.user.role === 'TECH' ? { techId: req.user.id } : {};
    const signatureWhereBase = req.user.role === 'ADMIN' ? { orderId: null } : { orderId: null, createdBy: req.user.id };

    const [rooms, equipment, interventions, orders, attachments, signatureDocuments, suppliers, stockItems, users] = await Promise.all([
      prisma.room.findMany({
        take: candidateLimit,
        orderBy: [{ building: 'asc' }, { number: 'asc' }],
        include: {
          _count: { select: { equipment: true, interventions: true } }
        }
      }),
      prisma.equipment.findMany({
        take: candidateLimit,
        orderBy: { updatedAt: 'desc' },
        include: {
          room: { select: { id: true, name: true, number: true } },
          _count: { select: { interventions: true } }
        }
      }),
      prisma.intervention.findMany({
        where: techRestriction,
        take: candidateLimit,
        orderBy: { createdAt: 'desc' },
        include: {
          room: { select: { id: true, name: true, number: true } },
          equipment: { select: { id: true, name: true, type: true } },
          tech: { select: { id: true, name: true } }
        }
      }),
      prisma.order.findMany({
        where: {},
        take: Math.max(candidateLimit, documentIntent ? limit + 12 : limit + 6),
        orderBy: { createdAt: 'desc' },
        include: {
          requester: { select: { id: true, name: true } },
          _count: { select: { items: true } }
        }
      }),
      orderAttachmentModel
        ? orderAttachmentModel.findMany({
            where: {
              ...(attachmentCategoryFilter ? { category: { in: attachmentCategoryFilter } } : {})
            },
            take: Math.max(candidateLimit, documentIntent ? limit + 16 : limit + 8),
            orderBy: { createdAt: 'desc' },
            include: {
              order: {
                select: {
                  id: true,
                  title: true,
                  supplier: true,
                  createdAt: true,
                  requester: { select: { name: true } }
                }
              },
              uploader: { select: { name: true } }
            }
          }).catch(err => tableMissing(err) ? [] : Promise.reject(err))
        : Promise.resolve([]),
      signatureRequestModel
        ? signatureRequestModel.findMany({
            where: {
              ...signatureWhereBase,
              ...(documentStateIntent === 'signed'
                ? { status: 'SIGNED' }
                : documentStateIntent === 'unsigned'
                  ? { status: { in: ['PENDING', 'EXPIRED', 'CANCELLED'] } }
                  : {})
            },
            take: Math.max(candidateLimit, documentIntent ? limit + 16 : limit + 8),
            orderBy: { createdAt: 'desc' },
            include: {
              creator: { select: { name: true } }
            }
          }).catch(err => tableMissing(err) ? [] : Promise.reject(err))
        : Promise.resolve([]),
      prisma.supplier.findMany({
        take: candidateLimit,
        orderBy: { name: 'asc' },
        include: {
          _count: { select: { orders: true, equipment: true } }
        }
      }),
      prisma.stockItem.findMany({
        take: candidateLimit,
        orderBy: { updatedAt: 'desc' },
        include: {
          supplier: { select: { id: true, name: true } }
        }
      }),
      req.user.role === 'ADMIN'
        ? prisma.user.findMany({
            take: candidateLimit,
            orderBy: { name: 'asc' },
            include: {
              _count: { select: { interventions: true, passkeys: true } }
            }
          })
        : Promise.resolve([])
    ]);

    const roomResults = filterAndRank(rooms.map(room => ({
      id: `room:${room.id}`,
      type: 'room',
      group: 'Salles',
      title: room.name,
      subtitle: [room.building, room.number ? `Salle ${room.number}` : null].filter(Boolean).join(' · ') || 'Salle',
      href: `/rooms.html?focus=${encodeURIComponent(room.id)}`,
      openMode: 'preview',
      preview: {
        title: room.name,
        description: room.description || 'Consulter la fiche salle et ses equipements.',
        lines: [
          [room.building, room.number ? `Salle ${room.number}` : null, room.floor != null ? `Etage ${room.floor}` : null].filter(Boolean).join(' · '),
          `${room._count.equipment} equipement(s) · ${room._count.interventions} intervention(s)`
        ].filter(Boolean)
      },
      searchText: [room.name, room.building, room.number, room.floor, room.description].filter(Boolean).join(' ')
    })), query, limit);

    const equipmentResults = filterAndRank(equipment.map(item => ({
      id: `equipment:${item.id}`,
      type: 'equipment',
      group: 'Equipements',
      title: item.name,
      subtitle: [item.type, item.room ? `${item.room.name}${item.room.number ? ` (${item.room.number})` : ''}` : 'Non assigne'].join(' · '),
      href: `/equipment.html?focus=${encodeURIComponent(item.id)}`,
      openMode: 'preview',
      preview: {
        title: item.name,
        description: [item.brand, item.model].filter(Boolean).join(' ') || 'Consulter la fiche equipement.',
        lines: [
          item.serialNumber ? `S/N ${item.serialNumber}` : null,
          item.room ? `Salle : ${item.room.name}${item.room.number ? ` (${item.room.number})` : ''}` : 'Salle : Non assigne',
          `${item._count.interventions} intervention(s)`
        ].filter(Boolean),
        badges: [EQUIPMENT_STATUS_LABELS[item.status] || item.status]
      },
      searchText: [
        item.name,
        item.type,
        item.brand,
        item.model,
        item.serialNumber,
        item.agentHostname,
        item.room?.name,
        item.room?.number
      ].filter(Boolean).join(' ')
    })), query, limit);

    const interventionResults = filterAndRank(interventions.map(item => ({
      id: `intervention:${item.id}`,
      type: 'intervention',
      group: 'Interventions',
      title: item.title,
      subtitle: [item.room?.name, item.equipment?.name, formatDate(item.createdAt)].filter(Boolean).join(' · ') || 'Intervention',
      href: `/interventions.html?focus=${encodeURIComponent(item.id)}`,
      openMode: 'preview',
      preview: {
        title: item.title,
        description: item.description || 'Consulter l intervention detaillee.',
        lines: [
          item.room ? `Salle : ${item.room.name}${item.room.number ? ` (${item.room.number})` : ''}` : null,
          item.equipment ? `Equipement : ${item.equipment.name}` : null,
          `Technicien : ${item.tech?.name || 'N/A'}`
        ].filter(Boolean),
        badges: [
          INTERVENTION_STATUS_LABELS[item.status] || item.status,
          PRIORITY_LABELS[item.priority] || item.priority
        ]
      },
      searchText: [
        item.title,
        item.description,
        item.room?.name,
        item.room?.number,
        item.equipment?.name,
        item.equipment?.type,
        item.tech?.name,
        item.status,
        item.priority
      ].filter(Boolean).join(' ')
    })), query, limit);

    const orderResults = filterAndRank(orders.map(order => {
      const orderNumber = getOrderNumber(order, poPrefix);
      return ({
      id: `order:${order.id}`,
      type: 'order',
      group: 'Commandes',
      title: order.title,
      subtitle: [orderNumber, order.supplier, formatDate(order.createdAt)].filter(Boolean).join(' · ') || 'Commande',
      href: `/orders.html?focus=${encodeURIComponent(order.id)}`,
      openMode: 'preview',
      preview: {
        title: order.title,
        description: order.description || 'Ouvrir la commande et ses lignes.',
        lines: [
          `Numero : ${orderNumber}`,
          order.supplier ? `Fournisseur : ${order.supplier}` : null,
          `Demandeur : ${order.requester?.name || 'N/A'}`,
          `${order._count.items} article(s)`
        ].filter(Boolean),
        badges: [ORDER_STATUS_LABELS[order.status] || order.status]
      },
      searchText: [order.title, orderNumber, order.supplier, order.description, order.requester?.name, order.deploymentTags].filter(Boolean).join(' ')
    });
    }), query, limit);

    const documentResults = filterAndRank(orders.map(order => {
      const orderNumber = getOrderNumber(order, poPrefix);
      return ({
      id: `document:order:${order.id}`,
      type: 'document',
      group: 'Documents',
      title: `Bon de commande - ${order.title}`,
      subtitle: [orderNumber, order.supplier, formatDate(order.createdAt)].filter(Boolean).join(' · ') || 'Document de commande',
      href: `/api/orders/${order.id}/pdf`,
      openMode: 'direct',
      target: '_blank',
      preview: {
        title: `Bon de commande ${orderNumber}`,
        description: `Ouvre la version imprimable du bon de commande pour ${order.title}.`,
        lines: [
          `Numero : ${orderNumber}`,
          order.supplier ? `Fournisseur : ${order.supplier}` : null,
          `Demandeur : ${order.requester?.name || 'N/A'}`,
          `${order._count.items} article(s)`
        ].filter(Boolean),
        badges: ['PDF', 'Non signe', ORDER_STATUS_LABELS[order.status] || order.status]
      },
      searchText: [
        'document pdf bon de commande non signe a signer',
        orderNumber,
        order.title,
        order.supplier,
        order.description,
        order.requester?.name,
        order.deploymentTags
      ].filter(Boolean).join(' ')
    });
    }), query, limit);

    const attachmentDocumentResults = filterAndRank(attachments.map(att => {
      const orderNumber = getOrderNumber(att.order, poPrefix);
      const categoryLabel = ATTACHMENT_CATEGORY_LABELS[att.category] || att.category;
      const signatureMeta = getAttachmentSignatureMeta(att.category);
      return ({
        id: `document:attachment:${att.id}`,
        type: 'document',
        group: 'Documents',
        title: att.filename,
        subtitle: [categoryLabel, orderNumber, att.order?.title].filter(Boolean).join(' · ') || 'Document joint',
        href: `/api/orders/${att.orderId}/attachments/${att.id}`,
        openMode: 'direct',
        target: '_blank',
        preview: {
          title: att.filename,
          description: `Ouvre le document joint de la commande ${att.order?.title || orderNumber}.`,
          lines: [
            `Categorie : ${categoryLabel}`,
            att.order?.title ? `Commande : ${att.order.title}` : null,
            att.order?.supplier ? `Fournisseur : ${att.order.supplier}` : null,
            att.uploader?.name ? `Depose par : ${att.uploader.name}` : null
          ].filter(Boolean),
          badges: [categoryLabel, ...(signatureMeta.label ? [signatureMeta.label] : [])]
        },
        searchText: [
          'document piece jointe fichier',
          categoryLabel,
          signatureMeta.label,
          ...signatureMeta.keywords,
          orderNumber,
          att.filename,
          att.order?.title,
          att.order?.supplier,
          att.order?.requester?.name,
          att.uploader?.name
        ].filter(Boolean).join(' ')
      });
    }), query, limit);

    const signatureDocumentResults = filterAndRank(signatureDocuments.map(sigReq => {
      const statusLabel = SIGNATURE_REQUEST_STATUS_LABELS[sigReq.status] || sigReq.status;
      const hrefMeta = buildDocumentRequestHref(sigReq);
      return ({
        id: `document:signature:${sigReq.id}`,
        type: 'document',
        group: 'Documents',
        title: sigReq.signedFilename || sigReq.sourceFilename || sigReq.documentTitle || 'Document',
        subtitle: [statusLabel, sigReq.recipientName, formatDate(sigReq.createdAt)].filter(Boolean).join(' · ') || 'Document en signature',
        href: hrefMeta.href,
        openMode: hrefMeta.openMode,
        ...(hrefMeta.target ? { target: hrefMeta.target } : {}),
        preview: {
          title: sigReq.documentTitle || sigReq.sourceFilename || 'Document',
          description: sigReq.documentNotes || 'Ouvre le document ou la demande de signature correspondante.',
          lines: [
            `Statut : ${statusLabel}`,
            sigReq.recipientName ? `Destinataire : ${sigReq.recipientName}` : null,
            sigReq.recipientEmail ? `Email : ${sigReq.recipientEmail}` : null,
            sigReq.signatureId ? `Identifiant : ${sigReq.signatureId}` : null
          ].filter(Boolean),
          badges: [statusLabel, sigReq.signatureId ? 'Certifie' : 'Signature']
        },
        searchText: [
          'document signature',
          statusLabel,
          sigReq.status === 'SIGNED' ? 'document signe signature valide' : 'document non signe a signer signature en attente',
          sigReq.documentTitle,
          sigReq.documentNotes,
          sigReq.sourceFilename,
          sigReq.signedFilename,
          sigReq.recipientName,
          sigReq.recipientEmail,
          sigReq.signatureId,
          sigReq.creator?.name
        ].filter(Boolean).join(' ')
      });
    }), query, limit);

    const supplierResults = filterAndRank(suppliers.map(s => ({
      id: `supplier:${s.id}`,
      type: 'supplier',
      group: 'Fournisseurs',
      title: s.name,
      subtitle: [s.contact, s.email].filter(Boolean).join(' · ') || 'Fournisseur',
      href: `/suppliers.html?focus=${encodeURIComponent(s.id)}`,
      openMode: 'preview',
      preview: {
        title: s.name,
        description: s.notes || 'Consulter la fiche fournisseur.',
        lines: [
          s.contact ? `Contact : ${s.contact}` : null,
          s.email ? `Email : ${s.email}` : null,
          s.phone ? `Tel : ${s.phone}` : null,
          s.website ? `Web : ${s.website}` : null,
          `${s._count.orders} commande(s) · ${s._count.equipment} equipement(s)`
        ].filter(Boolean)
      },
      searchText: [s.name, s.contact, s.email, s.phone, s.address, s.notes].filter(Boolean).join(' ')
    })), query, limit);

    const stockResults = filterAndRank(stockItems.map(item => ({
      id: `stock:${item.id}`,
      type: 'stock',
      group: 'Stock',
      title: item.name,
      subtitle: [item.category, item.reference, item.supplier?.name].filter(Boolean).join(' · ') || 'Article',
      href: `/stock.html?focus=${encodeURIComponent(item.id)}`,
      openMode: 'preview',
      preview: {
        title: item.name,
        description: item.description || 'Consulter la fiche stock.',
        lines: [
          item.reference ? `Reference : ${item.reference}` : null,
          item.category ? `Categorie : ${item.category}` : null,
          `Quantite : ${item.quantity}${item.minQuantity > 0 ? ` (min. ${item.minQuantity})` : ''}`,
          item.location ? `Emplacement : ${item.location}` : null,
          item.supplier?.name ? `Fournisseur : ${item.supplier.name}` : null
        ].filter(Boolean),
        badges: item.quantity <= item.minQuantity && item.minQuantity > 0 ? ['Alerte stock'] : []
      },
      searchText: [item.name, item.reference, item.category, item.description, item.location, item.supplier?.name].filter(Boolean).join(' ')
    })), query, limit);

    const userResults = req.user.role === 'ADMIN'
      ? filterAndRank(users.map(user => ({
          id: `user:${user.id}`,
          type: 'action',
          group: 'Utilisateurs',
          title: user.name,
          subtitle: [user.email, user.role === 'ADMIN' ? 'Administrateur' : 'Technicien'].join(' · '),
          href: '/settings.html?tab=users',
          openMode: 'preview',
          preview: {
            title: user.name,
            description: 'Ouvre l onglet utilisateurs des parametres pour gerer ce compte.',
            lines: [
              `Email : ${user.email}`,
              user.contactEmail ? `Email de contact : ${user.contactEmail}` : null,
              `Role : ${user.role === 'ADMIN' ? 'Administrateur' : 'Technicien'}`,
              user.isActive ? 'Compte actif' : 'Compte desactive',
              `${user._count.interventions} intervention(s) · ${user._count.passkeys} passkey(s)`
            ].filter(Boolean),
            badges: [user.role === 'ADMIN' ? 'Admin' : 'Tech', user.isActive ? 'Actif' : 'Inactif']
          },
          searchText: [user.name, user.email, user.contactEmail, user.role].filter(Boolean).join(' ')
        })), query, limit)
      : [];

    res.json({
      query,
      results: [
        ...actions,
        ...documentResults,
        ...attachmentDocumentResults,
        ...signatureDocumentResults,
        ...roomResults,
        ...equipmentResults,
        ...interventionResults,
        ...orderResults,
        ...supplierResults,
        ...stockResults,
        ...userResults
      ]
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
