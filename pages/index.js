import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";
import { useRequireAuth } from "../lib/useRequireAuth";
import { COMPETITIONS } from "../lib/competitions";
import {
  getRecentSearches, saveSearch, getFavoriteCompetitionCodes,
  addFavoriteCompetition, removeFavoriteCompetition,
} from "../lib/personalization";
import MatchCard, { matchHref } from "../components/MatchCard";
import MatchInfoBlock from "../components/MatchInfoBlock";

const UPCOMING_STATUSES = ["SCHEDULED", "TIMED"];
const LIVE_STATUSES = ["IN_PLAY", "PAUSED", "LIVE"];
// Grâce au cache partagé côté serveur (lib/liveListCache.js, actualisé toutes les
// 2,5s), on peut interroger /api/live-matches très souvent depuis le client sans
// multiplier les appels en amont : la plupart des requêtes retombent sur le cache,
// et dès qu'un but est marqué, la requête suivante (au plus 2s après) le reflète.
const LIVE_REFRESH_ACTIVE_MS = 2000;
const LIVE_REFRESH_BACKGROUND_MS = 45000;
// Les matchs à venir et par compétition changent moins vite, mais un rafraîchissement
// périodique permet quand même de : voir un match basculer en direct sans recharger la
// page, et surtout de se rétablir tout seul après un incident passager de l'API (quota,
// réseau) sans jamais laisser l'utilisateur bloqué sur un message d'erreur permanent.
const WEEK_REFRESH_ACTIVE_MS = 60000;
const WEEK_REFRESH_BACKGROUND_MS = 5 * 60000;

// Exemples illustratifs pour la barre de recherche (rien n'est envoyé/affiché comme
// résultat réel tant que la personne n'a rien tapé) — juste une aide visuelle.
const SEARCH_PLACEHOLDER_EXAMPLES = [
  "Rechercher une équipe, une compétition…",
  "Ex : Real Madrid",
  "Ex : Premier League",
  "Ex : Ligue des Champions",
];

// Regroupe les compétitions par grande région plutôt que par pays exact : un chip
// "Europe" doit inclure toutes les ligues européennes (Angleterre, Espagne...), pas
// seulement les compétitions dont l'aire vaut littéralement "Europe" (EC, CL).
const EUROPE_AREAS = new Set(["Europe", "Angleterre", "Espagne", "Italie", "Allemagne", "France", "Portugal", "Pays-Bas"]);
function regionOf(area) {
  if (area === "Monde") return "Monde";
  if (area === "Brésil") return "Amérique du Sud";
  if (EUROPE_AREAS.has(area)) return "Europe";
  return area;
}

function normalize(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export default function Home() {
  const { session, sessionChecked, authorized } = useRequireAuth();
  const router = useRouter();
  const userId = session?.user?.id;

  const [tab, setTab] = useState("tous"); // "tous" | "direct" | "venir" | "competitions"
  const [search, setSearch] = useState("");
  const [recentSearches, setRecentSearches] = useState([]);
  const [favoriteCodes, setFavoriteCodes] = useState(new Set());
  const [placeholderIndex, setPlaceholderIndex] = useState(0);

  const [liveData, setLiveData] = useState(null);
  const [liveLoading, setLiveLoading] = useState(true);

  const [weekData, setWeekData] = useState(null);
  const [weekLoading, setWeekLoading] = useState(true);

  const [competitionQuery, setCompetitionQuery] = useState("");
  const [regionFilter, setRegionFilter] = useState("Toutes");

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

  const loadWeekMatches = useCallback((silent = false) => {
    if (!silent) setWeekLoading(true);
    return fetch("/api/matches")
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) {
          console.error("Erreur /api/matches:", d.error);
          if (silent) return;
        }
        setWeekData(d);
      })
      .catch((e) => {
        console.error("Erreur /api/matches:", e);
        if (!silent) setWeekData({ error: true, competitions: [] });
      })
      .finally(() => setWeekLoading(false));
  }, []);

  // Tant que la personne n'est pas connectée, on n'interroge même pas l'API (pas de
  // données servies avant authentification).
  useEffect(() => {
    if (!authorized) return;
    loadLiveMatches();
    loadWeekMatches();
  }, [authorized, loadLiveMatches, loadWeekMatches]);

  // L'onglet "Tous" affiche direct + à venir en même temps : il a donc besoin des
  // deux rafraîchissements au rythme actif.
  const liveTabActive = tab === "direct" || tab === "tous";
  const weekTabActive = tab === "venir" || tab === "tous";

  // Rafraîchissement automatique des matchs en direct (scores, minute de jeu) : rapide
  // pendant que l'onglet est affiché, ralenti en arrière-plan pour rester sous le quota.
  useEffect(() => {
    if (!authorized) return;
    const intervalMs = liveTabActive ? LIVE_REFRESH_ACTIVE_MS : LIVE_REFRESH_BACKGROUND_MS;
    const id = setInterval(() => loadLiveMatches(true), intervalMs);
    return () => clearInterval(id);
  }, [authorized, liveTabActive, loadLiveMatches]);

  // Même principe pour les matchs à venir : rythme normal quand l'onglet est affiché,
  // ralenti sinon — permet à un match qui démarre ou une erreur passagère de se
  // rétablir tout seul, sans recharger la page.
  useEffect(() => {
    if (!authorized) return;
    const intervalMs = weekTabActive ? WEEK_REFRESH_ACTIVE_MS : WEEK_REFRESH_BACKGROUND_MS;
    const id = setInterval(() => loadWeekMatches(true), intervalMs);
    return () => clearInterval(id);
  }, [authorized, weekTabActive, loadWeekMatches]);

  // Historique de recherche et favoris : personnels à chaque compte (Supabase, avec
  // RLS — voir supabase/migrations/0001_personalization.sql), jamais partagés entre
  // deux comptes différents.
  useEffect(() => {
    if (!authorized || !userId) return;
    getRecentSearches(userId).then(setRecentSearches);
    getFavoriteCompetitionCodes(userId).then(setFavoriteCodes);
  }, [authorized, userId]);

  const logout = async () => supabase.auth.signOut();

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

  const toggleFavoriteCompetition = (code, label) => {
    setFavoriteCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
        removeFavoriteCompetition(userId, code);
      } else {
        next.add(code);
        addFavoriteCompetition(userId, code, label);
      }
      return next;
    });
  };

  // Matchs en direct (statut LIVE/IN_PLAY/PAUSED), sans filtre par compétition ou pays :
  // exactement ce que l'API renvoie, jamais de matchs inventés pour compléter la liste.
  const liveFeed = useMemo(() => {
    if (!liveData?.matches) return [];
    const validMatches = liveData.matches.filter((m) => m?.homeTeam && m?.awayTeam && m?.utcDate);
    const q = normalize(searchQuery);
    const matches = q
      ? validMatches.filter(
          (m) =>
            normalize(m.homeTeam.name).includes(q) ||
            normalize(m.awayTeam.name).includes(q) ||
            normalize(m.competition?.name).includes(q)
        )
      : validMatches;
    return matches.map((m) => ({ m, comp: m.competition }));
  }, [liveData, searchQuery]);

  // Matchs à venir dans la semaine (y compris plus tard aujourd'hui).
  const weekFeed = useMemo(() => {
    if (!weekData?.competitions) return [];
    const rows = [];
    const now = Date.now();
    weekData.competitions.forEach((comp) => {
      const validMatches = (comp.matches || []).filter((m) => m?.homeTeam && m?.awayTeam && m?.utcDate);
      let matches;
      if (searchQuery) {
        const q = normalize(searchQuery);
        matches = validMatches.filter(
          (m) =>
            normalize(m.homeTeam.name).includes(q) ||
            normalize(m.awayTeam.name).includes(q) ||
            normalize(comp.name).includes(q)
        );
      } else {
        matches = validMatches.filter(
          (m) => UPCOMING_STATUSES.includes(m.status) && new Date(m.utcDate).getTime() > now
        );
      }
      matches.forEach((m) => rows.push({ m, comp }));
    });
    rows.sort((a, b) => new Date(a.m.utcDate) - new Date(b.m.utcDate));
    return rows;
  }, [weekData, searchQuery]);

  // "Tous" = direct puis à venir, mélangés dans l'ordre le plus utile (ce qui se
  // joue déjà en premier).
  const allFeed = useMemo(() => [...liveFeed, ...weekFeed], [liveFeed, weekFeed]);

  const liveCount = liveData?.matches?.length || 0;

  // Compteur réel des matchs à venir, indépendant de la recherche en cours (comme
  // liveCount) — c'est ce que les onglets affichent en badge.
  const upcomingCount = useMemo(() => {
    if (!weekData?.competitions) return 0;
    const now = Date.now();
    let count = 0;
    weekData.competitions.forEach((comp) => {
      (comp.matches || []).forEach((m) => {
        if (m?.homeTeam && m?.awayTeam && m?.utcDate && UPCOMING_STATUSES.includes(m.status) && new Date(m.utcDate).getTime() > now) {
          count += 1;
        }
      });
    });
    return count;
  }, [weekData]);

  const totalCount = liveCount + upcomingCount;

  // Match phare de l'accueil : le premier match réellement en direct, sinon le
  // prochain match à venir le plus proche — jamais un match inventé. Calculé à
  // partir des données brutes (pas des listes déjà filtrées par la recherche) : une
  // recherche en cours ne doit pas faire changer ce qui est mis en avant en haut de
  // la page.
  const featuredMatch = useMemo(() => {
    const liveMatches = (liveData?.matches || []).filter((m) => m?.homeTeam && m?.awayTeam && m?.utcDate);
    if (liveMatches.length > 0) return { m: liveMatches[0], comp: liveMatches[0].competition };

    const now = Date.now();
    const upcoming = [];
    (weekData?.competitions || []).forEach((comp) => {
      (comp.matches || []).forEach((m) => {
        if (m?.homeTeam && m?.awayTeam && m?.utcDate && UPCOMING_STATUSES.includes(m.status) && new Date(m.utcDate).getTime() > now) {
          upcoming.push({ m, comp });
        }
      });
    });
    upcoming.sort((a, b) => new Date(a.m.utcDate) - new Date(b.m.utcDate));
    return upcoming[0] || null;
  }, [liveData, weekData]);

  const regions = useMemo(() => {
    const set = new Set(COMPETITIONS.map((c) => regionOf(c.area)));
    return ["Toutes", ...Array.from(set)];
  }, []);

  const filteredCompetitionList = useMemo(() => {
    const q = normalize(competitionQuery.trim());
    let base = q ? COMPETITIONS.filter((c) => normalize(c.name).includes(q) || normalize(c.area).includes(q)) : COMPETITIONS;
    if (regionFilter !== "Toutes") base = base.filter((c) => regionOf(c.area) === regionFilter);
    return [...base].sort((a, b) => {
      const aFav = favoriteCodes.has(a.code) ? 0 : 1;
      const bFav = favoriteCodes.has(b.code) ? 0 : 1;
      return aFav - bFav;
    });
  }, [competitionQuery, regionFilter, favoriteCodes]);

  // Les compétitions les plus populaires : l'ordre de lib/competitions.js reflète
  // déjà une priorité (compétitions majeures d'abord) — pas de statistique inventée.
  const popularCompetitions = useMemo(() => COMPETITIONS.slice(0, 6), []);

  const selectCompetition = (code) => {
    router.push(`/competition/${code}`);
  };

  let loading, data, feed;
  if (tab === "tous") {
    loading = liveLoading || weekLoading;
    data = liveData && weekData ? { ok: true } : (liveData?.error || weekData?.error ? { error: true } : null);
    feed = allFeed;
  } else if (tab === "direct") {
    loading = liveLoading;
    data = liveData;
    feed = liveFeed;
  } else {
    loading = weekLoading;
    data = weekData;
    feed = weekFeed;
  }

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
      <header style={st.header}>
        <span style={st.logo}>Blume</span>
        <div style={st.headerRight}>
          <span style={st.userEmail}>{session.user?.email}</span>
          <button onClick={logout} style={st.smallBtn}>Déconnexion</button>
        </div>
      </header>

      <main style={st.main}>
        <section style={st.hero}>
          <h1 style={st.heroTitle}>Football en direct &amp; matchs à venir</h1>
          <p style={st.heroSubtitle}>
            Scores en direct, horaires et analyses statistiques sur les compétitions suivies par
            Blume — Coupe du Monde, Ligue des Champions, Premier League, LaLiga, Serie A, Bundesliga,
            Ligue 1 et plus.
          </p>
        </section>

        {featuredMatch && (
          <button
            type="button"
            style={st.featuredCard}
            data-testid="featured-match"
            onClick={() => router.push(matchHref(featuredMatch.m, featuredMatch.comp))}
          >
            <span style={st.featuredBanner}>
              {LIVE_STATUSES.includes(featuredMatch.m.status) ? "EN DIRECT" : "À VENIR — PROGRAMME"}
            </span>
            <MatchInfoBlock m={featuredMatch.m} comp={featuredMatch.comp} />
          </button>
        )}

        <div style={st.chipsInfoRow}>
          <span style={st.chip}>Les plus populaires</span>
          <span style={st.chip}>Football</span>
          <span style={{ ...st.chip, ...st.chipLive }}>Live : {liveCount}</span>
          <button type="button" style={{ ...st.chip, ...st.chipAccent }} onClick={() => router.push("/analyse")}>
            Analyse IA →
          </button>
        </div>

        <div style={st.tabs} data-testid="home-tabs">
          <button
            style={{ ...st.tabBtn, ...(tab === "tous" ? st.tabBtnActive : {}) }}
            onClick={() => setTab("tous")}
          >
            Tous{totalCount > 0 ? ` (${totalCount})` : ""}
          </button>
          <button
            style={{ ...st.tabBtn, ...(tab === "direct" ? st.tabBtnActive : {}) }}
            onClick={() => setTab("direct")}
          >
            En direct{liveCount > 0 ? ` (${liveCount})` : ""}
          </button>
          <button
            style={{ ...st.tabBtn, ...(tab === "venir" ? st.tabBtnActive : {}) }}
            onClick={() => setTab("venir")}
          >
            À venir{upcomingCount > 0 ? ` (${upcomingCount})` : ""}
          </button>
          <button
            style={{ ...st.tabBtn, ...(tab === "competitions" ? st.tabBtnActive : {}) }}
            onClick={() => setTab("competitions")}
          >
            Compétitions
          </button>
        </div>

        {tab !== "competitions" && (
          <>
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

            {loading && <p style={st.hint}>Chargement des matchs…</p>}
            {!loading && (!data || data?.error) && (
              <p style={st.hint}>Les matchs ne sont pas disponibles pour le moment. Réessaie dans quelques minutes.</p>
            )}
            {!loading && data && !data.error && feed.length === 0 && (
              <p style={st.hint}>
                {searchQuery
                  ? "Aucun match ne correspond à ta recherche."
                  : tab === "direct"
                  ? "Aucun match en direct actuellement."
                  : tab === "venir"
                  ? "Aucun match à venir cette semaine."
                  : "Aucun match pour le moment."}
              </p>
            )}

            <div data-testid="match-list">
              {feed.map(({ m, comp }) => (
                <MatchCard key={m.id} m={m} comp={comp} />
              ))}
            </div>
          </>
        )}

        {tab === "competitions" && (
          <>
            <div style={st.searchRow}>
              <input
                value={competitionQuery}
                onChange={(e) => setCompetitionQuery(e.target.value)}
                placeholder="Rechercher une compétition (pays, nom…)"
                style={st.searchInput}
              />
              {competitionQuery && (
                <button style={st.searchBtn} onClick={() => setCompetitionQuery("")}>✕</button>
              )}
            </div>

            <p style={st.h2}>Les plus populaires</p>
            <div style={st.carousel} data-testid="popular-carousel">
              {popularCompetitions.map((c) => (
                <button key={c.code} type="button" style={st.carouselCard} onClick={() => selectCompetition(c.code)}>
                  <span style={st.carouselName}>{c.name}</span>
                  <span style={st.carouselArea}>{c.area}</span>
                </button>
              ))}
            </div>

            <div style={st.chipsRow}>
              {regions.map((r) => (
                <button
                  key={r}
                  type="button"
                  style={{ ...st.chip, ...(regionFilter === r ? st.chipActive : {}) }}
                  onClick={() => setRegionFilter(r)}
                >
                  {r}
                </button>
              ))}
            </div>

            <section style={st.panel} data-testid="competitions-list">
              <h2 style={st.h2}>Choisis une compétition</h2>
              {filteredCompetitionList.length === 0 && <p style={st.hint}>Aucune compétition trouvée.</p>}
              {filteredCompetitionList.map((c) => (
                <div key={c.code} style={st.compRowWrap}>
                  <button
                    type="button"
                    style={st.favStar}
                    onClick={() => toggleFavoriteCompetition(c.code, c.name)}
                    aria-label={favoriteCodes.has(c.code) ? `Retirer ${c.name} des favoris` : `Ajouter ${c.name} aux favoris`}
                  >
                    {favoriteCodes.has(c.code) ? "★" : "☆"}
                  </button>
                  <button type="button" style={st.compRow} onClick={() => selectCompetition(c.code)}>
                    <span style={st.compRowName}>{c.name}</span>
                    <span style={st.compRowArea}>{c.area}</span>
                  </button>
                </div>
              ))}
            </section>
          </>
        )}
      </main>

      <button
        type="button"
        style={st.floatingBtn}
        onClick={() => setTab("competitions")}
        aria-label="Voir toutes les compétitions"
      >
        Compétitions
      </button>
    </div>
  );
}

const st = {
  page: { minHeight: "100vh", padding: "20px 16px 100px" },
  header: { maxWidth: 640, margin: "0 auto 20px", display: "flex", justifyContent: "space-between", alignItems: "center" },
  logo: { fontSize: 20, fontWeight: 800, color: "#39B577", letterSpacing: 0.3 },
  headerRight: { display: "flex", alignItems: "center", gap: 10 },
  userEmail: { fontSize: 11.5, color: "#7EA694", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  smallBtn: {
    background: "transparent", border: "1px solid #1E3D2C", color: "#E9F1EC",
    borderRadius: 999, padding: "6px 12px", fontSize: 12, textDecoration: "none", cursor: "pointer",
  },
  main: { maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 },
  hero: { textAlign: "center", padding: "8px 4px" },
  heroTitle: { fontSize: 21, fontWeight: 800, margin: "0 0 8px", lineHeight: 1.25 },
  heroSubtitle: { fontSize: 12, color: "#7EA694", margin: 0, lineHeight: 1.5 },
  featuredCard: {
    display: "block", width: "100%", textAlign: "left", cursor: "pointer",
    background: "#12291E", border: "1px solid #39B577", borderRadius: 14, padding: 16,
    boxShadow: "0 0 20px rgba(57,181,119,0.2)",
  },
  featuredBanner: {
    display: "inline-block", fontSize: 10, fontWeight: 800, color: "#39B577",
    textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10,
  },
  chipsInfoRow: { display: "flex", flexWrap: "wrap", gap: 6 },
  chip: {
    background: "#12291E", border: "1px solid #1E3D2C", color: "#7EA694",
    borderRadius: 999, padding: "6px 12px", fontSize: 12, cursor: "pointer",
  },
  chipActive: { background: "#39B577", border: "1px solid #39B577", color: "#06121F" },
  chipLive: { color: "#D8685E", borderColor: "#D8685E" },
  chipAccent: { background: "#39B577", border: "1px solid #39B577", color: "#06121F", fontWeight: 700 },
  tabs: { display: "flex", gap: 8, flexWrap: "wrap" },
  tabBtn: {
    flex: "1 1 auto", background: "#12291E", border: "1px solid #1E3D2C", color: "#7EA694",
    borderRadius: 999, padding: "10px 8px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
  },
  tabBtnActive: { background: "#39B577", border: "1px solid #39B577", color: "#06121F" },
  backBtn: {
    alignSelf: "flex-start", background: "transparent", border: "1px solid #1E3D2C", color: "#E9F1EC",
    borderRadius: 999, padding: "6px 12px", fontSize: 12, cursor: "pointer",
  },
  panel: { background: "#12291E", border: "1px solid #1E3D2C", borderRadius: 14, padding: 16 },
  h2: { fontSize: 14, margin: "0 0 10px", color: "#7EA694", textTransform: "uppercase", letterSpacing: 0.4 },
  hint: { fontSize: 12.5, color: "#7EA694" },
  chipsRow: { display: "flex", flexWrap: "wrap", gap: 6 },
  carousel: { display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 },
  carouselCard: {
    flex: "0 0 auto", minWidth: 140, background: "#12291E", border: "1px solid #1E3D2C",
    borderRadius: 12, padding: "12px 14px", textAlign: "left", cursor: "pointer",
  },
  carouselName: { display: "block", fontWeight: 700, fontSize: 13, marginBottom: 4 },
  carouselArea: { fontSize: 11, color: "#7EA694" },
  compRowWrap: { display: "flex", alignItems: "center", borderTop: "1px solid #1E3D2C" },
  compRow: {
    flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center",
    background: "transparent", border: "none", padding: "12px 0",
    color: "#E9F1EC", fontSize: 13.5, cursor: "pointer", textAlign: "left",
  },
  favStar: {
    background: "transparent", border: "none", color: "#F5C518", fontSize: 18,
    cursor: "pointer", padding: "12px 8px 12px 0", lineHeight: 1,
  },
  compRowName: { fontWeight: 600 },
  compRowArea: { fontSize: 11.5, color: "#7EA694" },
  searchRow: { display: "flex", gap: 8 },
  searchInput: {
    flex: 1, background: "#12291E", border: "1px solid #1E3D2C", color: "#E9F1EC",
    borderRadius: 999, padding: "10px 16px", fontSize: 13,
  },
  searchBtn: {
    background: "#39B577", border: "none", color: "#06121F", fontWeight: 700,
    borderRadius: 999, padding: "0 18px", fontSize: 13, cursor: "pointer",
  },
  floatingBtn: {
    position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
    background: "#39B577", color: "#06121F", border: "none", borderRadius: 999,
    padding: "12px 24px", fontWeight: 800, fontSize: 13, cursor: "pointer",
    boxShadow: "0 4px 18px rgba(57,181,119,0.5)", zIndex: 10,
  },
};
