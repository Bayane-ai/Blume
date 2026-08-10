// Logique du contrôle de santé des routes « matchs », partagée par DEUX appelants :
//   • pages/api/health/matches.js   — le cron quotidien Vercel ;
//   • scripts/test-matches.mjs      — npm run test:matches, en local.
// Elle vit dans un module à part, en .mjs, pour une raison concrète : le script local
// est un module ES exécuté directement par Node, il ne peut pas importer une page Next
// (traitée en CommonJS). Sans ce partage, il aurait fallu réécrire le contrôle une
// seconde fois — et deux mesures censées être identiques finissent toujours par
// diverger.
//
// Verdict ÉCHEC si l'une de ces trois conditions est vraie (demandé) :
//   • code HTTP >= 400 ;
//   • 0 match sur les 7 jours ;
//   • toutes les sources du sport en erreur.

const SPORTS = ["football", "basketball", "tennis"];

// En dessous de ce nombre de compétitions distinctes sur 8 jours, la couverture est
// considérée comme suspecte : à l'échelle mondiale, chacun des trois sports en compte
// largement plus. Un chiffre bas signale un filtre oublié, pas un calendrier creux.
export const SEUIL_COUVERTURE = 15;

export function verdictPour({ httpCode, matchs, sources, competitions }) {
  if (httpCode >= 400) return { verdict: "ÉCHEC", raison: `HTTP ${httpCode}` };
  const interrogees = (sources || []).filter((s) => s.statut !== "non configurée");
  if (interrogees.length > 0 && interrogees.every((s) => s.erreur)) {
    return { verdict: "ÉCHEC", raison: "toutes les sources en erreur" };
  }
  if (!matchs) return { verdict: "ÉCHEC", raison: "0 match sur la fenêtre J → J+7" };
  if (Number.isFinite(competitions) && competitions > 0 && competitions < SEUIL_COUVERTURE) {
    return {
      verdict: "COUVERTURE FAIBLE",
      raison: `${competitions} compétition(s) distincte(s) seulement (seuil ${SEUIL_COUVERTURE}) — chercher un filtre résiduel`,
    };
  }
  return { verdict: "OK", raison: null };
}

async function controler(sport, base, fetchImpl) {
  const url = `${base}/api/${sport}/matches`;
  const debut = Date.now();
  try {
    const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
    const dureeMs = Date.now() - debut;
    const httpCode = res.status ?? 200;
    const corps = await res.json().catch(() => ({}));

    // La route peut renvoyer la forme normalisée (`matches`) ou la forme historique
    // groupée (`competitions`) : on compte l'une OU l'autre, jamais zéro par défaut.
    const matchs = Array.isArray(corps.matches)
      ? corps.matches.length
      : (corps.competitions || []).reduce((n, c) => n + (c.matches?.length || 0), 0);
    const sources = corps.sources || corps.diagnostic?.sources || [];

    // COUVERTURE : nombre de compétitions DISTINCTES réellement rapportées sur la
    // fenêtre. C'est la mesure qui trahit un filtre résiduel — un sport mondial sur
    // 8 jours en compte des dizaines ; en dessous de SEUIL_COUVERTURE, quelque chose
    // restreint quelque part (liste blanche, pagination non suivie, source unique).
    const noms = new Set();
    if (Array.isArray(corps.matches)) {
      for (const m of corps.matches) noms.add(m.tournoi || m.competition?.name || "?");
    }
    for (const c of corps.competitions || []) noms.add(c.name || c.code || "?");
    noms.delete("?");
    const competitions = noms.size;

    return {
      sport,
      url,
      httpCode,
      matchs,
      competitions,
      exemplesCompetitions: [...noms].sort().slice(0, 20),
      dureeMs,
      sources,
      ...verdictPour({ httpCode, matchs, sources, competitions }),
    };
  } catch (e) {
    return {
      sport,
      url,
      httpCode: null,
      matchs: 0,
      dureeMs: Date.now() - debut,
      sources: [],
      verdict: "ÉCHEC",
      raison: e.message,
    };
  }
}

// Exporté pour que le script local (npm run test:matches) exécute EXACTEMENT le même
// contrôle que le cron — jamais deux mesures parallèles qui pourraient diverger.
export async function controlerTous({ base, fetchImpl = fetch } = {}) {
  const sports = {};
  for (const sport of SPORTS) sports[sport] = await controler(sport, base, fetchImpl);

  const echecs = SPORTS.filter((s) => sports[s].verdict !== "OK");

  // Journal structuré, une ligne par sport, lisible dans les logs Vercel (point 4c) :
  // date, sport, nombre de matchs, sources en échec, message d'erreur exact.
  for (const sport of SPORTS) {
    const r = sports[sport];
    console.log(
      JSON.stringify({
        tag: "blume.health.matches",
        date: new Date().toISOString(),
        sport,
        verdict: r.verdict,
        matchs: r.matchs,
        competitions: r.competitions,
        httpCode: r.httpCode,
        dureeMs: r.dureeMs,
        sourcesEnEchec: (r.sources || []).filter((s) => s.erreur).map((s) => ({ nom: s.nom, erreur: s.erreur })),
        erreur: r.raison,
      })
    );
  }

  return { verifieLe: new Date().toISOString(), verdict: echecs.length ? "ÉCHEC" : "OK", echecs, sports };
}

