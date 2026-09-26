// „Meine Börse“: eigene Angebote, Wunschliste, Treffer und Tauschvorschläge.
import { useEffect, useState } from 'react';
import { REGIONEN, ZUSTAENDE, beschriftung } from '../../../shared/konstanten.js';
import { MARKE } from '../../../shared/marke.js';
import { api } from '../api.js';
import { euro, datumDe } from '../format.js';
import { useSitzung } from '../sitzung.js';
import Layout from '../komponenten/Layout.jsx';
import Cover from '../komponenten/Cover.jsx';
import Symbol from '../komponenten/Symbole.jsx';
import { useHinweis } from '../komponenten/Hinweise.jsx';
import { AngebotKarte, preisText, statusText } from '../komponenten/BoerseTeile.jsx';

const TABS = [
  ['angebote', 'Meine Angebote'],
  ['wunschliste', 'Wunschliste'],
  ['treffer', 'Treffer'],
  ['tausch', 'Tauschvorschläge'],
];

export default function BoerseMeine({ route }) {
  const tab = TABS.some(([t]) => t === route.parameter.tab) ? route.parameter.tab : 'angebote';
  return (
    <Layout route={route} titel="Meine Börse" zurueck="/boerse">
      <div className="mx-auto max-w-4xl space-y-4 pb-8">
        <nav className="-mx-4 flex gap-2 overflow-x-auto px-4" aria-label="Bereiche">
          {TABS.map(([t, l]) => <a key={t} href={`#/boerse/meine?tab=${t}`} className={tab === t ? 'chip-aktiv' : 'chip'}>{l}</a>)}
        </nav>
        {tab === 'angebote' && <MeineAngebote />}
        {tab === 'wunschliste' && <Wunschliste />}
        {tab === 'treffer' && <Treffer />}
        {tab === 'tausch' && <Tausch />}
      </div>
    </Layout>
  );
}

function MeineAngebote() {
  const zeigeHinweis = useHinweis();
  const { benutzer } = useSitzung();
  const [daten, setDaten] = useState(null);
  const [zeigeAlte, setZeigeAlte] = useState(false);
  const laden = () => api.meineAngebote().then(setDaten).catch((e) => zeigeHinweis(e.message, 'fehler'));
  useEffect(() => { laden(); }, []);
  if (!daten) return <p className="text-leise">Wird geladen …</p>;

  const aktiv = daten.angebote.filter((a) => ['aktiv', 'reserviert'].includes(a.status));
  const alte = daten.angebote.filter((a) => !['aktiv', 'reserviert'].includes(a.status));
  const verlaengern = async (a) => {
    try { await api.angebotAendern(a.id, a.status === 'aktiv' || a.status === 'reserviert' ? { verlaengern: true } : { status: 'aktiv' }); zeigeHinweis('Angebot verlängert.'); laden(); } catch (e) { zeigeHinweis(e.message, 'fehler'); }
  };

  return (
    <>
      <div className="karte flex flex-wrap items-center gap-3 p-3 text-sm">
        <span><strong>{daten.aktive}</strong> von {daten.limit.toLocaleString('de-DE')} aktiven Angeboten</span>
        <span className="flex-1" />
        <a className="knopf-sekundaer px-3 py-1.5" href="#/boerse/haendler"><Symbol name="laden" className="size-4" />Händler & Massen-Upload</a>
        <a className="knopf-sekundaer px-3 py-1.5" href="/api/boerse/meine.csv" download><Symbol name="herunterladen" className="size-4" />CSV</a>
      </div>
      <p className="text-sm text-leise">
        Neues Angebot: Öffne ein Spiel in deiner <a className="underline" href="#/">Sammlung</a> oder im <a className="underline" href="#/katalog">Katalog</a> und tippe auf „Anbieten“.
      </p>
      {aktiv.length === 0 ? <p className="karte p-6 text-center text-leise">Du hast gerade keine aktiven Angebote.</p> : (
        <div className="space-y-2">{aktiv.map((a) => <MeinAngebot key={a.id} angebot={a} onVerlaengern={() => verlaengern(a)} />)}</div>
      )}
      {alte.length > 0 && (
        <div className="space-y-2">
          <button type="button" className="text-sm text-leise underline" onClick={() => setZeigeAlte(!zeigeAlte)}>
            {zeigeAlte ? 'Beendete ausblenden' : `Beendete, verkaufte und abgelaufene anzeigen (${alte.length})`}
          </button>
          {zeigeAlte && alte.map((a) => <MeinAngebot key={a.id} angebot={a} onVerlaengern={a.status === 'entfernt' ? null : () => verlaengern(a)} />)}
        </div>
      )}
      {benutzer && !daten.plz && <PlzHinweis onGespeichert={laden} />}
    </>
  );
}

function MeinAngebot({ angebot: a, onVerlaengern }) {
  const bald = ['aktiv', 'reserviert'].includes(a.status) && Date.parse(`${a.laeuft_ab.replace(' ', 'T')}Z`) - Date.now() < 7 * 86_400_000;
  return (
    <div className="karte flex items-center gap-3 p-3">
      <Cover url={a.cover_url} typ={a.typ} alt="" className="aspect-[3/4] w-10 shrink-0 rounded" />
      <a href={`#/boerse/angebot/${a.id}`} className="min-w-0 flex-1 hover:underline">
        <span className="block truncate font-semibold">{a.titel}</span>
        <span className="block text-xs text-leise">
          {preisText(a)} · {statusText(a.status)}{['aktiv', 'reserviert'].includes(a.status) ? ` bis ${datumDe(a.laeuft_ab)}` : ''}
          {a.anfragen > 0 && ` · ${a.anfragen} ${a.anfragen === 1 ? 'Anfrage' : 'Anfragen'}`}
          {a.gesucht_von > 0 && ` · ${a.gesucht_von} suchen das`}
          {a.sku && ` · ${a.sku}`}
        </span>
      </a>
      {onVerlaengern && (bald || !['aktiv', 'reserviert'].includes(a.status)) && (
        <button type="button" className="knopf-sekundaer shrink-0 px-3 py-1.5 text-xs" onClick={onVerlaengern}>
          {['aktiv', 'reserviert'].includes(a.status) ? 'Verlängern' : 'Wieder einstellen'}
        </button>
      )}
    </div>
  );
}

function PlzHinweis({ onGespeichert }) {
  const zeigeHinweis = useHinweis();
  const [plz, setPlz] = useState('');
  return (
    <form className="karte flex flex-wrap items-end gap-2 p-3 text-sm" onSubmit={async (e) => {
      e.preventDefault();
      try { await api.boersePlz(plz); zeigeHinweis('Gespeichert.'); onGespeichert(); } catch (err) { zeigeHinweis(Object.values(err.felder ?? {})[0] ?? err.message, 'fehler'); }
    }}>
      <label className="block flex-1"><span className="beschriftung">Standard-PLZ-Bereich für deine Angebote (nur zwei Ziffern werden gespeichert)</span>
        <input className="eingabe" inputMode="numeric" maxLength={5} value={plz} onChange={(e) => setPlz(e.target.value)} placeholder="z. B. 40" /></label>
      <button type="submit" className="knopf-sekundaer">Speichern</button>
    </form>
  );
}

function Wunschliste() {
  const zeigeHinweis = useHinweis();
  const [liste, setListe] = useState(null);
  const laden = () => api.wunschliste().then(setListe).catch((e) => zeigeHinweis(e.message, 'fehler'));
  useEffect(() => { laden(); }, []);
  if (!liste) return <p className="text-leise">Wird geladen …</p>;
  if (!liste.length) {
    return <p className="karte p-6 text-center text-leise">Deine Wunschliste ist leer. Öffne ein Spiel im <a className="underline" href="#/katalog">Katalog</a> und tippe auf „Auf die Wunschliste“.</p>;
  }
  return (
    <ul className="space-y-2">
      {liste.map((w) => (
        <li key={w.id} className="karte flex items-center gap-3 p-3">
          <Cover url={w.cover_url} typ={w.typ} alt="" className="aspect-[3/4] w-10 shrink-0 rounded" />
          <a href={`#/katalog/${w.katalog_id}`} className="min-w-0 flex-1 hover:underline">
            <span className="block truncate font-semibold">{w.titel}</span>
            <span className="block text-xs text-leise">
              {[w.plattform, beschriftung(REGIONEN, w.region, 'kurz'), w.min_zustand && `ab ${beschriftung(ZUSTAENDE, w.min_zustand)}`, w.nur_cib && 'nur CIB', w.max_preis != null && `bis ${euro(w.max_preis)}`].filter(Boolean).join(' · ') || 'Keine Bedingungen'}
              {w.notiz && ` · ${w.notiz}`}
            </span>
          </a>
          <div className="shrink-0 text-right text-xs">
            {w.treffer > 0
              ? <a className="font-semibold text-akzent-hell underline" href={`#/boerse?katalog_id=${w.katalog_id}`}>{w.treffer} Treffer{w.guenstigster != null ? ` ab ${euro(w.guenstigster)}` : ''}</a>
              : <span className="text-leise">Noch kein Treffer</span>}
            <button type="button" className="mt-1 block w-full text-right text-leise underline" onClick={async () => { await api.wunschEntfernen(w.katalog_id); laden(); }}>Entfernen</button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Treffer() {
  const [liste, setListe] = useState(null);
  useEffect(() => { api.boerseTreffer().then(setListe).catch(() => setListe([])); }, []);
  if (!liste) return <p className="text-leise">Wird geladen …</p>;
  if (!liste.length) return <p className="karte p-6 text-center text-leise">Noch keine Angebote, die zu deiner Wunschliste passen. Du wirst benachrichtigt, sobald es welche gibt.</p>;
  return <div className="space-y-2">{liste.map((a) => <AngebotKarte key={a.id} angebot={a} />)}</div>;
}

function Tausch() {
  const [liste, setListe] = useState(null);
  useEffect(() => { api.tauschvorschlaege().then(setListe).catch(() => setListe([])); }, []);
  if (!liste) return <p className="text-leise">Wird geladen …</p>;
  if (!liste.length) {
    return (
      <p className="karte p-6 text-center text-leise">
        Noch keine passenden Tauschpartner. Biete Spiele zum Tausch an und pflege deine Wunschliste – dann findet {MARKE.name} Sammler,
        die haben, was du suchst, und suchen, was du hast.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {liste.map((v) => (
        <section key={v.partner.id} className="karte space-y-3 p-4">
          <h3 className="flex flex-wrap items-center gap-2 font-semibold">
            <Symbol name="boerse" className="size-5 text-akzent-hell" />Perfekter Tausch mit <a className="hover:underline" href={`#/boerse/anbieter/${v.partner.id}`}>{v.partner.name}</a>
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2"><p className="text-xs font-semibold text-leise">Du bekommst</p>{v.du_bekommst.map((a) => <AngebotKarte key={a.id} angebot={a} />)}</div>
            <div className="space-y-2"><p className="text-xs font-semibold text-leise">Du gibst</p>{v.du_gibst.map((a) => <AngebotKarte key={a.id} angebot={a} />)}</div>
          </div>
        </section>
      ))}
    </div>
  );
}
