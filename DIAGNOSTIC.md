# Diagnostic — basket et tennis vides sur « Matchs à venir » (10/08/2026)

Symptômes constatés en production (blume-rho.vercel.app) :

| Sport | Ce que voit le visiteur |
|---|---|
| Football | fonctionne |
| Basket | bandeau rouge « Problème de connexion à la source. Réessaie dans quelques minutes. » |
| Tennis | « Aucun match à venir pour ce sport dans les 7 prochains jours. » |

## Portée de ce diagnostic — à lire avant le reste

L'environnement de développement de ce projet **bloque tout hôte tiers**, production
comprise. Vérifié à l'instant :

```
https://blume-rho.vercel.app/api/basketball/matches   CONNECT tunnel failed, response 403
https://sportscore.com/api/widget/matches/            CONNECT tunnel failed, response 403
https://v1.basketball.api-sports.io/games             CONNECT tunnel failed, response 403
```

La documentation du proxy est explicite : `403 / 407 from the proxy — The destination
host is not allowed by your organization's egress policy. Do not retry or route around
it — report the blocked host.`

Les causes ci-dessous ne sont donc **pas** issues d'un appel réel aux fournisseurs.
Elles sont établies à partir du code, de l'arithmétique des quotas, et de la
correspondance exacte entre chaque symptôme et la seule branche de code qui peut le
produire. Chaque cause indique son niveau de preuve.

---

## Sport 1 — BASKET : bandeau rouge

### Quelle branche de code produit CE message, et elle seule

`components/UpcomingMatchesSection.js` n'affiche « Problème de connexion à la source »
que dans la phase `error`, atteinte uniquement quand `anySourceFailed` est vrai **et**
que les 3 tentatives de relance ont toutes échoué. Un vide, lui, produit un autre
message. Donc : **au moins une source basket échoue, de façon persistante** — ce n'est
pas un problème d'affichage ni de calendrier.

### Cause : le quota gratuit est dépassé d'un facteur 24 — PROUVÉ par arithmétique

`pages/api/basketball/matches.js` interroge API-Basketball **une fois par jour de la
fenêtre**, soit 8 appels. `lib/sports/basketball/provider.js` mettait ces réponses en
cache 5 minutes (`GAMES_BY_DATE_TTL_MS`).

```
route « à venir » : 8 appels par expiration, TTL 5 min
                    -> 96 appels/heure = 2 304 appels/jour
route « live »    : TTL 10 min          =   144 appels/jour
                                        ─────────────────────
TOTAL                                     2 448 appels/jour
quota gratuit API-SPORTS                       100 appels/jour
dépassement                                          x24
```

Le commentaire du fichier affirmait « TTLs calibrés pour un quota de ~100 requêtes/jour ».
L'arithmétique le contredit : le quota réel est consommé en **moins de 7 minutes de
trafic**. Ensuite, chaque appel reçoit 429/403 ; les 8 journées échouent toutes ;
`allSourcesFailed` devient vrai ; le bandeau rouge s'affiche — et reste affiché toute la
journée, jusqu'à la remise à zéro du quota.

Cela explique aussi pourquoi le symptôme est **permanent** et non intermittent, et
pourquoi il touche le basket et pas le football (football-data.org a un quota par minute,
pas par jour, et se rétablit donc tout seul).

### Cause aggravante : une panne effaçait les données déjà connues

La route ne servait pas le cache persistant quand toutes les sources échouaient. Un
quota épuisé faisait donc disparaître des matchs déjà récupérés une heure plus tôt.

### Cause aggravante : aucun timeout ni aucune reprise

`basketballFetch` appelait `fetch` sans `signal`. Une requête lente pouvait pendre
jusqu'au timeout de la fonction Vercel, et une coupure réseau d'une seconde comptait
comme une panne franche, sans seconde tentative.

---

## Sport 2 — TENNIS : « Aucun match »

### Quelle branche de code produit CE message

La phase `empty` exige `anySourceFailed === false` : **toutes** les sources ont répondu
correctement, avec 0 match. Ce n'est donc pas une panne — les sources interrogées
n'avaient réellement rien à donner sur la fenêtre.

### Cause : la source interrogée ne contient pas de calendrier

Jusqu'au correctif précédent, la chaîne tennis était :

1. **SportScore** — son endpoint public `/api/widget/matches/` n'accepte que `sport` et
   `limit` (vérifié sur le wrapper officiel), sans paramètre de date, et se décrit
   lui-même comme « live and recent matches ». Il ne peut structurellement pas remplir
   une fenêtre J → J+7 : il répond 200 avec 0 match dans la fenêtre. Réponse correcte à
   une mauvaise question.
2. **Live Tennis API `/matches?status=live`** — uniquement le direct. Hors direct : 0.

Deux sources répondant correctement 0 → « Aucun match ». Le message était exact ; c'est
la question posée aux sources qui était fausse.

### Cause racine : une affirmation fausse écrite dans le code

Le code portait ce commentaire : *« le plan gratuit de Live Tennis API n'expose pas de
calendrier »*. **C'est faux.** Vérifié dans le client **officiel** du fournisseur
(`npm livetennisapi@1.4.1`, `github.com/livetennisapi/livetennisapi-js`) :

| Endpoint | Description officielle | Tier |
|---|---|---|
| `GET /fixtures` | « Upcoming scheduled fixtures, earliest first » | **FREE** |
| `GET /matches?status=upcoming` | matchs à venir du flux principal | **FREE** |
| `GET /tournaments` | catalogue des tournois | **FREE** |

Le calendrier existait depuis le début, au tier gratuit, avec la clé déjà en place. Une
croyance erronée inscrite en commentaire a tenu l'onglet tennis vide.

Contrat retenu, repris tel quel du client officiel :
`https://api.livetennisapi.com/api/public/v1`, en-tête `Authorization: Bearer`,
réponse `{ data: [...], meta: { limit, offset, count, total, has_more } }`, pagination
`limit`/`offset` en lisant **`meta.has_more`** (la doc précise explicitement de ne pas
comparer `count` à `limit` : un filtre rend une page courte sans que ce soit la fin).

---

## Cause commune, corrigée séparément : des matchs jetés par le code

`mapCompetition` renvoie un code de compétition vide quand `league.id` est absent —
fréquent sur les tournois d'été et les compétitions secondaires. Les routes faisaient
alors `if (!code) continue`, et le match, **pourtant reçu de la source**, disparaissait
sans laisser de trace : indiscernable d'un « aucun match » légitime. À défaut
d'identifiant, le nom de la compétition sert désormais de code.

---

## Récapitulatif

| # | Cause | Sport | Preuve |
|---|---|---|---|
| 1 | Quota gratuit dépassé x24 (TTL 5 min × 8 jours) | basket | arithmétique sur le code |
| 2 | Cache persistant non servi en cas de panne | basket | lecture du code |
| 3 | Ni timeout ni reprise sur l'appel upstream | basket | lecture du code |
| 4 | Source sans calendrier (SportScore = live/recent) | tennis | wrapper officiel SportScore |
| 5 | `/fixtures` cru indisponible alors qu'il est gratuit | tennis | client officiel du fournisseur |
| 6 | Matchs jetés faute d'identifiant de compétition | les deux | lecture du code + test de non-régression |

Ce qui reste non vérifiable d'ici : que les clés API en production soient valides et
non expirées. Si `API_BASKETBALL_KEY` est absente ou révoquée, aucun correctif de code
ne peut y suppléer — la réponse `/api/basketball/matches?debug=1` le dira explicitement
(`statut: "non configurée"` ou l'erreur exacte du fournisseur).
