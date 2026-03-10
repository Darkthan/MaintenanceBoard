'use strict';

/**
 * Service de découverte automatique des salles par le nom du PC.
 *
 * Algorithme :
 * 1. Normalise le hostname (minuscules, séparateurs → espaces)
 * 2. Extrait les tokens (mots + séquences numériques)
 * 3. Pour chaque salle, calcule un score :
 *    - Token numérique exact (room.number) = +10
 *    - Token alphanumérique commun         = +5
 *    - Ratio Jaccard entre tokens > 0.5    = +score proportionnel
 * 4. Retourne { roomId, confidence } si score > seuil (7), sinon null
 */

const SCORE_THRESHOLD = 7;
const SCORE_NUMBER_EXACT = 10;
const SCORE_TOKEN_COMMON = 5;

/**
 * Normalise un texte : minuscules + séparateurs remplacés par espaces.
 */
function normalize(str) {
  return (str || '').toLowerCase().replace(/[-_./\\]+/g, ' ').trim();
}

/**
 * Extrait les tokens d'une chaîne normalisée.
 * Découpe sur les espaces et extrait aussi les séquences numériques seules.
 */
function extractTokens(normalized) {
  const words = normalized.split(/\s+/).filter(Boolean);
  const nums = normalized.match(/\d+/g) || [];
  return new Set([...words, ...nums]);
}

/**
 * Ratio de Jaccard entre deux ensembles.
 */
function jaccard(setA, setB) {
  const intersection = [...setA].filter(t => setB.has(t)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Trouve la meilleure salle correspondant au hostname.
 *
 * @param {string} hostname
 * @param {Array<{id: string, name: string, number: string|null, building: string|null}>} rooms
 * @returns {{ roomId: string, confidence: number } | null}
 */
function findBestRoom(hostname, rooms) {
  if (!hostname || !rooms || rooms.length === 0) return null;

  const normHost = normalize(hostname);
  const hostTokens = extractTokens(normHost);

  let bestScore = 0;
  let bestRoom = null;

  for (const room of rooms) {
    let score = 0;

    // Correspondance exacte du numéro de salle
    if (room.number) {
      const normNumber = normalize(room.number);
      if (hostTokens.has(normNumber)) {
        score += SCORE_NUMBER_EXACT;
      }
    }

    // Tokens communs avec le nom de la salle
    const normRoomName = normalize(room.name);
    const roomTokens = extractTokens(normRoomName);

    const commonTokens = [...hostTokens].filter(t => roomTokens.has(t) && t.length > 1);
    score += commonTokens.length * SCORE_TOKEN_COMMON;

    // Ratio Jaccard
    const jaccardScore = jaccard(hostTokens, roomTokens);
    if (jaccardScore > 0.5) {
      score += Math.round(jaccardScore * 10);
    }

    if (score > bestScore) {
      bestScore = score;
      bestRoom = room;
    }
  }

  if (bestScore >= SCORE_THRESHOLD && bestRoom) {
    return { roomId: bestRoom.id, confidence: bestScore };
  }

  return null;
}

module.exports = { findBestRoom };
