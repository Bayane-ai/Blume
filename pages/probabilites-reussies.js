import PronosticHistoryPage from "../components/PronosticHistoryPage";

export default function ProbabilitesReussies() {
  return (
    <PronosticHistoryPage
      status="success"
      title="Probabilités réussies"
      subtitle="Les matchs terminés dont l'équipe favorite désignée avant le match a réellement gagné — les plus récents en premier."
      emptyMessage="Aucun pronostic réussi pour le moment."
      testId="pronostic-history-success-list"
    />
  );
}
