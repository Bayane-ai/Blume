import { getStandingsTable } from "../../lib/standingsCache";
import { getLiveMatchesList } from "../../lib/liveListCache";
import { computePronostic } from "../../lib/pronostic";

function attachPronostic(m, table) {
  const homeRow = table?.find((row) => String(row.team.id) === String(m.homeTeam?.id));
  const awayRow = table?.find((row) => String(row.team.id) === String(m.awayTeam?.id));
  const pronostic = computePronostic({
    homeRow, awayRow, homeTeamName: m.homeTeam?.name, awayTeamName: m.awayTeam?.name,
  });
  return { ...m, pronostic };
}

export default async function handler(req, res) {
  const token = process.env.FOOTBALL_DATA_TOKEN;
  if (!token) return res.status(500).json({ error: "Clé API manquante" });

  try {
    // Tous les matchs en direct (IN_PLAY + PAUSED via le pseudo-statut LIVE de
    // football-data.org), sans filtrer par compétition ni par pays, et sans plafond
    // artificiel : on affiche exactement ce que l'API renvoie, jamais plus, jamais moins.
    // getLiveMatchesList mutualise l'appel en amont entre tous les visiteurs (quelques
    // secondes de cache partagé), pour pouvoir actualiser souvent côté client sans
    // dépasser le quota de l'API, même si plusieurs personnes regardent en même temps.
    const listResult = await getLiveMatchesList(token);
    if (listResult.errorStatus) {
      return res.status(listResult.errorStatus).json({ error: `Erreur API football-data (code ${listResult.errorStatus})` });
    }
    const liveMatches = listResult.matches || [];

    const codes = [...new Set(liveMatches.map((m) => m.competition?.code).filter(Boolean))];
    const standingsByCode = {};
    await Promise.all(
      codes.map(async (code) => {
        standingsByCode[code] = await getStandingsTable(code, token);
      })
    );

    const matches = liveMatches.map((m) => attachPronostic(m, standingsByCode[m.competition?.code]));

    // Vercel peut exécuter plusieurs instances de cette fonction en parallèle sous
    // charge : le cache en mémoire (liveListCache.js) n'est alors PAS partagé entre
    // elles (chacune a sa propre mémoire), et chacune referait son propre appel en
    // amont. Cet en-tête fait que le réseau Vercel (CDN, devant toutes les instances)
    // sert la même réponse à tout le monde pendant quelques secondes, quel que soit
    // le nombre d'instances — c'est ce qui borne réellement le nombre d'appels à
    // l'API football-data.org, plus fiable que le cache en mémoire seul.
    res.setHeader("Cache-Control", "s-maxage=3, stale-while-revalidate=20");
    return res.status(200).json({ matches });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
