import { useRef, useState } from "react";
import { validateDateOfBirth } from "../lib/dateOfBirth";

// Saisie de la date de naissance au clavier (voir PROMPT) — remplace l'ancien
// <input type="date"> (sélecteur à défilement). Trois champs numériques distincts
// (Jour/Mois/Année) plutôt qu'un champ unique masqué : plus simple à faire fonctionner
// de façon fiable (avance automatique, retour arrière, collage) sans bibliothèque de
// masque de saisie, avec un état par champ facilement testable.
//
// `onChange` reçoit le format "AAAA-MM-JJ" dès que les 3 champs forment une VRAIE date
// plausible (identique au format que produisait l'ancien composant, voir
// lib/dateOfBirth.js) — mis à jour à CHAQUE frappe (jamais seulement à la perte de
// focus), pour que le formulaire parent soit toujours à jour même si la personne
// valide le formulaire sans quitter le dernier champ (ex. touche Entrée). L'ERREUR
// visible, elle, n'apparaît qu'après avoir quitté le groupe des 3 champs (jamais
// pendant la frappe, voir PROMPT) — ces deux mécanismes sont volontairement
// dissociés.
export default function DateOfBirthInput({ onChange }) {
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [error, setError] = useState(null);

  const dayRef = useRef(null);
  const monthRef = useRef(null);
  const yearRef = useRef(null);

  function sync(nextDay, nextMonth, nextYear) {
    const { iso } = validateDateOfBirth(nextDay, nextMonth, nextYear);
    onChange(iso || "");
  }

  function handleDayChange(e) {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
    setDay(digits);
    setError(null);
    sync(digits, month, year);
    if (digits.length === 2) monthRef.current?.focus();
  }

  function handleMonthChange(e) {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
    setMonth(digits);
    setError(null);
    sync(day, digits, year);
    if (digits.length === 2) yearRef.current?.focus();
  }

  function handleYearChange(e) {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
    setYear(digits);
    setError(null);
    sync(day, month, digits);
  }

  // "La touche Retour arrière sur un champ vide renvoie au champ précédent" (voir
  // PROMPT) — uniquement quand le champ ACTUEL est déjà vide (sinon, un backspace
  // normal doit d'abord vider CE champ, pas sauter directement au précédent).
  function handleMonthKeyDown(e) {
    if (e.key === "Backspace" && month === "") dayRef.current?.focus();
  }
  function handleYearKeyDown(e) {
    if (e.key === "Backspace" && year === "") monthRef.current?.focus();
  }

  // Collage d'une date complète (ex. "12/04/1998" ou "12041998") : ne remplit les 3
  // champs que si le presse-papiers contient bien 8 chiffres au total (JJMMAAAA) —
  // un collage partiel (ex. juste "12") est laissé au comportement normal du champ
  // ciblé, géré par son propre onChange.
  function handlePasteFullDate(e) {
    const text = e.clipboardData?.getData("text") || "";
    const digits = text.replace(/\D/g, "");
    if (digits.length < 8) return;
    e.preventDefault();
    const d = digits.slice(0, 2);
    const m = digits.slice(2, 4);
    const y = digits.slice(4, 8);
    setDay(d);
    setMonth(m);
    setYear(y);
    setError(null);
    sync(d, m, y);
    yearRef.current?.focus();
  }

  // Ne valide (et n'affiche l'erreur) que lorsque le focus quitte VRAIMENT le groupe
  // des 3 champs — jamais entre Jour -> Mois -> Année (avance automatique ou tabulation
  // normale à l'intérieur du groupe), pour ne jamais afficher une erreur prématurée
  // pendant que la personne est encore en train de remplir la date.
  function handleGroupBlur(e) {
    const groupRefs = [dayRef.current, monthRef.current, yearRef.current];
    if (groupRefs.includes(e.relatedTarget)) return;
    const { error: err } = validateDateOfBirth(day, month, year);
    setError(err);
  }

  return (
    <div style={styles.wrap}>
      <span style={styles.caption}>Date de naissance</span>
      <div style={styles.row}>
        <input
          ref={dayRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="JJ"
          aria-label="Jour de naissance"
          autoComplete="bday-day"
          value={day}
          onChange={handleDayChange}
          onPaste={handlePasteFullDate}
          onBlur={handleGroupBlur}
          maxLength={2}
          style={{ ...styles.input, ...styles.dayMonth }}
        />
        <span style={styles.sep} aria-hidden="true">/</span>
        <input
          ref={monthRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="MM"
          aria-label="Mois de naissance"
          autoComplete="bday-month"
          value={month}
          onChange={handleMonthChange}
          onKeyDown={handleMonthKeyDown}
          onPaste={handlePasteFullDate}
          onBlur={handleGroupBlur}
          maxLength={2}
          style={{ ...styles.input, ...styles.dayMonth }}
        />
        <span style={styles.sep} aria-hidden="true">/</span>
        <input
          ref={yearRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="AAAA"
          aria-label="Année de naissance"
          autoComplete="bday-year"
          value={year}
          onChange={handleYearChange}
          onKeyDown={handleYearKeyDown}
          onPaste={handlePasteFullDate}
          onBlur={handleGroupBlur}
          maxLength={4}
          style={{ ...styles.input, ...styles.year }}
        />
      </div>
      {error && <p style={styles.error}>{error}</p>}
    </div>
  );
}

// Mêmes tokens (couleurs/bordure/arrondi/espacement) que les autres champs du
// formulaire d'inscription (voir pages/inscription.js:styles.input) — juste plus
// étroits et centrés, pour 2 ou 4 chiffres.
const styles = {
  wrap: { display: "flex", flexDirection: "column", gap: 6 },
  caption: { fontSize: 12, color: "var(--text-secondary)" },
  row: { display: "flex", alignItems: "center", gap: 6 },
  input: {
    background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)",
    borderRadius: 9, padding: "11px 12px", fontSize: 14, textAlign: "center",
  },
  dayMonth: { width: 56, flexShrink: 0 },
  year: { width: 84, flexShrink: 0 },
  sep: { color: "var(--text-secondary)", fontSize: 14 },
  error: { color: "var(--negative)", fontSize: 12.5, margin: 0 },
};
