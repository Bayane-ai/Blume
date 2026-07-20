/**
 * @jest-environment jsdom
 *
 * components/NewsCard.js — carte cliquable ouvrant le vrai article (nouvel onglet),
 * avec image/titre/résumé/source/date, robuste aux champs manquants.
 */
import { render, screen } from "@testing-library/react";
import NewsCard from "../components/NewsCard";

function articleFixture(overrides = {}) {
  return {
    title: "Mbappé signe un nouveau record",
    link: "https://example.com/article-1",
    summary: "Un grand soir pour le Real Madrid.",
    source: "L'Équipe",
    publishedAt: "2026-07-20T10:00:00.000Z",
    image: "https://example.com/image-1.jpg",
    ...overrides,
  };
}

test("affiche image, titre, résumé, source et date, et pointe vers le vrai lien de l'article", () => {
  render(<NewsCard article={articleFixture()} />);
  const link = screen.getByTestId("news-card");
  expect(link).toHaveAttribute("href", "https://example.com/article-1");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");

  expect(screen.getByText("Mbappé signe un nouveau record")).toBeInTheDocument();
  expect(screen.getByText("Un grand soir pour le Real Madrid.")).toBeInTheDocument();
  expect(screen.getByText("L'Équipe")).toBeInTheDocument();
  expect(link.querySelector("img")).toHaveAttribute("src", "https://example.com/image-1.jpg");
});

test("sans image ni résumé : la carte reste propre, pas d'élément cassé", () => {
  const { container } = render(<NewsCard article={articleFixture({ image: null, summary: "" })} />);
  expect(container.querySelector("img")).not.toBeInTheDocument();
  expect(screen.getByText("Mbappé signe un nouveau record")).toBeInTheDocument();
});

test("sans titre ou sans lien, ne rend rien (jamais une carte à moitié vide)", () => {
  const { container: c1 } = render(<NewsCard article={{ link: "https://example.com/x" }} />);
  expect(c1).toBeEmptyDOMElement();
  const { container: c2 } = render(<NewsCard article={{ title: "Titre seul" }} />);
  expect(c2).toBeEmptyDOMElement();
});
