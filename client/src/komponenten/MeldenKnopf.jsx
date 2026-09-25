// „Melden“ – z. B. bei Urheberrechtsverletzungen oder falschen Angaben (Notice-and-Takedown).
import { useState } from 'react';
import { api } from '../api.js';
import { useSitzung } from '../sitzung.js';
import Symbol from './Symbole.jsx';
import { useHinweis } from './Hinweise.jsx';

const GRUENDE = [
  ['urheberrecht', 'Urheberrechtsverletzung'],
  ['rechtswidrig', 'Sonstiger rechtswidriger Inhalt'],
  ['falsch', 'Falsche Angaben'],
  ['spam', 'Spam / Werbung'],
  ['sonstiges', 'Sonstiges'],
];

export default function MeldenKnopf({ bereich, zielId, klein = false, className = '' }) {
  const { benutzer } = useSitzung();
  const zeigeHinweis = useHinweis();
  const [offen, setOffen] = useState(false);
  const [w, setW] = useState({ grund: bereich === 'medien' ? 'urheberrecht' : 'falsch', text: '', kontakt: '' });
  const [fehler, setFehler] = useState(null);

  async function absenden(e) {
    e.preventDefault();
    try {
      await api.melden({ bereich, ziel_id: zielId, ...w });
      zeigeHinweis('Danke! Die Meldung wurde an das Moderationsteam übermittelt.');
      setOffen(false);
      setW({ ...w, text: '' });
    } catch (err) {
      setFehler(Object.values(err.felder ?? {})[0] ?? err.message);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOffen(true)} title="Inhalt melden" aria-label="Inhalt melden"
        className={klein ? `rounded-lg p-1.5 text-leise hover:bg-gefahr/10 hover:text-gefahr ${className}` : `text-xs text-leise underline hover:text-gefahr ${className}`}>
        {klein ? <Symbol name="warnung" className="size-4" /> : 'Melden'}
      </button>
      {offen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Inhalt melden">
          <form onSubmit={absenden} className="karte w-full max-w-md space-y-3 p-4">
            <h2 className="text-lg font-semibold">Inhalt melden</h2>
            <label className="block">
              <span className="beschriftung">Grund</span>
              <select className="eingabe" value={w.grund} onChange={(e) => setW({ ...w, grund: e.target.value })}>
                {GRUENDE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="beschriftung">Beschreibung</span>
              <textarea className="eingabe" rows={4} value={w.text} onChange={(e) => setW({ ...w, text: e.target.value })}
                placeholder={w.grund === 'urheberrecht' ? 'Welches Recht ist verletzt? Bist du Rechteinhaber oder handelst du in dessen Auftrag?' : 'Was ist falsch oder problematisch?'} />
            </label>
            {!benutzer && (
              <label className="block">
                <span className="beschriftung">Kontakt für Rückfragen (optional)</span>
                <input className="eingabe" value={w.kontakt} onChange={(e) => setW({ ...w, kontakt: e.target.value })} placeholder="E-Mail-Adresse" />
              </label>
            )}
            {fehler && <p className="text-sm text-gefahr" role="alert">{fehler}</p>}
            <div className="flex gap-2">
              <button type="button" className="knopf-sekundaer" onClick={() => setOffen(false)}>Abbrechen</button>
              <button type="submit" className="knopf-primaer">Meldung senden</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
