import { parseRssFeed } from "../../lib/rssParser";
import { sortByImportance } from "../../lib/newsScoring";
import { translateToFrench } from "../../lib/translate";

// Flux RSS 2.0 publics, gratuits, sans clé API — uniquement du football. Ces sources
// publient en anglais : le texte de chaque article (titre + résumé) est traduit
// automatiquement en français avant d'être renvoyé (voir lib/translate.js), le site
// étant en français — la source (nom du média) reste, elle, inchangée.
const FEEDS = [
  { url: "http://feeds.bbci.co.uk/sport/football/rss.xml", source: "BBC Sport" },
  { url: "https://www.skysports.com/rss/12040", source: "Sky Sports" },
  { url: "https://www.espn.com/espn/rss/soccer/news", source: "ESPN" },
];

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes : "se rafraîchit automatiquement" sans marteler les flux.
const MAX_ARTICLES = 30; // borne le nombre de traductions par cycle de rafraîchissement.

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

async function translateArticle(article) {
  const [title, summary] = await Promise.all([
    translateToFrench(article.title),
    translateToFrench(article.summary),
  ]);
  return { ...article, title, summary };
}

async function fetchAllNews() {
  const perFeed = await Promise.all(FEEDS.map(fetchFeed));
  const merged = dedupeByLink(perFeed.flat());
  // Le tri par importance se base sur les mots-clés (noms de clubs/compétitions,
  // identiques en anglais et en français) : pas besoin d'attendre la traduction pour
  // trier correctement, et ça évite de traduire des articles qui seront de toute façon
  // coupés par la limite ci-dessous.
  const sorted = sortByImportance(merged).slice(0, MAX_ARTICLES);
  return Promise.all(sorted.map(translateArticle));
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
