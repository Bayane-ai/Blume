/**
 * lib/security/sameOrigin.js — protection CSRF des mutations : n'accepte que les
 * requêtes dont l'en-tête Origin (ou Referer à défaut) correspond au VRAI site.
 */
import { isSameOriginRequest } from "../lib/security/sameOrigin";

function req({ origin, referer, host = "blume.example.com" } = {}) {
  return {
    headers: {
      ...(origin !== undefined ? { origin } : {}),
      ...(referer !== undefined ? { referer } : {}),
      host,
    },
  };
}

test("Origin identique au site : autorisé", () => {
  expect(isSameOriginRequest(req({ origin: "https://blume.example.com" }))).toBe(true);
});

test("Origin d'un autre domaine : refusé", () => {
  expect(isSameOriginRequest(req({ origin: "https://attaquant.example.net" }))).toBe(false);
});

test("Origin absente mais Referer same-origin : autorisé (repli)", () => {
  expect(isSameOriginRequest(req({ referer: "https://blume.example.com/combine-vision" }))).toBe(true);
});

test("Origin absente et Referer d'un autre domaine : refusé", () => {
  expect(isSameOriginRequest(req({ referer: "https://attaquant.example.net/page" }))).toBe(false);
});

test("ni Origin ni Referer : refusé par défaut (jamais une autorisation implicite)", () => {
  expect(isSameOriginRequest(req({}))).toBe(false);
});

test("Origin invalide (pas une URL) : refusé", () => {
  expect(isSameOriginRequest(req({ origin: "pas-une-url" }))).toBe(false);
});

test("NEXT_PUBLIC_SITE_URL défini : sert de référence plutôt que l'en-tête Host", () => {
  const original = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "https://blume-rho.vercel.app";
  try {
    expect(isSameOriginRequest(req({ origin: "https://blume-rho.vercel.app", host: "un-autre-host.internal" }))).toBe(true);
    expect(isSameOriginRequest(req({ origin: "https://blume.example.com", host: "un-autre-host.internal" }))).toBe(false);
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = original;
  }
});
