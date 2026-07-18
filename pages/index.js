import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabaseClient";

const LIVE_STATUSES = ["IN_PLAY", "PAUSED", "LIVE"];
const UPCOMING_STATUSES = ["SCHEDULED", "TIMED"];
const LIVE_REFRESH_MS = 30000;

function statusLabel(status) {
  if (LIVE_STATUSES.includes(status)) return "EN DIRECT";
  if (status === "FINISHED") return "Terminé";
  return null;
}

function formatKickoff(iso) {
  return new Date(iso).toLocaleString("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function utcDay(iso) {
  return iso.slice(0, 10);
}

function normalize(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function matchHref(m, comp) {
  return {
    pathname: `/match/${m.id}`,
    query: {
      competitionCode: comp.code,
      competitionName: comp.name,
      homeTeamId: m.homeTeam.id,
      awayTeamId: m.awayTeam.id,
      homeTeamName: m.homeTeam.name,
      awayTeamName: m.awayTeam.name,
      homeCrest: m.homeTeam.crest || "",
      awayCrest: m.awayTeam.crest || "",
      status: m.status,
      utcDate: m.utcDate,
      scoreHome: m.score.fullTime.home ?? "",
      scoreAway: m.score.fullTime.away ?? "",
    },
  };
}

export default function Home() {
  const [session, setSession] = useState(null);
  const [sessionChecked, setSessionChecked] = useState(false);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("live"); // "live" | "upcoming"
  const [search, setSearch] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionChecked(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  const loadMatches = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    return fetch("/api/matches")
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadMatches();
  }, [loadMatches]);

  // Rafraîchissement automatique des matchs du jour.
  useEffect(() => {
    if (tab !== "live") return;
    const id = setInterval(() => loadMatches(true), LIVE_REFRESH_MS);
    return () => clearInterval(id);
  }, [tab, loadMatches]);

  const logout = async () => supabase.auth.signOut();

  const today = useMemo(() => utcDay(new Date().toISOString()), []);
  const searchQuery = search.trim();

  // Répartit chaque compétition : matchs du jour vs matchs à venir dans la semaine.
  const competitions = useMemo(() => {
    if (!data?.competitions) return [];
    return data.competitions
      .map((comp) => {
        let matches;
        if (searchQuery) {
          const q = normalize(searchQuery);
          matches = comp.matches.filter(
            (m) =>
              normalize(m.homeTeam.name).includes(q) ||
              normalize(m.awayTeam.name).includes(q) ||
              normalize(comp.name).includes(q)
          );
        } else if (tab === "live") {
          matches = comp.matches.filter((m) => utcDay(m.utcDate) === today);
        } else {
          matches = comp.matches.filter(
            (m) => UPCOMING_STATUSES.includes(m.status) && utcDay(m.utcDate) > today
          );
        }
        const sorted = [...matches].sort((a, b) => {
          if (!searchQuery && tab === "live") {
            const aLive = LIVE_STATUSES.includes(a.status) ? 0 : 1;
            const bLive = LIVE_STATUSES.includes(b.status) ? 0 : 1;
            if (aLive !== bLive) return aLive - bLive;
          }
          return new Date(a.utcDate) - new Date(b.utcDate);
        });
        return { ...comp, matches: sorted };
      })
      .filter((comp) => comp.matches.length > 0);
  }, [data, tab, today, searchQuery]);

  const liveCount = useMemo(() => {
    if (!data?.competitions) return 0;
    return data.competitions.reduce(
      (n, comp) => n + comp.matches.filter((m) => LIVE_STATUSES.includes(m.status)).length,
      0
    );
  }, [data]);

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
        <div style={st.searchRow}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher une équipe, une compétition…"
            style={st.searchInput}
          />
          {search ? (
            <button style={st.searchBtn} onClick={() => setSearch("")}>✕</button>
          ) : (
            <button style={st.searchBtn} onClick={() => {}}>Rechercher</button>
          )}
        </div>

        {!searchQuery && (
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
          </div>
        )}

        {loading && <p style={st.hint}>Chargement des matchs…</p>}
        {!loading && !data && <p style={st.hint}>Impossible de charger les matchs pour le moment.</p>}
        {!loading && data && competitions.length === 0 && (
          <p style={st.hint}>
            {searchQuery
              ? "Aucun match ne correspond à ta recherche."
              : tab === "live"
              ? "Aucun match aujourd'hui."
              : "Aucun match à venir cette semaine."}
          </p>
        )}

        {competitions.map((comp) => (
          <section key={comp.code} style={st.panel}>
            <h2 style={st.h2}>{comp.name}</h2>
            {comp.matches.map((m) => {
              const live = statusLabel(m.status);
              return (
                <Link key={m.id} href={matchHref(m, comp)} style={st.matchCard}>
                  <div style={st.matchRow}>
                    <div style={st.teamBlock}>
                      {m.homeTeam.crest && (
                        <img src={m.homeTeam.crest} alt="" style={st.crest} onError={(e) => (e.target.style.display = "none")} />
                      )}
                      <span style={st.teamName}>{m.homeTeam.name}</span>
                    </div>
                    <span style={st.score}>
                      {m.score.fullTime.home ?? "–"} : {m.score.fullTime.away ?? "–"}
                    </span>
                    <div style={{ ...st.teamBlock, ...st.teamBlockAway }}>
                      <span style={st.teamName}>{m.awayTeam.name}</span>
                      {m.awayTeam.crest && (
                        <img src={m.awayTeam.crest} alt="" style={st.crest} onError={(e) => (e.target.style.display = "none")} />
                      )}
                    </div>
                  </div>
                  <div style={st.metaRow}>
                    <span style={{ ...st.badge, ...(live === "EN DIRECT" ? st.badgeLive : {}) }}>
                      {live || formatKickoff(m.utcDate)}
                    </span>
                    <span style={st.chevron}>Pronostics →</span>
                  </div>
                </Link>
              );
            })}
          </section>
        ))}
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
    borderRadius: 999, padding: "10px 8px", fontSize: 13, fontWeight: 700, cursor: "pointer",
  },
  tabBtnActive: { background: "#39B577", borderColor: "#39B577", color: "#06121F" },
  panel: { background: "#12291E", border: "1px solid #1E3D2C", borderRadius: 14, padding: 16 },
  h2: { fontSize: 15, margin: "0 0 10px" },
  hint: { fontSize: 12.5, color: "#7EA694" },
  matchCard: { display: "block", borderTop: "1px solid #1E3D2C", padding: "12px 0", textDecoration: "none", color: "inherit", cursor: "pointer" },
  matchRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 13.5 },
  teamBlock: { flex: 1, display: "flex", alignItems: "center", gap: 6, minWidth: 0 },
  teamBlockAway: { justifyContent: "flex-end" },
  crest: { width: 18, height: 18, objectFit: "contain", flexShrink: 0 },
  teamName: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  score: { fontWeight: 700, color: "#39B577", flexShrink: 0, padding: "0 8px" },
  metaRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
  badge: { fontSize: 11, color: "#7EA694" },
  badgeLive: { color: "#D8685E", fontWeight: 700 },
  chevron: { fontSize: 11.5, color: "#39B577", fontWeight: 600 },
};
