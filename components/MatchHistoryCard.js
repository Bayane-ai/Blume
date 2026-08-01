import { useRouter } from "next/router";
import MatchInfoBlock from "./MatchInfoBlock";
import { matchHref } from "./MatchCard";
import { getSportMeta } from "../lib/sports/registry";

function formatAddedAt(ts) {
  if (!Number.isFinite(ts)) return "";
  return new Date(ts).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Bloc 9 (multi-sport) — "Historique" mélange désormais les 3 sports sur une seule
// liste (voir pages/historique.js) : le sport de CETTE entrée précise se déduit du
// préfixe de son id (voir lib/sports/basketball/mapper.js "bk-"/lib/sports/tennis/
// mapper.js "tn-" ; tout le reste — id numérique ou "af-..." — est du football,
// jamais un id de match tennis/basket confondu par coïncidence avec un autre sport).
function sportFromMatchId(id) {
  const text = String(id || "");
  if (text.startsWith("bk-")) return "basketball";
  if (text.startsWith("tn-")) return "tennis";
  return "football";
}

// Une entrée de la page "Historique" (voir PROMPT) : reprend le même bloc visuel qu'une
// carte de match (components/MatchInfoBlock.js), mais SANS bouton "Analyser" — cette
// page ne fait que rappeler les matchs déjà consultés, jamais une nouvelle invitation à
// analyser. Un clic renvoie vers la page du match, qui refait sa propre analyse à jour
// (pronostics sans score s'il n'a pas encore été joué, "Match terminé" avec son
// compte-rendu s'il l'a été depuis) : jamais l'instantané figé au moment de l'ajout à
// l'historique, toujours l'état réel actuel du match. Bloc 9 : petit badge du sport
// (⚽/🏀/🎾), indispensable maintenant que cette liste mélange les 3 sports.
export default function MatchHistoryCard({ entry }) {
  const router = useRouter();
  if (!entry || !entry.homeTeam || !entry.awayTeam) return null;

  const sport = sportFromMatchId(entry.id);
  const sportMeta = getSportMeta(sport);
  const goToMatch = () => router.push(matchHref(entry, entry.competition));

  return (
    <button type="button" style={st.card} onClick={goToMatch} data-testid="match-history-card">
      <span style={st.sportBadge} data-testid="match-history-sport-badge">
        {sportMeta.icon} {sportMeta.label}
      </span>
      <MatchInfoBlock m={entry} comp={entry.competition} />
      <p style={st.addedAt}>Consulté le {formatAddedAt(entry.addedAt)}</p>
    </button>
  );
}

const st = {
  card: {
    display: "block", width: "100%", textAlign: "left", cursor: "pointer",
    background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14,
    padding: 16,
  },
  sportBadge: {
    display: "inline-block", fontSize: 10.5, fontWeight: 700, color: "var(--text-secondary)",
    background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 999,
    padding: "2px 9px", marginBottom: 10,
  },
  addedAt: { fontSize: 10.5, color: "var(--text-secondary)", margin: "12px 0 0", textAlign: "right" },
};
