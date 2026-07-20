import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/router";
import { useRequireAuth } from "../lib/useRequireAuth";
import { getRecentSearches, saveSearch } from "../lib/personalization";
import { presentCompetitions, presentMatchdays } from "../lib/matchFilters";
import MatchCard, { matchHref } from "../components/MatchCard";
import MatchInfoBlock from "../components/MatchInfoBlock";
import SiteHeader from "../components/SiteHeader";
import FilterCarousel from "../components/FilterCarousel";

// Grâce au cache partagé côté serveur (lib/liveListCache.js, actualisé toutes les
// 2,5s), on peut interroger /api/live-matches très souvent depuis le client sans
// multiplier les appels en amont : la plupart des requêtes retombent sur le cache,
// et dès qu'un but est marqué, la requête suivante (au plus 2s après) le reflète.
const LIVE_REFRESH_ACTIVE_MS = 2000;
const LIVE_REFRESH_BACKGROUND_MS = 45000;

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
  const router = useRouter();
  const userId = session?.user?.id;

  const [search, setSearch] = useState("");
  const [recentSearches, setRecentSearches] = useState([]);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [compFilter, setCompFilter] = useState("all");
  const [matchdayFilter, setMatchdayFilter] = useState("all");

  const [liveData, setLiveData] = useState(null);
  const [liveLoading, setLiveLoading] = useState(true);

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
  // données servies avant authentification).
  useEffect(() => {
    if (!authorized) return;
    loadLiveMatches();
  }, [authorized, loadLiveMatches]);

  // Rafraîchissement automatique des matchs en direct (scores, minute de jeu), sans
  // recharger la page.
  useEffect(() => {
    if (!authorized) return;
    const id = setInterval(() => loadLiveMatches(true), LIVE_REFRESH_ACTIVE_MS);
    return () => clearInterval(id);
  }, [authorized, loadLiveMatches]);

  // Historique de recherche : personnel à chaque compte (Supabase, avec RLS — voir
  // supabase/migrations/0001_personalization.sql), jamais partagé entre deux comptes.
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
  // n'affiche aucune donnée.
  if (!sessionChecked) {
    return (
      <div style={st.page}>
        <p style={st.hint}>Chargement…</p>
      </div>
    );
  }
  if (!authorized) return null;

  return (
    <div style={st.page}>
      <SiteHeader session={session} />

      <main style={st.main}>
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
      </main>
    </div>
  );
}

const st = {
  page: { minHeight: "100vh", padding: "20px 16px 60px" },
  main: { maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 },
  hero: { textAlign: "center", padding: "8px 4px" },
  heroTitle: { fontSize: 21, fontWeight: 800, margin: "0 0 8px", lineHeight: 1.25 },
  heroSubtitle: { fontSize: 12, color: "#5C7A6A", margin: 0, lineHeight: 1.5 },
  featuredCard: {
    display: "block", width: "100%", textAlign: "left", cursor: "pointer",
    background: "#FFFFFF", border: "1px solid #39B577", borderRadius: 14, padding: 16,
    boxShadow: "0 0 20px rgba(57,181,119,0.15)",
  },
  featuredBanner: {
    display: "inline-block", fontSize: 10, fontWeight: 800, color: "#1A7F4F",
    textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10,
  },
  chipsInfoRow: { display: "flex", flexWrap: "wrap", gap: 6 },
  chip: {
    background: "#FFFFFF", border: "1px solid #D8E6DE", color: "#5C7A6A",
    borderRadius: 999, padding: "6px 12px", fontSize: 12, cursor: "pointer",
  },
  chipLive: { color: "#C0392B", borderColor: "#C0392B" },
  hint: { fontSize: 12.5, color: "#5C7A6A" },
  chipsRow: { display: "flex", flexWrap: "wrap", gap: 6 },
  searchRow: { display: "flex", gap: 8 },
  searchInput: {
    flex: 1, background: "#FFFFFF", border: "1px solid #D8E6DE", color: "#13291D",
    borderRadius: 999, padding: "10px 16px", fontSize: 13,
  },
  searchBtn: {
    background: "#39B577", border: "none", color: "#06121F", fontWeight: 700,
    borderRadius: 999, padding: "0 18px", fontSize: 13, cursor: "pointer",
  },
};
