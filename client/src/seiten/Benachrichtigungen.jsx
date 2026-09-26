import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { datumDe } from '../format.js';
import Layout from '../komponenten/Layout.jsx';
import Symbol from '../komponenten/Symbole.jsx';
import { useHinweis } from '../komponenten/Hinweise.jsx';

const SYMBOL = { freigabe: 'haken', ablehnung: 'warnung', meldung: 'info', rolle: 'schild', erfolg: 'pokal', boerse: 'boerse', nachricht: 'nachricht' };

export default function Benachrichtigungen({ route }) {
  const zeigeHinweis = useHinweis();
  const [daten, setDaten] = useState(null);
  const laden = () => api.benachrichtigungen().then(setDaten).catch((e) => zeigeHinweis(e.message, 'fehler'));
  useEffect(() => { laden(); }, []);

  const gelesen = async (id) => {
    await api.benachrichtigungGelesen(id).catch(() => {});
    window.dispatchEvent(new Event('benachrichtigungen-gelesen'));
    laden();
  };

  return (
    <Layout route={route} titel="Benachrichtigungen" zurueck="/"
      aktionen={daten?.ungelesen > 0 && <button type="button" className="knopf-sekundaer px-3 py-1.5 text-sm" onClick={() => gelesen(null)}>Alle gelesen</button>}>
      <div className="mx-auto max-w-2xl space-y-2 pb-8">
        {!daten ? <p className="text-leise">Wird geladen …</p> : daten.eintraege.length === 0 ? (
          <p className="karte p-6 text-center text-leise">Noch keine Benachrichtigungen. Hier erfährst du, wenn deine Einreichungen geprüft wurden.</p>
        ) : daten.eintraege.map((b) => (
          <article key={b.id} className={`karte flex gap-3 p-3 ${b.gelesen ? 'opacity-70' : 'border-akzent/50'}`}>
            <Symbol name={SYMBOL[b.art] ?? 'info'} className={`mt-0.5 size-5 shrink-0 ${b.art === 'ablehnung' ? 'text-gefahr' : 'text-akzent-hell'}`} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{b.titel}</p>
              {b.text && <p className="text-sm text-leise">{b.text}</p>}
              <p className="mt-1 flex flex-wrap gap-3 text-xs text-leise">
                <span>{datumDe(b.erstellt_am)}</span>
                {b.link && <a href={b.link} className="text-akzent-hell underline" onClick={() => !b.gelesen && gelesen(b.id)}>Ansehen</a>}
                {!b.gelesen && <button type="button" className="underline" onClick={() => gelesen(b.id)}>Als gelesen markieren</button>}
                <button type="button" className="underline" onClick={async () => { await api.benachrichtigungLoeschen(b.id); laden(); }}>Löschen</button>
              </p>
            </div>
          </article>
        ))}
      </div>
    </Layout>
  );
}
