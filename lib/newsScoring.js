// Les flux RSS ne fournissent aucun score de popularité — on applique donc, comme
// demandé, un classement basé sur l'importance réelle du sujet (mots-clés : grands
// clubs/équipes/joueurs, grandes compétitions) combinée à la fraîcheur de l'article.
// Ce n'est jamais un nombre de vues/partages inventé, juste un tri déterministe sur
// du texte réellement présent dans le titre/résumé de l'article.
//
// Bloc 9 (multi-sport) — un jeu de mots-clés PAR SPORT (voir pages/api/news.js, qui
// interroge des flux RSS différents selon le sport) : les mots-clés football
// (clubs/compétitions européens) n'ont aucun sens pour trier des actualités basket ou
// tennis, et réciproquement.
const IMPORTANCE_KEYWORDS_BY_SPORT = {
  football: [
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
  ],
  basketball: [
    // Ligue/compétitions
    "nba", "playoffs", "finals", "finale nba", "all-star", "draft", "euroleague",
    // Grandes équipes
    "lakers", "celtics", "warriors", "bucks", "nuggets", "knicks", "suns", "76ers",
    "mavericks", "clippers", "heat", "nets",
    // Joueurs/entraîneurs connus
    "lebron", "lebron james", "curry", "stephen curry", "durant", "kevin durant",
    "giannis", "antetokounmpo", "doncic", "luka doncic", "jokic", "embiid",
    "joel embiid", "wembanyama",
    // Sujets à forte importance
    "trade", "transfert", "record", "blessure", "injury", "mvp",
  ],
  tennis: [
    // Compétitions
    "wimbledon", "roland garros", "french open", "us open", "australian open",
    "grand slam", "grand chelem", "atp", "wta", "masters 1000", "atp finals",
    // Joueurs connus
    "djokovic", "novak djokovic", "alcaraz", "carlos alcaraz", "sinner",
    "jannik sinner", "nadal", "rafael nadal", "federer", "roger federer",
    "swiatek", "iga swiatek", "sabalenka", "aryna sabalenka", "gauff", "coco gauff",
    "medvedev", "zverev",
    // Sujets à forte importance
    "classement", "ranking", "record", "blessure", "injury", "finale", "final",
  ],
};

const RECENCY_HALF_LIFE_HOURS = 48;

function keywordScore(article, sport) {
  const keywords = IMPORTANCE_KEYWORDS_BY_SPORT[sport] || IMPORTANCE_KEYWORDS_BY_SPORT.football;
  const text = `${article.title || ""} ${article.summary || ""}`.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
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

export function computeImportance(article, sport = "football", now = Date.now()) {
  return keywordScore(article, sport) * 2 + recencyScore(article, now);
}

// Tri stable du plus important au moins important — à égalité de score, l'ordre
// d'arrivée (déjà globalement chronologique par flux) est conservé. `sport` choisit
// le jeu de mots-clés (football par défaut, comportement inchangé pour tout appelant
// existant qui ne le précise pas).
export function sortByImportance(articles, sport = "football", now = Date.now()) {
  return articles
    .map((article, index) => ({ article, index, score: computeImportance(article, sport, now) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ article }) => article);
}
