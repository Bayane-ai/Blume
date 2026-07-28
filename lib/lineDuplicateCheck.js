// BLOC 2 — VÉRIFICATION AUTOMATIQUE OBLIGATOIRE : deux matchs différents ne doivent
// jamais afficher exactement le même jeu de lignes de pronostics. Compare les lignes
// RÉELLEMENT AFFICHÉES (celles que components/LiveStatBlock.js et
// components/CardsAndCorners.js consomment — markets + matchStats, jamais les champs
// internes comme selectionCandidates ou les identités d'équipe) de tous les matchs
// fournis, deux à deux, et signale toute paire strictement identique — jamais masqué :
// si ça arrive, c'est un vrai bug de calcul à corriger (lib/pronosticFromProfiles.js
// ou lib/pronostic.js), pas cette fonction elle-même.
// N'exige PAS `pronostic.available` : les pronostics déjà figés et relus depuis
// pronostic_history (voir lib/pronosticHistory.js#toPredictionSnapshot) ne portent pas
// ce champ (retiré volontairement de l'instantané persisté) — la présence de vraies
// lignes de marché suffit à qualifier un pronostic comparable.
function comparableLines(pronostic) {
  if (!pronostic?.markets) return null;
  // Uniquement les lignes réellement affichées comme "lignes de pronostics" (jamais
  // les probabilités 1X2, qui ont leur propre bloc séparé et n'ont pas vocation à
  // varier de la même façon — voir PROMPT, point 3).
  return {
    markets: pronostic.markets || null,
    matchStats: pronostic.matchStats || null,
    correctScores: pronostic.correctScores || null,
  };
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a == null || b == null) return a === b;
  if (typeof a !== "object") return a === b;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => deepEqual(a[k], b[k]));
}

// `matches` : liste de { matchId, pronostic } — un match sans pronostic disponible
// (encore en cours de calcul, données insuffisantes) est ignoré : il n'a alors aucune
// ligne réelle à comparer, ni une simple absence qui ressemblerait à un "vrai" doublon.
export function findDuplicateLineSets(matches) {
  const withLines = (matches || [])
    .map((m) => ({ matchId: m.matchId, lines: comparableLines(m.pronostic) }))
    .filter((m) => m.lines);

  const duplicates = [];
  for (let i = 0; i < withLines.length; i++) {
    for (let j = i + 1; j < withLines.length; j++) {
      if (deepEqual(withLines[i].lines, withLines[j].lines)) {
        duplicates.push([withLines[i].matchId, withLines[j].matchId]);
      }
    }
  }
  return duplicates;
}

// Journalise (jamais fatal pour la réponse) toute paire de matchs affichés avec des
// lignes identiques — le symptôme est signalé bruyamment, jamais masqué, pour être
// corrigé dans le calcul lui-même dès qu'il est constaté.
export function warnOnDuplicateLineSets(matches, { context = "" } = {}) {
  const duplicates = findDuplicateLineSets(matches);
  if (duplicates.length > 0) {
    console.error(
      `[lineDuplicateCheck]${context ? ` (${context})` : ""} ${duplicates.length} paire(s) de matchs avec des lignes de pronostics identiques — bug de calcul à corriger :`,
      duplicates.map(([a, b]) => `${a} === ${b}`).join(", ")
    );
  }
  return duplicates;
}
