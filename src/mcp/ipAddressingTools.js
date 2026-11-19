const service = require('./ipAddressingService');
const { MCP_SCOPES } = require('../utils/mcpTokens');

module.exports = function registerIpAddressingTools(server, ctx, tool) {
  const user = ctx.createdBy;
  const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
  server.registerTool('get_ip_address_history', {
    description: 'Consulte les modifications d’une IPv4 dans un réseau, y compris après libération.',
    inputSchema: { networkId: service.id, ip: service.ipv4 },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, tool(ctx, MCP_SCOPES.IP_ADDRESSING_READ, args => service.getAddressHistory(args, user)));
  function register(name, description, schema, fn, annotations = write) {
    server.registerTool(name, { description, inputSchema: schema, annotations }, tool(ctx, MCP_SCOPES.IP_ADDRESSING_WRITE, args => fn(args, user)));
  }
  register('create_ip_network', 'Crée un réseau IPv4 dans le plan d’adressage : nom, CIDR, VLAN, passerelles et description. Administrateur requis. Modifie uniquement la documentation du plan IP.', service.networkFields, service.createNetwork);
  const partial = fields => Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.optional()]));
  register('update_ip_network', 'Modifie un réseau du plan IP. Champs omis conservés ; null efface un champ facultatif. Refuse un CIDR excluant les adresses ou plages existantes. Administrateur requis ; historique conservé.', { ...partial(service.networkFields), networkId: service.id }, service.updateNetwork, { ...write, idempotentHint: true, destructiveHint: true });
  for (const [kind, fields, label] of [['range', service.rangeFields, 'plage'], ['address', service.addressFields, 'adresse IP']]) {
    const entryKey = kind === 'range' ? 'rangeId' : 'addressId';
    for (const operation of ['create', 'update', 'delete']) {
      const schema = { networkId: service.id,
        ...(operation === 'create' ? fields : { [entryKey]: service.id, ...(operation === 'update' ? partial(fields) : {}) }) };
      const detail = kind === 'range' ? ' startHost et endHost sont des offsets inclusifs depuis la base du réseau (ex. .0/24 : 10 à 20 pour .10 à .20).' : ' Une adresse issue d’un agent (autoDiscovered) doit être créée explicitement dans le plan avant modification ; utiliser ensuite son identifiant persistant.';
      register(`${operation}_ip_${kind}`, `${operation === 'create' ? 'Ajoute' : operation === 'update' ? 'Modifie' : 'Supprime'} une ${label} dans le plan IP uniquement. Administrateur requis ; historique conservé. Champs omis conservés, null efface un champ facultatif.${detail}`, schema,
        (args, actor) => service.mutateEntry(kind, operation, args, actor),
        { ...write, destructiveHint: operation !== 'create', idempotentHint: operation === 'update' });
    }
  }
};
