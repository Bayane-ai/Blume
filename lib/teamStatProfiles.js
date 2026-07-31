// BLOC 1 (+ PROMPT 1, moteur d'évaluation de la qualité des équipes) — profil
// statistique RÉEL par équipe (forme récente, attaque, défense, style de jeu),
// calculé à partir de ses derniers matchs réellement joués (API-Football), avec une
// répartition domicile/extérieur — jamais une constante partagée entre équipes ou
// entre matchs (contrairement à lib/pronostic.js, qui reste inchangé par ce fichier ;
// voir lib/pronosticFromProfiles.js pour la génération des lignes à partir de CES
// profils).
//
// Chaque match compte pour la moyenne d'une équipe, mais pas à poids égal :
//   - RÉCENCE : un match plus récent pèse plus qu'un match ancien (voir
//     RECENCY_WEIGHTS) — même échantillon (jusqu'à 10 matchs), mais la forme la plus
//     récente domine, comme demandé ("plus de poids sur les matchs les plus récents").
//   - NIVEAU D'ADVERSITÉ : un match contre une équipe mieux classée (classement
//     football-data.org, quand l'adversaire y est identifiable) pèse plus qu'un match
//     contre une équipe mal classée — "bien performer contre une équipe faible vaut
//     moins" (voir opponentStrengthMultiplier). Sans classement exploitable pour cet
//     adversaire précis (petite compétition, coupe, adversaire introuvable), le
//     poids reste neutre (1) : jamais une force d'adversaire inventée.
//
// Persisté en base (supabase/migrations/0011_team_stat_profiles.sql +
// 0013_team_quality_ratings.sql) avec un horodatage : un profil réutilisé tel quel
// tant qu'il a moins de STALE_MS, recalculé automatiquement (jamais par une tâche
// manuelle) dès qu'une équipe est redemandée après ce délai — le calcul complet d'un
// profil (jusqu'à 11 appels API-Football : liste des matchs + une statistique par
// match) est trop coûteux en quota (100 requêtes/jour, plan gratuit) pour être refait
// à chaque consultation.
import { getSupabaseAdmin } from "./supabaseAdmin";
import { getStandingsTable } from "./standingsCache";
import { refreshTeamQualityRatings } from "./teamQualityRatings";
import {
  getTeamLastFixtures,
  getFixtureStatistics,
  mapFixtureStatistics,
  findApiFootballTeamId,
  normalizeTeamName,
} from "./apiFootball";

const STALE_MS = 24 * 3600 * 1000; // 24h
const MAX_MATCHES = 10;
// Statuts API-Football signifiant "match réellement terminé" (score définitif) — un
// match reporté/annulé/à venir ne doit jamais entrer dans le calcul d'un profil.
const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);

// Statistiques calculées, en paires pour/contre quand ça a un sens (obtenus-concédés,
// commises-subies), sinon en valeur simple — plus les trois ajouts du PROMPT 1
// ("attaque" : taux de conversion ; "défense" : taux de clean sheets ; "style de
// jeu" : possession moyenne), chacune calculée MATCH PAR MATCH (jamais un ratio de
// moyennes) puis moyennée avec le même poids récence/adversité que le reste.
const FIELD_KEYS = [
  "goalsFor", "goalsAgainst",
  "cornersFor", "cornersAgainst",
  "shots", "shotsOnTarget",
  "foulsCommitted", "foulsSuffered",
  "touches",
  "offsides",
  "yellowCards", "redCards",
  "conversionRate", "cleanSheetRate", "possession",
];

// 1ère mi-temps (PROMPT Bloc 1, point 4) : buts, corners, fautes, touches, hors-jeu —
// jamais tirs/cartons/possession/taux dérivés, non demandés à ce niveau de détail.
const FIRST_HALF_FIELD_KEYS = [
  "goalsFor", "goalsAgainst",
  "cornersFor", "cornersAgainst",
  "foulsCommitted", "foulsSuffered",
  "touches",
  "offsides",
];

function round2(x) {
  return Math.round(x * 100) / 100;
}

// Moyenne PONDÉRÉE : `pairs` = [{ value, weight }]. Un poids de 1 partout redonne
// exactement une moyenne simple — la pondération est un raffinement, jamais un
// remplacement du principe "moyenne des vrais matchs".
function weightedAverage(pairs) {
  if (!pairs.length) return null;
  const totalWeight = pairs.reduce((a, p) => a + p.weight, 0);
  if (totalWeight <= 0) return null;
  return pairs.reduce((a, p) => a + p.value * p.weight, 0) / totalWeight;
}

function emptyBucket() {
  const bucket = {};
  for (const key of FIELD_KEYS) bucket[key] = [];
  return bucket;
}

function push(bucket, key, value, weight) {
  if (Number.isFinite(value)) bucket[key].push({ value, weight });
}

// Ajoute, pour UN match terminé et UNE équipe (domicile ou extérieur dans CE match),
// les vraies valeurs disponibles à l'accumulateur, chacune avec le poids
// récence×adversité de CE match précis — un champ que l'API n'a pas fourni pour ce
// match précis est simplement absent (jamais un zéro inventé qui fausserait la
// moyenne). "touches" n'est jamais alimenté ici : aucune source connectée
// (football-data.org, API-Football) ne fournit cette statistique, même pour un match
// terminé — déjà établi ailleurs dans ce projet (voir
// lib/pronosticVerification.js#verifyPredictionLines, statKey "throwIns").
function collectMatchFields(bucket, { isHome, goalsFor, goalsAgainst, stats, weight }) {
  push(bucket, "goalsFor", goalsFor, weight);
  push(bucket, "goalsAgainst", goalsAgainst, weight);
  // Clean sheet : calculable dès que le score final est connu, indépendamment des
  // statistiques détaillées du match (contrairement à tout ce qui suit ci-dessous).
  push(bucket, "cleanSheetRate", goalsAgainst === 0 ? 1 : 0, weight);
  if (!stats) return;
  const side = isHome ? "home" : "away";
  const otherSide = isHome ? "away" : "home";
  if (stats.corners) {
    push(bucket, "cornersFor", stats.corners[side], weight);
    push(bucket, "cornersAgainst", stats.corners[otherSide], weight);
  }
  if (stats.shots) {
    push(bucket, "shots", stats.shots[side], weight);
    // Taux de conversion RÉEL de ce match précis (buts / tirs) — jamais un ratio des
    // deux moyennes séparées, qui gommerait la vraie efficacité match par match.
    if (stats.shots[side] > 0) push(bucket, "conversionRate", goalsFor / stats.shots[side], weight);
  }
  if (stats.shotsOnTarget) push(bucket, "shotsOnTarget", stats.shotsOnTarget[side], weight);
  if (stats.fouls) {
    push(bucket, "foulsCommitted", stats.fouls[side], weight);
    push(bucket, "foulsSuffered", stats.fouls[otherSide], weight);
  }
  if (stats.offsides) push(bucket, "offsides", stats.offsides[side], weight);
  if (stats.yellowCards) push(bucket, "yellowCards", stats.yellowCards[side], weight);
  if (stats.redCards) push(bucket, "redCards", stats.redCards[side], weight);
  if (stats.possession) push(bucket, "possession", stats.possession[side], weight);
}

// Poids de récence : un match plus récent pèse plus qu'un match ancien — échelle
// linéaire simple (le plus ancien du lot = 1, le plus récent = N), documentée comme
// choix de méthode, jamais une "vraie" statistique en soi. `fixtures` DOIT être trié
// chronologiquement (le plus ancien d'abord) avant l'appel.
function recencyWeight(indexFromOldest, total) {
  return indexFromOldest + 1; // 1..N
}

// Niveau d'adversité : un adversaire mieux classé au classement football-data.org
// (quand il y est identifiable) fait peser CE match plus lourd dans la moyenne de
// l'équipe — "bien performer contre une équipe faible vaut moins". Échelle linéaire
// bornée [MIN, MAX] sur la position dans le tableau (1ᵉʳ = MAX, dernier = MIN) —
// choix de méthode documenté, jamais une force d'adversaire inventée : sans
// classement exploitable pour CET adversaire précis, le poids reste neutre (1).
const OPPONENT_WEIGHT_MIN = 0.7;
const OPPONENT_WEIGHT_MAX = 1.3;
function opponentStrengthMultiplier(opponentName, standingsTable) {
  if (!opponentName || !standingsTable || standingsTable.length < 2) return 1;
  const target = normalizeTeamName(opponentName);
  const row = standingsTable.find((r) => normalizeTeamName(r.team?.name) === target);
  if (!row?.position) return 1;
  const totalTeams = standingsTable.length;
  const fraction = (row.position - 1) / (totalTeams - 1); // 0 (1er) .. 1 (dernier)
  return OPPONENT_WEIGHT_MAX - fraction * (OPPONENT_WEIGHT_MAX - OPPONENT_WEIGHT_MIN);
}

// Classement utilisé pour évaluer le niveau des adversaires rencontrés : celui de la
// compétition DU MATCH analysé (déjà connu de l'appelant), réutilisé pour tous les
// adversaires de l'échantillon — la majorité des 10 derniers matchs d'une équipe sont
// typiquement dans sa compétition principale. Un adversaire hors de cette compétition
// (coupe, match amical, autre pays) n'y sera simplement pas trouvé : poids neutre,
// jamais un classement d'une autre compétition utilisé à tort. Aucun appel
// supplémentaire réel : getStandingsTable est déjà caché (20 min) et probablement
// déjà chaud (standings affichés ailleurs sur le site pour cette même compétition).
async function loadOpponentStandings(competitionCode, token) {
  if (!competitionCode || !token) return null;
  try {
    return await getStandingsTable(competitionCode, token);
  } catch {
    return null;
  }
}

// Calcule les trois accumulateurs (overall/home/away) à partir des vrais matchs
// terminés de l'équipe — un appel /fixtures/statistics PAR match utilisé (jusqu'à 10),
// chacun déjà mutualisé/caché par lib/apiFootball.js#getFixtureStatistics.
async function computeRawBuckets(teamId, key, { competitionCode, token } = {}) {
  const fixtures = await getTeamLastFixtures(teamId, key, { last: MAX_MATCHES });
  const finished = (fixtures || [])
    .filter((f) => FINISHED_STATUSES.has(f?.fixture?.status?.short))
    // Ordre chronologique croissant (le plus ancien d'abord) — indispensable pour que
    // les poids de récence soient corrects, indépendamment de l'ordre renvoyé par l'API.
    .sort((a, b) => new Date(a?.fixture?.date || 0) - new Date(b?.fixture?.date || 0));

  const standingsTable = await loadOpponentStandings(competitionCode, token);

  const overallBucket = emptyBucket();
  const homeBucket = emptyBucket();
  const awayBucket = emptyBucket();
  const sampleFixtureIds = [];
  const matchWeights = [];

  for (let i = 0; i < finished.length; i++) {
    const fixture = finished[i];
    const fixtureId = fixture?.fixture?.id;
    const homeId = fixture?.teams?.home?.id;
    const isHome = String(homeId) === String(teamId);
    const goalsFor = isHome ? fixture?.goals?.home : fixture?.goals?.away;
    const goalsAgainst = isHome ? fixture?.goals?.away : fixture?.goals?.home;
    // Score final manquant : match ignoré plutôt qu'une donnée à moitié fiable.
    if (!Number.isFinite(goalsFor) || !Number.isFinite(goalsAgainst)) continue;

    const opponentName = isHome ? fixture?.teams?.away?.name : fixture?.teams?.home?.name;
    const weight = recencyWeight(i, finished.length) * opponentStrengthMultiplier(opponentName, standingsTable);

    const raw = fixtureId ? await getFixtureStatistics(fixtureId, key) : null;
    const stats = raw ? mapFixtureStatistics(raw, homeId) : null;

    const entry = { isHome, goalsFor, goalsAgainst, stats, weight };
    collectMatchFields(overallBucket, entry);
    collectMatchFields(isHome ? homeBucket : awayBucket, entry);
    sampleFixtureIds.push(fixtureId);
    matchWeights.push({ fixtureId, opponentName, weight: round2(weight) });
  }

  return { overallBucket, homeBucket, awayBucket, matchesUsed: sampleFixtureIds.length, sampleFixtureIds, matchWeights };
}

// Un champ { value, estimated, sampleSize, available } : `value` vient des vrais
// matchs de l'équipe (moyenne pondérée récence/adversité) dès qu'il y en a au moins
// un ; sinon, repli sur la moyenne de sa compétition (calculée à partir des AUTRES
// profils déjà réels, jamais une constante codée en dur) et marqué `estimated: true` ;
// sans aucune des deux, `value` reste `null` (`available: false`) plutôt qu'une
// valeur inventée — c'est le cas permanent de "touches", jamais fourni par aucune
// source connectée.
function buildField(pairs, competitionAverage) {
  if (pairs.length > 0) {
    return { value: round2(weightedAverage(pairs)), estimated: false, sampleSize: pairs.length, available: true };
  }
  if (competitionAverage != null) {
    return { value: round2(competitionAverage), estimated: true, sampleSize: 0, available: true };
  }
  return { value: null, estimated: true, sampleSize: 0, available: false };
}

function buildSplitBlock(bucket, competitionAverages) {
  const block = {};
  for (const key of FIELD_KEYS) block[key] = buildField(bucket[key], competitionAverages[key]);
  return block;
}

// 1ère mi-temps : structure prête mais toujours indisponible pour l'instant — voir le
// commentaire de la migration 0011. Reste malgré tout ici (jamais un champ manquant à
// l'appelant) pour que le Bloc 2 n'ait rien à changer le jour où une source fournira
// enfin cette donnée.
function buildFirstHalfBlock() {
  const block = {};
  for (const key of FIRST_HALF_FIELD_KEYS) {
    block[key] = { value: null, estimated: true, sampleSize: 0, available: false };
  }
  return block;
}

// Moyenne de compétition pour un champ donné : uniquement à partir des profils
// d'AUTRES équipes de la même compétition qui ont, eux, une vraie mesure pour ce champ
// (jamais une valeur déjà elle-même estimée, qui ferait dériver l'estimation d'une
// estimation) — la seule donnée manquante systématiquement pour toutes les équipes
// (ex : "touches") ne peut jamais produire de moyenne ici, et reste donc honnêtement
// indisponible plutôt qu'inventée. Simple moyenne NON pondérée entre équipes (la
// pondération récence/adversité s'applique DANS le profil de chaque équipe, pas entre
// équipes différentes).
async function getCompetitionAverages(supabase, competitionCode, excludeTeamKey) {
  const empty = Object.fromEntries(FIELD_KEYS.map((k) => [k, null]));
  if (!supabase || !competitionCode) return empty;
  try {
    const { data, error } = await supabase
      .from("team_stat_profiles")
      .select("overall, team_key")
      .eq("competition_code", competitionCode)
      .neq("team_key", excludeTeamKey || "");
    if (error || !data) return empty;
    const averages = { ...empty };
    for (const key of FIELD_KEYS) {
      const values = data
        .map((row) => row.overall?.[key])
        .filter((f) => f && f.available && !f.estimated)
        .map((f) => f.value);
      averages[key] = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    }
    return averages;
  } catch {
    return empty;
  }
}

function toProfileResult(row) {
  return {
    available: true,
    teamName: row.team_name,
    teamKey: row.team_key,
    competitionCode: row.competition_code,
    competitionName: row.competition_name,
    matchesUsed: row.matches_used,
    sampleFixtureIds: row.sample_fixture_ids,
    matchWeights: row.match_weights || [],
    overall: row.overall,
    home: row.home,
    away: row.away,
    firstHalf: row.first_half,
    qualityRatings: row.quality_ratings || null,
    computedAt: row.computed_at,
  };
}

function isStale(row) {
  if (!row) return true;
  const computedAt = new Date(row.computed_at).getTime();
  return !Number.isFinite(computedAt) || Date.now() - computedAt > STALE_MS;
}

// Simple lecture Supabase, SANS jamais déclencher de calcul ni un seul appel
// API-Football — pour les chemins sensibles à la latence (voir pages/api/analyze.js,
// BLOC 2 : cliquer sur "ANALYSER" ne doit jamais attendre jusqu'à 22 appels
// API-Football en amont). Un profil périmé (> 24h) reste quand même utilisable ici —
// le rafraîchissement automatique reste la responsabilité de getOrRefreshTeamProfile,
// déclenché ailleurs (voir pages/api/admin/team-profile.js).
export async function getExistingTeamProfile(teamName) {
  const teamKey = normalizeTeamName(teamName);
  if (!teamKey) return { available: false, reason: "nom d'équipe manquant" };
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from("team_stat_profiles").select("*").eq("team_key", teamKey).maybeSingle();
    if (error || !data) return { available: false, reason: "profil non calculé" };
    return toProfileResult(data);
  } catch (e) {
    console.error("Erreur lecture profil équipe:", e.message);
    return { available: false, reason: "erreur lecture profil" };
  }
}

// Point d'entrée : renvoie le profil connu d'une équipe, en le (re)calculant
// automatiquement si absent ou périmé (> 24h) — jamais recalculé à chaque appel. Sans
// clé API-Football, retombe sur le dernier profil connu (même périmé) plutôt que de le
// faire disparaître ; sans AUCUN profil connu ET sans clé, honnêtement indisponible.
// `token` (football-data.org, optionnel) sert UNIQUEMENT à évaluer le niveau des
// adversaires rencontrés (voir loadOpponentStandings) — son absence ne bloque jamais
// le calcul, elle retombe sur un poids d'adversité neutre pour tout l'échantillon.
export async function getOrRefreshTeamProfile({ teamName, competitionCode = null, competitionName = null, apiFootballKey, token = null }) {
  const teamKey = normalizeTeamName(teamName);
  if (!teamKey) return { available: false, reason: "nom d'équipe manquant" };

  let supabase = null;
  let existing = null;
  try {
    supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from("team_stat_profiles").select("*").eq("team_key", teamKey).maybeSingle();
    if (!error) existing = data || null;
  } catch (e) {
    console.error("Erreur lecture profil équipe:", e.message);
  }

  if (!isStale(existing)) return toProfileResult(existing);

  if (!apiFootballKey) {
    return existing ? toProfileResult(existing) : { available: false, reason: "clé API-Football manquante" };
  }

  const teamId = await findApiFootballTeamId(teamName, apiFootballKey);
  if (!teamId) {
    return existing ? toProfileResult(existing) : { available: false, reason: "équipe introuvable côté API-Football" };
  }

  try {
    const { overallBucket, homeBucket, awayBucket, matchesUsed, sampleFixtureIds, matchWeights } =
      await computeRawBuckets(teamId, apiFootballKey, { competitionCode, token });
    const competitionAverages = await getCompetitionAverages(supabase, competitionCode, teamKey);

    const overall = buildSplitBlock(overallBucket, competitionAverages);
    // Notes de qualité (PROMPT 1) : percentile RÉEL parmi les autres équipes déjà
    // profilées de la même compétition — calculées à partir du même "overall" que
    // celui sauvegardé ci-dessous, jamais une échelle absolue inventée (voir
    // lib/teamQualityRatings.js).
    const qualityRatings = await refreshTeamQualityRatings(supabase, competitionCode, teamKey, overall);

    const row = {
      team_key: teamKey,
      team_name: teamName,
      api_football_team_id: String(teamId),
      competition_code: competitionCode,
      competition_name: competitionName,
      matches_used: matchesUsed,
      sample_fixture_ids: sampleFixtureIds,
      match_weights: matchWeights,
      overall,
      home: buildSplitBlock(homeBucket, competitionAverages),
      away: buildSplitBlock(awayBucket, competitionAverages),
      first_half: buildFirstHalfBlock(),
      quality_ratings: qualityRatings,
      computed_at: new Date().toISOString(),
    };

    if (supabase) {
      const { error } = await supabase.from("team_stat_profiles").upsert(row, { onConflict: "team_key" });
      if (error) console.error("Erreur sauvegarde profil équipe:", error.message);
    }

    return toProfileResult(row);
  } catch (e) {
    console.error("Erreur calcul profil équipe:", e.message);
    return existing ? toProfileResult(existing) : { available: false, reason: "calcul impossible" };
  }
}
