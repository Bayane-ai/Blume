// Traduction automatique anglais → français des textes d'actualités (titre + résumé),
// via l'API gratuite MyMemory (aucune clé requise, contrairement à API_FOOTBALL_KEY
// plus tôt dans le projet). Chaque texte est mis en cache indéfiniment par son
// contenu exact : un même article revu au rafraîchissement suivant n'est jamais
// retraduit, ce qui reste sous le quota gratuit même avec un flux actif.
const cache = new Map(); // texte original -> texte traduit
const TIMEOUT_MS = 4000;

export async function translateToFrench(text) {
  if (!text) return text;
  if (cache.has(text)) return cache.get(text);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|fr`;
    const r = await fetch(url, { signal: controller.signal });
    if (!r.ok) return text;
    const data = await r.json();
    const translated = data?.responseData?.translatedText;
    // Une réponse vide, ou un texte "d'erreur" renvoyé par l'API en cas de quota
    // dépassé, ne doit jamais remplacer un vrai texte par du contenu inventé/cassé :
    // on garde alors l'original (anglais) plutôt qu'un texte français incorrect.
    if (!translated) return text;
    cache.set(text, translated);
    return translated;
  } catch {
    return text;
  } finally {
    clearTimeout(timeout);
  }
}
