/**
 * lib/bettableFilter.js — "les matchs sur lesquels on peut parier" : retire les
 * catégories jeunes, réserves et amateurs (jamais couvertes par un bookmaker), garde
 * toutes les compétitions seniors professionnelles, de n'importe quelle fédération.
 */
import { isBettableCompetitionName } from "../lib/bettableFilter";

test("garde les compétitions seniors professionnelles classiques", () => {
  expect(isBettableCompetitionName("Premier League")).toBe(true);
  expect(isBettableCompetitionName("Copa Libertadores")).toBe(true);
  expect(isBettableCompetitionName("Coupe du Monde")).toBe(true);
  expect(isBettableCompetitionName("Campeonato Brasileiro Série A")).toBe(true);
});

test("écarte les catégories jeunes désignées 'U17'/'U19'/'U20'/'U23' (avec ou sans tiret, ou en toutes lettres 'Under-19')", () => {
  expect(isBettableCompetitionName("Coupe du Monde U20")).toBe(false);
  expect(isBettableCompetitionName("UEFA European Under-19 Championship")).toBe(false);
  expect(isBettableCompetitionName("Championnat U-17")).toBe(false);
  expect(isBettableCompetitionName("Primera División U23")).toBe(false);
});

test("écarte les catégories jeunes désignées 'Sub-20'/'Sub 17' (pays hispano/lusophones)", () => {
  expect(isBettableCompetitionName("Copa Sub-20")).toBe(false);
  expect(isBettableCompetitionName("Campeonato Sub 17")).toBe(false);
});

test("écarte les compétitions explicitement 'Youth'/'Jeunes'/'Junior(s)'", () => {
  expect(isBettableCompetitionName("English Youth League")).toBe(false);
  expect(isBettableCompetitionName("Championnat des jeunes")).toBe(false);
  expect(isBettableCompetitionName("Junior Cup")).toBe(false);
  expect(isBettableCompetitionName("Coupe des juniors")).toBe(false);
});

test("écarte les compétitions réserves/amateurs/académies", () => {
  expect(isBettableCompetitionName("Reserve League")).toBe(false);
  expect(isBettableCompetitionName("Championnat réserve")).toBe(false);
  expect(isBettableCompetitionName("Amateur Cup")).toBe(false);
  expect(isBettableCompetitionName("Academy League")).toBe(false);
  expect(isBettableCompetitionName("Serie A Primavera")).toBe(false);
  expect(isBettableCompetitionName("Copa Juvenil")).toBe(false);
});

test("ne filtre jamais un nombre dans un vrai nom de compétition (ex : '3. Liga', 'Ligue 1')", () => {
  expect(isBettableCompetitionName("Ligue 1")).toBe(true);
  expect(isBettableCompetitionName("3. Liga")).toBe(true);
  expect(isBettableCompetitionName("Serie A")).toBe(true);
});

test("un nom de compétition manquant n'est jamais filtré (pas de donnée à évaluer)", () => {
  expect(isBettableCompetitionName(null)).toBe(true);
  expect(isBettableCompetitionName(undefined)).toBe(true);
  expect(isBettableCompetitionName("")).toBe(true);
});

test("insensible à la casse et aux accents", () => {
  expect(isBettableCompetitionName("RÉSERVE NATIONALE")).toBe(false);
  expect(isBettableCompetitionName("championnat U20")).toBe(false);
});
