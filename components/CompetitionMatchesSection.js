import MatchCard from "./MatchCard";

// Bloc de présentation PUR (aucun appel réseau ici) : les deux sections demandées sur
// l'accueil football ("compétitions spécifiques" et "tous les clubs") réutilisent les
// matchs déjà récupérés par pages/index.js via /api/live-matches et /api/matches — les
// mêmes sources réelles, déjà testées et en production, que le reste du site (voir
// lib/featuredCompetitions.js pour le filtrage/tri).
export default function CompetitionMatchesSection({ title, subtitle, matches, loading, minMatches = 0, testId }) {
  return (
    <section style={st.section} data-testid={testId}>
      <div style={st.header}>
        <h2 style={st.title}>{title}</h2>
        {subtitle && <p style={st.subtitle}>{subtitle}</p>}
      </div>

      {loading && <p style={st.hint}>Chargement des matchs…</p>}

      {!loading && matches.length === 0 && (
        <p style={st.hint}>Aucun match trouvé actuellement pour ces compétitions.</p>
      )}

      {!loading && matches.length > 0 && (
        <>
          {minMatches > 0 && matches.length < minMatches && (
            <p style={st.staleNote}>
              Seulement {matches.length} match{matches.length > 1 ? "s" : ""} disponible{matches.length > 1 ? "s" : ""} pour le moment sur ces
              compétitions.
            </p>
          )}
          <div data-testid={`${testId}-list`}>
            {matches.map((m) => (
              <MatchCard key={m.id} m={m} comp={m.competition} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

const st = {
  section: { display: "flex", flexDirection: "column", gap: 12 },
  header: { display: "flex", flexDirection: "column", gap: 4 },
  title: { fontSize: 16, fontWeight: 800, margin: 0 },
  subtitle: { fontSize: 12, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 },
  hint: { fontSize: 12.5, color: "var(--text-secondary)" },
  staleNote: { fontSize: 11.5, color: "var(--text-secondary)", fontStyle: "italic", margin: 0 },
};
