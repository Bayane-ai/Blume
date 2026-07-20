// Analyseur RSS minimal (sans dépendance externe) pour le bloc "News" — les flux
// d'actualités football (BBC Sport, Sky Sports, ESPN...) sont de vrais flux RSS 2.0
// publics, pas besoin de clé API. On extrait uniquement les champs standard
// (title/link/description/pubDate/image), jamais un article inventé : un item RSS
// sans titre ni lien exploitable est simplement ignoré plutôt que d'apparaître à moitié vide.
function stripCdata(s) {
  const m = s.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return m ? m[1] : s;
}

function decodeXmlEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function stripHtml(s) {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// Résumé court (2-3 lignes maximum) : on tronque proprement sur un mot entier plutôt
// que de couper un mot en deux au milieu.
function truncateSummary(s, max = 220) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return `${cut.replace(/\s+\S*$/, "")}…`;
}

function extractTag(itemXml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = itemXml.match(re);
  if (!m) return null;
  return decodeXmlEntities(stripCdata(m[1].trim()));
}

function extractAttr(itemXml, tag, attr) {
  const re = new RegExp(`<${tag}[^>]*[\\s]${attr}=["']([^"']+)["'][^>]*/?>`, "i");
  const m = itemXml.match(re);
  return m ? m[1] : null;
}

function extractImage(itemXml) {
  return (
    extractAttr(itemXml, "media:thumbnail", "url") ||
    extractAttr(itemXml, "media:content", "url") ||
    extractAttr(itemXml, "enclosure", "url") ||
    null
  );
}

function parseDate(pubDate) {
  if (!pubDate) return null;
  const d = new Date(pubDate);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Analyse un flux RSS 2.0 brut (texte XML) en une liste d'articles exploitables.
// `sourceName` est le nom affiché de la source (ex : "BBC Sport") — jamais déduit du
// contenu du flux, toujours celui, connu, du flux interrogé.
export function parseRssFeed(xml, sourceName) {
  if (!xml) return [];
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) || [];

  return items
    .map((item) => {
      const title = extractTag(item, "title");
      const link = extractTag(item, "link");
      if (!title || !link) return null;

      const descriptionRaw = extractTag(item, "description");
      const summary = descriptionRaw ? truncateSummary(stripHtml(descriptionRaw)) : "";

      return {
        title,
        link,
        summary,
        source: sourceName,
        publishedAt: parseDate(extractTag(item, "pubDate")),
        image: extractImage(item),
      };
    })
    .filter(Boolean);
}
