import { useRequireAuth } from "../lib/useRequireAuth";
import { useSport } from "../lib/useSport";
import SiteHeader from "../components/SiteHeader";
import SportScoreSection from "../components/SportScoreSection";

// Page "Matchs du jour" : les deux sections alimentées par l'API publique SportScore
// (voir lib/sportScore.js et components/SportScoreSection.js) — appel direct depuis le
// navigateur, sans backend, sans clé API, rechargement automatique toutes les 5 minutes.
//
// Volontairement sur SA PROPRE page plutôt qu'ajoutées à l'accueil ou à /a-venir :
// ces deux pages affichent déjà, respectivement, TOUS les matchs en direct et TOUS les
// matchs à venir issus du pipeline principal de Blume (football-data.org +
// API-Football). Y greffer une deuxième liste ferait réapparaître exactement le
// doublon retiré à la demande de l'utilisateur. Ici, aucune autre liste de matchs n'est
// affichée : un match n'apparaît donc jamais deux fois sur une même page.
//
// Purement informatif : aucun bouton, aucun lien de paiement, aucun lien vers la page
// d'analyse (contrairement aux cartes du reste du site, voir components/MatchCard.js).
export default function MatchsDuJour() {
  const { session, sessionChecked, authorized } = useRequireAuth();
  const { sport, setSport, sportReady } = useSport();

  if (!sessionChecked || !sportReady) {
    return (
      <div style={st.page}>
        <p style={st.hint}>Chargement…</p>
      </div>
    );
  }
  if (!authorized) return null;

  return (
    <div style={st.page}>
      <SiteHeader session={session} sport={sport} onSportChange={setSport} />

      <main style={st.main}>
        <section style={st.hero}>
          <h1 style={st.heroTitle}>Matchs du jour</h1>
          <p style={st.heroSubtitle}>
            Football, tennis et basketball, toutes compétitions confondues — matchs amicaux et petites
            compétitions compris. Liste actualisée automatiquement toutes les 5 minutes.
          </p>
        </section>

        <SportScoreSection
          sport="football"
          title="Matchs de football à venir"
          subtitle="Grandes compétitions en tête (Ligue des Champions, Europa, Conference, Premier League, Liga, Serie A, Bundesliga, Ligue 1), puis toutes les autres."
          testId="sportscore-football"
        />

        <SportScoreSection
          sport="tennis"
          title="Matchs de tennis à venir"
          subtitle="Grands tournois en tête (Grand Chelem, ATP, WTA), puis tous les autres."
          testId="sportscore-tennis"
        />

        <SportScoreSection
          sport="basketball"
          title="Matchs de basketball à venir"
          subtitle="Grandes ligues en tête (NBA, EuroLeague), puis toutes les autres."
          testId="sportscore-basketball"
        />
      </main>
    </div>
  );
}

const st = {
  page: { minHeight: "100vh", padding: "20px 16px 60px" },
  main: { maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 },
  hero: { textAlign: "center", padding: "8px 4px" },
  heroTitle: { fontSize: 21, fontWeight: 800, margin: "0 0 8px", lineHeight: 1.25 },
  heroSubtitle: { fontSize: 12, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 },
  hint: { fontSize: 12.5, color: "var(--text-secondary)" },
};
