// Sport "football" au sens de l'abstraction multi-sport (voir lib/sports/registry.js)
// — INTENTIONNELLEMENT un simple descripteur, pas une réécriture de la logique
// football existante. Le football a déjà son provider (récupération des données
// réelles), son mapper (mise en forme) et son modèle de pronostics, répartis dans les
// fichiers ci-dessous depuis le début du projet — les déplacer ici casserait
// exactement ce que ce bloc doit préserver ("ne modifie AUCUN comportement football
// existant"). basketball/tennis (lib/sports/basketball, lib/sports/tennis), eux,
// n'avaient rien : ils reçoivent de vrais fichiers provider.js/mapper.js/pronostic.js
// avec la MÊME interface, prêts à être remplis dans les blocs dédiés.
const football = {
  id: "football",
  label: "Football",
  icon: "⚽",
  implemented: true,
  // Points d'entrée réels (routes API déjà en production, inchangées par ce bloc).
  routes: {
    live: "/api/live-matches",
    upcoming: "/api/matches",
    analyze: "/api/analyze",
  },
  // Provider (récupération des données réelles) : football-data.org appelé
  // directement depuis pages/api/*.js, complété par API-Football (lib/apiFootball.js)
  // pour les événements live/statistiques.
  // Mapper (mise en forme) : lib/apiFootball.js (mapFixtureToLiveState,
  // mapFixtureToUpcomingMatch...) et le mapping inline des réponses football-data.org
  // dans pages/api/*.js.
  // Modèle de pronostics : lib/pronostic.js (classement/forme récente) et
  // lib/pronosticFromProfiles.js (profils réels d'équipe, voir lib/teamStatProfiles.js
  // et lib/teamQualityRatings.js).
};

export default football;
