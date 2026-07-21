// Bloc de pronostics d'un match (Bloc 2 du parcours vidéo), présenté comme dans une
// app de paris sportifs — mais SANS jamais afficher de cote (pas de 1.85, 2.40...).
// Deux cartes bien séparées, chacune avec son propre titre, toujours dans cet ordre,
// identique pour tous les matchs (en ligne et à venir) :
//   Carte 1 — "Probabilité de victoire" : UNIQUEMENT le 1X2 (domicile/nul/extérieur),
//   chaque ligne accompagnée d'une barre visuelle dont la largeur reflète le vrai
//   pourcentage. Les seules valeurs en "%" de tout le bloc — jamais mélangées avec
//   les autres stats.
//   Carte 2 — "Statistiques du match" :
//     Total (buts du match entier) — ligne "Plus de X,X" / "Moins de X,X", avec une
//     marge (deux lignes voisines) quand l'issue est trop incertaine pour une seule.
//     Total 1 (équipe à domicile seule).
//     Total 2 (équipe à l'extérieur seule) — jamais mélangé avec le domicile.
//     Scores exacts (3 à 4), suivis d'un conseil de mise (miser petit sur chaque
//     score, encore moins quand les cotes sont élevées) — jamais de cote chiffrée
//     affichée, juste ce conseil de prudence.
// Corners/Hors-jeu/Fautes/Touches, Cartons (+ Tirs/Tirs cadrés) ont chacun leur
// propre bloc en bas de page (components/LiveStatBlock.js et
// components/CardsAndCorners.js). Les lignes ("X,5") et les probabilités viennent de
// lib/pronostic.js, calculées à partir des vraies statistiques des deux équipes pour
// CE match précis — jamais une valeur fixe recopiée d'un match à l'autre.
import { marketLabel } from "../lib/marketFormat";

function formatPercent(pct) {
  if (pct == null) return "–";
  return `${pct} %`;
}

function clampPercent(pct) {
  return Math.min(100, Math.max(0, pct || 0));
}

export default function PronosticResults({ pronostic, loading }) {
  if (loading) return null;

  if (pronostic?.error) {
    return <section style={st.card}><p style={{ ...st.hint, marginTop: 0 }}>{pronostic.error}</p></section>;
  }
  if (pronostic?.available === false) {
    return <section style={st.card}><p style={{ ...st.hint, marginTop: 0 }}>{pronostic.message || "Pronostics indisponibles pour ce match."}</p></section>;
  }
  if (!pronostic?.available || !pronostic?.probabilities || !pronostic?.goals) {
    return <section style={st.card}><p style={{ ...st.hint, marginTop: 0 }}>Pronostics indisponibles pour le moment.</p></section>;
  }

  const homeName = pronostic.home?.name || "Domicile";
  const awayName = pronostic.away?.name || "Extérieur";
  const markets = pronostic.markets;

  return (
    <>
      <section style={st.card} data-testid="win-probability-card">
        <h3 style={st.cardTitle}>Probabilité de victoire</h3>
        <div style={st.marketList} data-testid="win-probabilities">
          <div style={st.marketRow} data-testid="prob-home">
            Victoire {homeName} : {formatPercent(pronostic.probabilities.home)}
            <div style={st.probBarTrack}>
              <div style={{ ...st.probBarFill, width: `${clampPercent(pronostic.probabilities.home)}%` }} data-testid="prob-bar-home" />
            </div>
          </div>
          <div style={st.marketRow} data-testid="prob-draw">
            Match nul : {formatPercent(pronostic.probabilities.draw)}
            <div style={st.probBarTrack}>
              <div style={{ ...st.probBarFill, width: `${clampPercent(pronostic.probabilities.draw)}%` }} data-testid="prob-bar-draw" />
            </div>
          </div>
          <div style={st.marketRow} data-testid="prob-away">
            Victoire {awayName} : {formatPercent(pronostic.probabilities.away)}
            <div style={st.probBarTrack}>
              <div style={{ ...st.probBarFill, width: `${clampPercent(pronostic.probabilities.away)}%` }} data-testid="prob-bar-away" />
            </div>
          </div>
        </div>
      </section>

      <section style={st.card} data-testid="match-stats-card">
        <h3 style={st.cardTitle}>Statistiques du match</h3>
        <div style={st.marketList} data-testid="match-markets">
          <div style={st.marketRow} data-testid="market-total">Total : {marketLabel(markets?.totalGoals)}</div>
          <div style={st.marketRow} data-testid="market-total-1">Total 1 : {marketLabel(markets?.totalHome)}</div>
          <div style={st.marketRow} data-testid="market-total-2">Total 2 : {marketLabel(markets?.totalAway)}</div>
        </div>

        {pronostic.correctScores && pronostic.correctScores.length > 0 && (
          <>
            <p style={st.sectionLabel}>Scores exacts</p>
            <div style={st.scoresRow} data-testid="correct-scores">
              {pronostic.correctScores.map((s, i) => (
                <div key={s.score} style={st.scoreCell}>
                  <span style={st.probLabel}>{i === 0 ? "Le plus probable" : "Possible"}</span>
                  <span style={st.probValue}>{s.score.replace("-", " - ")}</span>
                </div>
              ))}
            </div>
            <p style={st.bettingTip} data-testid="correct-scores-tip">
              (Conseil : misez de petites sommes sur chaque score exact pour limiter le risque de perte, et misez encore moins quand les cotes sont élevées.)
            </p>
          </>
        )}
      </section>

      {pronostic.home && pronostic.away && (
        <p style={st.hint}>
          {homeName} :{" "}
          {pronostic.home.position != null
            ? `${pronostic.home.position}ᵉ (${pronostic.home.points} pts)`
            : pronostic.home.source || "estimation"}
          {" · "}
          {awayName} :{" "}
          {pronostic.away.position != null
            ? `${pronostic.away.position}ᵉ (${pronostic.away.points} pts)`
            : pronostic.away.source || "estimation"}
        </p>
      )}
      {pronostic.note && <p style={st.noteText}>{pronostic.note}</p>}
    </>
  );
}

const st = {
  // Même style que les autres cartes de la page (voir pages/match/[id].js — st.panel) :
  // chaque bloc de pronostic est sa propre section visuellement distincte, pas une
  // simple ligne au milieu d'un autre bloc.
  card: { background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 },
  cardTitle: { fontSize: 15, fontWeight: 800, margin: "0 0 12px", color: "var(--text-primary)" },
  hint: { fontSize: 12.5, color: "var(--text-secondary)", marginTop: 14 },
  sectionLabel: { fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", margin: "14px 0 6px", letterSpacing: 0.4 },
  marketList: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 4 },
  marketRow: {
    background: "var(--surface)", borderRadius: 8, padding: "10px 12px", fontSize: 13, fontWeight: 700,
  },
  // Barre visuelle sous chaque ligne de probabilité (1/X/2) : largeur proportionnelle
  // au vrai pourcentage de CE match — jamais une barre décorative fixe.
  probBarTrack: { marginTop: 8, height: 6, borderRadius: 999, background: "var(--border)", overflow: "hidden" },
  probBarFill: { height: "100%", borderRadius: 999, background: "var(--accent)" },
  scoresRow: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  scoreCell: { flex: "1 1 calc(33.333% - 6px)", minWidth: 72, textAlign: "center", background: "var(--surface)", borderRadius: 8, padding: "10px 4px" },
  probLabel: { display: "block", fontSize: 9.5, color: "var(--text-secondary)", textTransform: "uppercase" },
  probValue: { fontSize: 15, fontWeight: 700 },
  noteText: { fontSize: 10.5, color: "var(--text-secondary)", fontStyle: "italic", margin: "8px 0 0" },
  bettingTip: { fontSize: 10.5, color: "var(--text-secondary)", fontStyle: "italic", margin: "8px 0 0" },
};
