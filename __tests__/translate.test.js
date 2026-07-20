/**
 * lib/translate.js — traduction anglais → français via l'API gratuite MyMemory
 * (aucune clé requise), avec repli sur le texte original en cas d'échec, jamais un
 * texte inventé ni un plantage.
 */
beforeEach(() => {
  jest.resetModules();
});

test("traduit un texte anglais en français via l'API MyMemory (en|fr)", async () => {
  const fetchMock = jest.fn((url) => {
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://api.mymemory.translated.net/get");
    expect(parsed.searchParams.get("langpair")).toBe("en|fr");
    expect(parsed.searchParams.get("q")).toBe("Hello world");
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ responseData: { translatedText: "Bonjour le monde" } }) });
  });
  global.fetch = fetchMock;

  const { translateToFrench } = await import("../lib/translate.js");
  const result = await translateToFrench("Hello world");
  expect(result).toBe("Bonjour le monde");
});

test("un texte vide n'appelle pas l'API et renvoie tel quel", async () => {
  const fetchMock = jest.fn();
  global.fetch = fetchMock;

  const { translateToFrench } = await import("../lib/translate.js");
  expect(await translateToFrench("")).toBe("");
  expect(await translateToFrench(null)).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("en cas d'échec réseau, renvoie le texte original plutôt que de planter", async () => {
  global.fetch = jest.fn(() => Promise.reject(new Error("Erreur réseau")));

  const { translateToFrench } = await import("../lib/translate.js");
  const result = await translateToFrench("Some headline");
  expect(result).toBe("Some headline");
});

test("une réponse HTTP non ok renvoie le texte original", async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: false }));

  const { translateToFrench } = await import("../lib/translate.js");
  expect(await translateToFrench("Some headline")).toBe("Some headline");
});

test("une réponse sans traduction exploitable renvoie le texte original", async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ responseData: {} }) }));

  const { translateToFrench } = await import("../lib/translate.js");
  expect(await translateToFrench("Some headline")).toBe("Some headline");
});

test("un même texte traduit une première fois est mis en cache — un seul appel réseau pour deux appels identiques", async () => {
  const fetchMock = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ responseData: { translatedText: "Texte traduit" } }) })
  );
  global.fetch = fetchMock;

  const { translateToFrench } = await import("../lib/translate.js");
  await translateToFrench("Répéter ce texte");
  await translateToFrench("Répéter ce texte");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
