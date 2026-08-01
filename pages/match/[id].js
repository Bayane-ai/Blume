import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import MatchHeaderHero from "../../components/MatchHeaderHero";
import MatchTimeline from "../../components/MatchTimeline";
import FormBadges from "../../components/FormBadges";
import PronosticResults from "../../components/PronosticResults";
import PreMatchSummary from "../../components/PreMatchSummary";
import ProbableScorers from "../../components/ProbableScorers";
import CardsAndCorners from "../../components/CardsAndCorners";
import AssistsProbables from "../../components/AssistsProbables";
import LiveStatBlock from "../../components/LiveStatBlock";
import MatchOutcomeRecap from "../../components/MatchOutcomeRecap";
import BasketballPronosticResults from "../../components/BasketballPronosticResults";
import BasketballPeriodsBlock from "../../components/BasketballPeriodsBlock";
import BasketballSecondaryStats from "../../components/BasketballSecondaryStats";
import BasketballSingleTotals from "../../components/BasketballSingleTotals";
import BasketballPlayersToWatch from "../../components/BasketballPlayersToWatch";
import BasketballMatchTimeline from "../../components/BasketballMatchTimeline";
import BasketballMatchOutcomeRecap from "../../components/BasketballMatchOutcomeRecap";
import TennisPronosticResults from "../../components/TennisPronosticResults";
import TennisSecondaryStats from "../../components/TennisSecondaryStats";
import TennisServiceReturnContext from "../../components/TennisServiceReturnContext";
import TennisMatchScenario from "../../components/TennisMatchScenario";
import TennisMatchTimeline from "../../components/TennisMatchTimeline";
import TennisMatchOutcomeRecap from "../../components/TennisMatchOutcomeRecap";
import { useRequireAuth } from "../../lib/useRequireAuth";
import { addMatchToHistory } from "../../lib/matchHistory";

const LIVE_STATUSES = ["IN_PLAY", "PAUSED"];
// 2s : rendu possible sans dépasser le quota de l'API grâce au cache partagé côté
// serveur (lib/liveMatchCache.js, actualisé toutes les 2,5s), qui mutualise les appels
// entre tous les visiteurs suivant ce match. Dès qu'un but est marqué, la requête
// suivante (au plus 2s après) le reflète.
const LIVE_REFRESH_MS = 2000;

function formatKickoff(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (isToday) return `Aujourd'hui - ${time}`;
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) + ` - ${time}`;
}

export default function MatchPage() {
  const { session, sessionChecked, authorized } = useRequireAuth();
  const userId = session?.id;
  const router = useRouter();
  const {
    id: matchId,
    competitionCode, competitionName, competitionEmblem, homeTeamId, awayTeamId,
    homeTeamName, awayTeamName, homeCrest, awayCrest,
    status: initialStatus, minute: initialMinute, period: initialPeriod, utcDate, scoreHome, scoreAway,
    season,
    // Tennis uniquement (voir components/MatchCard.js#matchHref) — chaînes vides pour
    // le football/basket, jamais lues par eux.
    surface: tennisSurface, round: tennisRound, homeFlag, awayFlag, sets: setsJson, category: tennisCategory,
  } = router.query;

  // Multi-sport bloc 3 : un match basket (id préfixé "bk-", voir lib/sports/
  // basketball/mapper.js) utilise sa propre route d'analyse (pages/api/basketball/
  // analyze.js) et ses propres cartes de pronostics (métriques basket, voir PROMPT) —
  // jamais le chemin football ci-dessous, dont les champs (corners, cartons...) n'ont
  // pas de sens pour ce sport.
  const isBasketball = typeof matchId === "string" && matchId.startsWith("bk-");
  // Multi-sport bloc 7 : un match tennis (id préfixé "tn-") utilise sa propre route
  // d'analyse (pages/api/tennis/analyze.js) et ses propres cartes de pronostics
  // (métriques tennis, voir PROMPT) — jamais /api/analyze (football) ni
  // /api/basketball/analyze, dont les paramètres et les champs renvoyés n'ont aucun
  // sens pour ce sport.
  const isTennis = typeof matchId === "string" && matchId.startsWith("tn-");
  const tennisSets = (() => {
    if (!setsJson || typeof setsJson !== "string") return [];
    try {
      const parsed = JSON.parse(setsJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  const [pronostic, setPronostic] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hasRequested, setHasRequested] = useState(false);
  // État réel du match (score/minute/statut) tel que renvoyé par l'API à la dernière
  // requête — prioritaire sur les query params, qui ne sont qu'un instantané pris au
  // moment du clic depuis la liste et peuvent être périmés.
  const [liveState, setLiveState] = useState(null);

  const runAnalysis = useCallback((silent = false) => {
    if (!router.isReady) return;
    setHasRequested(true);
    if (!homeTeamId || !awayTeamId || (!isBasketball && !isTennis && !competitionCode)) {
      setPronostic({ error: "Informations du match manquantes pour calculer les pronostics." });
      return;
    }
    const endpoint = isBasketball
      ? `/api/basketball/analyze?${new URLSearchParams({ matchId: matchId || "", homeTeamId, awayTeamId, homeTeamName, awayTeamName, season: season || "" })}`
      : isTennis
      ? `/api/tennis/analyze?${new URLSearchParams({ matchId: matchId || "", homeTeamId, awayTeamId, homeTeamName, awayTeamName, surface: tennisSurface || "", category: tennisCategory || "" })}`
      : `/api/analyze?${new URLSearchParams({ matchId: matchId || "", competitionCode, homeTeamId, awayTeamId, homeTeamName, awayTeamName })}`;
    if (!silent) setLoading(true);
    fetch(endpoint)
      .then((r) => r.json())
      .then((result) => {
        if (result?.error) {
          console.error("Erreur analyse:", result.error);
          // Rafraîchissement silencieux (live) : une erreur passagère (quota API,
          // réseau) ne doit pas faire disparaître un pronostic déjà affiché — on
          // garde le dernier résultat connu et on réessaie au prochain cycle.
          if (silent) return;
        }
        setPronostic(result);
        if (result?.matchStatus) {
          setLiveState({
            status: result.matchStatus, minute: result.matchMinute, period: result.matchPeriod, score: result.matchScore,
            events: result.events, timelineNote: result.timelineNote, server: result.server, sets: result.sets,
          });
        }
      })
      .catch((e) => {
        console.error("Erreur analyse:", e);
        if (!silent) setPronostic({ error: "Erreur lors du calcul des pronostics." });
      })
      .finally(() => setLoading(false));
  }, [router.isReady, matchId, isBasketball, isTennis, competitionCode, homeTeamId, awayTeamId, homeTeamName, awayTeamName, season, tennisSurface, tennisCategory]);

  // Lance l'analyse automatiquement dès que le match est chargé, et à chaque fois qu'on
  // navigue vers un AUTRE match (Next.js réutilise ce même composant, seul l'id d'URL
  // change : sans matchId en dépendance, l'ancienne analyse restait affichée).
  useEffect(() => {
    if (!router.isReady || !authorized) return;
    setPronostic(null);
    setHasRequested(false);
    setLiveState(null);
    runAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, authorized, matchId]);

  // "Historique" (voir PROMPT) : dès que l'utilisateur ouvre l'analyse/les pronostics
  // d'un match, il s'ajoute automatiquement en haut de SON historique personnel (voir
  // lib/matchHistory.js, table match_history propre à chaque compte) — un instantané
  // pris au moment de l'ouverture (mêmes champs que components/MatchCard.js:matchHref),
  // jamais mis à jour ensuite par les rafraîchissements live : seule une NOUVELLE
  // ouverture de la page remonte l'entrée et remet son délai d'effacement à zéro.
  useEffect(() => {
    if (!router.isReady || !authorized || !matchId || !userId) return;
    addMatchToHistory(userId, {
      id: matchId,
      status: initialStatus || "",
      minute: initialMinute ? Number(initialMinute) : null,
      utcDate: utcDate || "",
      competition: { code: competitionCode || "", name: competitionName || "", emblem: competitionEmblem || "" },
      homeTeam: { id: homeTeamId || "", name: homeTeamName || "", crest: homeCrest || "" },
      awayTeam: { id: awayTeamId || "", name: awayTeamName || "", crest: awayCrest || "" },
      score: {
        fullTime: {
          home: scoreHome !== "" && scoreHome !== undefined ? scoreHome : null,
          away: scoreAway !== "" && scoreAway !== undefined ? scoreAway : null,
        },
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, authorized, matchId, userId]);

  const currentStatus = liveState?.status || initialStatus;

  // Rafraîchissement automatique tant que le match est en direct — le score, la
  // minute, la timeline d'événements, les probabilités de victoire, les scores exacts
  // et les totaux de buts en profitent réellement (voir pages/api/analyze.js,
  // computeLiveOutcome) ; les autres lignes de pronostics (Corners/Hors-jeu/Fautes/
  // Touches, tirs, cartons...) restent figées et reviennent donc identiques à chaque
  // appel pendant tout le match.
  useEffect(() => {
    if (!authorized || !LIVE_STATUSES.includes(currentStatus)) return;
    const intervalId = setInterval(() => runAnalysis(true), LIVE_REFRESH_MS);
    return () => clearInterval(intervalId);
  }, [authorized, currentStatus, runAnalysis]);

  const isLiveNow = LIVE_STATUSES.includes(currentStatus);
  // Bloc 4 (parcours vidéo) : "quand on appuie sur un match déjà terminé" — le statut
  // vient toujours de l'API (currentStatus), jamais d'une valeur supposée.
  const isFinishedNow = currentStatus === "FINISHED";

  // Le format de `minute` dépend du sport (voir lib/liveClockFormat.js) : un nombre de
  // minutes écoulées pour le football ("34’"), mais une chaîne pour le basket ("5:23")
  // et le tennis ("40-30", score du jeu en cours) — jamais convertie en Number pour ces
  // deux-là, ce qui produirait NaN.
  const initialMinuteValue =
    initialMinute !== undefined && initialMinute !== "" && /^-?\d+$/.test(initialMinute)
      ? Number(initialMinute)
      : initialMinute || null;

  const matchForBlock = {
    id: matchId || "current",
    status: currentStatus || "",
    minute: liveState?.minute ?? initialMinuteValue,
    period: liveState?.period ?? (initialPeriod || null),
    utcDate: utcDate || "",
    competition: { code: competitionCode || "", name: competitionName || "", emblem: competitionEmblem || "", surface: tennisSurface || "" },
    round: tennisRound || "",
    // Bloc 8, point 1 : "sets terminés" — dès qu'une analyse en direct a répondu, le
    // vrai score set par set (liveState.sets) prend le pas sur l'instantané pris au
    // clic depuis la liste (tennisSets, potentiellement déjà périmé).
    sets: liveState?.sets ?? tennisSets,
    homeTeam: { name: homeTeamName || "", crest: homeCrest || "", flag: homeFlag || "" },
    awayTeam: { name: awayTeamName || "", crest: awayCrest || "", flag: awayFlag || "" },
    score: {
      fullTime: liveState?.score || {
        home: scoreHome !== "" && scoreHome !== undefined ? scoreHome : null,
        away: scoreAway !== "" && scoreAway !== undefined ? scoreAway : null,
      },
    },
    // Tennis uniquement (bloc 8, point 1 : "indicateur du joueur au service" dans
    // l'en-tête détaillé) — vient toujours de la dernière analyse (liveState), jamais
    // deviné ; absent pour le football/basket, qui ne renseignent jamais ce champ.
    server: liveState?.server || null,
  };

  if (!sessionChecked) {
    return (
      <div style={st.page}>
        <p style={st.hint}>Chargement…</p>
      </div>
    );
  }
  if (!authorized) return null;

  const kickoff = formatKickoff(utcDate);
  const venue = pronostic?.venue;
  const referee = pronostic?.referee;

  return (
    <div style={st.page}>
      <MatchHeaderHero m={matchForBlock} isLive={isLiveNow} />

      {/* Épinglée juste sous le score (position: sticky) : en faisant défiler la page,
          les moments forts restent visibles en premier, avant le reste du contenu —
          seule la liste des événements défile en interne (hauteur bornée) une fois
          qu'elle dépasse ce qui tient à l'écran. Bloc 4 (basket)/Bloc 8 (tennis) :
          reste épinglée en haut EXACTEMENT comme le football (PROMPT : "il reste
          toujours en haut"), chacun avec sa propre timeline dérivée du score officiel
          (jamais "Événement non disponible", voir components/BasketballMatchTimeline.js
          et components/TennisMatchTimeline.js). */}
      {isLiveNow && (
        <section style={st.pinnedPanel} data-testid="pinned-highlights">
          <h2 style={st.h2}>Moments forts</h2>
          <div style={st.timelineScroll}>
            {isBasketball ? (
              <BasketballMatchTimeline events={liveState?.events} timelineNote={liveState?.timelineNote} />
            ) : isTennis ? (
              <TennisMatchTimeline events={liveState?.events} timelineNote={liveState?.timelineNote} />
            ) : (
              <MatchTimeline events={liveState?.events} homeTeamId={homeTeamId} isLive />
            )}
          </div>
        </section>
      )}

      <main style={st.main}>
        <section style={st.panel}>
          {!isBasketball && !isTennis && pronostic?.home && pronostic?.away && (
            <div style={st.formRow}>
              <div style={st.formCell}>
                <FormBadges form={pronostic.home.form} />
              </div>
              <div style={st.formCell}>
                <FormBadges form={pronostic.away.form} />
              </div>
            </div>
          )}

          {homeTeamName && awayTeamName && (
            <p style={st.descText}>
              {isBasketball
                ? `${homeTeamName} affronte ${awayTeamName}${competitionName ? ` en ${competitionName}` : ""}. Retrouve ci-dessous l'analyse statistique : probabilité de victoire, scores finaux probables et statistiques de match estimées.`
                : isTennis
                ? `${homeTeamName} affronte ${awayTeamName}${competitionName ? ` en ${competitionName}` : ""}${tennisRound ? ` (${tennisRound})` : ""}. Retrouve ci-dessous l'analyse statistique : probabilité de victoire, scores en sets probables et totaux de jeux estimés.`
                : `${homeTeamName} affronte ${awayTeamName}${competitionName ? ` en ${competitionName}` : ""}. Retrouve ci-dessous l'analyse statistique : probabilités 1X2, buts/corners/tirs probables et score exact estimé.`}
            </p>
          )}

          <div style={st.infoGrid}>
            <div style={st.infoCell}>
              <span style={st.infoLabel}>{isTennis ? "Horaire" : "Coup d'envoi"}</span>
              <span style={st.infoValue}>{kickoff || "Indisponible"}</span>
            </div>
            {!isBasketball && !isTennis && (
              <>
                <div style={st.infoCell}>
                  <span style={st.infoLabel}>Stade</span>
                  <span style={st.infoValue}>{venue || "Indisponible"}</span>
                </div>
                <div style={st.infoCell}>
                  <span style={st.infoLabel}>Arbitre</span>
                  <span style={st.infoValue}>{referee || "Indisponible"}</span>
                </div>
              </>
            )}
            {isTennis && (
              <>
                <div style={st.infoCell}>
                  <span style={st.infoLabel}>Surface</span>
                  <span style={st.infoValue}>{tennisSurface || "Indisponible"}</span>
                </div>
                <div style={st.infoCell}>
                  <span style={st.infoLabel}>Tour</span>
                  <span style={st.infoValue}>{tennisRound || "Indisponible"}</span>
                </div>
              </>
            )}
          </div>

          <div style={st.divider} />

          <h2 style={st.h2}>Pronostics automatiques</h2>
          {/* "Historique" (voir PROMPT) : un match rouvert depuis l'historique une fois
              terminé affiche cette mention, avec ses pronostics/analyses juste en
              dessous — jamais un score muet sans contexte. S'affiche pour tout match
              constaté terminé, peu importe le chemin emprunté pour y arriver. */}
          {isFinishedNow && (
            <p style={st.finishedHint} data-testid="match-finished-tag">Match terminé</p>
          )}
          {isLiveNow && (
            <p style={st.liveHint}>
              {isBasketball
                ? "Le score, la probabilité de victoire, les scores finaux probables et les totaux de points suivent l'évolution du match en direct. Les autres lignes (rebonds, passes décisives, tirs à 3 points, fautes, ballons perdus, lancers francs, joueurs à suivre) ont été calculées une seule fois avant le match et restent identiques jusqu'à la fin — une référence stable pour parier dessus."
                : isTennis
                ? "Le score, la probabilité de victoire, les scores en sets probables et les totaux de jeux suivent l'évolution du match en direct. Les autres lignes (aces, doubles fautes, breaks, jeu décisif, handicap jeux) ont été calculées une seule fois avant le match et restent identiques jusqu'à la fin — une référence stable pour parier dessus."
                : "Le score, les moments forts, les probabilités de victoire, les scores exacts et les totaux de buts suivent l'évolution du match en direct. Les autres lignes (Corners, Hors-jeu, Fautes, Touches, tirs, cartons...) ont été calculées une seule fois avant le match et restent identiques jusqu'à la fin — une référence stable pour parier dessus."}
            </p>
          )}

          <button style={st.analyzeBtn} onClick={() => runAnalysis(false)} disabled={loading}>
            {loading ? "Analyse en cours…" : hasRequested ? "Actualiser" : "Analyser ce match"}
          </button>
        </section>

        {isTennis ? (
          <>
            {/* Bloc 8 (PROMPT point 4) : "Un clic sur un match terminé montre si ses
                pronostics ont été validés" — même emplacement que le football/basket
                (tout en premier, avant les cartes de pronostics elles-mêmes).
                `pronostic.verification` n'existe que pour un match déjà classé (voir
                pages/api/tennis/analyze.js) ; le composant ne s'affiche donc de
                lui-même que si cette donnée est là. */}
            {!loading && hasRequested && isFinishedNow && <TennisMatchOutcomeRecap pronostic={pronostic} />}

            {/* Bloc 7 : Probabilité de victoire, scores en sets probables, totaux de
                jeux, handicap jeux, sets (blocs 1-5) — voir components/
                TennisPronosticResults.js. */}
            {!loading && hasRequested && <TennisPronosticResults pronostic={pronostic} />}
            {/* Aces, doubles fautes, breaks, jeu décisif (blocs 6-9). */}
            {!loading && hasRequested && pronostic?.available && <TennisSecondaryStats pronostic={pronostic} />}
            {/* Contexte service/retour (bloc 10). */}
            {!loading && hasRequested && pronostic?.available && <TennisServiceReturnContext pronostic={pronostic} />}
            {/* Scénario du match (bloc 11). */}
            {!loading && hasRequested && pronostic?.available && <TennisMatchScenario pronostic={pronostic} />}

            {!isLiveNow && (
              <section style={st.panel}>
                <h2 style={st.h2}>Moments forts</h2>
                <TennisMatchTimeline events={liveState?.events} timelineNote={liveState?.timelineNote} />
              </section>
            )}
          </>
        ) : isBasketball ? (
          <>
            {/* Bloc 4 (PROMPT point 4) : "En cliquant sur un match terminé, on voit si
                ses pronostics ont été validés ou non" — même emplacement que le
                football (tout en premier, avant les cartes de pronostics elles-mêmes).
                `pronostic.verification` n'existe que pour un match déjà classé (voir
                pages/api/basketball/analyze.js) ; le composant ne s'affiche donc de
                lui-même que si cette donnée est là. */}
            {!loading && hasRequested && isFinishedNow && <BasketballMatchOutcomeRecap pronostic={pronostic} />}

            {!loading && hasRequested && <BasketballPronosticResults pronostic={pronostic} />}
            {!loading && hasRequested && pronostic?.available && <BasketballPeriodsBlock pronostic={pronostic} />}
            {!loading && hasRequested && pronostic?.available && <BasketballSecondaryStats pronostic={pronostic} />}
            {!loading && hasRequested && pronostic?.available && <BasketballSingleTotals pronostic={pronostic} />}
            {!loading && hasRequested && pronostic?.available && <BasketballPlayersToWatch pronostic={pronostic} />}

            {!isLiveNow && (
              <section style={st.panel}>
                <h2 style={st.h2}>Moments forts</h2>
                <BasketballMatchTimeline events={liveState?.events} timelineNote={liveState?.timelineNote} />
              </section>
            )}
          </>
        ) : (
          <>
            {/* Bloc 4 : sur un match déjà terminé, le compte-rendu (crochet vert/croix
                rouge par ligne de pronostic, y compris Réussi/Échec de la probabilité de
                victoire) apparaît en tout premier, avant les cartes de pronostics
                elles-mêmes — voir components/MatchOutcomeRecap.js. `pronostic.verification`
                n'existe que pour un match déjà classé (voir pages/api/analyze.js) ; le
                composant ne s'affiche donc de lui-même que si cette donnée est là. */}
            {!loading && hasRequested && isFinishedNow && <MatchOutcomeRecap pronostic={pronostic} />}

            {/* Résumé d'avant-match (PROMPT 2, voir components/PreMatchSummary.js) : en
                tout premier parmi les cartes de pronostics, avant "Probabilité de
                victoire" — comparaison du niveau des deux équipes et scénario le plus
                probable, générés à partir des vrais chiffres de CE match. */}
            {!loading && hasRequested && <PreMatchSummary pronostic={pronostic} />}

            {/* Cartes de pronostics séparées de la section ci-dessus (voir
                components/PronosticResults.js) : "Probabilité de victoire" en premier,
                "Statistiques du match" ensuite — chacune sa propre carte visuelle. */}
            {!loading && hasRequested && <PronosticResults pronostic={pronostic} loading={loading} />}
            {!loading && hasRequested && <ProbableScorers pronostic={pronostic} />}

            {!isLiveNow && (
              <section style={st.panel}>
                <h2 style={st.h2}>Moments forts</h2>
                <MatchTimeline events={liveState?.events} homeTeamId={homeTeamId} />
              </section>
            )}

            {/* Corners / Hors-jeu / Fautes / Touches (Total match + mi-temps, figés comme
                le reste des pronostics — voir components/LiveStatBlock.js et
                lib/pronostic.js:buildMatchStats), puis cartons, puis passes décisives :
                tout en bas de la page, chacun sa propre carte visuelle, même structure et
                même logique pour les 4 premiers blocs. */}
            {!loading && hasRequested && (
              <LiveStatBlock
                testId="stat-corners"
                title="Corners"
                block={pronostic?.matchStats?.corners}
                note={pronostic?.liveStatNote}
                narrative={pronostic?.narrative?.corners}
              />
            )}
            {!loading && hasRequested && (
              <LiveStatBlock
                testId="stat-offsides"
                title="Hors-jeu"
                block={pronostic?.matchStats?.offsides}
                narrative={pronostic?.narrative?.offsides}
              />
            )}
            {!loading && hasRequested && (
              <LiveStatBlock
                testId="stat-fouls"
                title="Fautes"
                block={pronostic?.matchStats?.fouls}
                narrative={pronostic?.narrative?.fouls}
              />
            )}
            {!loading && hasRequested && (
              <LiveStatBlock
                testId="stat-throwins"
                title="Touches"
                block={pronostic?.matchStats?.throwIns}
                narrative={pronostic?.narrative?.throwIns}
              />
            )}
            {!loading && hasRequested && <CardsAndCorners pronostic={pronostic} />}
            {!loading && hasRequested && <AssistsProbables pronostic={pronostic} />}
          </>
        )}
      </main>
    </div>
  );
}

const st = {
  page: { minHeight: "100vh", padding: "20px 16px 60px" },
  main: { maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 },
  panel: { background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 },
  pinnedPanel: {
    position: "sticky", top: 0, zIndex: 5, maxWidth: 640, margin: "0 auto 16px",
    background: "var(--card-bg)", border: "1px solid var(--accent)", borderRadius: 14, padding: 18,
    boxShadow: "0 6px 18px rgba(0,0,0,0.15)",
  },
  timelineScroll: { maxHeight: "34vh", overflowY: "auto" },
  formRow: { display: "flex", justifyContent: "space-between", marginTop: 12 },
  formCell: { display: "flex" },
  descText: { fontSize: 12, color: "var(--text-secondary)", margin: "14px 0 0", lineHeight: 1.5 },
  infoGrid: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 },
  infoCell: { flex: "1 1 calc(33.333% - 6px)", minWidth: 100, background: "var(--surface)", borderRadius: 8, padding: "8px 10px" },
  infoLabel: { display: "block", fontSize: 9.5, color: "var(--text-secondary)", textTransform: "uppercase" },
  infoValue: { fontSize: 12.5, fontWeight: 600 },
  divider: { borderTop: "1px solid var(--border)", margin: "16px 0" },
  h2: { fontSize: 15, margin: "0 0 4px" },
  liveHint: { fontSize: 11, color: "var(--negative)", margin: "0 0 12px" },
  finishedHint: {
    display: "inline-block", fontSize: 11, fontWeight: 700, color: "var(--text-secondary)",
    background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 999,
    padding: "4px 10px", margin: "0 0 12px",
  },
  hint: { fontSize: 12.5, color: "var(--text-secondary)" },
  analyzeBtn: {
    display: "block", width: "100%", background: "var(--accent)", border: "none", color: "var(--on-accent)",
    fontWeight: 800, fontSize: 15, borderRadius: 999, padding: "14px 0", cursor: "pointer",
    boxShadow: "0 0 18px rgba(var(--accent-rgb),0.45)",
  },
};
