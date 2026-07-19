import { useCallback, useEffect, useState } from "react";
import { useRequireAuth } from "../lib/useRequireAuth";
import { COMPETITIONS } from "../lib/competitions";
import PronosticResults from "../components/PronosticResults";

// Analyse libre : choisis n'importe quelles deux équipes d'une même compétition
// (pas besoin d'un match réellement programmé) et lance le même moteur de
// pronostic que pour un match réel (lib/pronostic.js, via /api/compare) —
// aucune connexion supplémentaire requise au-delà du compte déjà obligatoire pour
// accéder au site.
// Compétition de départ : un championnat de clubs (toujours un classement complet
// et stable), pas une compétition internationale par élimination directe (Coupe du
// Monde, Euro) qui n'a souvent pas de classement exploitable — la page serait vide
// au premier chargement.
const DEFAULT_COMPETITION_CODE = COMPETITIONS.find((c) => c.code === "PL")?.code || COMPETITIONS[0].code;

export default function AnalysePage() {
  const { sessionChecked, authorized } = useRequireAuth();

  const [competitionCode, setCompetitionCode] = useState(DEFAULT_COMPETITION_CODE);
  const [teams, setTeams] = useState([]);
  const [teamsLoading, setTeamsLoading] = useState(true);

  const [homeTeam, setHomeTeam] = useState(null);
  const [awayTeam, setAwayTeam] = useState(null);

  const [suggestions, setSuggestions] = useState([]);

  const [pronostic, setPronostic] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadTeams = useCallback((code) => {
    setTeamsLoading(true);
    setTeams([]);
    return fetch(`/api/competition-standings?code=${code}`)
      .then((r) => r.json())
      .then((d) => {
        const list = (d?.table || []).map((row) => ({ id: row.team?.id, name: row.team?.name, crest: row.team?.crest }))
          .filter((t) => t.id && t.name);
        setTeams(list);
      })
      .catch(() => setTeams([]))
      .finally(() => setTeamsLoading(false));
  }, []);

  useEffect(() => {
    if (!authorized) return;
    loadTeams(competitionCode);
    setHomeTeam(null);
    setAwayTeam(null);
    setPronostic(null);
  }, [authorized, competitionCode, loadTeams]);

  // Suggestions : de vrais matchs à venir (n'importe quelle compétition), cliquables
  // pour pré-remplir directement les deux équipes.
  useEffect(() => {
    if (!authorized) return;
    fetch("/api/matches")
      .then((r) => r.json())
      .then((d) => {
        const rows = [];
        for (const comp of d?.competitions || []) {
          for (const m of comp.matches || []) {
            if (!m?.homeTeam?.id || !m?.awayTeam?.id) continue;
            rows.push({
              competitionCode: comp.code,
              competitionName: comp.name,
              home: { id: m.homeTeam.id, name: m.homeTeam.name, crest: m.homeTeam.crest },
              away: { id: m.awayTeam.id, name: m.awayTeam.name, crest: m.awayTeam.crest },
            });
            if (rows.length >= 6) break;
          }
          if (rows.length >= 6) break;
        }
        setSuggestions(rows);
      })
      .catch(() => setSuggestions([]));
  }, [authorized]);

  const applySuggestion = (s) => {
    setCompetitionCode(s.competitionCode);
    setPronostic(null);
    loadTeams(s.competitionCode).then(() => {
      setHomeTeam(s.home);
      setAwayTeam(s.away);
    });
  };

  const runAnalysis = () => {
    if (!homeTeam || !awayTeam) return;
    setLoading(true);
    setPronostic(null);
    const params = new URLSearchParams({
      competitionCode,
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      homeTeamName: homeTeam.name,
      awayTeamName: awayTeam.name,
    });
    fetch(`/api/compare?${params}`)
      .then((r) => r.json())
      .then((result) => {
        if (result?.error) console.error("Erreur /api/compare:", result.error);
        setPronostic(result);
      })
      .catch((e) => {
        console.error("Erreur /api/compare:", e);
        setPronostic({ error: "Erreur lors du calcul de l'analyse." });
      })
      .finally(() => setLoading(false));
  };

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
        <a href="/" style={st.smallBtn}>← Matchs</a>
      </header>

      <main style={st.main}>
        <section style={st.panel}>
          <p style={st.eyebrow}>Moteur d'analyse</p>
          <h1 style={st.h1}>
            Analyse un match. <span style={st.h1Accent}>Le modèle fait le reste.</span>
          </h1>
          <p style={st.subtitle}>
            Choisis les deux équipes (dans une même compétition). Le modèle statistique croise
            classement et forme récente pour estimer probabilités, buts, corners et tirs — comme sur
            la page d'un match réel.
          </p>

          <label style={st.label} htmlFor="analyse-competition">Compétition</label>
          <select
            id="analyse-competition"
            value={competitionCode}
            onChange={(e) => setCompetitionCode(e.target.value)}
            style={st.select}
          >
            {COMPETITIONS.map((c) => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </select>

          <div style={st.pickerRow}>
            <TeamSlot
              label="Domicile"
              team={homeTeam}
              teams={teams}
              disabledId={awayTeam?.id}
              loading={teamsLoading}
              onChange={setHomeTeam}
            />
            <span style={st.vsBadge}>VS</span>
            <TeamSlot
              label="Extérieur"
              team={awayTeam}
              teams={teams}
              disabledId={homeTeam?.id}
              loading={teamsLoading}
              onChange={setAwayTeam}
            />
          </div>

          {suggestions.length > 0 && (
            <>
              <p style={st.sectionLabel}>Suggestions</p>
              <div style={st.suggestionsList}>
                {suggestions.map((s, i) => (
                  <button key={i} type="button" style={st.suggestionRow} onClick={() => applySuggestion(s)}>
                    <span style={st.suggestionComp}>{s.competitionName}</span>
                    <span style={st.suggestionTeams}>{s.home.name} - {s.away.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          <button
            type="button"
            style={{ ...st.analyzeBtn, ...(!homeTeam || !awayTeam ? st.analyzeBtnDisabled : {}) }}
            onClick={runAnalysis}
            disabled={!homeTeam || !awayTeam || loading}
          >
            {loading ? "Analyse en cours…" : "Lancer l'analyse →"}
          </button>

          {pronostic && <PronosticResults pronostic={pronostic} loading={loading} />}
        </section>
      </main>
    </div>
  );
}

function TeamSlot({ label, team, teams, disabledId, loading, onChange }) {
  if (!team) {
    return (
      <div style={st.slot}>
        <span style={st.slotLabel}>{label}</span>
        <select
          value=""
          disabled={loading || teams.length === 0}
          onChange={(e) => {
            const picked = teams.find((t) => String(t.id) === e.target.value);
            if (picked) onChange(picked);
          }}
          style={st.select}
        >
          <option value="" disabled>
            {loading ? "Chargement…" : teams.length === 0 ? "Indisponible" : "Choisir une équipe…"}
          </option>
          {teams.filter((t) => String(t.id) !== String(disabledId)).map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div style={st.slot}>
      <span style={st.slotLabel}>{label}</span>
      <div style={st.slotFilled}>
        {team.crest && <img src={team.crest} alt="" style={st.slotCrest} onError={(e) => (e.target.style.display = "none")} />}
        <span style={st.slotName}>{team.name}</span>
        <div style={st.slotActions}>
          <button type="button" style={st.changeBtn} onClick={() => onChange(null)}>Changer</button>
          <button type="button" style={st.removeBtn} onClick={() => onChange(null)} aria-label={`Retirer ${team.name}`}>✕</button>
        </div>
      </div>
    </div>
  );
}

const st = {
  page: { minHeight: "100vh", padding: "20px 16px 60px" },
  header: { maxWidth: 640, margin: "0 auto 20px" },
  smallBtn: {
    background: "transparent", border: "1px solid #1E3D2C", color: "#E9F1EC",
    borderRadius: 999, padding: "6px 12px", fontSize: 12, textDecoration: "none",
  },
  main: { maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 },
  panel: { background: "#12291E", border: "1px solid #1E3D2C", borderRadius: 14, padding: 18 },
  eyebrow: { fontSize: 10.5, color: "#39B577", textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 800, margin: "0 0 6px" },
  h1: { fontSize: 22, fontWeight: 800, margin: "0 0 8px", lineHeight: 1.25 },
  h1Accent: { color: "#39B577" },
  subtitle: { fontSize: 12.5, color: "#7EA694", margin: "0 0 16px" },
  label: { display: "block", fontSize: 10.5, color: "#7EA694", textTransform: "uppercase", margin: "0 0 6px" },
  select: {
    width: "100%", background: "#0B1F16", border: "1px solid #1E3D2C", color: "#E9F1EC",
    borderRadius: 9, padding: "10px 12px", fontSize: 13,
  },
  pickerRow: { display: "flex", alignItems: "center", gap: 8, margin: "16px 0" },
  slot: { flex: 1, minWidth: 0 },
  slotLabel: {
    display: "inline-block", fontSize: 9.5, fontWeight: 800, color: "#06121F", background: "#F5C518",
    borderRadius: 999, padding: "2px 8px", textTransform: "uppercase", marginBottom: 6,
  },
  slotFilled: {
    background: "#0B1F16", border: "1px solid #1E3D2C", borderRadius: 9, padding: "10px 12px",
    display: "flex", flexDirection: "column", alignItems: "center", gap: 6, textAlign: "center",
  },
  slotCrest: { width: 32, height: 32, objectFit: "contain" },
  slotName: { fontSize: 12.5, fontWeight: 700, overflowWrap: "break-word" },
  slotActions: { display: "flex", gap: 6 },
  changeBtn: {
    background: "transparent", border: "1px solid #1E3D2C", color: "#7EA694",
    borderRadius: 999, padding: "3px 10px", fontSize: 11, cursor: "pointer",
  },
  removeBtn: {
    background: "transparent", border: "1px solid #1E3D2C", color: "#D8685E",
    borderRadius: 999, padding: "3px 8px", fontSize: 11, cursor: "pointer",
  },
  vsBadge: {
    background: "#39B577", color: "#06121F", fontWeight: 800, fontSize: 11,
    borderRadius: 999, padding: "4px 8px", flexShrink: 0,
  },
  sectionLabel: { fontSize: 10, color: "#5C8A73", textTransform: "uppercase", margin: "14px 0 6px", letterSpacing: 0.4 },
  suggestionsList: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 },
  suggestionRow: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    background: "#0B1F16", border: "1px solid #1E3D2C", borderRadius: 9,
    padding: "10px 12px", cursor: "pointer", textAlign: "left",
  },
  suggestionComp: { fontSize: 10.5, color: "#7EA694" },
  suggestionTeams: { fontSize: 12.5, fontWeight: 600, color: "#E9F1EC" },
  analyzeBtn: {
    display: "block", width: "100%", background: "#39B577", border: "none", color: "#06121F",
    fontWeight: 800, fontSize: 15, borderRadius: 999, padding: "14px 0", cursor: "pointer",
    boxShadow: "0 0 18px rgba(57,181,119,0.45)",
  },
  analyzeBtnDisabled: { opacity: 0.5, cursor: "not-allowed", boxShadow: "none" },
  hint: { fontSize: 12.5, color: "#7EA694" },
};
