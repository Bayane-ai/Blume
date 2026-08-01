import { parseRssFeed } from "../../lib/rssParser";
import { sortByImportance } from "../../lib/newsScoring";
import { translateToFrench } from "../../lib/translate";

// Flux RSS 2.0 publics, gratuits, sans clé API. Ces sources publient en anglais : le
// texte de chaque article (titre + résumé) est traduit automatiquement en français
// avant d'être renvoyé (voir lib/translate.js), le site étant en français — la source
// (nom du média) reste, elle, inchangée.
//
// Bloc 9 (multi-sport) — un jeu de flux PAR SPORT : les flux basket/tennis suivent la
// même convention d'URL déjà VÉRIFIÉE et fonctionnelle pour le football (BBC Sport
// publie une section par sport : feeds.bbci.co.uk/sport/<sport>/rss.xml ; ESPN publie
// de même : espn.com/espn/rss/<sport>/news) — leur JOIGNABILITÉ précise n'a pas pu
// être re-testée en direct depuis cet environnement (réseau bloqué, même limitation
// que documentée pour l'API tennis, voir lib/sports/tennis/provider.js). `fetchFeed`
// ci-dessous avale déjà toute erreur réseau/flux individuelle (retourne `[]`) : une
// URL incorrecte pour un sport dégrade simplement ce flux à "aucun article", jamais un
// plantage de la page — vérifie les logs Vercel après déploiement.
const FEEDS_BY_SPORT = {
  football: [
    { url: "http://feeds.bbci.co.uk/sport/football/rss.xml", source: "BBC Sport" },
    { url: "https://www.skysports.com/rss/12040", source: "Sky Sports" },
    { url: "https://www.espn.com/espn/rss/soccer/news", source: "ESPN" },
  ],
  basketball: [
    { url: "http://feeds.bbci.co.uk/sport/basketball/rss.xml", source: "BBC Sport" },
    { url: "https://www.espn.com/espn/rss/nba/news", source: "ESPN" },
    { url: "https://www.cbssports.com/rss/headlines/nba/", source: "CBS Sports" },
  ],
  tennis: [
    { url: "http://feeds.bbci.co.uk/sport/tennis/rss.xml", source: "BBC Sport" },
    { url: "https://www.espn.com/espn/rss/tennis/news", source: "ESPN" },
  ],
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes : "se rafraîchit automatiquement" sans marteler les flux.
const MAX_ARTICLES = 30; // borne le nombre de traductions par cycle de rafraîchissement.

// Un cache/verrou de requête en cours PAR SPORT (jamais un seul cache partagé qui
// mélangerait les actualités de deux sports différents).
const cacheBySport = new Map(); // sport -> { articles, fetchedAt }
const inFlightBySport = new Map(); // sport -> Promise

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

async function fetchAllNews(sport) {
  const feeds = FEEDS_BY_SPORT[sport] || FEEDS_BY_SPORT.football;
  const perFeed = await Promise.all(feeds.map(fetchFeed));
  const merged = dedupeByLink(perFeed.flat());
  // Le tri par importance se base sur les mots-clés (noms de clubs/équipes/joueurs,
  // identiques en anglais et en français) : pas besoin d'attendre la traduction pour
  // trier correctement, et ça évite de traduire des articles qui seront de toute façon
  // coupés par la limite ci-dessous.
  const sorted = sortByImportance(merged, sport).slice(0, MAX_ARTICLES);
  return Promise.all(sorted.map(translateArticle));
}

export default async function handler(req, res) {
  const sport = ["basketball", "tennis"].includes(req.query?.sport) ? req.query.sport : "football";

  const cache = cacheBySport.get(sport);
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return res.status(200).json({ articles: cache.articles });
  }

  let inFlight = inFlightBySport.get(sport);
  if (!inFlight) {
    inFlight = fetchAllNews(sport)
      .then((articles) => {
        cacheBySport.set(sport, { articles, fetchedAt: Date.now() });
        return articles;
      })
      .finally(() => {
        inFlightBySport.delete(sport);
      });
    inFlightBySport.set(sport, inFlight);
  }

  // fetchFeed avale déjà toute erreur réseau/flux individuelle (jamais de plantage
  // global) : dans le pire des cas, `articles` est simplement vide, et la page
  // affiche alors un message clair plutôt qu'une erreur 500.
  const articles = await inFlight;
  return res.status(200).json({ articles });
}
