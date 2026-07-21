import { useRouter } from "next/router";
import { matchHref } from "./MatchCard";
import { RISK_LABELS } from "../lib/combinedVision";

// BLOC 4.B / BLOC 5 — Gagné/Perdu/En cours (voir lib/comboHistory.js) : `progress`
// vient de pages/api/combo-history.js — `undefined` (combiné jamais vu, ou pas
// encore classé) se lit comme "En cours", jamais un statut inventé faute de donnée.
const STATUS_LABELS = { success: "Gagné", failure: "Perdu", pending: "En cours" };
const STATUS_STYLE_KEY = { success: "success", failure: "failure" };

// BLOC 5 — marque chaque sélection Gagnée (✓)/Perdue (✗)/En attente, à partir de
// `legResults[matchId]` (true/false/null|undefined) — jamais un verdict inventé pour
// une sélection dont le résultat réel n'est pas encore connu.
function legResultMark(result) {
  if (result === true) return { text: "✓ Gagné", styleKey: "won" };
  if (result === false) return { text: "✗ Perdu", styleKey: "lost" };
  return { text: "En attente", styleKey: "pending" };
}

// UN combiné (ticket) "Combiné Vision" — voir lib/combinedVision.js pour la
// génération : ses sélections détaillées match par match (jamais un mélange entre
// équipes ni entre matchs, un combiné pouvant mélanger matchs en direct et à venir —
// voir BLOC 5 "combiné mixte"), une justification par sélection (BLOC 4.A), un niveau
// de confiance RÉEL (produit des probabilités de chaque ligne, jamais une cote
// chiffrée), un statut Gagné/Perdu/En cours avec chaque sélection cochée au fil des
// matchs (BLOC 5) et, quand pertinent, la mention "En live — saisir l'occasion" (ou
// "compromis", voir BLOC 4.D). Chaque ligne mène directement au vrai match concerné,
// pour que la personne puisse vérifier elle-même la donnée qui a produit cette
// sélection.
export default function CombinedVisionTicket({ combo, progress }) {
  const router = useRouter();
  if (!combo) return null;

  const status = progress?.status;
  const statusKey = STATUS_STYLE_KEY[status] || "pending";
  const failed = status === "failure";
  const legResults = progress?.legResults || {};

  return (
    <section style={{ ...st.card, ...(failed ? st.cardFailed : null) }} data-testid="combined-vision-ticket">
      <div style={st.headerRow}>
        <span style={{ ...st.riskBadge, ...st.riskBadgeByLevel[combo.riskLevel] }} data-testid="ticket-risk-badge">
          {RISK_LABELS[combo.riskLevel] || combo.riskLevel}
        </span>
        {/* BLOC 5 — un combiné déjà en échec n'est plus présenté comme une
            opportunité ("saisir l'occasion"/"compromis") : le statut "Perdu"
            ci-dessous suffit, jamais deux messages contradictoires. */}
        {combo.isLive && !failed && (
          <span
            style={{ ...st.liveBadge, ...(combo.compromised ? st.liveBadgeCompromised : null) }}
            data-testid="ticket-live-badge"
          >
            {combo.compromised ? "En live — compromis" : "En live — saisir l'occasion"}
          </span>
        )}
        <span style={{ ...st.statusBadge, ...st.statusBadgeByKey[statusKey] }} data-testid="ticket-status-badge">
          {STATUS_LABELS[status] || "En cours"}
        </span>
      </div>

      {/* BLOC 5 — "Échec immédiat et automatique" : message clair dès qu'une seule
          sélection est perdue, même si d'autres matchs du combiné ne sont pas encore
          joués. */}
      {failed && (
        <p style={st.failureMessage} data-testid="ticket-failure-message">
          Combiné en échec : une sélection a été perdue.
        </p>
      )}

      <div style={st.legList}>
        {combo.legs.map((leg) => {
          const mark = legResultMark(legResults[leg.matchId]);
          return (
            <div key={leg.matchId} style={st.legWrap}>
              <button
                type="button"
                style={st.legRow}
                data-testid="ticket-leg"
                onClick={() => router.push(matchHref(leg.match, leg.comp))}
              >
                <div style={st.legTopRow}>
                  <span style={st.legComp}>{leg.competitionName}{leg.isLive ? " · LIVE" : ""}</span>
                  <span style={{ ...st.legResult, ...st.legResultByKey[mark.styleKey] }} data-testid="ticket-leg-result">
                    {mark.text}
                  </span>
                </div>
                <span style={st.legTeams} data-testid="ticket-leg-teams">{leg.homeTeamName} — {leg.awayTeamName}</span>
                <span style={st.legPick}>{leg.marketLabel} : {leg.pickLabel}</span>
              </button>
              {leg.reason && (
                <p style={st.legReason} data-testid="ticket-leg-reason">{leg.reason}</p>
              )}
            </div>
          );
        })}
      </div>

      <div style={st.confidenceRow} data-testid="ticket-confidence">
        Confiance : {combo.confidenceLabel} ({combo.confidence} %)
      </div>
    </section>
  );
}

const st = {
  card: { background: "#FFFFFF", border: "1px solid #D8E6DE", borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 10 },
  cardFailed: { opacity: 0.7, borderColor: "#F0C4BC" },
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
  liveBadgeCompromised: { background: "#8A6100" },
  statusBadge: { fontSize: 11, fontWeight: 800, borderRadius: 999, padding: "4px 10px", marginLeft: "auto" },
  statusBadgeByKey: {
    pending: { background: "#EEF5F0", color: "#3F6151" },
    success: { background: "#DCF5E6", color: "#127A45" },
    failure: { background: "#FBE1DE", color: "#B23B2C" },
  },
  failureMessage: { fontSize: 12, fontWeight: 700, color: "#B23B2C", margin: 0 },
  legList: { display: "flex", flexDirection: "column", gap: 6 },
  legWrap: { display: "flex", flexDirection: "column", gap: 2 },
  legRow: {
    display: "flex", flexDirection: "column", gap: 2, textAlign: "left", cursor: "pointer",
    background: "#EEF5F0", border: "none", borderRadius: 8, padding: "10px 12px", width: "100%",
  },
  legTopRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 },
  legComp: { fontSize: 10, color: "#5C7A6A", textTransform: "uppercase", letterSpacing: 0.3 },
  legResult: { fontSize: 10, fontWeight: 800 },
  legResultByKey: {
    won: { color: "#127A45" },
    lost: { color: "#B23B2C" },
    pending: { color: "#8A9A91" },
  },
  legTeams: { fontSize: 12.5, fontWeight: 700, color: "#13291D" },
  legPick: { fontSize: 12, fontWeight: 600, color: "#1A7F4F" },
  legReason: { fontSize: 11, color: "#5C7A6A", margin: "0 4px", lineHeight: 1.4 },
  confidenceRow: { fontSize: 12.5, fontWeight: 700, color: "#13291D" },
};
