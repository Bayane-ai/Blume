import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import { useRequireAuth } from "../lib/useRequireAuth";
import { COMPETITIONS } from "../lib/competitions";
import {
  getRecentSearches, saveSearch, getFavoriteCompetitionCodes,
  addFavoriteCompetition, removeFavoriteCompetition,
} from "../lib/personalization";
import MatchCard from "../components/MatchCard";

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
const COMP_REFRESH_MS = 60000;

function normalize(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export default function Home() {
  const { session, sessionChecked, authorized } = useRequireAuth();
  const userId = session?.user?.id;

  const [tab, setTab] = useState("live"); // "live" | "upcoming" | "competitions"
  const [search, setSearch] = useState("");
  const [recentSearches, setRecentSearches] = useState([]);
  const [favoriteCodes, setFavoriteCodes] = useState(new Set());

  const [liveData, setLiveData] = useState(null);
  const [liveLoading, setLiveLoading] = useState(true);

  const [weekData, setWeekData] = useState(null);
  const [weekLoading, setWeekLoading] = useState(true);

  const [competitionQuery, setCompetitionQuery] = useState("");
  const [selectedCode, setSelectedCode] = useState(null);
  const [compData, setCompData] = useState(null);
  const [compLoading, setCompLoading] = useState(false);
  const [compMatchSearch, setCompMatchSearch] = useState("");

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

  // Rafraîchissement automatique des matchs en direct (scores, minute de jeu) : rapide
  // pendant que l'onglet est affiché, ralenti en arrière-plan pour rester sous le quota.
  useEffect(() => {
    if (!authorized) return;
    const intervalMs = tab === "live" ? LIVE_REFRESH_ACTIVE_MS : LIVE_REFRESH_BACKGROUND_MS;
    const id = setInterval(() => loadLiveMatches(true), intervalMs);
    return () => clearInterval(id);
  }, [authorized, tab, loadLiveMatches]);

  // Même principe pour les matchs à venir : rythme normal quand l'onglet est affiché,
  // ralenti sinon — permet à un match qui démarre ou une erreur passagère de se
  // rétablir tout seul, sans recharger la page.
  useEffect(() => {
    if (!authorized) return;
    const intervalMs = tab === "upcoming" ? WEEK_REFRESH_ACTIVE_MS : WEEK_REFRESH_BACKGROUND_MS;
    const id = setInterval(() => loadWeekMatches(true), intervalMs);
    return () => clearInterval(id);
  }, [authorized, tab, loadWeekMatches]);

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

  const liveCount = liveData?.matches?.length || 0;

  const filteredCompetitionList = useMemo(() => {
    const q = normalize(competitionQuery.trim());
    const base = q ? COMPETITIONS.filter((c) => normalize(c.name).includes(q) || normalize(c.area).includes(q)) : COMPETITIONS;
    return [...base].sort((a, b) => {
      const aFav = favoriteCodes.has(a.code) ? 0 : 1;
      const bFav = favoriteCodes.has(b.code) ? 0 : 1;
      return aFav - bFav;
    });
  }, [competitionQuery, favoriteCodes]);

  const loadCompetitionMatches = useCallback((code, silent = false) => {
    if (!silent) setCompLoading(true);
    return fetch(`/api/competition-matches?code=${code}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) {
          console.error("Erreur /api/competition-matches:", d.error);
          if (silent) return;
        }
        setCompData(d);
      })
      .catch((e) => {
        console.error("Erreur /api/competition-matches:", e);
        if (!silent) setCompData({ error: true, matches: [] });
      })
      .finally(() => setCompLoading(false));
  }, []);

  const selectCompetition = (code) => {
    setSelectedCode(code);
    setCompData(null);
    setCompMatchSearch("");
    loadCompetitionMatches(code, false);
  };

  // Rafraîchissement périodique tant qu'une compétition est ouverte : mêmes raisons
  // que pour les autres onglets (match qui démarre, incident passager qui se résout
  // tout seul).
  useEffect(() => {
    if (!selectedCode) return;
    const id = setInterval(() => loadCompetitionMatches(selectedCode, true), COMP_REFRESH_MS);
    return () => clearInterval(id);
  }, [selectedCode, loadCompetitionMatches]);

  const backToCompetitions = () => {
    setSelectedCode(null);
    setCompData(null);
    setCompMatchSearch("");
  };

  const compMatches = useMemo(() => {
    if (!compData?.matches) return [];
    const validMatches = compData.matches.filter((m) => m?.homeTeam && m?.awayTeam && m?.utcDate);
    const q = normalize(compMatchSearch.trim());
    const filtered = q
      ? validMatches.filter(
          (m) => normalize(m.homeTeam.name).includes(q) || normalize(m.awayTeam.name).includes(q)
        )
      : validMatches;
    return [...filtered].sort((a, b) => {
      const aLive = LIVE_STATUSES.includes(a.status) ? 0 : 1;
      const bLive = LIVE_STATUSES.includes(b.status) ? 0 : 1;
      if (aLive !== bLive) return aLive - bLive;
      return new Date(a.utcDate) - new Date(b.utcDate);
    });
  }, [compData, compMatchSearch]);

  const loading = tab === "live" ? liveLoading : weekLoading;
  const data = tab === "live" ? liveData : weekData;
  const feed = tab === "live" ? liveFeed : weekFeed;

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
        <h1 style={st.h1}>Matchs</h1>
        <div style={st.headerRight}>
          <span style={st.userEmail}>{session.user?.email}</span>
          <button onClick={logout} style={st.smallBtn}>Déconnexion</button>
        </div>
      </header>

      <main style={st.main}>
        <div style={st.tabs}>
          <button
            style={{ ...st.tabBtn, ...(tab === "live" ? st.tabBtnActive : {}) }}
            onClick={() => setTab("live")}
          >
            Matchs en ligne{liveCount > 0 ? ` (${liveCount})` : ""}
          </button>
          <button
            style={{ ...st.tabBtn, ...(tab === "upcoming" ? st.tabBtnActive : {}) }}
            onClick={() => setTab("upcoming")}
          >
            Matchs à venir
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
                placeholder="Rechercher une équipe, une compétition…"
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
                  : tab === "live"
                  ? "Aucun match en direct actuellement."
                  : "Aucun match à venir cette semaine."}
              </p>
            )}

            {feed.map(({ m, comp }) => (
              <MatchCard key={m.id} m={m} comp={comp} />
            ))}
          </>
        )}

        {tab === "competitions" && !selectedCode && (
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
            <section style={st.panel}>
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

        {tab === "competitions" && selectedCode && (
          <>
            <button style={st.backBtn} onClick={backToCompetitions}>← Compétitions</button>
            <div style={st.searchRow}>
              <input
                value={compMatchSearch}
                onChange={(e) => setCompMatchSearch(e.target.value)}
                placeholder={`Rechercher un match dans ${compData?.name || "cette compétition"}…`}
                style={st.searchInput}
              />
              {compMatchSearch && (
                <button style={st.searchBtn} onClick={() => setCompMatchSearch("")}>✕</button>
              )}
            </div>

            {compLoading && <p style={st.hint}>Chargement des matchs…</p>}
            {!compLoading && compData?.error && (
              <p style={st.hint}>Les matchs ne sont pas disponibles pour le moment. Réessaie dans quelques minutes.</p>
            )}
            {!compLoading && !compData?.error && compMatches.length === 0 && (
              <p style={st.hint}>Aucun match à venir trouvé pour cette compétition.</p>
            )}
            {!compLoading &&
              compMatches.map((m) => <MatchCard key={m.id} m={m} comp={compData} />)}
          </>
        )}
      </main>
    </div>
  );
}

const st = {
  page: { minHeight: "100vh", padding: "20px 16px 60px" },
  header: { maxWidth: 640, margin: "0 auto 20px", display: "flex", justifyContent: "space-between", alignItems: "center" },
  h1: { fontSize: 20, fontWeight: 800, margin: 0 },
  headerRight: { display: "flex", alignItems: "center", gap: 10 },
  userEmail: { fontSize: 11.5, color: "#7EA694", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  smallBtn: {
    background: "transparent", border: "1px solid #1E3D2C", color: "#E9F1EC",
    borderRadius: 999, padding: "6px 12px", fontSize: 12, textDecoration: "none", cursor: "pointer",
  },
  main: { maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 },
  searchRow: { display: "flex", gap: 8 },
  searchInput: {
    flex: 1, background: "#12291E", border: "1px solid #1E3D2C", color: "#E9F1EC",
    borderRadius: 999, padding: "10px 16px", fontSize: 13,
  },
  searchBtn: {
    background: "#39B577", border: "none", color: "#06121F", fontWeight: 700,
    borderRadius: 999, padding: "0 18px", fontSize: 13, cursor: "pointer",
  },
  tabs: { display: "flex", gap: 8 },
  tabBtn: {
    flex: 1, background: "#12291E", border: "1px solid #1E3D2C", color: "#7EA694",
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
  chip: {
    background: "#12291E", border: "1px solid #1E3D2C", color: "#7EA694",
    borderRadius: 999, padding: "6px 12px", fontSize: 12, cursor: "pointer",
  },
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
};
