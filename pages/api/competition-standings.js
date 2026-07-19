import { COMPETITIONS } from "../../lib/competitions";
import { getStandingsTable } from "../../lib/standingsCache";

// Classement réel d'une compétition (déjà mis en cache côté serveur pour les
// pronostics — lib/standingsCache.js) : on l'expose ici tel quel pour l'onglet
// "Classement" de la page d'une compétition. Certaines compétitions (phase à
// élimination directe, coupe sans tableau) n'ont pas de classement : table vide,
// affiché proprement côté client plutôt que masqué.
export default async function handler(req, res) {
  const token = process.env.FOOTBALL_DATA_TOKEN;
  if (!token) return res.status(500).json({ error: "Clé API manquante" });

  const { code } = req.query;
  const comp = COMPETITIONS.find((c) => c.code === code);
  if (!comp) return res.status(400).json({ error: "Compétition inconnue" });

  try {
    const table = await getStandingsTable(code, token);
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900");
    return res.status(200).json({ ...comp, table: table || [] });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
