/**
 * Helper de filtrage IP pour les tokens d'enrollment.
 * Supporte les IP simples et les CIDR IPv4.
 * Module natif net uniquement, pas de dépendance externe.
 */

const net = require('net');

/**
 * Convertit une adresse IPv4 en entier 32 bits.
 * Retourne null si l'IP est invalide.
 * @param {string} ip
 * @returns {number|null}
 */
function ipv4ToInt(ip) {
  if (!net.isIPv4(ip)) return null;
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

/**
 * Vérifie si une IP appartient à une liste d'IP ou CIDR.
 * Les entrées invalides sont ignorées silencieusement.
 * @param {string} ip - IP cliente
 * @param {string[]} list - Tableau d'IP ou CIDR (ex: "192.168.1.0/24", "10.0.0.5")
 * @returns {boolean}
 */
function isIpInList(ip, list) {
  if (!Array.isArray(list) || list.length === 0) return false;

  // Normaliser les IPv4-mapped IPv6 (::ffff:x.x.x.x)
  const normalizedIp = ip.startsWith('::ffff:') ? ip.slice(7) : ip;

  const clientInt = ipv4ToInt(normalizedIp);
  if (clientInt === null) return false; // IPv6 non géré (hors IPv4-mapped)

  for (const entry of list) {
    if (typeof entry !== 'string') continue;
    try {
      if (entry.includes('/')) {
        // CIDR
        const [cidrIp, prefixStr] = entry.split('/');
        const prefixLen = parseInt(prefixStr, 10);
        if (prefixLen < 0 || prefixLen > 32) continue;
        const networkInt = ipv4ToInt(cidrIp);
        if (networkInt === null) continue;
        const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
        if ((clientInt & mask) === (networkInt & mask)) return true;
      } else {
        // IP simple
        if (clientInt === ipv4ToInt(entry)) return true;
      }
    } catch {
      // Entrée malformée → ignorer
    }
  }
  return false;
}

/**
 * Détermine si une IP cliente est autorisée selon whitelist et blacklist.
 * - false si l'IP est dans la blacklist
 * - false si la whitelist est non nulle ET l'IP n'est pas dans la whitelist
 * - true sinon
 * @param {string} clientIp
 * @param {string[]|null} whitelist - null = tout autoriser
 * @param {string[]|null} blacklist - null = rien bloquer
 * @returns {boolean}
 */
function isIpAllowed(clientIp, whitelist, blacklist) {
  if (Array.isArray(blacklist) && blacklist.length > 0 && isIpInList(clientIp, blacklist)) {
    return false;
  }
  if (Array.isArray(whitelist) && whitelist.length > 0 && !isIpInList(clientIp, whitelist)) {
    return false;
  }
  return true;
}

module.exports = { isIpInList, isIpAllowed };
