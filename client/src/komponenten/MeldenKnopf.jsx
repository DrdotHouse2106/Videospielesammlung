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
  ['ergaenzung', 'Ergänzung / Sammlerhinweis vorschlagen'],
  ['sonstiges', 'Sonstiges'],
];

/** `vorschlag`: statt „Melden“ ein Knopf zum Vorschlagen von Ergänzungen (Sammlerhinweise, Korrekturen). */
export default function MeldenKnopf({ bereich, zielId, klein = false, className = '', vorschlag = false }) {
  const { benutzer } = useSitzung();
  const zeigeHinweis = useHinweis();
  const [offen, setOffen] = useState(false);
  const [w, setW] = useState({ grund: vorschlag ? 'ergaenzung' : ['medien', 'link'].includes(bereich) ? 'urheberrecht' : 'falsch', text: '', kontakt: '' });
  const [fehler, setFehler] = useState(null);

  async function absenden(e) {
    e.preventDefault();
    try {
      await api.melden({ bereich, ziel_id: zielId, ...w });
      zeigeHinweis(w.grund === 'ergaenzung' ? 'Danke! Dein Vorschlag wurde an das Moderationsteam übermittelt.' : 'Danke! Die Meldung wurde an das Moderationsteam übermittelt.');
      setOffen(false);
      setW({ ...w, text: '' });
    } catch (err) {
      setFehler(Object.values(err.felder ?? {})[0] ?? err.message);
    }
  }

  return (
    <>
      {vorschlag ? (
        <button type="button" onClick={() => setOffen(true)} className={`text-xs text-akzent-hell underline ${className}`}>
          Sammlerhinweis oder Korrektur vorschlagen
        </button>
      ) : (
        <button type="button" onClick={() => setOffen(true)} title="Inhalt melden" aria-label="Inhalt melden"
          className={klein ? `rounded-lg p-1.5 text-leise hover:bg-gefahr/10 hover:text-gefahr ${className}` : `text-xs text-leise underline hover:text-gefahr ${className}`}>
          {klein ? <Symbol name="warnung" className="size-4" /> : 'Melden'}
        </button>
      )}
      {offen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={vorschlag ? 'Ergänzung vorschlagen' : 'Inhalt melden'}>
          <form onSubmit={absenden} className="karte w-full max-w-md space-y-3 p-4">
            <h2 className="text-lg font-semibold">{vorschlag ? 'Ergänzung vorschlagen' : 'Inhalt melden'}</h2>
            {vorschlag && (
              <p className="text-xs text-leise">
                Kennst du Besonderheiten dieses Spiels – z. B. PAL-/USK-Versionen, Lieferumfang, Revisionen oder Fälschungsmerkmale?
                Das Moderationsteam prüft deinen Vorschlag und übernimmt ihn in die Sammlerhinweise.
              </p>
            )}
            <label className="block">
              <span className="beschriftung">Grund</span>
              <select className="eingabe" value={w.grund} onChange={(e) => setW({ ...w, grund: e.target.value })}>
                {GRUENDE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="beschriftung">Beschreibung</span>
              <textarea className="eingabe" rows={4} value={w.text} onChange={(e) => setW({ ...w, text: e.target.value })}
                placeholder={w.grund === 'urheberrecht' ? 'Welches Recht ist verletzt? Bist du Rechteinhaber oder handelst du in dessen Auftrag?'
                  : w.grund === 'ergaenzung' ? 'z. B. „Die deutsche Erstauflage hat ein rotes USK-Logo und eine mehrsprachige Anleitung.“'
                    : 'Was ist falsch oder problematisch?'} />
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
              <button type="submit" className="knopf-primaer">{w.grund === 'ergaenzung' ? 'Vorschlag senden' : 'Meldung senden'}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
