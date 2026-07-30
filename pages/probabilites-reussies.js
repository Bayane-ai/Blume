import PronosticHistoryPage from "../components/PronosticHistoryPage";

export default function ProbabilitesReussies() {
  return (
    <PronosticHistoryPage
      status="success"
      title="Probabilités réussies"
      subtitle="Les matchs terminés dont l'équipe favorite désignée avant le match a réellement gagné — les plus récents en premier."
      emptyMessage="Aucun match terminé pour l'instant — l'historique se remplit à la fin de chaque match."
      testId="pronostic-history-success-list"
    />
  );
}
