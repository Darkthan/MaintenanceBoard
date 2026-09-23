const CLAUDE_HELP = 'https://support.claude.com/fr/articles/11175166-commencer-avec-les-connecteurs-personnalises-utilisant-mcp-distant';
const CHATGPT_HELP = 'https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function buildPublicMcpInviteEmail(email, url) {
  const safeEmail = escapeHtml(email);
  const safeUrl = escapeHtml(url);
  const text = `Bonjour,

Votre adresse ${email} est autorisée à demander des réservations de tablettes et des interventions depuis un assistant IA.

Adresse du serveur MCP public : ${url}

Pour vous connecter avec Claude
Compte Pro ou Max : Personnaliser > Connecteurs > + > Ajouter un connecteur personnalisé. Indiquez l’adresse du serveur ci-dessus.
Espace Team ou Enterprise : le propriétaire de l’espace ajoute d’abord le connecteur dans les paramètres de l’organisation. Vous pourrez ensuite choisir Connecter.

Pour vous connecter avec ChatGPT
Un administrateur de votre espace Business, Enterprise ou Edu crée une application MCP personnalisée dans Paramètres de l’espace > Apps > Créer, indique l’adresse du serveur, puis publie l’application pour les membres. Ouvrez ensuite l’application publiée et connectez votre compte. La création de demandes nécessite un espace où les applications MCP avec écriture sont disponibles.

Confirmer votre adresse
Lors de la connexion, saisissez ${email} sur la page MaintenanceBoard. Vous recevrez un lien de connexion par e-mail : ouvrez-le pour confirmer votre adresse. Aucun mot de passe ni jeton MCP administrateur n’est nécessaire.

Aide Claude : ${CLAUDE_HELP}
Aide ChatGPT : ${CHATGPT_HELP}
`;
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 12px;background:#f3f6fa;color:#172334;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;margin:0 auto;background:#fff;border:1px solid #dfe5ed;border-radius:12px"><tr><td style="padding:32px">
<p style="margin:0 0 8px;color:#526780;font-size:13px;font-weight:bold">MAINTENANCEBOARD</p>
<h1 style="margin:0 0 16px;font-size:25px;line-height:1.25;color:#172334">Connectez votre assistant IA</h1>
<p style="margin:0 0 22px">Bonjour,<br>Votre adresse <strong>${safeEmail}</strong> est autorisée à demander des réservations de tablettes et des interventions depuis un assistant IA.</p>
<p style="margin:0 0 8px;font-weight:bold">Adresse du serveur MCP public</p>
<p style="margin:0 0 28px;padding:12px 14px;background:#eef4fb;border-radius:6px;overflow-wrap:anywhere"><a href="${safeUrl}" style="color:#145a9e">${safeUrl}</a></p>
<h2 style="margin:0 0 8px;font-size:18px;color:#172334">Avec Claude</h2>
<p style="margin:0 0 10px"><strong>Compte Pro ou Max :</strong> ouvrez Personnaliser &gt; Connecteurs &gt; + &gt; Ajouter un connecteur personnalisé, puis indiquez l’adresse ci-dessus.</p>
<p style="margin:0 0 24px"><strong>Espace Team ou Enterprise :</strong> le propriétaire de l’espace ajoute d’abord le connecteur dans les paramètres de l’organisation. Vous pourrez ensuite choisir Connecter.</p>
<h2 style="margin:0 0 8px;font-size:18px;color:#172334">Avec ChatGPT</h2>
<p style="margin:0 0 24px">Un administrateur de votre espace Business, Enterprise ou Edu crée une application MCP personnalisée dans Paramètres de l’espace &gt; Apps &gt; Créer, indique l’adresse ci-dessus, puis publie l’application pour les membres. Ouvrez ensuite l’application publiée et connectez votre compte. La création de demandes nécessite un espace où les applications MCP avec écriture sont disponibles.</p>
<h2 style="margin:0 0 8px;font-size:18px;color:#172334">Confirmez votre adresse</h2>
<p style="margin:0 0 24px">Lors de la connexion, saisissez <strong>${safeEmail}</strong> sur la page MaintenanceBoard. Vous recevrez un lien de connexion par e-mail : ouvrez-le pour confirmer votre adresse. Aucun mot de passe ni jeton MCP administrateur n’est nécessaire.</p>
<p style="margin:0;padding-top:18px;border-top:1px solid #dfe5ed;font-size:13px;color:#526780">Besoin d’aide ? <a href="${CLAUDE_HELP}" style="color:#145a9e">Guide Claude</a> · <a href="${CHATGPT_HELP}" style="color:#145a9e">Guide ChatGPT</a></p>
</td></tr></table></body></html>`;
  return { text, html };
}

module.exports = { buildPublicMcpInviteEmail };
