import PronosticHistoryPage from "../components/PronosticHistoryPage";

export default function ProbabilitesEchouees() {
  return (
    <PronosticHistoryPage
      status="failure"
      title="Probabilités échouées"
      subtitle="Les matchs terminés dont l'équipe favorite désignée avant le match n'a pas gagné — les plus récents en premier."
      emptyMessage="Aucun match terminé pour l'instant — l'historique se remplit à la fin de chaque match."
      testId="pronostic-history-failure-list"
    />
  );
}
