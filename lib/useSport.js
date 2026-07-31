import { useEffect, useState } from "react";
import { readPrefs, writePrefs } from "./prefsCookie";
import { isValidSport, DEFAULT_SPORT } from "./sports/registry";

// Multi-sport (bloc 0) : sport actuellement sélectionné, mémorisé dans le cookie
// blume_prefs (voir lib/prefsCookie.js) et partagé entre le sélecteur (components/
// SportTabs.js, rendu par components/SiteHeader.js) et le contenu de la page qui
// l'affiche — chaque page de contenu appelle ce hook UNE FOIS et transmet `sport`/
// `setSport` en props à <SiteHeader>, exactement comme `session` l'est déjà : pas de
// Context React ajouté, un changement d'onglet met donc bien à jour tout le contenu
// de la page en un seul re-rendu (jamais besoin de recharger la page).
//
// `sportReady` évite un flash "Football" avant que le cookie du navigateur (posé lors
// d'une visite précédente) ne soit relu : même principe que `sessionChecked` de
// lib/useRequireAuth.js — la lecture réelle n'a lieu qu'après le montage (le rendu
// serveur n'a jamais accès à document.cookie), pour ne jamais produire un rendu
// client différent du rendu serveur au premier affichage.
export function useSport() {
  const [sport, setSportState] = useState(DEFAULT_SPORT);
  const [sportReady, setSportReady] = useState(false);

  useEffect(() => {
    const stored = readPrefs().sport;
    setSportState(isValidSport(stored) ? stored : DEFAULT_SPORT);
    setSportReady(true);
  }, []);

  const setSport = (next) => {
    if (!isValidSport(next)) return;
    setSportState(next);
    writePrefs({ sport: next });
  };

  return { sport, setSport, sportReady };
}
