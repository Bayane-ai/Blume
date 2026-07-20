/**
 * pages/api/news.js — interroge les vrais flux RSS football (BBC Sport, Sky Sports,
 * ESPN), dédoublonne, trie par importance, met en cache (jamais une erreur 500 :
 * toujours { articles: [...] }, vide au pire des cas).
 */
function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function rssFor(items) {
  return `<?xml version="1.0"?><rss><channel>${items
    .map(
      (i) => `<item><title>${i.title}</title><link>${i.link}</link><pubDate>${i.pubDate || "Mon, 20 Jul 2026 10:00:00 GMT"}</pubDate></item>`
    )
    .join("")}</channel></rss>`;
}

beforeEach(() => {
  jest.resetModules();
});

test("interroge les trois flux configurés (BBC Sport, Sky Sports, ESPN)", async () => {
  const fetchMock = jest.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(rssFor([])) }));
  global.fetch = fetchMock;

  const handler = (await import("../pages/api/news.js")).default;
  const res = makeRes();
  await handler({}, res);

  const urls = fetchMock.mock.calls.map((c) => c[0]);
  expect(urls).toEqual(
    expect.arrayContaining([
      "http://feeds.bbci.co.uk/sport/football/rss.xml",
      "https://www.skysports.com/rss/12040",
      "https://www.espn.com/espn/rss/soccer/news",
    ])
  );
  expect(res.statusCode).toBe(200);
  expect(res.body.articles).toEqual([]);
});

test("fusionne les vrais articles des différents flux et les trie par importance", async () => {
  global.fetch = jest.fn((url) => {
    if (url.includes("bbci")) {
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(rssFor([{ title: "Match amical mineur", link: "https://example.com/minor" }])),
      });
    }
    if (url.includes("skysports")) {
      return Promise.resolve({
        ok: true,
        text: () =>
          Promise.resolve(rssFor([{ title: "Real Madrid officialise un transfert record", link: "https://example.com/major" }])),
      });
    }
    return Promise.resolve({ ok: true, text: () => Promise.resolve(rssFor([])) });
  });

  const handler = (await import("../pages/api/news.js")).default;
  const res = makeRes();
  await handler({}, res);

  expect(res.statusCode).toBe(200);
  expect(res.body.articles.map((a) => a.link)).toEqual(["https://example.com/major", "https://example.com/minor"]);
});

test("déduplique un même article (même lien) repris par plusieurs flux", async () => {
  const shared = rssFor([{ title: "Article partagé", link: "https://example.com/shared" }]);
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(shared) }));

  const handler = (await import("../pages/api/news.js")).default;
  const res = makeRes();
  await handler({}, res);

  expect(res.body.articles).toHaveLength(1);
});

test("un flux qui échoue ne casse pas les autres : les articles des flux valides restent affichés", async () => {
  global.fetch = jest.fn((url) => {
    if (url.includes("bbci")) return Promise.reject(new Error("Erreur réseau"));
    if (url.includes("skysports")) {
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(rssFor([{ title: "Article valide", link: "https://example.com/valid" }])),
      });
    }
    return Promise.resolve({ ok: false });
  });

  const handler = (await import("../pages/api/news.js")).default;
  const res = makeRes();
  await handler({}, res);

  expect(res.statusCode).toBe(200);
  expect(res.body.articles).toHaveLength(1);
  expect(res.body.articles[0].link).toBe("https://example.com/valid");
});

test("échec total des trois flux : renvoie 200 avec une liste vide, jamais une erreur 500", async () => {
  global.fetch = jest.fn(() => Promise.reject(new Error("Erreur réseau")));

  const handler = (await import("../pages/api/news.js")).default;
  const res = makeRes();
  await handler({}, res);

  expect(res.statusCode).toBe(200);
  expect(res.body.articles).toEqual([]);
});

test("une deuxième requête rapprochée réutilise le cache (pas de nouvel appel réseau)", async () => {
  const fetchMock = jest.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(rssFor([])) }));
  global.fetch = fetchMock;

  const handler = (await import("../pages/api/news.js")).default;
  await handler({}, makeRes());
  const callsAfterFirst = fetchMock.mock.calls.length;
  await handler({}, makeRes());
  expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
});

test("deux requêtes concurrentes ne déclenchent qu'un seul lot d'appels réseau (inFlight partagé)", async () => {
  const fetchMock = jest.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(rssFor([])) }));
  global.fetch = fetchMock;

  const handler = (await import("../pages/api/news.js")).default;
  await Promise.all([handler({}, makeRes()), handler({}, makeRes())]);
  expect(fetchMock.mock.calls.length).toBe(3); // un seul lot des 3 flux, pas deux
});
