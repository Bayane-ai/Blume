import { useRouter } from "next/router";
import MatchInfoBlock from "./MatchInfoBlock";
import { matchHref } from "./MatchCard";

function formatAddedAt(ts) {
  if (!Number.isFinite(ts)) return "";
  return new Date(ts).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Une entrée de la page "Historique" (voir PROMPT) : reprend le même bloc visuel qu'une
// carte de match (components/MatchInfoBlock.js), mais SANS bouton "Analyser" — cette
// page ne fait que rappeler les matchs déjà consultés, jamais une nouvelle invitation à
// analyser. Un clic renvoie vers la page du match, qui refait sa propre analyse à jour
// (pronostics sans score s'il n'a pas encore été joué, "Match terminé" avec son
// compte-rendu s'il l'a été depuis) : jamais l'instantané figé au moment de l'ajout à
// l'historique, toujours l'état réel actuel du match.
export default function MatchHistoryCard({ entry }) {
  const router = useRouter();
  if (!entry || !entry.homeTeam || !entry.awayTeam) return null;

  const goToMatch = () => router.push(matchHref(entry, entry.competition));

  return (
    <button type="button" style={st.card} onClick={goToMatch} data-testid="match-history-card">
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
  addedAt: { fontSize: 10.5, color: "var(--text-secondary)", margin: "12px 0 0", textAlign: "right" },
};
