import { useState, useEffect, useMemo, useCallback } from "react";
import { useRequireAuth } from "../lib/useRequireAuth";
import { buildDayList, groupMatchesByDay, sortDayMatches } from "../lib/dayGrouping";
import MatchCard from "../components/MatchCard";
import SiteHeader from "../components/SiteHeader";
import DayTabs from "../components/DayTabs";

// Statuts affichables sur cette page : en direct ou pas encore joué. Un match déjà
// terminé plus tôt dans la journée appartient aux résultats (page compétition), pas
// à ce navigateur "à venir".
const DISPLAYABLE_STATUSES = ["SCHEDULED", "TIMED", "IN_PLAY", "PAUSED"];
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

// Page "Matchs à venir" : navigateur jour par jour, toutes compétitions et tous pays
// confondus (aucun filtre par compétition — voir la demande "Affichage des matchs
// jour par jour"). Chaque jour a sa propre section ; dans le jour affiché, les
// matchs en direct passent avant les matchs à venir, eux-mêmes triés par heure de
// coup d'envoi. Vraies données API (/api/matches, mêmes compétitions que la page
// "Live"), jamais de match inventé.
export default function UpcomingMatches() {
  const { session, sessionChecked, authorized } = useRequireAuth();

  const [search, setSearch] = useState("");
  const [weekData, setWeekData] = useState(null);
  const [weekLoading, setWeekLoading] = useState(true);
  // Toujours au moins 7 jours ; calculée une seule fois par montage de la page (la
  // liste ne bouge pas pendant qu'on navigue entre les jours).
  const [days] = useState(() => buildDayList());
  const [selectedDayKey, setSelectedDayKey] = useState(() => days[0]?.key);

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

  useEffect(() => {
    if (!authorized) return;
    loadWeekMatches();
  }, [authorized, loadWeekMatches]);

  useEffect(() => {
    if (!authorized) return;
    const id = setInterval(() => loadWeekMatches(true), WEEK_REFRESH_MS);
    return () => clearInterval(id);
  }, [authorized, loadWeekMatches]);

  const searchQuery = search.trim();

  // Tous les matchs affichables, toutes compétitions confondues, regroupés par jour
  // calendaire — jamais filtrés par compétition sur cette page.
  const dayGroups = useMemo(() => {
    const allMatches = (weekData?.competitions || [])
      .flatMap((c) => c.matches || [])
      .filter((m) => m?.homeTeam && m?.awayTeam && m?.utcDate && DISPLAYABLE_STATUSES.includes(m.status));
    return groupMatchesByDay(allMatches);
  }, [weekData]);

  const selectedDayMatches = useMemo(() => {
    let matches = dayGroups.get(selectedDayKey) || [];
    if (searchQuery) {
      const q = normalize(searchQuery);
      matches = matches.filter(
        (m) =>
          normalize(m.homeTeam.name).includes(q) ||
          normalize(m.awayTeam.name).includes(q) ||
          normalize(m.competition?.name).includes(q)
      );
    }
    return sortDayMatches(matches);
  }, [dayGroups, selectedDayKey, searchQuery]);

  const selectedDay = days.find((d) => d.key === selectedDayKey) || days[0];

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
          <h1 style={st.heroTitle}>Matchs à venir</h1>
          <p style={st.heroSubtitle}>
            Les prochains matchs, jour par jour, toutes compétitions et tous pays confondus —
            Coupe du Monde, Ligue des Champions, Premier League, LaLiga, Serie A, Bundesliga,
            Ligue 1 et plus.
          </p>
        </section>

        <DayTabs days={days} selectedKey={selectedDayKey} onSelect={setSelectedDayKey} />

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

        <h2 style={st.dayHeading} data-testid="day-heading">{selectedDay?.label}</h2>

        {weekLoading && <p style={st.hint}>Chargement des matchs…</p>}
        {!weekLoading && (!weekData || weekData?.error) && (
          <p style={st.hint}>Les matchs ne sont pas disponibles pour le moment. Réessaie dans quelques minutes.</p>
        )}
        {!weekLoading && weekData && !weekData.error && selectedDayMatches.length === 0 && (
          <p style={st.hint}>
            {searchQuery ? "Aucun match ne correspond à ta recherche." : "Aucun match ce jour"}
          </p>
        )}

        <div data-testid="match-list">
          {selectedDayMatches.map((m) => (
            <MatchCard key={m.id} m={m} comp={m.competition} />
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
  heroSubtitle: { fontSize: 12, color: "#7EA694", margin: 0, lineHeight: 1.5 },
  hint: { fontSize: 12.5, color: "#7EA694" },
  dayHeading: { fontSize: 15, fontWeight: 800, margin: "4px 0 0" },
  searchRow: { display: "flex", gap: 8 },
  searchInput: {
    flex: 1, background: "#12291E", border: "1px solid #1E3D2C", color: "#E9F1EC",
    borderRadius: 999, padding: "10px 16px", fontSize: 13,
  },
  searchBtn: {
    background: "#39B577", border: "none", color: "#06121F", fontWeight: 700,
    borderRadius: 999, padding: "0 18px", fontSize: 13, cursor: "pointer",
  },
};
