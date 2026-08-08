import Head from "next/head";
import { useRequireAuth } from "../lib/useRequireAuth";
import { useSport } from "../lib/useSport";
import SiteHeader from "../components/SiteHeader";
import UpcomingMatchesSection from "../components/UpcomingMatchesSection";

const SPORT_INTRO = {
  football:
    "Tous les matchs de football à venir, d'aujourd'hui à J+7 — toutes fédérations, toutes divisions, coupes, jeunes, réserves, féminines et amicaux compris.",
  basketball:
    "Tous les matchs de basket à venir, d'aujourd'hui à J+7 — toutes fédérations et tous pays, WNBA, ligues d'été, championnats nationaux et coupes compris.",
  tennis:
    "Tous les matchs de tennis à venir, d'aujourd'hui à J+7 — tous les circuits sans exception, principaux comme secondaires.",
};

// Onglet unique "Matchs à venir" — fusion de l'ancienne page du même nom et de
// l'ancien onglet "Matchs du jour" (supprimé ; /matchs-du-jour redirige ici de façon
// permanente, voir next.config.js).
//
// Contient les matchs du jour ET des jours suivants, séparés par sport (un seul sport
// affiché à la fois), groupés par date puis par compétition. Toute la récupération et
// l'agrégation multi-sources vivent dans lib/upcomingMatches.js.
export default function UpcomingMatches() {
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
      <Head>
        <title>Matchs à venir — Blume</title>
        <meta
          name="description"
          content="Tous les matchs à venir en football, basket et tennis : aujourd'hui et les jours suivants, toutes compétitions confondues."
        />
      </Head>

      <SiteHeader session={session} sport={sport} onSportChange={setSport} />

      <main style={st.main}>
        <section style={st.hero}>
          <h1 style={st.heroTitle}>Matchs à venir</h1>
          <p style={st.heroSubtitle}>{SPORT_INTRO[sport] || SPORT_INTRO.football}</p>
        </section>

        {/* Le sport sélectionné (mémorisé, voir lib/useSport.js) décide seul de ce qui
            est affiché : les matchs d'un sport n'apparaissent jamais dans un autre. */}
        <UpcomingMatchesSection key={sport} sport={sport} />
      </main>
    </div>
  );
}

const st = {
  page: { minHeight: "100vh", padding: "20px 16px 60px" },
  main: { maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 },
  hero: { textAlign: "center", padding: "8px 4px" },
  heroTitle: { fontSize: 21, fontWeight: 800, margin: "0 0 8px", lineHeight: 1.25 },
  heroSubtitle: { fontSize: 12, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 },
  hint: { fontSize: 12.5, color: "var(--text-secondary)" },
};
