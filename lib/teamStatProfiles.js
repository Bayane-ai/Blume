// BLOC 1 — profil statistique RÉEL par équipe (buts, corners, tirs, fautes, touches,
// hors-jeu, cartons), calculé à partir de ses derniers matchs réellement joués
// (API-Football), avec une répartition domicile/extérieur — jamais une constante
// partagée entre équipes ou entre matchs (contrairement à lib/pronostic.js,
// AVG_CORNERS_TOTAL etc., qui restera en l'état tant que le Bloc 2 — génération des
// lignes de pronostics à partir de CES profils — n'a pas été fait ; ce fichier ne
// touche donc à aucune logique de pronostic existante).
//
// Persisté en base (supabase/migrations/0011_team_stat_profiles.sql) avec un
// horodatage : un profil réutilisé tel quel tant qu'il a moins de STALE_MS, recalculé
// automatiquement (jamais par une tâche manuelle) dès qu'une équipe est redemandée
// après ce délai — le calcul complet d'un profil (jusqu'à 11 appels API-Football :
// liste des matchs + une statistique par match) est trop coûteux en quota (100
// requêtes/jour, plan gratuit) pour être refait à chaque consultation.
import { getSupabaseAdmin } from "./supabaseAdmin";
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

// Les 12 statistiques demandées (PROMPT Bloc 1, point 3) : buts/corners/fautes en
// paires pour/contre (obtenus-concédés, commises-subies), le reste en valeur simple
// (ce que demande explicitement le PROMPT, sans y ajouter une deuxième face non
// demandée).
const FIELD_KEYS = [
  "goalsFor", "goalsAgainst",
  "cornersFor", "cornersAgainst",
  "shots", "shotsOnTarget",
  "foulsCommitted", "foulsSuffered",
  "touches",
  "offsides",
  "yellowCards", "redCards",
];

// 1ère mi-temps (PROMPT point 4) : buts, corners, fautes, touches, hors-jeu — jamais
// tirs/cartons, non demandés à ce niveau de détail.
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

function average(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function emptyBucket() {
  const bucket = {};
  for (const key of FIELD_KEYS) bucket[key] = [];
  return bucket;
}

// Ajoute, pour UN match terminé et UNE équipe (domicile ou extérieur dans CE match),
// les vraies valeurs disponibles à l'accumulateur — un champ que l'API n'a pas fourni
// pour ce match précis est simplement absent (jamais un zéro inventé qui fausserait la
// moyenne). "touches" n'est jamais alimenté ici : aucune source connectée
// (football-data.org, API-Football) ne fournit cette statistique, même pour un match
// terminé — déjà établi ailleurs dans ce projet (voir
// lib/pronosticVerification.js#verifyPredictionLines, statKey "throwIns").
function collectMatchFields(bucket, { isHome, goalsFor, goalsAgainst, stats }) {
  if (Number.isFinite(goalsFor)) bucket.goalsFor.push(goalsFor);
  if (Number.isFinite(goalsAgainst)) bucket.goalsAgainst.push(goalsAgainst);
  if (!stats) return;
  const side = isHome ? "home" : "away";
  const otherSide = isHome ? "away" : "home";
  if (stats.corners) {
    bucket.cornersFor.push(stats.corners[side]);
    bucket.cornersAgainst.push(stats.corners[otherSide]);
  }
  if (stats.shots) bucket.shots.push(stats.shots[side]);
  if (stats.shotsOnTarget) bucket.shotsOnTarget.push(stats.shotsOnTarget[side]);
  if (stats.fouls) {
    bucket.foulsCommitted.push(stats.fouls[side]);
    bucket.foulsSuffered.push(stats.fouls[otherSide]);
  }
  if (stats.offsides) bucket.offsides.push(stats.offsides[side]);
  if (stats.yellowCards) bucket.yellowCards.push(stats.yellowCards[side]);
  if (stats.redCards) bucket.redCards.push(stats.redCards[side]);
}

// Calcule les trois accumulateurs (overall/home/away) à partir des vrais matchs
// terminés de l'équipe — un appel /fixtures/statistics PAR match utilisé (jusqu'à 10),
// chacun déjà mutualisé/caché par lib/apiFootball.js#getFixtureStatistics.
async function computeRawBuckets(teamId, key) {
  const fixtures = await getTeamLastFixtures(teamId, key, { last: MAX_MATCHES });
  const finished = (fixtures || []).filter((f) => FINISHED_STATUSES.has(f?.fixture?.status?.short));

  const overallBucket = emptyBucket();
  const homeBucket = emptyBucket();
  const awayBucket = emptyBucket();
  const sampleFixtureIds = [];

  for (const fixture of finished) {
    const fixtureId = fixture?.fixture?.id;
    const homeId = fixture?.teams?.home?.id;
    const isHome = String(homeId) === String(teamId);
    const goalsFor = isHome ? fixture?.goals?.home : fixture?.goals?.away;
    const goalsAgainst = isHome ? fixture?.goals?.away : fixture?.goals?.home;
    // Score final manquant : match ignoré plutôt qu'une donnée à moitié fiable.
    if (!Number.isFinite(goalsFor) || !Number.isFinite(goalsAgainst)) continue;

    const raw = fixtureId ? await getFixtureStatistics(fixtureId, key) : null;
    const stats = raw ? mapFixtureStatistics(raw, homeId) : null;

    const entry = { isHome, goalsFor, goalsAgainst, stats };
    collectMatchFields(overallBucket, entry);
    collectMatchFields(isHome ? homeBucket : awayBucket, entry);
    sampleFixtureIds.push(fixtureId);
  }

  return { overallBucket, homeBucket, awayBucket, matchesUsed: sampleFixtureIds.length, sampleFixtureIds };
}

// Un champ { value, estimated, sampleSize, available } : `value` vient des vrais
// matchs de l'équipe dès qu'il y en a au moins un ; sinon, repli sur la moyenne de sa
// compétition (calculée à partir des AUTRES profils déjà réels, jamais une constante
// codée en dur) et marqué `estimated: true` ; sans aucune des deux, `value` reste
// `null` (`available: false`) plutôt qu'une valeur inventée — c'est le cas permanent
// de "touches", jamais fourni par aucune source connectée.
function buildField(values, competitionAverage) {
  if (values.length > 0) {
    return { value: round2(average(values)), estimated: false, sampleSize: values.length, available: true };
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
// indisponible plutôt qu'inventée.
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
      averages[key] = values.length ? average(values) : null;
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
    overall: row.overall,
    home: row.home,
    away: row.away,
    firstHalf: row.first_half,
    computedAt: row.computed_at,
  };
}

function isStale(row) {
  if (!row) return true;
  const computedAt = new Date(row.computed_at).getTime();
  return !Number.isFinite(computedAt) || Date.now() - computedAt > STALE_MS;
}

// Point d'entrée : renvoie le profil connu d'une équipe, en le (re)calculant
// automatiquement si absent ou périmé (> 24h) — jamais recalculé à chaque appel. Sans
// clé API-Football, retombe sur le dernier profil connu (même périmé) plutôt que de le
// faire disparaître ; sans AUCUN profil connu ET sans clé, honnêtement indisponible.
export async function getOrRefreshTeamProfile({ teamName, competitionCode = null, competitionName = null, apiFootballKey }) {
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
    const { overallBucket, homeBucket, awayBucket, matchesUsed, sampleFixtureIds } = await computeRawBuckets(teamId, apiFootballKey);
    const competitionAverages = await getCompetitionAverages(supabase, competitionCode, teamKey);

    const row = {
      team_key: teamKey,
      team_name: teamName,
      api_football_team_id: String(teamId),
      competition_code: competitionCode,
      competition_name: competitionName,
      matches_used: matchesUsed,
      sample_fixture_ids: sampleFixtureIds,
      overall: buildSplitBlock(overallBucket, competitionAverages),
      home: buildSplitBlock(homeBucket, competitionAverages),
      away: buildSplitBlock(awayBucket, competitionAverages),
      first_half: buildFirstHalfBlock(),
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
