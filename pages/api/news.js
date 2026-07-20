import { parseRssFeed } from "../../lib/rssParser";
import { sortByImportance } from "../../lib/newsScoring";

// Flux RSS 2.0 publics, gratuits, sans clé API — uniquement du football. On évite
// volontairement une API d'actualités payante/à clé (voir API_FOOTBALL_KEY plus tôt
// dans le projet, jamais activée sur Vercel) pour ne pas bloquer sur une étape manuelle
// supplémentaire côté utilisateur.
const FEEDS = [
  { url: "http://feeds.bbci.co.uk/sport/football/rss.xml", source: "BBC Sport" },
  { url: "https://www.skysports.com/rss/12040", source: "Sky Sports" },
  { url: "https://www.espn.com/espn/rss/soccer/news", source: "ESPN" },
];

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes : "se rafraîchit automatiquement" sans marteler les flux.

let cache = null; // { articles, fetchedAt }
let inFlight = null;

async function fetchFeed(feed) {
  try {
    const r = await fetch(feed.url);
    if (!r.ok) return [];
    const xml = await r.text();
    return parseRssFeed(xml, feed.source);
  } catch {
    return [];
  }
}

// Un même article est parfois repris par plusieurs flux : on déduplique par lien
// (URL de l'article réel), pas par titre (deux titres différents peuvent pointer vers
// le même article après réécriture par le flux).
function dedupeByLink(articles) {
  const seen = new Set();
  const result = [];
  for (const article of articles) {
    if (seen.has(article.link)) continue;
    seen.add(article.link);
    result.push(article);
  }
  return result;
}

async function fetchAllNews() {
  const perFeed = await Promise.all(FEEDS.map(fetchFeed));
  const merged = dedupeByLink(perFeed.flat());
  return sortByImportance(merged);
}

export default async function handler(req, res) {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return res.status(200).json({ articles: cache.articles });
  }

  if (!inFlight) {
    inFlight = fetchAllNews()
      .then((articles) => {
        cache = { articles, fetchedAt: Date.now() };
        return articles;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  // fetchFeed avale déjà toute erreur réseau/flux individuelle (jamais de plantage
  // global) : dans le pire des cas, `articles` est simplement vide, et la page
  // affiche alors un message clair plutôt qu'une erreur 500.
  const articles = await inFlight;
  return res.status(200).json({ articles });
}
