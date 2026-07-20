/**
 * lib/rssParser.js — analyseur RSS 2.0 minimal utilisé pour le bloc "News". Doit
 * extraire fidèlement les vrais champs du flux, sans jamais inventer un article
 * quand un champ essentiel (titre/lien) manque.
 */
import { parseRssFeed } from "../lib/rssParser";

function feed(items) {
  return `<?xml version="1.0"?><rss><channel><title>Flux</title>${items.join("")}</channel></rss>`;
}

test("extrait titre, lien, résumé (HTML retiré), date et image d'un item complet", () => {
  const item = `<item>
    <title><![CDATA[Mbappé signe un nouveau record]]></title>
    <link>https://example.com/article-1</link>
    <description><![CDATA[<p>Un très <b>grand</b> soir pour le Real Madrid.</p>]]></description>
    <pubDate>Mon, 20 Jul 2026 10:00:00 GMT</pubDate>
    <media:thumbnail url="https://example.com/image-1.jpg" />
  </item>`;

  const [article] = parseRssFeed(feed([item]), "BBC Sport");
  expect(article.title).toBe("Mbappé signe un nouveau record");
  expect(article.link).toBe("https://example.com/article-1");
  expect(article.summary).toBe("Un très grand soir pour le Real Madrid.");
  expect(article.source).toBe("BBC Sport");
  expect(article.publishedAt).toBe(new Date("Mon, 20 Jul 2026 10:00:00 GMT").toISOString());
  expect(article.image).toBe("https://example.com/image-1.jpg");
});

test("décode les entités XML dans le titre et le résumé", () => {
  const item = `<item>
    <title>Chelsea &amp; Arsenal : duel au sommet</title>
    <link>https://example.com/article-2</link>
    <description>Score final : 2 &gt; 1</description>
  </item>`;
  const [article] = parseRssFeed(feed([item]), "ESPN");
  expect(article.title).toBe("Chelsea & Arsenal : duel au sommet");
  expect(article.summary).toBe("Score final : 2 > 1");
});

test("tronque un résumé trop long sur un mot entier avec une ellipse", () => {
  const longText = "mot ".repeat(100).trim();
  const item = `<item>
    <title>Titre</title>
    <link>https://example.com/article-3</link>
    <description>${longText}</description>
  </item>`;
  const [article] = parseRssFeed(feed([item]), "Sky Sports");
  expect(article.summary.length).toBeLessThanOrEqual(221);
  expect(article.summary.endsWith("…")).toBe(true);
  // Coupe sur un mot entier : ce qui précède l'ellipse est un multiple de "mot ".
  expect(article.summary.slice(0, -1).trim()).toMatch(/^(mot ?)+$/);
});

test("récupère l'image depuis media:content ou enclosure si media:thumbnail est absent", () => {
  const itemMediaContent = `<item>
    <title>Titre A</title>
    <link>https://example.com/a</link>
    <media:content url="https://example.com/img-a.jpg" />
  </item>`;
  const itemEnclosure = `<item>
    <title>Titre B</title>
    <link>https://example.com/b</link>
    <enclosure url="https://example.com/img-b.jpg" type="image/jpeg" />
  </item>`;
  const [a, b] = parseRssFeed(feed([itemMediaContent, itemEnclosure]), "BBC Sport");
  expect(a.image).toBe("https://example.com/img-a.jpg");
  expect(b.image).toBe("https://example.com/img-b.jpg");
});

test("un item sans titre ou sans lien est ignoré — jamais un article à moitié inventé", () => {
  const noTitle = `<item><link>https://example.com/x</link></item>`;
  const noLink = `<item><title>Sans lien</title></item>`;
  const valid = `<item><title>Valide</title><link>https://example.com/y</link></item>`;
  const articles = parseRssFeed(feed([noTitle, noLink, valid]), "ESPN");
  expect(articles).toHaveLength(1);
  expect(articles[0].title).toBe("Valide");
});

test("un item sans image ni description renvoie des champs vides/null, pas d'erreur", () => {
  const item = `<item><title>Titre nu</title><link>https://example.com/z</link></item>`;
  const [article] = parseRssFeed(feed([item]), "BBC Sport");
  expect(article.summary).toBe("");
  expect(article.image).toBeNull();
  expect(article.publishedAt).toBeNull();
});

test("un flux vide ou invalide renvoie une liste vide, jamais une erreur", () => {
  expect(parseRssFeed("", "BBC Sport")).toEqual([]);
  expect(parseRssFeed(null, "BBC Sport")).toEqual([]);
  expect(parseRssFeed("<rss><channel></channel></rss>", "BBC Sport")).toEqual([]);
});

test("une date de publication invalide est ignorée (null) plutôt que de planter", () => {
  const item = `<item><title>T</title><link>https://example.com/w</link><pubDate>pas une date</pubDate></item>`;
  const [article] = parseRssFeed(feed([item]), "BBC Sport");
  expect(article.publishedAt).toBeNull();
});
