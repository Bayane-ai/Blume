// PROMPT 1 — notes de qualité par équipe (0-100), par secteur (attaque, défense,
// discipline, rythme de jeu) + une note globale, calculées à partir du profil RÉEL de
// chaque équipe (lib/teamStatProfiles.js, déjà pondéré récence/adversité) — jamais
// une échelle absolue arbitraire (aucune référence "un bon buteur marque X buts/match"
// codée en dur) : chaque note est un PERCENTILE RÉEL parmi les autres équipes déjà
// profilées de la MÊME compétition. Une compétition à faible scoring (défensive) et
// une compétition très offensive n'utilisent donc jamais la même échelle — la note
// reflète la vraie position relative de l'équipe dans SON contexte, pas un barème
// universel inventé.
//
// Sans assez d'équipes pairs déjà profilées dans la même compétition, un percentile
// n'a pas de sens statistique : la note reste honnêtement indisponible
// (available: false) plutôt qu'une valeur calculée sur un échantillon trop petit pour
// être significative.
const MIN_PEERS_FOR_RATING = 3; // l'équipe elle-même + au moins 2 autres

// Champs réels (voir lib/teamStatProfiles.js#FIELD_KEYS) qui composent chaque secteur.
// `invert: true` signifie "une valeur plus BASSE est meilleure" (buts encaissés,
// cartons, fautes commises) — la note du secteur reste malgré tout "plus haut = mieux"
// une fois calculée.
const SECTOR_FIELDS = {
  attack: [
    { key: "goalsFor", invert: false },
    { key: "shotsOnTarget", invert: false },
    { key: "conversionRate", invert: false },
  ],
  defense: [
    { key: "goalsAgainst", invert: true },
    { key: "cleanSheetRate", invert: false },
  ],
  discipline: [
    { key: "yellowCards", invert: true },
    { key: "redCards", invert: true },
    { key: "foulsCommitted", invert: true },
  ],
  tempo: [
    { key: "cornersFor", invert: false },
    { key: "shots", invert: false },
    { key: "possession", invert: false },
  ],
};

function round1(x) {
  return Math.round(x * 10) / 10;
}

// Percentile RÉEL d'une valeur face à un échantillon de valeurs réelles d'AUTRES
// équipes (jamais elle-même) : fraction de l'échantillon strictement inférieure, plus
// la moitié de la fraction égale (méthode standard, évite qu'une égalité fasse
// basculer tout un côté).
function percentileOf(value, sample) {
  if (!sample.length) return null;
  const below = sample.filter((v) => v < value).length;
  const equal = sample.filter((v) => v === value).length;
  return ((below + equal / 2) / sample.length) * 100;
}

// Récupère, pour UN champ, les vraies valeurs de TOUTES les équipes pairs (profil
// "overall", jamais une valeur déjà elle-même estimée — même règle que
// lib/teamStatProfiles.js#getCompetitionAverages : une estimation ne doit jamais
// servir de référence à une autre estimation).
function realPeerValues(peers, key) {
  return peers
    .map((p) => p.overall?.[key])
    .filter((f) => f && f.available && !f.estimated)
    .map((f) => f.value);
}

// Note d'UN secteur : moyenne des percentiles réels de chacun de ses champs
// constitutifs — jamais une moyenne de valeurs brutes d'unités différentes (buts vs
// tirs vs %). Un champ sans assez de pairs réels pour lui (même si d'autres champs du
// secteur en ont assez) est simplement exclu de la moyenne du secteur, plutôt que de
// faire échouer tout le secteur pour une seule statistique éparse.
function computeSectorRating(fields, teamOverall, peers) {
  const percentiles = [];
  for (const { key, invert } of fields) {
    const field = teamOverall?.[key];
    if (!field?.available || field.estimated) continue; // note basée sur du réel uniquement
    const peerValues = realPeerValues(peers, key);
    if (peerValues.length < MIN_PEERS_FOR_RATING) continue;
    const pct = percentileOf(field.value, peerValues);
    if (pct == null) continue;
    percentiles.push(invert ? 100 - pct : pct);
  }
  if (!percentiles.length) return { value: null, available: false, basedOn: 0 };
  const avg = percentiles.reduce((a, b) => a + b, 0) / percentiles.length;
  return { value: round1(avg), available: true, basedOn: percentiles.length };
}

// Calcule les 4 notes de secteur + la note globale (moyenne simple des 4 secteurs
// disponibles — pondération égale, choix de méthode documenté, jamais une constante
// de statistique fabriquée) à partir du profil "overall" d'une équipe et des profils
// "overall" de ses pairs de compétition (déjà réels, jamais recalculés ici).
export function computeQualityRatings(teamOverall, peerOveralls) {
  const peers = (peerOveralls || []).map((overall) => ({ overall }));
  const sectors = {};
  for (const [sector, fields] of Object.entries(SECTOR_FIELDS)) {
    sectors[sector] = computeSectorRating(fields, teamOverall, peers);
  }
  const availableSectors = Object.values(sectors).filter((s) => s.available);
  const overall = availableSectors.length
    ? { value: round1(availableSectors.reduce((a, s) => a + s.value, 0) / availableSectors.length), available: true }
    : { value: null, available: false };
  return { ...sectors, overall };
}

// Orchestration : lit les profils déjà réels des autres équipes de la même
// compétition (même requête que lib/teamStatProfiles.js#getCompetitionAverages) et
// calcule les notes — utilisée par getOrRefreshTeamProfile juste après avoir construit
// le profil "overall" d'une équipe, jamais appelée seule sans profil frais.
export async function refreshTeamQualityRatings(supabase, competitionCode, excludeTeamKey, teamOverall) {
  if (!supabase || !competitionCode) return computeQualityRatings(teamOverall, []);
  try {
    const { data, error } = await supabase
      .from("team_stat_profiles")
      .select("overall")
      .eq("competition_code", competitionCode)
      .neq("team_key", excludeTeamKey || "");
    if (error || !data) return computeQualityRatings(teamOverall, []);
    return computeQualityRatings(teamOverall, data.map((row) => row.overall));
  } catch {
    return computeQualityRatings(teamOverall, []);
  }
}
