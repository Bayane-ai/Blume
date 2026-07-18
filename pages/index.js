import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabaseClient";
import { COMPETITIONS } from "../lib/competitions";

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
      competitionCode: comp?.code || "",
      competitionName: comp?.name || "",
      homeTeamId: m.homeTeam?.id ?? "",
      awayTeamId: m.awayTeam?.id ?? "",
      homeTeamName: m.homeTeam?.name || "",
      awayTeamName: m.awayTeam?.name || "",
      homeCrest: m.homeTeam?.crest || "",
      awayCrest: m.awayTeam?.crest || "",
      status: m.status || "",
      utcDate: m.utcDate || "",
      scoreHome: m.score?.fullTime?.home ?? "",
      scoreAway: m.score?.fullTime?.away ?? "",
    },
  };
}

function MatchCard({ m, comp }) {
  if (!m || !m.homeTeam || !m.awayTeam) return null;
  const live = statusLabel(m.status);
  const p = m.pronostic;
  return (
    <Link href={matchHref(m, comp)} style={st.matchCard}>
      <div style={st.matchRow}>
        <div style={st.teamBlock}>
          {m.homeTeam.crest && (
            <span style={st.crestWrap}>
              <img src={m.homeTeam.crest} alt="" style={st.crest} onError={(e) => (e.target.parentElement.style.display = "none")} />
            </span>
          )}
          <span style={st.teamName}>{m.homeTeam.name}</span>
        </div>
        <span style={st.score}>
          {m.score?.fullTime?.home ?? "–"} : {m.score?.fullTime?.away ?? "–"}
        </span>
        <div style={{ ...st.teamBlock, ...st.teamBlockAway }}>
          <span style={st.teamName}>{m.awayTeam.name}</span>
          {m.awayTeam.crest && (
            <span style={st.crestWrap}>
              <img src={m.awayTeam.crest} alt="" style={st.crest} onError={(e) => (e.target.parentElement.style.display = "none")} />
            </span>
          )}
        </div>
      </div>
      <span style={{ ...st.badge, ...(live === "EN DIRECT" ? st.badgeLive : {}) }}>
        {live || formatKickoff(m.utcDate)}
      </span>

      {p?.available === false && <p style={{ ...st.hint, marginTop: 10 }}>{p.message || "Pronostics indisponibles."}</p>}

      {p?.available && p.probabilities && p.goals && (
        <>
          <div style={st.divider} />
          <p style={st.sectionLabel}>% de victoire</p>
          <div style={st.probRow}>
            <div style={st.probCell}>
              <span style={st.probLabel}>Domicile</span>
              <span style={st.probValue}>{p.probabilities.home ?? "–"}%</span>
            </div>
            <div style={st.probCell}>
              <span style={st.probLabel}>Nul</span>
              <span style={st.probValue}>{p.probabilities.draw ?? "–"}%</span>
            </div>
            <div style={st.probCell}>
              <span style={st.probLabel}>Extérieur</span>
              <span style={st.probValue}>{p.probabilities.away ?? "–"}%</span>
            </div>
          </div>

          <p style={st.sectionLabel}>Buts probables</p>
          <div style={st.probRow}>
            <div style={st.probCell}>
              <span style={st.probLabel}>Attendus</span>
              <span style={st.probValue}>{p.goals.expectedHome ?? "–"} - {p.goals.expectedAway ?? "–"}</span>
            </div>
            <div style={st.probCell}>
              <span style={st.probLabel}>+2.5 buts</span>
              <span style={st.probValue}>{p.goals.over25 ?? "–"}%</span>
            </div>
            <div style={st.probCell}>
              <span style={st.probLabel}>Les 2 marquent</span>
              <span style={st.probValue}>{p.goals.bttsYes ?? "–"}%</span>
            </div>
          </div>

          {(p.correctScores || []).length > 0 && (
            <>
              <p style={st.sectionLabel}>Scores exacts les plus probables</p>
              <div style={st.probRow}>
                {p.correctScores.map((cs) => (
                  <div key={cs.score} style={st.probCell}>
                    <span style={st.probLabel}>{cs.score}</span>
                    <span style={st.probValue}>{cs.probability}%</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Link>
  );
}

export default function Home() {
  const [session, setSession] = useState(null);
  const [sessionChecked, setSessionChecked] = useState(false);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("live"); // "live" | "upcoming" | "competitions"
  const [search, setSearch] = useState("");

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

  const loadMatches = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    return fetch("/api/matches")
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) console.error("Erreur /api/matches:", d.error);
        setData(d);
      })
      .catch((e) => console.error("Erreur /api/matches:", e))
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
        } else if (tab === "live") {
          matches = validMatches.filter((m) => utcDay(m.utcDate) === today);
        } else {
          matches = validMatches.filter(
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
      (n, comp) => n + (comp.matches || []).filter((m) => LIVE_STATUSES.includes(m.status)).length,
      0
    );
  }, [data]);

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
              {search ? (
                <button style={st.searchBtn} onClick={() => setSearch("")}>✕</button>
              ) : (
                <button style={st.searchBtn} onClick={() => {}}>Rechercher</button>
              )}
            </div>

            {loading && <p style={st.hint}>Chargement des matchs…</p>}
            {!loading && (!data || data?.error) && (
              <p style={st.hint}>Les matchs ne sont pas disponibles pour le moment. Réessaie dans quelques minutes.</p>
            )}
            {!loading && data && !data.error && competitions.length === 0 && (
              <p style={st.hint}>
                {searchQuery
                  ? "Aucun match ne correspond à ta recherche."
                  : tab === "live"
                  ? "Aucun match aujourd'hui."
                  : "Aucun match à venir cette semaine."}
              </p>
            )}

            {competitions.map((comp) => (
              <section key={comp.code} style={st.compSection}>
                <h2 style={st.h2}>{comp.name}</h2>
                {comp.matches.map((m) => (
                  <MatchCard key={m.id} m={m} comp={comp} />
                ))}
              </section>
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
              <button style={st.searchBtn} onClick={() => {}}>Rechercher</button>
            </div>
            <section style={st.panel}>
              <h2 style={st.h2}>Choisis une compétition</h2>
              {filteredCompetitionList.length === 0 && <p style={st.hint}>Aucune compétition trouvée.</p>}
              {filteredCompetitionList.map((c) => (
                <button key={c.code} style={st.compRow} onClick={() => selectCompetition(c.code)}>
                  <span style={st.compName}>{c.name}</span>
                  <span style={st.compArea}>{c.area}</span>
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
              {compMatchSearch ? (
                <button style={st.searchBtn} onClick={() => setCompMatchSearch("")}>✕</button>
              ) : (
                <button style={st.searchBtn} onClick={() => {}}>Rechercher</button>
              )}
            </div>

            {compLoading && <p style={st.hint}>Chargement des matchs…</p>}
            {!compLoading && compData?.error && (
              <p style={st.hint}>Erreur de chargement des matchs : {compData.error}</p>
            )}
            {!compLoading && !compData?.error && compMatches.length === 0 && (
              <p style={st.hint}>Aucun match à venir trouvé pour cette compétition.</p>
            )}
            {!compLoading && compMatches.length > 0 && (
              <section style={st.compSection}>
                <h2 style={st.h2}>{compData?.name}</h2>
                {compMatches.map((m) => (
                  <MatchCard key={m.id} m={m} comp={compData} />
                ))}
              </section>
            )}
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
  compSection: { display: "flex", flexDirection: "column" },
  h2: { fontSize: 14, margin: "4px 0 10px", color: "#7EA694", textTransform: "uppercase", letterSpacing: 0.4 },
  hint: { fontSize: 12.5, color: "#7EA694" },
  compRow: {
    display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%",
    background: "transparent", border: "none", borderTop: "1px solid #1E3D2C", padding: "12px 0",
    color: "#E9F1EC", fontSize: 13.5, cursor: "pointer", textAlign: "left",
  },
  compName: { fontWeight: 600 },
  compArea: { fontSize: 11.5, color: "#7EA694" },
  matchCard: {
    display: "block", background: "#12291E", border: "1px solid #1E3D2C", borderRadius: 14,
    padding: 16, marginBottom: 12, textDecoration: "none", color: "inherit", cursor: "pointer",
  },
  matchRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 14 },
  teamBlock: { flex: 1, display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  teamBlockAway: { justifyContent: "flex-end" },
  crestWrap: {
    width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    background: "radial-gradient(circle, rgba(57,181,119,0.25) 0%, rgba(57,181,119,0) 70%)",
    boxShadow: "0 0 10px rgba(57,181,119,0.35)",
  },
  crest: { width: 26, height: 26, objectFit: "contain", filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.4))" },
  teamName: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 },
  score: { fontWeight: 800, color: "#39B577", flexShrink: 0, padding: "0 8px", fontSize: 16 },
  badge: { fontSize: 11, color: "#7EA694", display: "block", marginTop: 8 },
  badgeLive: { color: "#D8685E", fontWeight: 700 },
  divider: { borderTop: "1px solid #1E3D2C", margin: "14px 0" },
  sectionLabel: { fontSize: 10, color: "#5C8A73", textTransform: "uppercase", margin: "10px 0 6px", letterSpacing: 0.4 },
  probRow: { display: "flex", gap: 8, marginBottom: 4 },
  probCell: { flex: 1, textAlign: "center", background: "#0B1F16", borderRadius: 8, padding: "8px 4px" },
  probLabel: { display: "block", fontSize: 9.5, color: "#7EA694", textTransform: "uppercase" },
  probValue: { fontSize: 14, fontWeight: 700 },
};
