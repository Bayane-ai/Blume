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


---

# Couverture des compétitions — audit du 10/08/2026

## Ce qui a été cherché, et ce qui a été trouvé

Recherche sur **tout** le projet (hors `node_modules`, `.next`, tests) des mots-clés
`whitelist`, `allowedLeagues`, `TOP_LEAGUES`, `MAJOR`, `popularLeagues`, `leagueIds`,
`includeLeagues`, `filter(league…)`, `country ===`, `tier`, `priority`.

| Trouvé | Nature réelle | Verdict |
|---|---|---|
| `ALLOWED_SPORTS` (`pages/api/sportscore.js`) | énumération des 4 sports acceptés par SportScore (`football`, `tennis`, `basketball`, `cricket`) | garde-fou de paramètre, aucune compétition concernée — **conservé** |
| `PRIORITY_CODES` (`lib/matchFilters.js`) | ordre d'affichage des boutons de filtre | **tri seul** : toute compétition présente ressort, prioritaire ou non — vérifié par test |
| `FOOTBALL_MAJORS` (`lib/sportScore.js`) | remontée des grandes compétitions en tête | **tri seul**, aucune exclusion — vérifié par test |
| `isFeaturedSpecificCompetition` | remontée de 4 championnats demandés | **tri seul** |
| `TENNIS_MAJORS` / `BASKETBALL_MAJORS` | anciens tris privilégiés | **vidés** au correctif précédent |
| `.slice(0, 100)` sur les matchs (`pages/api/competition-matches.js`) | **vraie troncature** : une page lue, puis retronquée à 100 | **SUPPRIMÉ** — pagination complète par `offset` |

Aucune liste blanche, aucun filtre par pays, continent, fédération, niveau, popularité,
genre ou catégorie d'âge n'existe dans le chemin de données. La seule restriction
supprimée était le plafond de 100 matchs ci-dessus.

## Découverte dynamique — comment elle est réellement assurée

Aucune liste de compétitions n'est écrite en dur. Les trois sports interrogent leur
source **par DATE**, ce qui rapporte d'un coup **toutes** les compétitions de la
journée :

| Sport | Appel | Effet |
|---|---|---|
| Football | `/matches?dateFrom=…&dateTo=…` (football-data.org) + `/fixtures?date=` (API-Football) | toutes compétitions des deux fournisseurs |
| Basket | `/games?date=…&timezone=UTC` | toutes ligues, sans paramètre `league` |
| Tennis | `/fixtures` (Live Tennis API) | tous tournois, sans paramètre `tour` |

Une compétition nouvelle chez un fournisseur apparaît donc **sans modification de
code**. C'est plus complet qu'une énumération ligue par ligue, et sans commune mesure
en coût : énumérer les centaines de ligues puis les interroger une à une multiplierait
les appels par cent — exactement le mécanisme qui a fait exploser le quota basket
(voir plus haut). `getActiveLeagues` reste appelé, mais **uniquement comme mesure de
contrôle** : il compare le nombre de compétitions actives au nombre réellement affiché
et journalise l'écart.

## Comptage des compétitions distinctes (fenêtre J → J+7)

Le contrôle quotidien (`lib/healthMatches.mjs`, cron 06:00 UTC, et
`npm run test:matches`) compte désormais les compétitions distinctes par sport et rend
un verdict **`COUVERTURE FAIBLE`** en dessous de **15** — le seuil demandé — avec la
mention explicite « chercher un filtre résiduel ».

Mesure obtenue ici, sur un flux tennis volontairement hétéroclite (les hôtes tiers
étant inaccessibles depuis cet environnement, voir l'avertissement en tête de
document) :

```
SPORT        VERDICT      MATCHS       COMPÉT.      HTTP    DURÉE
tennis       OK           20           19           200     136 ms
```

Les 19 compétitions traversées, sans qu'aucune catégorie ne soit écartée :

```
ATP 250 Kitzbuhel        ATP 500 Washington      ATP Masters 1000 Cincinnati
Billie Jean King Cup     Challenger Como         Coupe Davis Groupe IV
Exhibition Abu Dhabi     ITF M15 Monastir        ITF W25 Bastad
ITF Wheelchair Open      NCAA Tennis             US Open Doubles
UTR Pro Tennis Hambourg  UTR Pro Tennis Saitama  United Cup
WTA 1000 Montreal        WTA 250 Prague          Wimbledon
Wimbledon Juniors
```

Grand Chelem, Masters, 500/250, Challenger, ITF hommes **et** femmes, United Cup,
Coupe Davis, Billie Jean King Cup, exhibitions, double, juniors, handisport et NCAA :
tout passe. La pagination a bien parcouru les 4 pages (6 + 6 + 6 + 2).

**Les chiffres de production restent à relever** : football et basket ne peuvent pas
être mesurés d'ici (fournisseurs injoignables, et clés absentes de cet
environnement). Le cron de 06:00 UTC les publie chaque jour dans les logs Vercel sous
le tag `blume.health.matches`, avec le champ `competitions` et le verdict. Un sport
sous les 15 y apparaîtra explicitement comme `COUVERTURE FAIBLE`.

## Affichage

Le regroupement jour → compétition → matchs est conservé. Les grandes compétitions
remontent en tête pour la lisibilité (football uniquement ; basket et tennis sont
strictement à égalité). **Aucune coupure à N éléments** : ni la liste des jours, ni
celle des compétitions, ni celle des matchs ne sont tronquées à l'affichage — vérifié
par test.


---

# Basket — troisième source et vérification du contrat SportScore (10/08/2026)

## SportScore ne peut pas fournir de matchs par date — vérifié, pas supposé

Demande : « le bon endpoint de matchs par date, le bon format de date (UTC), et la
pagination ». Ces trois choses **n'existent pas** sur cette API. Relu dans le wrapper
officiel du fournisseur (`Backspace-me/sportscore-mcp`), qui déclare l'intégralité de
sa surface :

| Outil | Chemin | Paramètres |
|---|---|---|
| `get_matches` | `/api/widget/matches/` | `sport` (enum), `limit` (1–50) |
| `get_match_detail` | `/api/widget/match/` | `sport`, `slug` |
| `get_team_schedule` | `/api/widget/team/` | `sport`, `slug` |
| `get_standings`, `get_top_scorers`, `get_player`, `get_bracket`, `get_tracker` | … | `sport`, `slug` |

`get_matches` n'accepte **que** `sport` et `limit`. Sa description officielle est
« List live and **recent** matches ». Aucun paramètre de date, aucun curseur, aucune
page. Le seul endpoint daté, `get_team_schedule`, exige le slug d'une équipe —
inutilisable pour balayer toutes les compétitions.

Conclusion : le « HTTP 200 avec 0 match » de SportScore n'est pas un bug d'appel, c'est
une réponse correcte à une question que cette API ne sait pas traiter. SportScore reste
en **deuxième** position, jamais en principale. `sport=basketball` est bien la valeur
attendue par l'enum.

## Troisième source : balldontlie

Contrat repris du **SDK officiel** du fournisseur (`npm @balldontlie/sdk`) :

| | |
|---|---|
| base | `https://api.balldontlie.io` |
| chemin | `/nba/v1/games` |
| authentification | en-tête `Authorization: <clé>` — clé **brute**, sans « Bearer » |
| paramètres | `start_date`, `end_date` (AAAA-MM-JJ), `per_page`, `cursor` |
| pagination | `meta.next_cursor`, suivi jusqu'à épuisement |

Chaîne basket désormais : **API-Basketball → SportScore → balldontlie**, passage
automatique dès qu'une source échoue ou renvoie 0.

### Limite à connaître avant de compter dessus

Le SDK officiel n'expose que **NBA, MLB, NFL et EPL** : **il n'y a pas de WNBA**.
balldontlie ne couvre donc ni la WNBA, ni les ligues d'été, ni les championnats
nationaux, et ne renvoie rien pendant l'intersaison NBA (juillet → septembre). C'est un
vrai troisième fournisseur, indépendant des deux autres, mais **il ne répond pas au
besoin d'août** : la seule source qui porte la WNBA et les championnats nationaux reste
API-Basketball. Si l'onglet basket est vide en août, c'est cette clé-là qu'il faut
regarder, pas balldontlie.

## Vérification exécutée

Cascade complète éprouvée en local, les deux premières sources réellement en échec
(403 du pare-feu de cet environnement), la troisième servant le contrat documenté :

```
API-Basketball (v1.basketball.api-sports.io)  statut=échec   http=None recus=0
SportScore (secours)                          statut=échec   http=403  recus=0
balldontlie (NBA uniquement)                  statut=ok      http=200  recus=6

TOTAL 6 matchs, pagination parcourue sur 3 pages (curseur 0 → 2 → 4)
2026-08-10  NBA  Los Angeles Lakers vs Boston Celtics
2026-08-10  NBA  Golden State Warriors vs Denver Nuggets
2026-08-11  NBA  Miami Heat vs New York Knicks
2026-08-12  NBA  Phoenix Suns vs Dallas Mavericks
2026-08-13  NBA  Milwaukee Bucks vs Philadelphia 76ers
2026-08-15  NBA  Chicago Bulls vs Detroit Pistons
```

La route a répondu **HTTP 200 avec des matchs** alors que deux sources sur trois
étaient tombées — c'est exactement le comportement attendu, et l'inverse du bandeau
rouge signalé.
