// Équivalent tennis de pages/api/matches.js (football) — matchs À VENIR (jamais
// commencés). Live Tennis API (plan gratuit, voir lib/sports/tennis/provider.js) ne
// propose AUCUN endpoint de calendrier/matchs programmés sur ce plan — seuls
// /matches?status=live, /matches/{id}/score et /players/{id} sont disponibles (voir
// PROMPT : "endpoints disponibles sur le plan gratuit UNIQUEMENT"). Plutôt que
// d'inventer un appel qui échouerait, cette route répond honnêtement `unsupported:
// true` (statut 200, ce n'est pas une panne) — pages/a-venir.js affiche un message
// clair à la place d'un écran vide ambigu.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
  return res.status(200).json({
    competitions: [],
    unsupported: true,
    message: "Les matchs à venir ne sont pas disponibles pour le tennis avec cette source (plan gratuit : seul le direct est proposé).",
  });
}
