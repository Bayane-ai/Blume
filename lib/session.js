import { serialize } from "cookie";
import crypto from "crypto";

// Session propre à l'application (voir PROMPT : "supprimer totalement les mots de
// passe, les codes à 6 chiffres, les magic links et Google OAuth") — plus aucun appel
// à supabase.auth.* nulle part dans ce projet. Un jeton signé HS256 (implémenté avec
// le module `crypto` intégré à Node, sans dépendance supplémentaire : un JWT HS256
// n'est jamais qu'un HMAC-SHA256 sur "header.payload" encodé en base64url — voir
// createSessionToken/verifySessionToken) porte { sub, email, iat, exp }, posé dans un
// cookie httpOnly (jamais lisible par le JavaScript du navigateur, seule protection
// réelle contre le vol de session par XSS).
const COOKIE_NAME = "blume_session";
const SESSION_DURATION_SECONDS = 30 * 24 * 3600; // 30 jours (voir PROMPT)

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const withPadding = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  return Buffer.from(withPadding, "base64");
}

function hmacSha256(data, secret) {
  return crypto.createHmac("sha256", secret).update(data).digest();
}

// Construit un jeton { sub: profile.id, email } (voir PROMPT, point 3) qui expire
// dans 30 jours — `iat`/`exp` sont nécessaires pour que cette expiration existe
// réellement (un jeton signé mais sans date d'expiration ne "durerait" pas 30 jours,
// il durerait pour toujours).
export function createSessionToken({ id, email }, secret) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({ sub: id, email, iat: now, exp: now + SESSION_DURATION_SECONDS }));
  const signature = base64url(hmacSha256(`${header}.${payload}`, secret));
  return `${header}.${payload}.${signature}`;
}

// Vérifie la signature (comparaison à temps constant : évite qu'un attaquant déduise
// progressivement la bonne signature en mesurant le temps de réponse — timing
// attack), l'expiration, puis la présence des champs attendus — renvoie null au
// moindre souci, jamais une exception que l'appelant devrait penser à attraper.
export function verifySessionToken(token, secret) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;

  let expectedSignature;
  try {
    expectedSignature = base64url(hmacSha256(`${header}.${payload}`, secret));
  } catch {
    return null;
  }
  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;

  let decoded;
  try {
    decoded = JSON.parse(base64urlDecode(payload).toString("utf8"));
  } catch {
    return null;
  }
  if (typeof decoded.exp !== "number" || decoded.exp < Math.floor(Date.now() / 1000)) return null;
  if (!decoded.sub || !decoded.email) return null;
  return { id: decoded.sub, email: decoded.email };
}

function appendSetCookie(res, cookieString) {
  const existing = res.getHeader("Set-Cookie");
  const existingCookies = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
  res.setHeader("Set-Cookie", [...existingCookies, cookieString]);
}

// httpOnly + secure (uniquement en production : un cookie "Secure" n'est de toute
// façon jamais envoyé sur http://, ce qui casserait le développement local en
// http://localhost) + sameSite=lax + path=/ (voir PROMPT, point 3, exactement).
function cookieOptions(maxAgeSeconds) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export function setSessionCookie(res, token) {
  appendSetCookie(res, serialize(COOKIE_NAME, token, cookieOptions(SESSION_DURATION_SECONDS)));
}

export function clearSessionCookie(res) {
  appendSetCookie(res, serialize(COOKIE_NAME, "", cookieOptions(0)));
}

// Lit et vérifie le cookie de la requête — renvoie { id, email } ou null (voir
// PROMPT, point 5). AUTH_SESSION_SECRET absente : refus par défaut (jamais une
// session considérée valide sans secret pour la vérifier), exactement le même
// principe de refus-par-défaut que lib/auth/admin.js.
export function getSession(req) {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret) return null;
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  return verifySessionToken(token, secret);
}

export { COOKIE_NAME };
