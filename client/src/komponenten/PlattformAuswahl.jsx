import { nachHersteller, usePlattformen } from '../plattformen.js';

/** Auswahlfeld mit allen Plattformen, gruppiert nach Hersteller. */
export default function PlattformAuswahl({ id, wert, onChange, leerText = '– Plattform wählen –', className = 'eingabe' }) {
  const plattformen = usePlattformen();
  return (
    <select id={id} className={className} value={wert ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">{leerText}</option>
      {nachHersteller(plattformen).map(([hersteller, liste]) => (
        <optgroup key={hersteller} label={hersteller}>
          {liste.map((p) => <option key={p.id} value={p.id}>{p.name}{p.kurz !== p.name ? ` (${p.kurz})` : ''}</option>)}
        </optgroup>
      ))}
    </select>
  );
}
