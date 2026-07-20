// Les flux RSS ne fournissent aucun score de popularité — on applique donc, comme
// demandé, un classement basé sur l'importance réelle du sujet (mots-clés : grands
// clubs, grandes compétitions, joueurs connus) combinée à la fraîcheur de l'article.
// Ce n'est jamais un nombre de vues/partages inventé, juste un tri déterministe sur
// du texte réellement présent dans le titre/résumé de l'article.
const IMPORTANCE_KEYWORDS = [
  // Grandes compétitions
  "champions league", "ligue des champions", "premier league", "liga", "laliga",
  "serie a", "bundesliga", "ligue 1", "coupe du monde", "world cup", "euro 2024",
  "euro 2028", "europa league", "ballon d'or",
  // Grands clubs
  "real madrid", "barcelona", "barcelone", "manchester united", "manchester city",
  "liverpool", "chelsea", "arsenal", "psg", "paris saint-germain", "bayern munich",
  "bayern", "juventus", "inter milan", "ac milan", "atletico madrid", "tottenham",
  // Joueurs/entraîneurs connus (transferts et actualités majeures)
  "mbappe", "mbappé", "haaland", "messi", "ronaldo", "neymar", "vinicius",
  "bellingham", "guardiola", "mourinho", "ancelotti", "salah", "kane",
  // Sujets à forte importance
  "transfert", "transfer", "signe", "signs", "record", "blessure", "injury",
];

const RECENCY_HALF_LIFE_HOURS = 48;

function keywordScore(article) {
  const text = `${article.title || ""} ${article.summary || ""}`.toLowerCase();
  let score = 0;
  for (const kw of IMPORTANCE_KEYWORDS) {
    if (text.includes(kw)) score += 1;
  }
  return score;
}

// 1 = vient de publier, 0 = a 48h ou plus. Une actualité sans date connue n'est ni
// avantagée ni pénalisée à l'excès : on la traite comme "moyennement fraîche".
function recencyScore(article, now) {
  if (!article.publishedAt) return 0.5;
  const ageHours = (now - new Date(article.publishedAt).getTime()) / 3600000;
  if (!Number.isFinite(ageHours) || ageHours < 0) return 0.5;
  return Math.max(0, 1 - ageHours / RECENCY_HALF_LIFE_HOURS);
}

export function computeImportance(article, now = Date.now()) {
  return keywordScore(article) * 2 + recencyScore(article, now);
}

// Tri stable du plus important au moins important — à égalité de score, l'ordre
// d'arrivée (déjà globalement chronologique par flux) est conservé.
export function sortByImportance(articles, now = Date.now()) {
  return articles
    .map((article, index) => ({ article, index, score: computeImportance(article, now) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ article }) => article);
}
