import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import { COMPETITIONS } from "../lib/competitions";
import MatchCard from "../components/MatchCard";

const UPCOMING_STATUSES = ["SCHEDULED", "TIMED"];
const LIVE_STATUSES = ["IN_PLAY", "PAUSED", "LIVE"];
// Le plan gratuit football-data.org limite à 10 requêtes/minute. On actualise vite
// (10s) quand l'onglet "Matchs en ligne" est réellement affiché, et beaucoup plus
// doucement en arrière-plan sinon (juste pour garder le badge de compteur à jour).
const LIVE_REFRESH_ACTIVE_MS = 10000;
const LIVE_REFRESH_BACKGROUND_MS = 45000;

function normalize(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export default function Home() {
  const [session, setSession] = useState(null);
  const [sessionChecked, setSessionChecked] = useState(false);

  const [tab, setTab] = useState("live"); // "live" | "upcoming" | "competitions"
  const [search, setSearch] = useState("");

  const [liveData, setLiveData] = useState(null);
  const [liveLoading, setLiveLoading] = useState(true);

  const [weekData, setWeekData] = useState(null);
  const [weekLoading, setWeekLoading] = useState(true);

  const [competitionQuery, setCompetitionQuery] = useState("");
  const [selectedCode, setSelectedCode] = useState(null);
  const [compData, setCompData] = useState(null);
  const [compLoading, setCompLoading] = useState(false);
  const [compMatchSearch, setCompMatchSearch] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionChecked(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  const loadLiveMatches = useCallback((silent = false) => {
    if (!silent) setLiveLoading(true);
    return fetch("/api/live-matches")
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) console.error("Erreur /api/live-matches:", d.error);
        setLiveData(d);
      })
      .catch((e) => console.error("Erreur /api/live-matches:", e))
      .finally(() => setLiveLoading(false));
  }, []);

  const loadWeekMatches = useCallback(() => {
    setWeekLoading(true);
    return fetch("/api/matches")
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) console.error("Erreur /api/matches:", d.error);
        setWeekData(d);
      })
      .catch((e) => console.error("Erreur /api/matches:", e))
      .finally(() => setWeekLoading(false));
  }, []);

  useEffect(() => {
    loadLiveMatches();
    loadWeekMatches();
  }, [loadLiveMatches, loadWeekMatches]);

  // Rafraîchissement automatique des matchs en direct (scores, minute de jeu) : rapide
  // pendant que l'onglet est affiché, ralenti en arrière-plan pour rester sous le quota.
  useEffect(() => {
    const intervalMs = tab === "live" ? LIVE_REFRESH_ACTIVE_MS : LIVE_REFRESH_BACKGROUND_MS;
    const id = setInterval(() => loadLiveMatches(true), intervalMs);
    return () => clearInterval(id);
  }, [tab, loadLiveMatches]);

  const logout = async () => supabase.auth.signOut();

  const searchQuery = search.trim();

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
    if (!q) return COMPETITIONS;
    return COMPETITIONS.filter((c) => normalize(c.name).includes(q) || normalize(c.area).includes(q));
  }, [competitionQuery]);

  const selectCompetition = (code) => {
    setSelectedCode(code);
    setCompData(null);
    setCompMatchSearch("");
    setCompLoading(true);
    fetch(`/api/competition-matches?code=${code}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) console.error("Erreur /api/competition-matches:", d.error);
        setCompData(d);
      })
      .catch((e) => {
        console.error("Erreur /api/competition-matches:", e);
        setCompData({ error: true, matches: [] });
      })
      .finally(() => setCompLoading(false));
  };

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

  return (
    <div style={st.page}>
      <header style={st.header}>
        <h1 style={st.h1}>Matchs</h1>
        <div style={st.headerRight}>
          {sessionChecked &&
            (session ? (
              <button onClick={logout} style={st.smallBtn}>Déconnexion</button>
            ) : (
              <a href="/login" style={st.smallBtn}>Se connecter</a>
            ))}
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
                <button key={c.code} style={st.compRow} onClick={() => selectCompetition(c.code)}>
                  <span style={st.compRowName}>{c.name}</span>
                  <span style={st.compRowArea}>{c.area}</span>
                </button>
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
  tabBtnActive: { background: "#39B577", borderColor: "#39B577", color: "#06121F" },
  backBtn: {
    alignSelf: "flex-start", background: "transparent", border: "1px solid #1E3D2C", color: "#E9F1EC",
    borderRadius: 999, padding: "6px 12px", fontSize: 12, cursor: "pointer",
  },
  panel: { background: "#12291E", border: "1px solid #1E3D2C", borderRadius: 14, padding: 16 },
  h2: { fontSize: 14, margin: "0 0 10px", color: "#7EA694", textTransform: "uppercase", letterSpacing: 0.4 },
  hint: { fontSize: 12.5, color: "#7EA694" },
  compRow: {
    display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%",
    background: "transparent", border: "none", borderTop: "1px solid #1E3D2C", padding: "12px 0",
    color: "#E9F1EC", fontSize: 13.5, cursor: "pointer", textAlign: "left",
  },
  compRowName: { fontWeight: 600 },
  compRowArea: { fontSize: 11.5, color: "#7EA694" },
};
