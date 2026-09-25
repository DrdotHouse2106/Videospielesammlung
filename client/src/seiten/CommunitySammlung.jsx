import { useEffect, useState } from 'react';
import { ARTIKELTYPEN } from '../../../shared/konstanten.js';
import { api } from '../api.js';
import Layout from '../komponenten/Layout.jsx';
import ArtikelKarte from '../komponenten/ArtikelKarte.jsx';
import Symbol from '../komponenten/Symbole.jsx';

export default function CommunitySammlung({ route, name }) {
  const [typ, setTyp] = useState('');
  const [suche, setSuche] = useState('');
  const [daten, setDaten] = useState(null);
  const [fehler, setFehler] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api.communitySammlung(name, { typ, q: suche }).then(setDaten).catch((e) => setFehler(e.message));
    }, suche ? 300 : 0);
    return () => clearTimeout(t);
  }, [name, typ, suche]);

  const basis = `/community/${encodeURIComponent(name)}`;
  return (
    <Layout route={route} titel={daten ? `Sammlung von ${daten.sammler.anzeigename}` : 'Sammlung'} zurueck="/community">
      {fehler && <p className="text-gefahr" role="alert">{fehler}</p>}
      {daten && (
        <div className="space-y-3">
          <label className="relative block">
            <span className="sr-only">Sammlung durchsuchen</span>
            <Symbol name="suche" className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-leise" />
            <input type="search" value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Titel oder Plattform …" className="eingabe pl-10" />
          </label>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            <button type="button" className={!typ ? 'chip-aktiv' : 'chip'} onClick={() => setTyp('')}>Alle</button>
            {ARTIKELTYPEN.map((t) => (
              <button key={t.value} type="button" className={typ === t.value ? 'chip-aktiv' : 'chip'} onClick={() => setTyp(t.value)}>
                <Symbol name={t.value} className="size-4" />{t.mehrzahl}
              </button>
            ))}
          </div>
          <p className="text-sm text-leise">{daten.artikel.length} Einträge</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {daten.artikel.map((a) => <ArtikelKarte key={a.id} artikel={a} href={`#${basis}/${a.id}`} />)}
          </div>
        </div>
      )}
    </Layout>
  );
}
