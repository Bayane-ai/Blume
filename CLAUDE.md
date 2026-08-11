# Blume — instructions pour Claude

Site Next.js (**Pages Router**) de matchs **football / basket / tennis** en direct et à venir,
avec pronostics automatiques. Déployé sur Vercel (`blume-rho.vercel.app`), branché sur la
branche `main` du repo GitHub `Bayane-ai/Blume`.

---

## 1. À LIRE EN PREMIER — la contrainte qui fait perdre le plus de temps

**L'environnement de développement bloque TOUS les hôtes tiers, production comprise.**

```
https://blume-rho.vercel.app/…            CONNECT tunnel failed, response 403
https://sportscore.com/…                  CONNECT tunnel failed, response 403
https://v1.basketball.api-sports.io/…     CONNECT tunnel failed, response 403
https://api.livetennisapi.com/…           CONNECT tunnel failed, response 403
```

La doc du proxy (`/root/.ccr/README.md`) est explicite : un 403 sur le CONNECT est une
**décision de politique réseau**, et il est interdit de la contourner. Conséquences :

- Tu **ne peux pas** appeler les fournisseurs de données, ni voir le site déployé.
- Tu **ne peux donc pas** confirmer « l'onglet affiche de vrais matchs ». **Ne le prétends
  jamais.** L'utilisateur a déjà été induit en erreur par ce genre d'affirmation ; il tient
  beaucoup à l'exactitude (« mets-moi des trucs uniquement vrai et fiable »).
- Ce que tu **peux** faire, et qui marche très bien : lancer `next dev` avec un **faux
  serveur local** qui sert le contrat documenté d'une API, et prouver la chaîne de bout en
  bout. Exemples déjà utilisés dans l'historique (faux Live Tennis API, faux balldontlie).

**Hôtes ACCESSIBLES et très utiles** : `registry.npmjs.org` et `raw.githubusercontent.com`.
C'est ainsi que les contrats d'API ci-dessous ont été vérifiés — en lisant les **clients
officiels publiés par les fournisseurs**, jamais en devinant.

---

## 2. Workflow de mise à jour (demandé le 18/07/2026)

Après chaque modification demandée, **ne pas attendre de confirmation** pour déployer :

1. Faire la modification.
2. `CI=true npx jest` (suite complète) — doit être 100 % vert.
3. `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=x npm run build`
4. Si l'UI est touchée : `npx playwright test` (mêmes variables d'env).
5. Commit, puis **push direct sur `main`** :
   `git push origin claude/matches-homepage-live-99o5ke:main`

Ne jamais demander « veux-tu que je pousse ? ». Le faire, sauf si le changement est
destructif (suppression de données, migration DB).

⚠️ `npm run build` et un `next dev` en cours **partagent `.next`** et se corrompent
mutuellement (`Cannot find module './xxxx.js'`). Ne pas les lancer en même temps.

---

## 3. Architecture des données

Une **route serveur par sport**. Le navigateur n'appelle **jamais** un domaine externe
(c'était la cause de « Failed to fetch » / CORS, et ça exposait les clés).

```
Navigateur ──► /api/football/matches    (alias de /api/matches)
           ──► /api/basketball/matches
           ──► /api/tennis/matches
                        │
                        └── cascade de sources CÔTÉ SERVEUR (lib/sourceCascade.js)
```

| Sport | Source A | Source B | Source C |
|---|---|---|---|
| Football | football-data.org | API-Football (API-SPORTS) | — |
| Basket | API-Basketball (API-SPORTS) | SportScore | balldontlie (NBA seul) |
| Tennis | SportScore | Live Tennis API `/fixtures` | Live Tennis API `/matches?status=upcoming` |

**Règle de cascade** : on passe à la source suivante si la précédente échoue **OU renvoie 0
match**. On s'arrête à la première source qui **ramène** quelque chose (préserve les quotas).

### Fichiers clés

| Fichier | Rôle |
|---|---|
| `lib/sourceCascade.js` | moteur de cascade ; produit `{nom, statut, httpCode, recus, erreur}` |
| `lib/normalizedMatch.js` | format commun `{id, sport, tournoi, pays, categorie, joueur1, joueur2, debutUtc, statut, source}` + déduplication + tri + fenêtre UTC |
| `lib/routeCache.js` | cache serveur 60 s par sport (jamais de réponse dégradée mise en cache) |
| `lib/upcomingMatches.js` | couche client : une seule route same-origin par sport |
| `components/UpcomingMatchesSection.js` | affichage jour → compétition → matchs |
| `lib/healthMatches.mjs` | contrôle de santé partagé par le cron et `npm run test:matches` |
| `lib/sports/<sport>/` | providers, mappers, moteurs de pronostic |
| `DIAGNOSTIC.md` | **historique des pannes réelles et de leurs causes — à lire avant de re-diagnostiquer** |

---

## 4. Contrats d'API VÉRIFIÉS — ne jamais les redeviner

### SportScore (public, sans clé)
Vérifié dans le wrapper officiel `Backspace-me/sportscore-mcp` :
- `GET https://sportscore.com/api/widget/matches/` — **seuls paramètres : `sport` (enum
  `football|basketball|cricket|tennis`) et `limit` (1–50)**.
- **AUCUN paramètre de date. AUCUNE pagination.** Description officielle : « List live and
  **recent** matches ».
- ⇒ Cette API **ne peut pas** servir une fenêtre J→J+7. Son « HTTP 200 avec 0 match » est
  une réponse correcte, pas un bug. Elle n'est jamais source principale.
- Si on te redemande « corrige l'endpoint par date de SportScore » : **il n'existe pas**,
  dis-le avec cette preuve.

### Live Tennis API
Vérifié dans le client **officiel** `npm livetennisapi@1.4.1` :
- base `https://api.livetennisapi.com/api/public/v1`, en-tête `Authorization: Bearer <clé>`
- `GET /fixtures` — « Upcoming scheduled fixtures, earliest first » — **tier FREE**
- `GET /matches?status=upcoming|live|completed` — **tier FREE**
- réponse `{ data: [...], meta: { limit, offset, count, total, has_more } }`
- pagination : **lire `meta.has_more`**, jamais comparer `count` à `limit`
- ⚠️ Le code affirmait autrefois « le plan gratuit n'expose pas de calendrier ». **C'était
  faux** et c'est ce qui a tenu l'onglet tennis vide pendant des semaines.

### balldontlie
Vérifié dans le SDK **officiel** `npm @balldontlie/sdk` :
- base `https://api.balldontlie.io`, chemin `/nba/v1/games`
- en-tête `Authorization: <clé>` — **clé brute, SANS « Bearer »**
- paramètres `start_date`, `end_date`, `per_page`, `cursor` ; pagination `meta.next_cursor`
- ⚠️ **NBA uniquement** : pas de WNBA, pas de ligues d'été, rien entre juillet et septembre.

### API-SPORTS (football + basket)
- en-tête `x-apisports-key`, pagination `paging: {current, total}`
- **quota gratuit : 100 requêtes/JOUR** — voir le piège n°1 ci-dessous.

---

## 5. Pièges déjà rencontrés — ne pas les refaire

1. **Le quota API-SPORTS est minuscule.** La route basket appelle 1 fois par jour de la
   fenêtre = 8 appels. Avec un TTL de 5 min, cela faisait **2 304 appels/jour contre 100
   autorisés (×24)** : quota mort en 7 minutes, puis bandeau rouge toute la journée.
   Corrigé par un TTL adaptatif (aujourd'hui 30 min, J+1→J+7 12 h ⇒ 62 appels/jour).
   **Fais toujours le calcul `appels × (24h / TTL)` avant de toucher un TTL.**
   Un test (`__tests__/matches-resilience.test.jsx`) recalcule ce budget et échoue s'il
   repasse au-dessus de 100.

2. **N'énumère jamais les ligues pour ensuite les interroger une par une.** Les trois sports
   interrogent leur source **par DATE**, ce qui rapporte toutes les compétitions d'un coup.
   Énumérer les ligues multiplierait les appels par cent — c'est exactement le mécanisme
   qui a fait exploser le quota basket.

3. **Un match sans identifiant de compétition était jeté en silence.** `if (!code) continue`
   supprimait des matchs pourtant reçus (fréquent sur les tournois d'été). À défaut d'id, le
   **nom** sert de code.

4. **Ne mets jamais une réponse dégradée en cache.** Une panne de 2 s figerait le sport sur
   « aucun match » pendant toute la durée du TTL.

5. **`.next` partagé** entre `next dev` et `npm run build` (voir §2).

---

## 6. Règles absolues du projet

- **Jamais d'écran vide décidé par le code.** Un vide doit être un fait constaté : toutes
  les sources ont répondu correctement avec 0. Sinon c'est un problème de connexion, et le
  message doit être différent. Ces deux cas ne doivent jamais être confondus.
- **Jamais de données inventées.** Pas de faux match, pas de faux score, pas de valeur
  bouchée pour combler un champ manquant. Un champ absent s'affiche honnêtement comme
  indisponible. Les squelettes de chargement sont des formes vides, jamais des matchs.
- **Aucune restriction de compétition**, nulle part : pas de liste blanche, pas de filtre par
  pays / fédération / niveau / popularité / genre / catégorie d'âge, pas de plafond sur le
  nombre de matchs. Le tri par importance est autorisé ; masquer ne l'est pas.
  Basket et tennis n'ont **aucune** compétition privilégiée (`TENNIS_MAJORS` et
  `BASKETBALL_MAJORS` sont volontairement des tableaux vides).
- **Toujours HTTP 200 sur les routes « matchs »**, avec un diagnostic exploitable. Jamais de
  502 muet.
- **Ligne de diagnostic technique réservée à `?debug=1`.**
- **Ne jamais affirmer avoir vérifié en production.** (Voir §1.)

Ces règles sont verrouillées par des tests : `__tests__/no-hardcoded-empty.test.js`,
`upcoming-sources-lockdown.test.jsx`, `couverture-competitions.test.js`,
`matches-resilience.test.jsx`, `bloc2-sources-tennis.test.js`.

---

## 7. Variables d'environnement (Vercel → Settings → Environment Variables)

| Variable | Usage | Sans elle |
|---|---|---|
| `FOOTBALL_DATA_TOKEN` | football-data.org | football vide (200 + diagnostic) |
| `API_FOOTBALL_KEY` | API-Football, et repli pour le basket | couverture football réduite |
| `API_BASKETBALL_KEY` | API-Basketball (sinon retombe sur `API_FOOTBALL_KEY`) | **basket vide — c'est la seule source qui porte la WNBA** |
| `LIVE_TENNIS_API_KEY` | Live Tennis API (`LIVETENNISAPI_KEY` et `TENNIS_API_KEY` acceptées aussi) | tennis limité à SportScore |
| `BALLDONTLIE_API_KEY` | 3ᵉ source basket, NBA seule | source déclarée « non configurée », pas une panne |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | cache persistant, historique | cache partagé inopérant |
| `CRON_SECRET` | optionnelle, sécurise `/api/health/matches` | le cron passe par l'en-tête `x-vercel-cron` |

Variables de **test** (jamais en production) : `FORCE_SPORTSCORE_FAIL=1` (simule une panne
de la source A), `LIVETENNISAPI_BASE_URL`, `BALLDONTLIE_BASE_URL` (pointer un faux serveur).

---

## 8. Commandes

```bash
CI=true npx jest                      # suite unitaire (~1526 tests, 168 suites)
npx playwright test                   # 41 tests navigateur réel
npm run build                         # build Next
npm run test:matches                  # contrôle des 3 sports, sort en code 1 si un échoue
BLUME_BASE_URL=https://blume-rho.vercel.app npm run test:matches   # contre la prod
```

Playwright et build exigent `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY`
(valeurs factices acceptées).

**Surveillance quotidienne** : cron Vercel à 06:00 UTC sur `/api/health/matches`
(`vercel.json`). Il journalise, par sport, le nombre de matchs, le nombre de **compétitions
distinctes**, le statut de chaque source et un verdict `OK` / `ÉCHEC` / `COUVERTURE FAIBLE`
(< 15 compétitions ⇒ chercher un filtre résiduel). Cherche le tag `blume.health.matches`
dans les logs Vercel. Plan Hobby : 2 crons max, une exécution/jour — la limite est atteinte.

---

## 9. État actuel et points ouverts

**Ça marche** : football. Tests, build et e2e tous verts.

**À surveiller / non résolu :**

1. **Basket vide en production.** Toutes les causes trouvables par le code ont été corrigées
   (quota ×24, timeout, reprises, cache resservi, cascade à 3 sources). S'il reste vide, la
   piste n°1 est une **clé `API_BASKETBALL_KEY` absente ou révoquée** — aucun correctif de
   code n'y suppléera. Le diagnostic exact est sur `/a-venir?debug=1` ou dans la réponse
   `/api/basketball/matches`, champ `sources`.
2. **Tennis** : `/fixtures` est branché et couvre ATP/WTA/ITF/Challenger/UTR/juniors/double.
   Vérifié sur flux local : 20 matchs, 19 compétitions distinctes, pagination sur 4 pages.
   Non vérifié contre l'API réelle (§1).
3. **balldontlie ne couvre pas la WNBA** — ne pas compter dessus pour l'été.
4. **Comptage de couverture en production jamais relevé** pour football et basket : seul le
   cron quotidien peut le produire.

**Historique complet des pannes et de leurs causes : `DIAGNOSTIC.md`.** Le lire avant de
rediagnostiquer quoi que ce soit — il évite de refaire une enquête déjà faite.
