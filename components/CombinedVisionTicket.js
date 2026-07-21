import { useRouter } from "next/router";
import { matchHref } from "./MatchCard";
import { RISK_LABELS } from "../lib/combinedVision";

// UN combiné (ticket) "Combiné Vision" — voir lib/combinedVision.js pour la
// génération : ses sélections détaillées match par match (jamais un mélange entre
// équipes ni entre matchs), un niveau de risque, un niveau de confiance RÉEL (produit
// des probabilités de chaque ligne, jamais une cote chiffrée) et, quand pertinent, la
// mention "En live — saisir l'occasion". Chaque ligne mène directement au vrai match
// concerné, pour que la personne puisse vérifier elle-même la donnée qui a produit
// cette sélection.
export default function CombinedVisionTicket({ combo }) {
  const router = useRouter();
  if (!combo) return null;

  return (
    <section style={st.card} data-testid="combined-vision-ticket">
      <div style={st.headerRow}>
        <span style={{ ...st.riskBadge, ...st.riskBadgeByLevel[combo.riskLevel] }} data-testid="ticket-risk-badge">
          {RISK_LABELS[combo.riskLevel] || combo.riskLevel}
        </span>
        {combo.isLive && (
          <span style={st.liveBadge} data-testid="ticket-live-badge">En live — saisir l'occasion</span>
        )}
      </div>

      <div style={st.legList}>
        {combo.legs.map((leg) => (
          <button
            key={leg.matchId}
            type="button"
            style={st.legRow}
            data-testid="ticket-leg"
            onClick={() => router.push(matchHref(leg.match, leg.comp))}
          >
            <span style={st.legComp}>{leg.competitionName}{leg.isLive ? " · LIVE" : ""}</span>
            <span style={st.legTeams} data-testid="ticket-leg-teams">{leg.homeTeamName} — {leg.awayTeamName}</span>
            <span style={st.legPick}>{leg.marketLabel} : {leg.pickLabel}</span>
          </button>
        ))}
      </div>

      <div style={st.confidenceRow} data-testid="ticket-confidence">
        Confiance : {combo.confidenceLabel} ({combo.confidence} %)
      </div>
    </section>
  );
}

const st = {
  card: { background: "#FFFFFF", border: "1px solid #D8E6DE", borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 10 },
  headerRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  riskBadge: { fontSize: 11, fontWeight: 800, borderRadius: 999, padding: "4px 10px", textTransform: "uppercase" },
  riskBadgeByLevel: {
    faible: { background: "#DCF5E6", color: "#127A45" },
    moyen: { background: "#FFF3D6", color: "#8A6100" },
    eleve: { background: "#FBE1DE", color: "#B23B2C" },
  },
  liveBadge: {
    fontSize: 11, fontWeight: 800, borderRadius: 999, padding: "4px 10px",
    background: "#C0392B", color: "#FFFFFF", letterSpacing: 0.2,
  },
  legList: { display: "flex", flexDirection: "column", gap: 6 },
  legRow: {
    display: "flex", flexDirection: "column", gap: 2, textAlign: "left", cursor: "pointer",
    background: "#EEF5F0", border: "none", borderRadius: 8, padding: "10px 12px", width: "100%",
  },
  legComp: { fontSize: 10, color: "#5C7A6A", textTransform: "uppercase", letterSpacing: 0.3 },
  legTeams: { fontSize: 12.5, fontWeight: 700, color: "#13291D" },
  legPick: { fontSize: 12, fontWeight: 600, color: "#1A7F4F" },
  confidenceRow: { fontSize: 12.5, fontWeight: 700, color: "#13291D" },
};
