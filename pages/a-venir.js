import { useState, useEffect, useMemo, useCallback } from "react";
import { useRequireAuth } from "../lib/useRequireAuth";
import { useSport } from "../lib/useSport";
import { presentCompetitions, presentMatchdays } from "../lib/matchFilters";
import MatchCard from "../components/MatchCard";
import SiteHeader from "../components/SiteHeader";
import FilterCarousel from "../components/FilterCarousel";
import SportComingSoon from "../components/SportComingSoon";
import { formatMinutesAgo } from "../lib/formatRelativeTime";

const UPCOMING_STATUSES = ["SCHEDULED", "TIMED"];
// Les matchs à venir changent moins vite que le direct, mais un rafraîchissement
// périodique permet quand même de voir un match basculer en direct sans recharger la
// page, et de se rétablir tout seul après un incident passager de l'API (quota,
// réseau) sans jamais laisser l'utilisateur bloqué sur un message d'erreur permanent.
const WEEK_REFRESH_MS = 60000;

function normalize(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

// Multi-sport bloc 2 : "Matchs groupés JOUR PAR JOUR (une section par date)" pour le
// basket — clé de jour calendaire LOCALE (jamais la date UTC brute, qui ferait
// basculer un match de 23h dans le mauvais jour pour une bonne partie des visiteurs).
function localDayKey(utcDateIso) {
  const d = new Date(utcDateIso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayLabel(key) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((date - today) / 86400000);
  if (diffDays === 0) return "Aujourd'hui";
  if (diffDays === 1) return "Demain";
  const label = date.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Page "Matchs à venir" (PROMPT 2 du plan) : deuxième et dernier bouton de
// navigation du site. Vraies données API (/api/matches, mêmes compétitions que
// PROMPT 1), jamais de match inventé.
export default function UpcomingMatches() {
  const { session, sessionChecked, authorized } = useRequireAuth();
  const { sport, setSport, sportReady } = useSport();

  const [search, setSearch] = useState("");
  const [weekData, setWeekData] = useState(null);
  const [weekLoading, setWeekLoading] = useState(true);
  const [compFilter, setCompFilter] = useState("all");
  const [matchdayFilter, setMatchdayFilter] = useState("all");

  const [bkWeekData, setBkWeekData] = useState(null);
  const [bkWeekLoading, setBkWeekLoading] = useState(true);

  // silent=true (rafraîchissement automatique) : une erreur passagère ne doit jamais
  // effacer des matchs déjà affichés — on réessaie simplement au prochain cycle.
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

  // Multi-sport (bloc 0) : /api/matches ne sert que du football (voir
  // lib/sports/football) — pas d'appel tant que l'onglet Basket/Tennis est affiché.
  useEffect(() => {
    if (!authorized || sport !== "football") return;
    loadWeekMatches();
  }, [authorized, sport, loadWeekMatches]);

  useEffect(() => {
    if (!authorized || sport !== "football") return;
    const id = setInterval(() => loadWeekMatches(true), WEEK_REFRESH_MS);
    return () => clearInterval(id);
  }, [authorized, sport, loadWeekMatches]);

  // Multi-sport bloc 2 : mêmes principes que le football ci-dessus, pour
  // /api/basketball/matches (voir pages/api/basketball/matches.js).
  const loadBkWeekMatches = useCallback((silent = false) => {
    if (!silent) setBkWeekLoading(true);
    return fetch("/api/basketball/matches")
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) {
          console.error("Erreur /api/basketball/matches:", d.error);
          if (silent) return;
        }
        setBkWeekData(d);
      })
      .catch((e) => {
        console.error("Erreur /api/basketball/matches:", e);
        if (!silent) setBkWeekData({ error: true, competitions: [] });
      })
      .finally(() => setBkWeekLoading(false));
  }, []);

  useEffect(() => {
    if (!authorized || sport !== "basketball") return;
    loadBkWeekMatches();
  }, [authorized, sport, loadBkWeekMatches]);

  useEffect(() => {
    if (!authorized || sport !== "basketball") return;
    const id = setInterval(() => loadBkWeekMatches(true), WEEK_REFRESH_MS);
    return () => clearInterval(id);
  }, [authorized, sport, loadBkWeekMatches]);

  const [tnWeekData, setTnWeekData] = useState(null);
  const [tnWeekLoading, setTnWeekLoading] = useState(true);

  // Multi-sport bloc 5 : mêmes principes que football/basket ci-dessus, pour
  // /api/tennis/matches (voir pages/api/tennis/matches.js).
  const loadTnWeekMatches = useCallback((silent = false) => {
    if (!silent) setTnWeekLoading(true);
    return fetch("/api/tennis/matches")
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) {
          console.error("Erreur /api/tennis/matches:", d.error);
          if (silent) return;
        }
        setTnWeekData(d);
      })
      .catch((e) => {
        console.error("Erreur /api/tennis/matches:", e);
        if (!silent) setTnWeekData({ error: true, competitions: [] });
      })
      .finally(() => setTnWeekLoading(false));
  }, []);

  useEffect(() => {
    if (!authorized || sport !== "tennis") return;
    loadTnWeekMatches();
  }, [authorized, sport, loadTnWeekMatches]);

  useEffect(() => {
    if (!authorized || sport !== "tennis") return;
    const id = setInterval(() => loadTnWeekMatches(true), WEEK_REFRESH_MS);
    return () => clearInterval(id);
  }, [authorized, sport, loadTnWeekMatches]);

  const searchQuery = search.trim();

  // Choisir une compétition réinitialise la journée sélectionnée (une journée n'a de
  // sens que dans le contexte de la compétition qui vient d'être choisie).
  const selectCompetitionFilter = (value) => {
    setCompFilter(value);
    setMatchdayFilter("all");
  };

  // Options des deux carrousels (PROMPT 6), déduites des vrais matchs actuellement
  // chargés (toutes compétitions confondues) — jamais une compétition ou une
  // journée sans aucun match derrière.
  const allUpcomingMatches = useMemo(
    () => (weekData?.competitions || []).flatMap((c) => c.matches || []),
    [weekData]
  );
  const competitionOptions = useMemo(() => presentCompetitions(allUpcomingMatches), [allUpcomingMatches]);
  const matchdayOptions = useMemo(
    () => (compFilter === "all" ? [] : presentMatchdays(allUpcomingMatches, compFilter)),
    [allUpcomingMatches, compFilter]
  );

  const weekFeed = useMemo(() => {
    if (!weekData?.competitions) return [];
    const rows = [];
    const now = Date.now();
    weekData.competitions.forEach((comp) => {
      if (compFilter !== "all" && comp.code !== compFilter) return;
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
      if (matchdayFilter !== "all") matches = matches.filter((m) => String(m.matchday) === matchdayFilter);
      matches.forEach((m) => rows.push({ m, comp }));
    });
    rows.sort((a, b) => new Date(a.m.utcDate) - new Date(b.m.utcDate));
    return rows;
  }, [weekData, searchQuery, compFilter, matchdayFilter]);

  // Multi-sport bloc 2 : "Matchs groupés JOUR PAR JOUR (une section par date), toutes
  // compétitions confondues" — jamais de filtre par compétition pour le basket dans
  // ce bloc (contrairement au football ci-dessus, pas demandé ici).
  const bkByDay = useMemo(() => {
    const all = (bkWeekData?.competitions || [])
      .flatMap((c) => c.matches || [])
      .filter((m) => m?.homeTeam && m?.awayTeam && m?.utcDate);
    all.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
    const groups = new Map(); // "YYYY-MM-DD" locale -> matchs[]
    for (const m of all) {
      const key = localDayKey(m.utcDate);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }
    return [...groups.entries()].map(([key, matches]) => ({ key, label: dayLabel(key), matches }));
  }, [bkWeekData]);

  // Multi-sport bloc 5 : "Matchs groupés JOUR PAR JOUR", toutes catégories confondues
  // (ATP, WTA, Grand Chelem, Masters 1000, ATP 250/500, Challengers, ITF — voir
  // PROMPT bloc 5, point 3), jamais un filtre.
  const tnByDay = useMemo(() => {
    const all = (tnWeekData?.competitions || [])
      .flatMap((c) => c.matches || [])
      .filter((m) => m?.homeTeam && m?.awayTeam && m?.utcDate);
    all.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
    const groups = new Map();
    for (const m of all) {
      const key = localDayKey(m.utcDate);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }
    return [...groups.entries()].map(([key, matches]) => ({ key, label: dayLabel(key), matches }));
  }, [tnWeekData]);

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
              <h1 style={st.heroTitle}>Basket à venir</h1>
              <p style={st.heroSubtitle}>
                Les prochains matchs programmés sur les ligues suivies par Blume, jour par jour —
                NBA, EuroLeague, WNBA, NCAA, championnats nationaux et plus.
              </p>
            </section>

            {bkWeekLoading && <p style={st.hint}>Chargement des matchs…</p>}
            {!bkWeekLoading && (!bkWeekData || bkWeekData?.error) && (
              <p style={st.hint}>Les matchs ne sont pas disponibles pour le moment. Réessaie dans quelques minutes.</p>
            )}
            {!bkWeekLoading && bkWeekData && !bkWeekData.error && bkByDay.length === 0 && (
              <p style={st.hint}>Aucun match à venir pour le moment.</p>
            )}
            {!bkWeekLoading && bkWeekData?.stale && (
              <p style={st.staleNote}>Données mises à jour {formatMinutesAgo(bkWeekData.lastUpdated)}</p>
            )}

            <div data-testid="match-list" style={st.dayList}>
              {bkByDay.map((day) => (
                <div key={day.key} style={st.daySection} data-testid="day-section">
                  <h2 style={st.dayLabel}>{day.label}</h2>
                  <div style={st.dayCards}>
                    {day.matches.map((m) => (
                      <MatchCard key={m.id} m={m} comp={m.competition} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : sport === "tennis" ? (
          <>
            <section style={st.hero}>
              <h1 style={st.heroTitle}>Tennis à venir</h1>
              <p style={st.heroSubtitle}>
                Les prochains matchs programmés sur les circuits suivis par Blume, jour par jour — ATP,
                WTA, Grand Chelem, Masters 1000, ATP 250/500, Challengers et ITF.
              </p>
            </section>

            {tnWeekLoading && <p style={st.hint}>Chargement des matchs…</p>}
            {!tnWeekLoading && tnWeekData?.unsupported && (
              <p style={st.hint}>{tnWeekData.message || "Les matchs à venir ne sont pas disponibles pour le tennis avec cette source."}</p>
            )}
            {!tnWeekLoading && !tnWeekData?.unsupported && (!tnWeekData || tnWeekData?.error) && (
              <p style={st.hint}>Les matchs ne sont pas disponibles pour le moment. Réessaie dans quelques minutes.</p>
            )}
            {!tnWeekLoading && tnWeekData && !tnWeekData.error && !tnWeekData.unsupported && tnByDay.length === 0 && (
              <p style={st.hint}>Aucun match à venir pour le moment.</p>
            )}

            <div data-testid="match-list" style={st.dayList}>
              {tnByDay.map((day) => (
                <div key={day.key} style={st.daySection} data-testid="day-section">
                  <h2 style={st.dayLabel}>{day.label}</h2>
                  <div style={st.dayCards}>
                    {day.matches.map((m) => (
                      <MatchCard key={m.id} m={m} comp={m.competition} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : sport !== "football" ? (
          <SportComingSoon sport={sport} pageLabel="Matchs à venir" />
        ) : (
          <>
            <section style={st.hero}>
              <h1 style={st.heroTitle}>Matchs à venir</h1>
              <p style={st.heroSubtitle}>
                Les prochains matchs programmés sur les compétitions suivies par Blume — Coupe du
                Monde, Ligue des Champions, Premier League, LaLiga, Serie A, Bundesliga, Ligue 1 et
                plus.
              </p>
            </section>

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
                placeholder="Rechercher une équipe, une compétition…"
                style={st.searchInput}
              />
              {search && (
                <button style={st.searchBtn} onClick={() => setSearch("")}>✕</button>
              )}
            </div>

            {weekLoading && <p style={st.hint}>Chargement des matchs…</p>}
            {!weekLoading && (!weekData || weekData?.error) && (
              <p style={st.hint}>Les matchs ne sont pas disponibles pour le moment. Réessaie dans quelques minutes.</p>
            )}
            {!weekLoading && weekData && !weekData.error && weekFeed.length === 0 && (
              <p style={st.hint}>
                {searchQuery
                  ? "Aucun match ne correspond à ta recherche."
                  : compFilter !== "all"
                  ? "Aucun match à venir pour ce filtre."
                  : "Aucun match à venir cette semaine."}
              </p>
            )}
            {!weekLoading && weekData?.stale && (
              <p style={st.staleNote}>Données mises à jour {formatMinutesAgo(weekData.lastUpdated)}</p>
            )}

            <div data-testid="match-list">
              {weekFeed.map(({ m, comp }) => (
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
  hint: { fontSize: 12.5, color: "var(--text-secondary)" },
  // Message discret (jamais une erreur) affiché quand le quota API du jour est épuisé
  // et que les matchs viennent du dernier cache connu (voir PROMPT, pages/api/
  // basketball/*.js) — même ton que .hint, en italique pour rester secondaire.
  staleNote: { fontSize: 11.5, color: "var(--text-secondary)", fontStyle: "italic", margin: "4px 0 0" },
  searchRow: { display: "flex", gap: 8 },
  searchInput: {
    flex: 1, background: "var(--card-bg)", border: "1px solid var(--border)", color: "var(--text-primary)",
    borderRadius: 999, padding: "10px 16px", fontSize: 13,
  },
  searchBtn: {
    background: "var(--accent)", border: "none", color: "var(--on-accent)", fontWeight: 700,
    borderRadius: 999, padding: "0 18px", fontSize: 13, cursor: "pointer",
  },
  // Multi-sport bloc 2 : une section par jour (voir PROMPT bloc 2, point 2) — même
  // espacement (16) que le reste des blocs de la page (st.main), une carte de match
  // gardant, elle, le même espacement (10) que les listes de cartes ailleurs sur le
  // site (voir components/ProbableScorers.js, AssistsProbables.js...).
  dayList: { display: "flex", flexDirection: "column", gap: 16 },
  daySection: { display: "flex", flexDirection: "column", gap: 10 },
  dayLabel: { fontSize: 13, fontWeight: 800, color: "var(--text-primary)", margin: "0 0 2px", textTransform: "capitalize" },
  dayCards: { display: "flex", flexDirection: "column", gap: 10 },
};
