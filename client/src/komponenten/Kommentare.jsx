// Private Kommentare/Notizen zu einem Spiel oder Gerät – nur für den eigenen Benutzer sichtbar.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { datumDe } from '../format.js';
import Symbol from './Symbole.jsx';
import { useHinweis } from './Hinweise.jsx';

export default function Kommentare({ katalogId }) {
  const zeigeHinweis = useHinweis();
  const [liste, setListe] = useState(null);
  const [text, setText] = useState('');
  const [bearbeitet, setBearbeitet] = useState(null); // { id, text }

  const laden = () => api.kommentare(katalogId).then(setListe).catch(() => setListe([]));
  useEffect(() => { if (katalogId) laden(); }, [katalogId]);
  if (!katalogId) return null;

  const ausfuehren = async (fn) => {
    try {
      await fn();
      laden();
    } catch (e) {
      zeigeHinweis(Object.values(e.felder ?? {})[0] ?? e.message, 'fehler');
    }
  };

  return (
    <section className="karte space-y-3 p-4">
      <h3 className="flex items-center gap-2 font-semibold">
        <Symbol name="stift" className="size-5" />Meine Kommentare
        <span className="abzeichen" title="Nur für dich sichtbar"><Symbol name="schloss" className="mr-1 size-3" />privat</span>
      </h3>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); ausfuehren(async () => { await api.kommentarAnlegen(katalogId, text); setText(''); }); }}>
        <label className="flex-1">
          <span className="sr-only">Neuer Kommentar</span>
          <textarea className="eingabe min-h-[2.75rem]" rows={1} value={text} onChange={(e) => setText(e.target.value)}
            placeholder="z. B. „Suche noch die USK-Version“ oder „Modul von Onkel geerbt“" maxLength={5000} />
        </label>
        <button type="submit" className="knopf-primaer self-start" disabled={!text.trim()}>Speichern</button>
      </form>
      {liste?.length > 0 && (
        <ul className="space-y-2">
          {liste.map((k) => (
            <li key={k.id} className="rounded-xl bg-karte-hover p-3 text-sm">
              {bearbeitet?.id === k.id ? (
                <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); ausfuehren(async () => { await api.kommentarAendern(k.id, bearbeitet.text); setBearbeitet(null); }); }}>
                  <textarea className="eingabe" rows={3} value={bearbeitet.text} onChange={(e) => setBearbeitet({ ...bearbeitet, text: e.target.value })} />
                  <div className="flex gap-2">
                    <button type="button" className="knopf-sekundaer px-3 py-1.5" onClick={() => setBearbeitet(null)}>Abbrechen</button>
                    <button type="submit" className="knopf-primaer px-3 py-1.5">Speichern</button>
                  </div>
                </form>
              ) : (
                <>
                  <p className="whitespace-pre-wrap">{k.text}</p>
                  <div className="mt-1 flex items-center gap-2 text-xs text-leise">
                    <span>{datumDe(k.erstellt_am)}{k.aktualisiert_am !== k.erstellt_am ? ' · bearbeitet' : ''}</span>
                    <button type="button" className="ml-auto underline" onClick={() => setBearbeitet({ id: k.id, text: k.text })}>Bearbeiten</button>
                    <button type="button" className="underline hover:text-gefahr" onClick={() => window.confirm('Kommentar löschen?') && ausfuehren(() => api.kommentarLoeschen(k.id))}>Löschen</button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
