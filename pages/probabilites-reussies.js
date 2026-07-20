import PronosticHistoryPage from "../components/PronosticHistoryPage";

export default function ProbabilitesReussies() {
  return (
    <PronosticHistoryPage
      status="success"
      title="Probabilités réussies"
      subtitle="Les matchs terminés dont le pronostic (issue et total de buts) s'est vérifié — les plus récents en premier."
      emptyMessage="Aucun pronostic réussi pour le moment."
      testId="pronostic-history-success-list"
    />
  );
}
