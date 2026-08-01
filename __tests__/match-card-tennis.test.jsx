/**
 * @jest-environment jsdom
 *
 * components/MatchInfoBlock.js / MatchCard.js — champs propres au tennis (PROMPT
 * bloc 6) : surface, tour, drapeaux, joueur au service, score set par set. Ces champs
 * n'existent jamais pour le football/basket (voir lib/apiFootball.js, lib/sports/
 * basketball/mapper.js) : les tests confirment aussi qu'ils restent invisibles pour
 * ces sports (rien à afficher = rien de nouveau à l'écran, pas de régression visuelle).
 */
import { render, screen } from "@testing-library/react";
import MatchCard, { matchHref } from "../components/MatchCard";

const pushMock = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({ push: pushMock }),
}));

function tennisMatch(overrides = {}) {
  return {
    id: "tn-1",
    status: "IN_PLAY",
    minute: "40-30",
    period: "Set 3",
    utcDate: "2026-08-01T14:00:00Z",
    competition: { code: "tn-1", name: "Wimbledon", area: "United Kingdom", emblem: "", surface: "Gazon", category: "Grand Slam" },
    round: "Quart de finale",
    homeTeam: { id: "tn-10", name: "Novak Djokovic", crest: "", flag: "https://example.com/rs.png" },
    awayTeam: { id: "tn-11", name: "Carlos Alcaraz", crest: "", flag: "https://example.com/es.png" },
    score: { fullTime: { home: 1, away: 1 } },
    sets: [{ home: 6, away: 4 }, { home: 4, away: 6 }],
    server: "home",
    pronostic: { available: false },
    ...overrides,
  };
}

describe("MatchInfoBlock — tennis (surface, tour, drapeaux, service, sets)", () => {
  test("affiche la surface et le tour sous le bandeau de compétition", () => {
    render(<MatchCard m={tennisMatch()} comp={{}} />);
    expect(screen.getByTestId("tennis-meta")).toHaveTextContent("Gazon");
    expect(screen.getByTestId("tennis-meta")).toHaveTextContent("Quart de finale");
  });

  test("affiche les drapeaux des deux joueurs", () => {
    render(<MatchCard m={tennisMatch()} comp={{}} />);
    const flags = screen.getAllByAltText("").map((img) => img.getAttribute("src"));
    expect(flags).toContain("https://example.com/rs.png");
    expect(flags).toContain("https://example.com/es.png");
  });

  test("indique le joueur au service par un point à côté de son nom", () => {
    render(<MatchCard m={tennisMatch({ server: "home" })} comp={{}} />);
    expect(screen.getAllByTestId("serving-indicator")).toHaveLength(1);
  });

  test("aucun indicateur de service si la source ne l'a pas fourni", () => {
    render(<MatchCard m={tennisMatch({ server: null })} comp={{}} />);
    expect(screen.queryByTestId("serving-indicator")).not.toBeInTheDocument();
  });

  test("aucun indicateur de service pour un match qui n'est pas en direct, même si server est renseigné par erreur", () => {
    render(<MatchCard m={tennisMatch({ status: "SCHEDULED", server: "home" })} comp={{}} />);
    expect(screen.queryByTestId("serving-indicator")).not.toBeInTheDocument();
  });

  test("affiche le score set par set en direct", () => {
    render(<MatchCard m={tennisMatch()} comp={{}} />);
    expect(screen.getByTestId("sets-line")).toHaveTextContent("6-4");
    expect(screen.getByTestId("sets-line")).toHaveTextContent("4-6");
  });

  test("pas de score set par set pour un match pas encore commencé", () => {
    render(<MatchCard m={tennisMatch({ status: "SCHEDULED", sets: [] })} comp={{}} />);
    expect(screen.queryByTestId("sets-line")).not.toBeInTheDocument();
  });

  test("pas de bloc surface/tour quand ni l'un ni l'autre n'est fourni (football/basket)", () => {
    render(
      <MatchCard
        m={{
          id: 1, status: "IN_PLAY", minute: 57, utcDate: "2026-07-20T18:00:00Z",
          competition: { code: "PL", name: "Premier League", emblem: "" },
          homeTeam: { id: 10, name: "Arsenal FC", crest: "" },
          awayTeam: { id: 11, name: "Chelsea FC", crest: "" },
          score: { fullTime: { home: 1, away: 0 } },
          pronostic: { available: false },
        }}
        comp={{}}
      />
    );
    expect(screen.queryByTestId("tennis-meta")).not.toBeInTheDocument();
    expect(screen.queryByTestId("serving-indicator")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sets-line")).not.toBeInTheDocument();
  });

  test('bouton "ANALYSER" à l\'intérieur de la carte, avec une marge (même structure partagée que football/basket)', () => {
    render(<MatchCard m={tennisMatch()} comp={{}} />);
    const btn = screen.getByRole("button", { name: /^analyser$/i });
    expect(btn).toBeInTheDocument();
    // Même carte (st.card, padding partagé) que le corps du match — pas un bouton
    // séparé collé aux bords, voir components/MatchCard.js.
    expect(btn.closest('[data-testid="match-card"]')).not.toBeNull();
  });
});

describe("matchHref — transmet les champs tennis nécessaires à la page de détail", () => {
  test("surface, tour, drapeaux et sets partent dans les query params", () => {
    const href = matchHref(tennisMatch(), {});
    expect(href.pathname).toBe("/match/tn-1");
    expect(href.query.surface).toBe("Gazon");
    expect(href.query.round).toBe("Quart de finale");
    expect(href.query.homeFlag).toBe("https://example.com/rs.png");
    expect(href.query.awayFlag).toBe("https://example.com/es.png");
    expect(JSON.parse(href.query.sets)).toEqual([{ home: 6, away: 4 }, { home: 4, away: 6 }]);
  });

  test("champs tennis vides (chaîne) pour un match football, jamais undefined ni une erreur", () => {
    const href = matchHref(
      {
        id: 1, status: "SCHEDULED", utcDate: "2026-07-20T18:00:00Z",
        competition: { code: "PL", name: "Premier League" },
        homeTeam: { id: 10, name: "Arsenal FC" }, awayTeam: { id: 11, name: "Chelsea FC" },
        score: { fullTime: { home: null, away: null } },
      },
      {}
    );
    expect(href.query.surface).toBe("");
    expect(href.query.round).toBe("");
    expect(href.query.sets).toBe("");
  });
});
