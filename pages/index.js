import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/router";
import { useRequireAuth } from "../lib/useRequireAuth";
import { useSport } from "../lib/useSport";
import { getRecentSearches, saveSearch } from "../lib/personalization";
import { presentCompetitions, presentMatchdays } from "../lib/matchFilters";
import MatchCard, { matchHref } from "../components/MatchCard";
import MatchInfoBlock from "../components/MatchInfoBlock";
import SiteHeader from "../components/SiteHeader";
import FilterCarousel from "../components/FilterCarousel";
import SportComingSoon from "../components/SportComingSoon";
import { formatMinutesAgo } from "../lib/formatRelativeTime";

// Grâce au cache partagé côté serveur (lib/liveListCache.js, actualisé toutes les
// 2,5s), on peut interroger /api/live-matches très souvent depuis le client sans
// multiplier les appels en amont : la plupart des requêtes retombent sur le cache,
// et dès qu'un but est marqué, la requête suivante (au plus 2s après) le reflète.
const LIVE_REFRESH_ACTIVE_MS = 2000;
const LIVE_REFRESH_BACKGROUND_MS = 45000;

// Multi-sport bloc 2 : basket, moins fréquent que le direct football (voir
// pages/api/basketball/live-matches.js, déjà mis en cache 45s côté serveur) — un
// rafraîchissement client dans la fourchette demandée (15-30s, voir PROMPT bloc 1)
// suffit pour une "actualisation continue et automatique du score" sans jamais
// dépasser le quota réel en amont.
const BASKETBALL_LIVE_REFRESH_MS = 20000;

// Multi-sport bloc 5 : tennis, même principe — cache serveur 20s (voir pages/api/
// tennis/live-matches.js), rafraîchissement client dans la fourchette demandée par
// le PROMPT (15-30s), 20s au milieu.
const TENNIS_LIVE_REFRESH_MS = 20000;

// Exemples illustratifs pour la barre de recherche (rien n'est envoyé/affiché comme
// résultat réel tant que la personne n'a rien tapé) — juste une aide visuelle.
const SEARCH_PLACEHOLDER_EXAMPLES = [
  "Rechercher une équipe, une compétition…",
  "Ex : Real Madrid",
  "Ex : Premier League",
  "Ex : Ligue des Champions",
];

function normalize(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

// Page "Matchs en ligne" (PROMPT 2 du plan) : accueil du site, dédié exclusivement
// aux matchs actuellement en direct (vraie API, voir PROMPT 1). Les matchs à venir
// vivent désormais sur leur propre page (/a-venir).
export default function Home() {
  const { session, sessionChecked, authorized } = useRequireAuth();
  const { sport, setSport, sportReady } = useSport();
  const router = useRouter();
  const userId = session?.id;

  const [search, setSearch] = useState("");
  const [recentSearches, setRecentSearches] = useState([]);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [compFilter, setCompFilter] = useState("all");
  const [matchdayFilter, setMatchdayFilter] = useState("all");

  const [liveData, setLiveData] = useState(null);
  const [liveLoading, setLiveLoading] = useState(true);

  const [bkLiveData, setBkLiveData] = useState(null);
  const [bkLiveLoading, setBkLiveLoading] = useState(true);

  const [tnLiveData, setTnLiveData] = useState(null);
  const [tnLiveLoading, setTnLiveLoading] = useState(true);

  // Placeholder de recherche qui change régulièrement (simple indication visuelle,
  // pas une donnée réelle).
  useEffect(() => {
    const id = setInterval(() => {
      setPlaceholderIndex((i) => (i + 1) % SEARCH_PLACEHOLDER_EXAMPLES.length);
    }, 3000);
    return () => clearInterval(id);
  }, []);

  // silent=true (rafraîchissement automatique en arrière-plan) : une erreur passagère
  // (quota API, réseau) ne doit jamais effacer des matchs déjà affichés à l'écran — on
  // se contente de réessayer au prochain cycle. silent=false (chargement initial ou
  // action explicite de l'utilisateur) : on reflète le résultat tel quel, y compris
  // une éventuelle erreur, pour donner un retour clair.
  const loadLiveMatches = useCallback((silent = false) => {
    if (!silent) setLiveLoading(true);
    return fetch("/api/live-matches")
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) {
          console.error("Erreur /api/live-matches:", d.error);
          if (silent) return;
        }
        setLiveData(d);
      })
      .catch((e) => {
        console.error("Erreur /api/live-matches:", e);
        if (!silent) setLiveData({ error: true, matches: [] });
      })
      .finally(() => setLiveLoading(false));
  }, []);

  // Tant que la personne n'est pas connectée, on n'interroge même pas l'API (pas de
  // données servies avant authentification). Multi-sport (bloc 0) : /api/live-matches
  // ne sert que du football (voir lib/sports/football) — inutile d'interroger l'API
  // (et de consommer son quota) tant que l'onglet Basket/Tennis est affiché, puisque
  // SportComingSoon s'affiche à la place de toute façon.
  useEffect(() => {
    if (!authorized || sport !== "football") return;
    loadLiveMatches();
  }, [authorized, sport, loadLiveMatches]);

  // Rafraîchissement automatique des matchs en direct (scores, minute de jeu), sans
  // recharger la page.
  useEffect(() => {
    if (!authorized || sport !== "football") return;
    const id = setInterval(() => loadLiveMatches(true), LIVE_REFRESH_ACTIVE_MS);
    return () => clearInterval(id);
  }, [authorized, sport, loadLiveMatches]);

  // Multi-sport bloc 2 : mêmes principes que le football ci-dessus (silent=true ne
  // doit jamais effacer des matchs déjà affichés lors d'un incident passager), pour
  // /api/basketball/live-matches (voir pages/api/basketball/live-matches.js).
  const loadBkLiveMatches = useCallback((silent = false) => {
    if (!silent) setBkLiveLoading(true);
    return fetch("/api/basketball/live-matches")
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) {
          console.error("Erreur /api/basketball/live-matches:", d.error);
          if (silent) return;
        }
        setBkLiveData(d);
      })
      .catch((e) => {
        console.error("Erreur /api/basketball/live-matches:", e);
        if (!silent) setBkLiveData({ error: true, matches: [] });
      })
      .finally(() => setBkLiveLoading(false));
  }, []);

  useEffect(() => {
    if (!authorized || sport !== "basketball") return;
    loadBkLiveMatches();
  }, [authorized, sport, loadBkLiveMatches]);

  useEffect(() => {
    if (!authorized || sport !== "basketball") return;
    const id = setInterval(() => loadBkLiveMatches(true), BASKETBALL_LIVE_REFRESH_MS);
    return () => clearInterval(id);
  }, [authorized, sport, loadBkLiveMatches]);

  // Multi-sport bloc 5 : mêmes principes que basket/football ci-dessus, pour
  // /api/tennis/live-matches (voir pages/api/tennis/live-matches.js).
  const loadTnLiveMatches = useCallback((silent = false) => {
    if (!silent) setTnLiveLoading(true);
    return fetch("/api/tennis/live-matches")
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) {
          console.error("Erreur /api/tennis/live-matches:", d.error);
          if (silent) return;
        }
        setTnLiveData(d);
      })
      .catch((e) => {
        console.error("Erreur /api/tennis/live-matches:", e);
        if (!silent) setTnLiveData({ error: true, matches: [] });
      })
      .finally(() => setTnLiveLoading(false));
  }, []);

  useEffect(() => {
    if (!authorized || sport !== "tennis") return;
    loadTnLiveMatches();
  }, [authorized, sport, loadTnLiveMatches]);

  useEffect(() => {
    if (!authorized || sport !== "tennis") return;
    const id = setInterval(() => loadTnLiveMatches(true), TENNIS_LIVE_REFRESH_MS);
    return () => clearInterval(id);
  }, [authorized, sport, loadTnLiveMatches]);

  // Historique de recherche : personnel à chaque compte, filtré côté serveur par
  // profile_id (voir pages/api/search-history.js), jamais partagé entre deux comptes.
  useEffect(() => {
    if (!authorized || !userId) return;
    getRecentSearches(userId).then(setRecentSearches);
  }, [authorized, userId]);

  const searchQuery = search.trim();

  // Sauvegarde la recherche sur le compte une fois que la personne s'arrête de
  // taper (pas à chaque frappe), pour la retrouver comme suggestion la prochaine fois.
  useEffect(() => {
    if (!authorized || !userId || !searchQuery) return;
    const id = setTimeout(() => {
      saveSearch(userId, searchQuery);
      setRecentSearches((prev) => {
        const withoutDup = prev.filter((q) => q.toLowerCase() !== searchQuery.toLowerCase());
        return [searchQuery, ...withoutDup].slice(0, 8);
      });
    }, 800);
    return () => clearTimeout(id);
  }, [authorized, userId, searchQuery]);

  // Choisir une compétition réinitialise la journée sélectionnée (une journée n'a de
  // sens que dans le contexte de la compétition qui vient d'être choisie).
  const selectCompetitionFilter = (value) => {
    setCompFilter(value);
    setMatchdayFilter("all");
  };

  // Options des deux carrousels (PROMPT 6), déduites des vrais matchs actuellement
  // chargés — jamais une compétition ou une journée sans aucun match derrière.
  const competitionOptions = useMemo(() => presentCompetitions(liveData?.matches), [liveData]);
  const matchdayOptions = useMemo(
    () => (compFilter === "all" ? [] : presentMatchdays(liveData?.matches, compFilter)),
    [liveData, compFilter]
  );

  // Matchs en direct (statut LIVE/IN_PLAY/PAUSED) : exactement ce que l'API renvoie,
  // jamais de matchs inventés pour compléter la liste, filtré par compétition/journée
  // (carrousels) puis par la recherche texte.
  const liveFeed = useMemo(() => {
    if (!liveData?.matches) return [];
    let matches = liveData.matches.filter((m) => m?.homeTeam && m?.awayTeam && m?.utcDate);
    if (compFilter !== "all") matches = matches.filter((m) => m.competition?.code === compFilter);
    if (matchdayFilter !== "all") matches = matches.filter((m) => String(m.matchday) === matchdayFilter);
    const q = normalize(searchQuery);
    if (q) {
      matches = matches.filter(
        (m) =>
          normalize(m.homeTeam.name).includes(q) ||
          normalize(m.awayTeam.name).includes(q) ||
          normalize(m.competition?.name).includes(q)
      );
    }
    return matches.map((m) => ({ m, comp: m.competition }));
  }, [liveData, searchQuery, compFilter, matchdayFilter]);

  const liveCount = liveData?.matches?.length || 0;

  // Multi-sport bloc 2 : TOUS les matchs basket en direct, toutes ligues confondues,
  // sans exception (voir PROMPT bloc 2, point 1) — aucun filtre, contrairement au
  // football ci-dessus (non demandé pour le basket dans ce bloc).
  const bkFeed = useMemo(() => {
    if (!bkLiveData?.matches) return [];
    return bkLiveData.matches
      .filter((m) => m?.homeTeam && m?.awayTeam && m?.utcDate)
      .map((m) => ({ m, comp: m.competition }));
  }, [bkLiveData]);

  // Multi-sport bloc 5 : TOUS les matchs tennis en direct, toutes catégories
  // confondues (ATP, WTA, Grand Chelem, Masters 1000, ATP 250/500, Challengers,
  // ITF — voir PROMPT bloc 5, point 3), aucun filtre.
  const tnFeed = useMemo(() => {
    if (!tnLiveData?.matches) return [];
    return tnLiveData.matches
      .filter((m) => m?.homeTeam && m?.awayTeam && m?.utcDate)
      .map((m) => ({ m, comp: m.competition }));
  }, [tnLiveData]);

  // Match phare : le premier match réellement en direct, jamais un match inventé.
  // Calculé à partir des données brutes (pas de la liste déjà filtrée par la
  // recherche) : une recherche en cours ne doit pas faire changer ce qui est mis en
  // avant en haut de la page.
  const featuredMatch = useMemo(() => {
    const liveMatches = (liveData?.matches || []).filter((m) => m?.homeTeam && m?.awayTeam && m?.utcDate);
    return liveMatches.length > 0 ? { m: liveMatches[0], comp: liveMatches[0].competition } : null;
  }, [liveData]);

  // L'accès à l'application nécessite un compte : tant que la session n'a pas été
  // vérifiée, ou si personne n'est connecté (redirection vers /login en cours), on
  // n'affiche aucune donnée. `sportReady` (multi-sport, bloc 0) : idem pour le sport
  // mémorisé (voir lib/useSport.js) — jamais un flash "Football" avant la vraie
  // lecture du cookie.
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
        {sport === "basketball" ? (
          <>
            <section style={st.hero}>
              <h1 style={st.heroTitle}>Basket en direct</h1>
              <p style={st.heroSubtitle}>
                Scores en direct, quart-temps par quart-temps, sur toutes les ligues suivies par
                Blume — NBA, EuroLeague, WNBA, NCAA, championnats nationaux et plus.
              </p>
            </section>

            <div style={st.chipsInfoRow}>
              <span style={st.chip}>Basket</span>
              <span style={{ ...st.chip, ...st.chipLive }}>Live : {bkFeed.length}</span>
            </div>

            {bkLiveLoading && <p style={st.hint}>Chargement des matchs…</p>}
            {!bkLiveLoading && (!bkLiveData || bkLiveData?.error) && (
              <p style={st.hint}>Les matchs ne sont pas disponibles pour le moment. Réessaie dans quelques minutes.</p>
            )}
            {!bkLiveLoading && bkLiveData && !bkLiveData.error && bkFeed.length === 0 && (
              <p style={st.hint}>Aucun match en direct pour ce sport actuellement.</p>
            )}
            {!bkLiveLoading && bkLiveData?.stale && (
              <p style={st.staleNote}>Données mises à jour {formatMinutesAgo(bkLiveData.lastUpdated)}</p>
            )}

            <div data-testid="match-list">
              {bkFeed.map(({ m, comp }) => (
                <MatchCard key={m.id} m={m} comp={comp} />
              ))}
            </div>
          </>
        ) : sport === "tennis" ? (
          <>
            <section style={st.hero}>
              <h1 style={st.heroTitle}>Tennis en direct</h1>
              <p style={st.heroSubtitle}>
                Scores en direct, set par set, sur tous les circuits suivis par Blume — ATP, WTA, Grand
                Chelem, Masters 1000, ATP 250/500, Challengers et ITF.
              </p>
            </section>

            <div style={st.chipsInfoRow}>
              <span style={st.chip}>Tennis</span>
              <span style={{ ...st.chip, ...st.chipLive }}>Live : {tnFeed.length}</span>
            </div>

            {tnLiveLoading && <p style={st.hint}>Chargement des matchs…</p>}
            {!tnLiveLoading && (!tnLiveData || tnLiveData?.error) && (
              <p style={st.hint}>Les matchs ne sont pas disponibles pour le moment. Réessaie dans quelques minutes.</p>
            )}
            {!tnLiveLoading && tnLiveData && !tnLiveData.error && tnFeed.length === 0 && (
              <p style={st.hint}>Aucun match en direct actuellement.</p>
            )}

            <div data-testid="match-list">
              {tnFeed.map(({ m, comp }) => (
                <MatchCard key={m.id} m={m} comp={comp} />
              ))}
            </div>
          </>
        ) : sport !== "football" ? (
          <SportComingSoon sport={sport} pageLabel="Matchs en direct" />
        ) : (
          <>
            <section style={st.hero}>
              <h1 style={st.heroTitle}>Football en direct</h1>
              <p style={st.heroSubtitle}>
                Scores en direct, minute par minute, sur toutes les compétitions suivies par Blume —
                Coupe du Monde, Ligue des Champions, Premier League, LaLiga, Serie A, Bundesliga, Ligue 1
                et plus.
              </p>
            </section>

            {featuredMatch && (
              <button
                type="button"
                style={st.featuredCard}
                data-testid="featured-match"
                onClick={() => router.push(matchHref(featuredMatch.m, featuredMatch.comp))}
              >
                <span style={st.featuredBanner}>EN DIRECT</span>
                <MatchInfoBlock m={featuredMatch.m} comp={featuredMatch.comp} />
              </button>
            )}

            <div style={st.chipsInfoRow}>
              <span style={st.chip}>Les plus populaires</span>
              <span style={st.chip}>Football</span>
              <span style={{ ...st.chip, ...st.chipLive }}>Live : {liveCount}</span>
            </div>

            <FilterCarousel
              testId="competition-filter"
              allLabel="Toutes les compétitions"
              items={competitionOptions}
              selected={compFilter}
              onSelect={selectCompetitionFilter}
            />
            <FilterCarousel
              testId="matchday-filter"
              allLabel="Toutes les journées"
              items={matchdayOptions}
              selected={matchdayFilter}
              onSelect={setMatchdayFilter}
            />

            <div style={st.searchRow}>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={SEARCH_PLACEHOLDER_EXAMPLES[placeholderIndex]}
                style={st.searchInput}
              />
              {search && (
                <button style={st.searchBtn} onClick={() => setSearch("")}>✕</button>
              )}
            </div>

            {!search && recentSearches.length > 0 && (
              <div style={st.chipsRow}>
                {recentSearches.map((q) => (
                  <button key={q} type="button" style={st.chip} onClick={() => setSearch(q)}>
                    {q}
                  </button>
                ))}
              </div>
            )}

            {liveLoading && <p style={st.hint}>Chargement des matchs…</p>}
            {!liveLoading && (!liveData || liveData?.error) && (
              <p style={st.hint}>Les matchs ne sont pas disponibles pour le moment. Réessaie dans quelques minutes.</p>
            )}
            {!liveLoading && liveData && !liveData.error && liveFeed.length === 0 && (
              <p style={st.hint}>
                {searchQuery
                  ? "Aucun match ne correspond à ta recherche."
                  : compFilter !== "all"
                  ? "Aucun match en direct actuellement pour ce filtre."
                  : "Aucun match en direct actuellement."}
              </p>
            )}

            <div data-testid="match-list">
              {liveFeed.map(({ m, comp }) => (
                <MatchCard key={m.id} m={m} comp={comp} />
              ))}
            </div>
          </>
        )}
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
  featuredCard: {
    display: "block", width: "100%", textAlign: "left", cursor: "pointer",
    background: "var(--card-bg)", border: "1px solid var(--accent)", borderRadius: 14, padding: 16,
    boxShadow: "0 0 20px rgba(var(--accent-rgb),0.15)",
  },
  featuredBanner: {
    display: "inline-block", fontSize: 10, fontWeight: 800, color: "var(--accent)",
    textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10,
  },
  chipsInfoRow: { display: "flex", flexWrap: "wrap", gap: 6 },
  chip: {
    background: "var(--card-bg)", border: "1px solid var(--border)", color: "var(--text-secondary)",
    borderRadius: 999, padding: "6px 12px", fontSize: 12, cursor: "pointer",
  },
  chipLive: { color: "var(--negative)", borderColor: "var(--negative)" },
  hint: { fontSize: 12.5, color: "var(--text-secondary)" },
  // Message discret (jamais une erreur) affiché quand le quota API du jour est épuisé
  // et que les matchs viennent du dernier cache connu (voir PROMPT, pages/api/
  // basketball/*.js) — même ton que .hint, en italique pour rester secondaire.
  staleNote: { fontSize: 11.5, color: "var(--text-secondary)", fontStyle: "italic", margin: "4px 0 0" },
  chipsRow: { display: "flex", flexWrap: "wrap", gap: 6 },
  searchRow: { display: "flex", gap: 8 },
  searchInput: {
    flex: 1, background: "var(--card-bg)", border: "1px solid var(--border)", color: "var(--text-primary)",
    borderRadius: 999, padding: "10px 16px", fontSize: 13,
  },
  searchBtn: {
    background: "var(--accent)", border: "none", color: "var(--on-accent)", fontWeight: 700,
    borderRadius: 999, padding: "0 18px", fontSize: 13, cursor: "pointer",
  },
};
