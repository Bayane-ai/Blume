// Formatage du "chrono" affiché en direct sur une carte/l'en-tête d'un match — partagé
// par components/MatchInfoBlock.js et components/MatchHeaderHero.js, pour que football
// et basket affichent chacun le format adapté à leur sport à partir de la MÊME forme de
// match (voir lib/sports/basketball/mapper.js). Football n'a pas de champ `period` (ce
// concept n'existe pas pour lui) : le comportement existant ("34’") reste donc
// strictement inchangé. Basket ajoute `period` (Q1/Q2/Q3/Q4/OT) : affiché avec le
// chrono ("Q3 · 5:23"), voir PROMPT bloc 2 — "quart-temps en cours et le chrono".
const PERIOD_LABELS = { Q1: "Q1", Q2: "Q2", Q3: "Q3", Q4: "Q4", OT: "Prolongation" };

export function formatLiveClock(m) {
  if (m?.period) {
    const label = PERIOD_LABELS[m.period] || m.period;
    return m.minute ? `${label} · ${m.minute}` : label;
  }
  return m?.minute != null ? `${m.minute}’` : "";
}
