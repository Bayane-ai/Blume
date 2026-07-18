/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, within } from "@testing-library/react";
import MatchCard from "../components/MatchCard";

const pronostic = {
  available: true,
  home: { name: "Arsenal FC", position: 3, points: 55, form: "WWDLW" },
  away: { name: "Chelsea FC", position: 7, points: 44, form: "LWDDW" },
  probabilities: { home: 48.2, draw: 26.1, away: 25.7 },
  goals: { expectedHome: 1.6, expectedAway: 1.1, over25: 54.3, under25: 45.7, bttsYes: 58.9, bttsNo: 41.1 },
  correctScores: [
    { score: "1-0", probability: 12.4 },
    { score: "1-1", probability: 10.8 },
    { score: "2-1", probability: 9.6 },
  ],
  note: "Estimation statistique (modèle de Poisson).",
};

function baseMatch(overrides = {}) {
  return {
    id: 1,
    status: "SCHEDULED",
    utcDate: "2026-07-20T18:00:00Z",
    minute: null,
    competition: { code: "PL", name: "Primera B Metropolitana", emblem: "https://crests.football-data.org/PL.png" },
    homeTeam: { id: 10, name: "Arsenal FC", crest: "https://crests.football-data.org/57.png" },
    awayTeam: { id: 11, name: "Chelsea FC", crest: "https://crests.football-data.org/61.png" },
    score: { fullTime: { home: null, away: null } },
    pronostic,
    ...overrides,
  };
}

describe("MatchCard — présentation exacte de la carte", () => {
  test("affiche le bandeau compétition (logo + nom) en haut de la carte", () => {
    render(<MatchCard m={baseMatch()} comp={{ code: "PL", name: "Premier League" }} />);
    expect(screen.getByText("Primera B Metropolitana")).toBeInTheDocument();
    const emblem = screen.getByAltText(/primera b metropolitana/i);
    expect(emblem).toHaveAttribute("src", "https://crests.football-data.org/PL.png");
  });

  test("affiche LIVE + la minute, aligné à droite, quand le match est en direct", () => {
    render(<MatchCard m={baseMatch({ status: "IN_PLAY", minute: 57 })} comp={{}} />);
    expect(screen.getByText(/LIVE/)).toHaveTextContent("57");
  });

  test("n'affiche pas LIVE quand le match n'est pas en direct", () => {
    render(<MatchCard m={baseMatch({ status: "SCHEDULED" })} comp={{}} />);
    expect(screen.queryByText(/LIVE/)).not.toBeInTheDocument();
  });

  test("affiche l'heure du match (pas de score) quand il n'a pas commencé", () => {
    render(<MatchCard m={baseMatch({ status: "SCHEDULED" })} comp={{}} />);
    expect(screen.queryByText(/–\s*:\s*–/)).not.toBeInTheDocument();
  });

  test("affiche le score quand le match est en direct ou terminé", () => {
    render(
      <MatchCard
        m={baseMatch({ status: "IN_PLAY", minute: 12, score: { fullTime: { home: 1, away: 0 } } })}
        comp={{}}
      />
    );
    expect(screen.getByText(/1\s*:\s*0/)).toBeInTheDocument();
  });

  test("affiche l'équipe à domicile à gauche (avec logo) et l'équipe extérieure à droite (avec logo)", () => {
    render(<MatchCard m={baseMatch()} comp={{}} />);
    expect(screen.getByText("Arsenal FC")).toBeInTheDocument();
    expect(screen.getByText("Chelsea FC")).toBeInTheDocument();
    expect(screen.getAllByAltText("").length).toBeGreaterThan(0); // logos d'équipe (alt vide, décoratif)
  });

  test('bouton "ANALYSER" pleine largeur et fonctionnel : révèle l\'analyse déjà calculée, sans requête réseau', () => {
    global.fetch = jest.fn(() => Promise.reject(new Error("aucun appel réseau ne doit être déclenché")));
    render(<MatchCard m={baseMatch()} comp={{}} />);

    const btn = screen.getByRole("button", { name: /analyser/i });
    expect(btn).toBeInTheDocument();
    expect(btn.tagName).toBe("BUTTON");

    // Rien n'est visible avant le clic.
    expect(screen.queryByText(/48.2/)).not.toBeInTheDocument();

    fireEvent.click(btn);

    // L'analyse apparaît instantanément (donnée déjà présente dans les props).
    expect(screen.getByText(/48.2/)).toBeInTheDocument();
    expect(screen.getByText(/54.3/)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('bouton "ANALYSER" affiche un vrai message (pas un écran vide) quand le pronostic est indisponible', () => {
    render(
      <MatchCard
        m={baseMatch({ pronostic: { available: false, message: "Classement indisponible pour cette compétition." } })}
        comp={{}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /analyser/i }));
    expect(screen.getByText("Classement indisponible pour cette compétition.")).toBeInTheDocument();
  });

  test("le bouton Analyser n'est pas imbriqué dans un lien (structure HTML valide)", () => {
    render(<MatchCard m={baseMatch()} comp={{}} />);
    const btn = screen.getByRole("button", { name: /analyser/i });
    expect(btn.closest("a")).toBeNull();
  });
});
