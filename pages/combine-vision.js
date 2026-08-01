import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRequireAuth } from "../lib/useRequireAuth";
import { useSport } from "../lib/useSport";
import { generateCombos, RISK_LABELS } from "../lib/combinedVision";
import SiteHeader from "../components/SiteHeader";
import CombinedVisionTicket from "../components/CombinedVisionTicket";

const RISK_ORDER = ["faible", "moyen", "eleve"];
const LIVE_STATUSES = ["IN_PLAY", "PAUSED"];

// Les combinés changent de composition à chaque actualisation (tirage aléatoire parmi
// les lignes éligibles, voir lib/combinedVision.js) — un intervalle modéré suffit,
// aligné sur le cache serveur de /api/matches (s-maxage=60) pour ne jamais dépasser le
// quota football-data.org.
const REFRESH_MS = 45000;

// Bloc 9 (multi-sport) — contrairement au football (dont /api/matches et /api/
// live-matches calculent déjà un pronostic complet pour CHAQUE match, gratuitement,
// depuis le classement), un pronostic basket/tennis réel exige un profil par équipe/
// joueur (appels API dédiés, voir lib/sports/basketball/statProfiles.js et lib/
// sports/tennis/statProfiles.js) — jamais bon marché pour la totalité d'une liste.
// On borne donc le nombre de matchs basket/tennis analysés automatiquement à CHAQUE
// cycle de rafraîchissement (tous les matchs déjà en direct, généralement peu
// nombreux à la fois, puis les N prochains à venir) : exactement ce qui se
// passerait si une personne cliquait "Analyser" sur ces matchs elle-même — jamais un
// appel par match de la liste entière, qui viderait le quota d'un coup.
const MAX_BACKGROUND_ANALYSES_PER_SPORT = 6;

const SPORT_FILTERS = [
  { key: "tous", label: "Tous" },
  { key: "football", label: "⚽ Football" },
  { key: "basketball", label: "🏀 Basket" },
  { key: "tennis", label: "🎾 Tennis" },
];

function fetchJson(url) {
  return fetch(url).then((r) => r.json()).catch((e) => {
    console.error(`Erreur ${url}:`, e);
    return null;
  });
}

// Parmi les matchs basket/tennis actuellement chargés (en direct + à venir), choisit
// ceux à analyser automatiquement CE cycle — tous les matchs en direct (jamais
// filtrés : un match en direct doit toujours pouvoir alimenter un combiné "en live"),
// puis les prochains à venir par ordre chronologique, jusqu'à `cap`.
function selectCandidatesForAnalysis(matches, cap) {
  const live = matches.filter((m) => LIVE_STATUSES.includes(m.status));
  const upcoming = matches
    .filter((m) => !LIVE_STATUSES.includes(m.status))
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
    .slice(0, cap);
  return [...live, ...upcoming];
}

function analyzeUrl(sport, m) {
  const params = new URLSearchParams({
    matchId: m.id || "",
    homeTeamId: m.homeTeam?.id ?? "",
    awayTeamId: m.awayTeam?.id ?? "",
    homeTeamName: m.homeTeam?.name || "",
    awayTeamName: m.awayTeam?.name || "",
  });
  if (sport === "basketball") params.set("season", m.competition?.season || "");
  if (sport === "tennis") {
    params.set("surface", m.competition?.surface || "");
    params.set("category", m.competition?.category || "");
  }
  return `/api/${sport}/analyze?${params.toString()}`;
}

// Déclenche l'analyse automatique bornée (voir MAX_BACKGROUND_ANALYSES_PER_SPORT) et
// attache le VRAI pronostic obtenu directement sur chaque objet match (`m.pronostic`)
// — exactement la même forme que celle déjà attachée par /api/matches pour le
// football, pour que lib/combinedVision.js n'ait besoin d'aucune distinction. `cache`
// (une Map matchId -> pronostic, conservée le temps de la session de navigation)
// évite de redemander une analyse à chaque cycle pour un match déjà couvert et pas en
// direct (le pronostic ne change jamais tant que le match n'a pas commencé) ; les
// matchs déjà couverts mais non retirés ce cycle réutilisent leur dernier pronostic
// connu, jamais perdu entre deux actualisations.
async function analyzeInBackground(sport, matches, cache) {
  const candidates = selectCandidatesForAnalysis(matches, MAX_BACKGROUND_ANALYSES_PER_SPORT).filter((m) => {
    const alreadyAnalyzed = cache.has(m.id);
    return !alreadyAnalyzed || LIVE_STATUSES.includes(m.status);
  });

  await Promise.all(candidates.map(async (m) => {
    const result = await fetchJson(analyzeUrl(sport, m));
    if (result?.available) {
      m.pronostic = result;
      cache.set(m.id, result);
    } else if (cache.has(m.id)) {
      m.pronostic = cache.get(m.id);
    }
  }));

  for (const m of matches) {
    if (!m.pronostic && cache.has(m.id)) m.pronostic = cache.get(m.id);
  }
}

// Page "Combiné Vision" (bloc 9 : mélange football/basket/tennis, matchs en direct et
// à venir, sur une seule liste — voir PROMPT) : L'APP GÉNÈRE AUTOMATIQUEMENT les
// combinés, l'utilisateur ne sélectionne rien. Contrairement aux autres pages de
// contenu, cette page IGNORE le sélecteur de sport global (`sport`/`setSport`, gardé
// uniquement pour la cohérence visuelle du bandeau — voir components/SiteHeader.js) :
// un combiné mélangeant plusieurs sports n'a pas de sens à filtrer par le sport
// "actif" du site — le filtre PROPRE à cette page (voir `sportFilter` ci-dessous,
// section "Tous/Football/Basket/Tennis") répond exactement au besoin exprimé dans le
// PROMPT ("un filtre permet de voir tous les combinés ou seulement ceux d'un sport").
export default function CombineVision() {
  const { session, sessionChecked, authorized } = useRequireAuth();
  const { sport, setSport, sportReady } = useSport();

  const [footballData, setFootballData] = useState({ upcoming: null, live: null });
  // `raw*` : réponses brutes des 2 routes de chaque sport, uniquement pour détecter un
  // échec total (voir `hasError` plus bas) — les tableaux de matchs DÉRIVÉS
  // (`basketballMatches`/`tennisMatches`, avec pronostic attaché) restent toujours des
  // tableaux, même vides, jamais `null` : ne pas les confondre.
  const [basketballRaw, setBasketballRaw] = useState({ upcoming: null, live: null });
  const [tennisRaw, setTennisRaw] = useState({ upcoming: null, live: null });
  const [basketballMatches, setBasketballMatches] = useState(null);
  const [tennisMatches, setTennisMatches] = useState(null);
  const [loading, setLoading] = useState(true);
  const [combos, setCombos] = useState([]);
  // BLOC 4.B / BLOC 5 "Suivi dans le temps" — taux de réussite par niveau de risque,
  // et progression (statut global + résultat de chaque sélection) des combinés
  // actuellement affichés (voir lib/comboHistory.js / pages/api/combo-history.js).
  const [successRates, setSuccessRates] = useState({});
  const [progress, setProgress] = useState({});
  // BLOC 5 — "propositions dynamiques" : horodatage de la dernière actualisation
  // réussie, affiché près du bouton "Actualiser" pour que la personne comprenne que
  // cette liste n'est pas figée (voir PROMPT).
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  // BLOC 9 — filtre local (Tous/Football/Basket/Tennis), indépendant du sélecteur de
  // sport global (voir en-tête de fichier).
  const [sportFilter, setSportFilter] = useState("tous");

  const analyzedCache = useRef({ basketball: new Map(), tennis: new Map() });

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    return Promise.all([
      fetchJson("/api/matches"),
      fetchJson("/api/live-matches"),
      fetchJson("/api/basketball/matches"),
      fetchJson("/api/basketball/live-matches"),
      fetchJson("/api/tennis/matches"),
      fetchJson("/api/tennis/live-matches"),
    ]).then(async ([fUpcoming, fLive, bUpcoming, bLive, tUpcoming, tLive]) => {
      setFootballData({ upcoming: fUpcoming, live: fLive });
      setBasketballRaw({ upcoming: bUpcoming, live: bLive });
      setTennisRaw({ upcoming: tUpcoming, live: tLive });

      const basketball = [
        ...(bLive?.matches || []),
        ...(bUpcoming?.competitions || []).flatMap((c) => c.matches || []),
      ];
      const tennis = [
        ...(tLive?.matches || []),
        ...(tUpcoming?.competitions || []).flatMap((c) => c.matches || []),
      ];

      await Promise.all([
        analyzeInBackground("basketball", basketball, analyzedCache.current.basketball),
        analyzeInBackground("tennis", tennis, analyzedCache.current.tennis),
      ]);

      setBasketballMatches(basketball);
      setTennisMatches(tennis);
      setLastUpdatedAt(new Date());
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!authorized) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized]);

  // Actualisation automatique : de nouveaux combinés apparaissent régulièrement, sans
  // que la personne ait besoin de recharger la page (voir PROMPT).
  useEffect(() => {
    if (!authorized) return;
    const id = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [authorized, load]);

  // Tous les matchs des 3 sports, chacun étiqueté `sport` — c'est ce que
  // lib/combinedVision.js utilise pour choisir le bon seuil d'éligibilité, la bonne
  // règle "cartons rares" (football uniquement) et pour que lib/comboHistory.js sache
  // quelle API interroger à la vérification.
  const allMatches = useMemo(() => {
    const footballUpcoming = (footballData.upcoming?.competitions || []).flatMap((c) => c.matches || []);
    const footballLive = footballData.live?.matches || [];
    const football = [...footballLive, ...footballUpcoming].map((m) => ({ ...m, sport: "football" }));
    const basketball = (basketballMatches || []).map((m) => ({ ...m, sport: "basketball" }));
    const tennis = (tennisMatches || []).map((m) => ({ ...m, sport: "tennis" }));
    return [...football, ...basketball, ...tennis];
  }, [footballData, basketballMatches, tennisMatches]);

  // Une nouvelle génération (tirage aléatoire) à chaque chargement de données réussi —
  // pas seulement au premier rendu — pour que l'actualisation change réellement la
  // composition des combinés proposés.
  useEffect(() => {
    if (allMatches.length === 0) {
      setCombos([]);
      return;
    }
    setCombos(generateCombos(allMatches));
  }, [allMatches]);

  // BLOC 4.B / BLOC 5 — enregistre les combinés fraîchement générés ("pending", voir
  // lib/comboHistory.js) et relit le taux de réussite par niveau de risque + la
  // progression (statut global + résultat de chaque sélection, pour cocher au fil des
  // matchs) des combinés actuellement affichés. Best-effort : une erreur ici
  // (Supabase indisponible, migration pas encore exécutée) ne doit jamais empêcher
  // l'affichage des combinés eux-mêmes.
  useEffect(() => {
    if (combos.length === 0) return;
    fetch("/api/combo-history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ combos }),
    }).catch((e) => console.error("Erreur sauvegarde historique combinés:", e));

    const ids = combos.map((c) => c.id).join(",");
    fetch(`/api/combo-history?ids=${encodeURIComponent(ids)}`)
      .then((r) => r.json())
      .then((data) => {
        setSuccessRates(data.successRates || {});
        setProgress(data.progress || {});
      })
      .catch((e) => console.error("Erreur lecture historique combinés:", e));
  }, [combos]);

  const hasData = Boolean(
    footballData.upcoming || footballData.live
    || basketballRaw.upcoming || basketballRaw.live
    || tennisRaw.upcoming || tennisRaw.live
  );
  const hasError = !loading && !hasData;

  const displayedCombos = sportFilter === "tous"
    ? combos
    : combos.filter((c) => c.legs.some((l) => (l.sport || "football") === sportFilter));

  if (!sessionChecked || !sportReady) {
    return (
      <div style={st.page}>
        <p style={st.hint}>Chargement…</p>
      </div>
    );
  }
  if (!authorized) return null;

  return (
    <div style={st.page}>
      <SiteHeader session={session} sport={sport} onSportChange={setSport} />

      <main style={st.main}>
        <section style={st.hero}>
          <h1 style={st.heroTitle}>Combiné Vision</h1>
          <p style={st.heroSubtitle}>
            L'app assemble automatiquement des pronostics assez sûrs — football, basket et tennis, matchs en
            direct comme à venir — pour proposer des combinés à différents niveaux de risque — jamais de cote
            chiffrée, seulement les sélections détaillées et un niveau de confiance.
          </p>
        </section>

        <div style={st.refreshRow}>
          <button type="button" style={st.refreshBtn} onClick={() => load(false)} disabled={loading}>
            {loading ? "Actualisation…" : "Actualiser"}
          </button>
          {/* BLOC 5 — "propositions dynamiques" : indicateur visuel clair que la liste
              n'est pas figée, se renouvelle automatiquement (voir PROMPT). */}
          <p style={st.freshnessHint} data-testid="combined-vision-freshness">
            <span style={st.freshnessDot} aria-hidden="true" />
            {lastUpdatedAt
              ? `Mis à jour à ${lastUpdatedAt.toLocaleTimeString("fr-FR")} · se renouvelle automatiquement`
              : "Se renouvelle automatiquement"}
          </p>
        </div>

        {/* BLOC 9 — "un filtre permet de voir tous les combinés ou seulement ceux
            d'un sport" : un combiné mixte reste visible sous CHAQUE sport qu'il
            contient (jamais masqué juste parce qu'il touche aussi un autre sport). */}
        <div style={st.filterRow} data-testid="combined-vision-sport-filter">
          {SPORT_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setSportFilter(f.key)}
              style={{ ...st.filterBtn, ...(sportFilter === f.key ? st.filterBtnActive : null) }}
              aria-pressed={sportFilter === f.key}
              data-testid={`combo-sport-filter-${f.key}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading && !hasData && <p style={st.hint}>Chargement des combinés…</p>}
        {!loading && hasError && (
          <p style={st.hint}>Les combinés ne sont pas disponibles pour le moment. Réessaie dans quelques minutes.</p>
        )}
        {/* BLOC 4.D — "aucun combiné fiable disponible : ne rien forcer" : jamais un
            combiné rempli avec des lignes en dessous du seuil de confiance, juste un
            message clair invitant à revenir plus tard. */}
        {!loading && !hasError && displayedCombos.length === 0 && (
          <p style={st.hint} data-testid="combined-vision-empty">
            {combos.length === 0
              ? "Aucun combiné fiable disponible pour le moment — reviens plus tard."
              : "Aucun combiné pour ce sport en ce moment — reviens plus tard ou change de filtre."}
          </p>
        )}

        {/* BLOC 4.B — taux de réussite par niveau de risque (autorisé, ce n'est pas
            une cote — voir PROMPT) : n'apparaît que pour les niveaux ayant déjà au
            moins un combiné classé Gagné/Perdu. */}
        {RISK_ORDER.some((level) => successRates[level]) && (
          <section style={st.statsBox} data-testid="combo-success-rates">
            {RISK_ORDER.filter((level) => successRates[level]).map((level) => (
              <div key={level} style={st.statsRow} data-testid={`success-rate-${level}`}>
                {RISK_LABELS[level]} : {successRates[level].pct} % réussis ({successRates[level].total} combiné{successRates[level].total > 1 ? "s" : ""})
              </div>
            ))}
          </section>
        )}

        <div style={st.list} data-testid="combined-vision-list">
          {displayedCombos.map((combo) => (
            <CombinedVisionTicket key={combo.id} combo={combo} progress={progress[combo.id]} />
          ))}
        </div>
      </main>
    </div>
  );
}

const st = {
  page: { minHeight: "100vh", padding: "20px 16px 60px" },
  main: { maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 },
  hero: { textAlign: "center", padding: "8px 4px" },
  heroTitle: { fontSize: 21, fontWeight: 800, margin: "0 0 8px", lineHeight: 1.25 },
  heroSubtitle: { fontSize: 12, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 },
  hint: { fontSize: 12.5, color: "var(--text-secondary)" },
  refreshRow: { display: "flex", flexDirection: "column", alignItems: "center", gap: 6 },
  refreshBtn: {
    alignSelf: "center", background: "var(--accent)", border: "none", color: "var(--on-accent)", fontWeight: 800,
    borderRadius: 999, padding: "10px 24px", fontSize: 13, cursor: "pointer",
  },
  freshnessHint: {
    display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-secondary)", margin: 0,
  },
  freshnessDot: {
    width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", flexShrink: 0,
  },
  filterRow: { display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" },
  filterBtn: {
    background: "var(--card-bg)", border: "1px solid var(--border)", color: "var(--text-secondary)",
    borderRadius: 999, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
  },
  filterBtnActive: { background: "var(--accent)", borderColor: "var(--accent)", color: "var(--on-accent)" },
  list: { display: "flex", flexDirection: "column", gap: 10 },
  statsBox: {
    background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 14px",
    display: "flex", flexDirection: "column", gap: 4,
  },
  statsRow: { fontSize: 12, fontWeight: 700, color: "var(--text-primary)" },
};
