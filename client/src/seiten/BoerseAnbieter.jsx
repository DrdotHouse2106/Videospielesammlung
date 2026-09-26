// Profil eines Anbieters in der Tauschbörse: Bewertungen, aktive Angebote, bei Händlern die Anbieterkennzeichnung.
import { useEffect, useState } from 'react';
import { BEWERTUNGSWERTE } from '../../../shared/konstanten.js';
import { api } from '../api.js';
import { datumDe } from '../format.js';
import { navigiere } from '../router.js';
import Layout from '../komponenten/Layout.jsx';
import { useHinweis } from '../komponenten/Hinweise.jsx';
import { AngebotKarte } from '../komponenten/BoerseTeile.jsx';
import { AnbieterBox } from './BoerseAngebot.jsx';

export default function BoerseAnbieter({ route, id }) {
  const zeigeHinweis = useHinweis();
  const [p, setP] = useState(null);
  const [fehler, setFehler] = useState(null);
  const seite = Number(route.parameter.seite) || 1;
  const laden = () => api.anbieter(id, seite).then(setP).catch((e) => setFehler(e.message));
  useEffect(() => { laden(); }, [id, seite]);

  if (!p) {
    return (
      <Layout route={route} titel="Anbieter" zurueck="/boerse">
        {fehler ? <p className="text-gefahr" role="alert">{fehler}</p> : <p className="text-leise">Wird geladen …</p>}
      </Layout>
    );
  }

  const blockieren = async () => {
    const ja = !p.blockiert;
    if (ja && !window.confirm(`${p.name} blockieren? Ihr könnt euch dann keine Nachrichten mehr schreiben und seht eure Angebote nicht mehr.`)) return;
    try {
      await (ja ? api.blockieren(p.id) : api.entblocken(p.id));
      zeigeHinweis(ja ? 'Benutzer blockiert.' : 'Blockierung aufgehoben.');
      if (ja) navigiere('/boerse'); else laden();
    } catch (err) { zeigeHinweis(err.message, 'fehler'); }
  };

  return (
    <Layout route={route} titel={p.name} zurueck="/boerse">
      <div className="mx-auto max-w-3xl space-y-4 pb-8">
        <AnbieterBox anbieter={p} />
        {p.oeffentlich_pfad && (
          <p className="text-sm"><a className="text-akzent-hell underline" href={p.oeffentlich_pfad} target="_blank" rel="noopener">Öffentliche Händlerseite ansehen</a></p>
        )}
        {!p.eigenes && (
          <p className="text-right"><button type="button" className="text-xs text-leise underline hover:text-gefahr" onClick={blockieren}>{p.blockiert ? 'Blockierung aufheben' : 'Blockieren'}</button></p>
        )}
        <section className="space-y-2">
          <h2 className="font-semibold">Aktive Angebote ({p.angebote.gesamt})</h2>
          {p.angebote.eintraege.length === 0 ? <p className="text-sm text-leise">Keine aktiven Angebote.</p>
            : p.angebote.eintraege.map((a) => <AngebotKarte key={a.id} angebot={a} />)}
          {p.angebote.seiten > 1 && (
            <nav className="flex items-center justify-center gap-2" aria-label="Seiten">
              <button type="button" className="knopf-sekundaer px-3 py-1.5" disabled={seite <= 1} onClick={() => navigiere(`/boerse/anbieter/${id}`, { seite: seite - 1 })}>Zurück</button>
              <span className="text-sm text-leise">Seite {seite} von {p.angebote.seiten}</span>
              <button type="button" className="knopf-sekundaer px-3 py-1.5" disabled={seite >= p.angebote.seiten} onClick={() => navigiere(`/boerse/anbieter/${id}`, { seite: seite + 1 })}>Weiter</button>
            </nav>
          )}
        </section>
        <section className="space-y-2">
          <h2 className="font-semibold">Bewertungen ({p.bewertung.gesamt})</h2>
          {p.bewertungen.length === 0 ? <p className="text-sm text-leise">Noch keine Bewertungen.</p> : (
            <ul className="karte divide-y divide-rand">
              {p.bewertungen.map((b) => (
                <li key={b.id} className="flex gap-3 p-3 text-sm">
                  <span aria-label={BEWERTUNGSWERTE.find((x) => x.value === b.wert)?.label}>{BEWERTUNGSWERTE.find((x) => x.value === b.wert)?.icon}</span>
                  <div className="min-w-0 flex-1">
                    {b.text && <p>{b.text}</p>}
                    <p className="text-xs text-leise">{b.von ?? 'Gelöschtes Konto'} · {datumDe(b.erstellt_am)}{b.titel ? ` · ${b.titel}` : ''}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Layout>
  );
}
