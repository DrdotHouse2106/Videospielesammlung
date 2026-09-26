// Tauschbörse: aktuelle Angebote mit Filtern und die meistgesuchten Spiele.
import { useEffect, useState } from 'react';
import { ARTIKELTYPEN, REGIONEN, ZUSTAENDE } from '../../../shared/konstanten.js';
import { api } from '../api.js';
import { euro, anzahl } from '../format.js';
import { navigiere } from '../router.js';
import Layout from '../komponenten/Layout.jsx';
import Cover from '../komponenten/Cover.jsx';
import Symbol from '../komponenten/Symbole.jsx';
import { AngebotKarte } from '../komponenten/BoerseTeile.jsx';

const FILTER = ['q', 'plattform_id', 'typ', 'art', 'region', 'zustand', 'cib', 'max_preis', 'versand', 'plz', 'anbieter', 'sortierung', 'katalog_id'];

export default function Boerse({ route }) {
  const tab = route.parameter.tab === 'gesucht' ? 'gesucht' : 'angebote';
  const [plattformen, setPlattformen] = useState([]);
  useEffect(() => { api.plattformenAlle().then((p) => setPlattformen(p.plattformen ?? p)).catch(() => {}); }, []);

  return (
    <Layout route={route} titel="Tauschbörse">
      <div className="mx-auto max-w-4xl space-y-4 pb-8">
        <div className="flex flex-wrap items-center gap-2">
          <a href="#/boerse" className={tab === 'angebote' ? 'chip-aktiv' : 'chip'}>Angebote</a>
          <a href="#/boerse?tab=gesucht" className={tab === 'gesucht' ? 'chip-aktiv' : 'chip'}>Meistgesucht</a>
          <span className="flex-1" />
          <a href="#/boerse/meine" className="knopf-sekundaer px-3 py-1.5 text-sm"><Symbol name="herz" className="size-4" />Meine Börse</a>
        </div>
        {tab === 'angebote' ? <Angebote route={route} plattformen={plattformen} /> : <Gesucht route={route} plattformen={plattformen} />}
        <p className="text-xs text-leise">
          Die Tauschbörse bringt Sammler zusammen – Kauf, Bezahlung und Versand vereinbart ihr direkt miteinander.
          Nutze sichere Zahlungswege (z. B. mit Käuferschutz) und melde verdächtige Angebote.
        </p>
      </div>
    </Layout>
  );
}

function Angebote({ route, plattformen }) {
  const p = route.parameter;
  const [daten, setDaten] = useState(null);
  const [fehler, setFehler] = useState(null);
  const [q, setQ] = useState(p.q ?? '');
  const [mehr, setMehr] = useState(Boolean(p.region || p.zustand || p.cib || p.max_preis || p.plz || p.anbieter || p.versand));

  const filter = Object.fromEntries(FILTER.map((f) => [f, p[f]]).filter(([, w]) => w));
  const schluessel = JSON.stringify({ ...filter, seite: p.seite });
  useEffect(() => {
    setDaten(null);
    api.angebote({ ...filter, seite: p.seite }).then(setDaten).catch((e) => setFehler(e.message));
  }, [schluessel]);

  const setze = (feld, wert) => navigiere('/boerse', { ...filter, [feld]: wert || undefined });

  return (
    <>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setze('q', q.trim()); }}>
        <input className="eingabe" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Titel suchen …" aria-label="Titel suchen" />
        <button type="submit" className="knopf-primaer" aria-label="Suchen"><Symbol name="suche" className="size-4" /></button>
      </form>
      <div className="flex flex-wrap gap-2">
        <select className="eingabe w-auto" value={p.plattform_id ?? ''} onChange={(e) => setze('plattform_id', e.target.value)} aria-label="Plattform">
          <option value="">Alle Plattformen</option>
          {plattformen.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <select className="eingabe w-auto" value={p.art ?? ''} onChange={(e) => setze('art', e.target.value)} aria-label="Angebotsart">
          <option value="">Kaufen & Tauschen</option>
          <option value="verkauf">Nur Kaufen</option>
          <option value="tausch">Nur Tauschen</option>
        </select>
        <select className="eingabe w-auto" value={p.sortierung ?? ''} onChange={(e) => setze('sortierung', e.target.value)} aria-label="Sortierung">
          <option value="">Neueste zuerst</option>
          <option value="preis_auf">Preis aufsteigend</option>
          <option value="preis_ab">Preis absteigend</option>
          <option value="titel">Titel A–Z</option>
        </select>
        <button type="button" className="chip" onClick={() => setMehr(!mehr)}><Symbol name="filter" className="size-4" />Weitere Filter</button>
      </div>
      {mehr && (
        <div className="karte grid grid-cols-2 gap-3 p-3 sm:grid-cols-4">
          <label className="block"><span className="beschriftung">Typ</span>
            <select className="eingabe" value={p.typ ?? ''} onChange={(e) => setze('typ', e.target.value)}>
              <option value="">Alle</option>{ARTIKELTYPEN.map((t) => <option key={t.value} value={t.value}>{t.mehrzahl}</option>)}
            </select></label>
          <label className="block"><span className="beschriftung">Region</span>
            <select className="eingabe" value={p.region ?? ''} onChange={(e) => setze('region', e.target.value)}>
              <option value="">Alle</option>{REGIONEN.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select></label>
          <label className="block"><span className="beschriftung">Mindestens</span>
            <select className="eingabe" value={p.zustand ?? ''} onChange={(e) => setze('zustand', e.target.value)}>
              <option value="">Jeder Zustand</option>{ZUSTAENDE.map((z) => <option key={z.value} value={z.value}>{z.label}</option>)}
            </select></label>
          <label className="block"><span className="beschriftung">Anbieter</span>
            <select className="eingabe" value={p.anbieter ?? ''} onChange={(e) => setze('anbieter', e.target.value)}>
              <option value="">Alle</option><option value="privat">Privat</option><option value="gewerblich">Händler</option>
            </select></label>
          <label className="block"><span className="beschriftung">Höchstpreis (€)</span>
            <input className="eingabe" inputMode="decimal" defaultValue={p.max_preis ?? ''} onBlur={(e) => setze('max_preis', e.target.value.trim())} /></label>
          <label className="block"><span className="beschriftung">Abholung im PLZ-Bereich</span>
            <input className="eingabe" inputMode="numeric" maxLength={2} defaultValue={p.plz ?? ''} placeholder="z. B. 40" onBlur={(e) => setze('plz', e.target.value.trim())} /></label>
          <label className="flex items-center gap-2 self-end pb-3 text-sm"><input type="checkbox" checked={p.cib === '1'} onChange={(e) => setze('cib', e.target.checked ? '1' : '')} />Nur CIB</label>
          <label className="flex items-center gap-2 self-end pb-3 text-sm"><input type="checkbox" checked={p.versand === '1'} onChange={(e) => setze('versand', e.target.checked ? '1' : '')} />Mit Versand</label>
        </div>
      )}
      {p.katalog_id && <p className="text-sm">Angebote zu einem Spiel · <a className="text-akzent-hell underline" href="#/boerse">Filter entfernen</a></p>}

      {fehler && <p className="text-gefahr" role="alert">{fehler}</p>}
      {!daten ? <p className="text-leise">Wird geladen …</p> : daten.eintraege.length === 0 ? (
        <div className="karte space-y-2 p-6 text-center text-leise">
          <p>Keine passenden Angebote.</p>
          <p className="text-sm">Setze gesuchte Spiele auf deine Wunschliste – dann wirst du benachrichtigt, sobald jemand sie anbietet.</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-leise">{anzahl(daten.gesamt)} {daten.gesamt === 1 ? 'Angebot' : 'Angebote'}</p>
          <div className="space-y-2">{daten.eintraege.map((a) => <AngebotKarte key={a.id} angebot={a} />)}</div>
          {daten.seiten > 1 && (
            <nav className="flex items-center justify-center gap-2" aria-label="Seiten">
              <button type="button" className="knopf-sekundaer px-3 py-1.5" disabled={daten.seite <= 1} onClick={() => navigiere('/boerse', { ...filter, seite: daten.seite - 1 })}>Zurück</button>
              <span className="text-sm text-leise">Seite {daten.seite} von {daten.seiten}</span>
              <button type="button" className="knopf-sekundaer px-3 py-1.5" disabled={daten.seite >= daten.seiten} onClick={() => navigiere('/boerse', { ...filter, seite: daten.seite + 1 })}>Weiter</button>
            </nav>
          )}
        </>
      )}
    </>
  );
}

function Gesucht({ route, plattformen }) {
  const p = route.parameter;
  const [daten, setDaten] = useState(null);
  const filter = { plattform_id: p.plattform_id, typ: p.typ, ohne_angebot: p.ohne_angebot };
  useEffect(() => { setDaten(null); api.nachfrage(filter).then(setDaten).catch(() => setDaten({ eintraege: [] })); }, [JSON.stringify(filter)]);
  const setze = (feld, wert) => navigiere('/boerse', { tab: 'gesucht', ...filter, [feld]: wert || undefined });

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <select className="eingabe w-auto" value={p.plattform_id ?? ''} onChange={(e) => setze('plattform_id', e.target.value)} aria-label="Plattform">
          <option value="">Alle Plattformen</option>
          {plattformen.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        {daten?.voll && (
          <label className="chip cursor-pointer"><input type="checkbox" checked={p.ohne_angebot === '1'} onChange={(e) => setze('ohne_angebot', e.target.checked ? '1' : '')} />Nur ohne Angebot</label>
        )}
      </div>
      {daten && !daten.voll && (
        <p className="text-xs text-leise">Die 30 meistgesuchten Einträge. Händler mit Pro-Paket sehen die vollständige Auswertung mit Preisbereitschaft.</p>
      )}
      {!daten ? <p className="text-leise">Wird geladen …</p> : daten.eintraege.length === 0 ? (
        <p className="karte p-6 text-center text-leise">Noch stehen keine Spiele auf Wunschlisten.</p>
      ) : (
        <ol className="karte divide-y divide-rand">
          {daten.eintraege.map((e, i) => (
            <li key={e.katalog_id}>
              <a href={`#/katalog/${e.katalog_id}`} className="flex items-center gap-3 p-3 hover:bg-karte-hover">
                <span className="w-6 text-right text-sm text-leise tabular-nums">{i + 1}</span>
                <Cover url={e.cover_url} typ={e.typ} alt="" className="aspect-[3/4] w-10 shrink-0 rounded" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{e.titel}</span>
                  <span className="block text-xs text-leise">
                    {e.angebote ? `${e.angebote} ${e.angebote === 1 ? 'Angebot' : 'Angebote'}${e.ab_preis != null ? ` ab ${euro(e.ab_preis)}` : ''}` : 'Kein Angebot'}
                    {daten.voll && e.max_preis_schnitt != null && ` · Preisbereitschaft Ø ${euro(e.max_preis_schnitt)}, bis ${euro(e.max_preis_hoechst)}`}
                    {daten.voll && e.nur_cib > 0 && ` · ${e.nur_cib}× nur CIB`}
                  </span>
                </span>
                <span className="shrink-0 text-right text-sm"><strong>{e.suchende}</strong><span className="block text-xs text-leise">suchen</span></span>
              </a>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
