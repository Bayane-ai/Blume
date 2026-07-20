import PronosticHistoryPage from "../components/PronosticHistoryPage";

export default function ProbabilitesEchouees() {
  return (
    <PronosticHistoryPage
      status="failure"
      title="Probabilités échouées"
      subtitle="Les matchs terminés dont le pronostic (issue et total de buts) ne s'est pas vérifié — les plus récents en premier."
      emptyMessage="Aucun pronostic échoué pour le moment."
      testId="pronostic-history-failure-list"
    />
  );
}
