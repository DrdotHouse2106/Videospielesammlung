import { useEffect, useId, useMemo, useState } from 'react';
import {
  ARTIKELTYPEN, ZUSTAENDE, VOLLSTAENDIGKEITEN, REGIONEN, PLATTFORMEN,
} from '../../../shared/konstanten.js';
import { api, ApiFehler } from '../api.js';
import { navigiere } from '../router.js';
import { preisFeld } from '../format.js';
import Layout from '../komponenten/Layout.jsx';
import Cover from '../komponenten/Cover.jsx';
import Symbol from '../komponenten/Symbole.jsx';
import BarcodeScanner from '../komponenten/BarcodeScanner.jsx';
import { useHinweis } from '../komponenten/Hinweise.jsx';

const FARBVORSCHLAEGE = [
  'Schwarz', 'Weiß', 'Grau', 'Silber', 'Clear', 'Clear Red', 'Clear Blue', 'Clear Green', 'Atomic Purple',
  'Jungle Green', 'Fire Orange', 'Ice Blue', 'Indigo', 'Platinum', 'Orange', 'Pikachu Edition', 'Crystal', 'Neon Rot/Blau',
];

const LEER = {
  typ: 'spiel', titel: '', plattform: '', katalog_id: null, barcode: '', cover_url: '', zustand: '', vollstaendigkeit: '',
  region: 'pal_de', farbe: '', edition: '', modellnummer: '', seriennummer: '', notizen: '', kaufpreis: '', kaufdatum: '', anzahl: 1,
  marktwert: '',
};

export default function ArtikelFormular({ route, artikelId }) {
  const p = route.parameter;
  const zeigeHinweis = useHinweis();
  const bearbeiten = Boolean(artikelId);
  const [werte, setWerte] = useState(null);
  const [katalogEintrag, setKatalogEintrag] = useState(null);
  const [inKatalogSpeichern, setInKatalogSpeichern] = useState(true);
  const [fehler, setFehler] = useState({});
  const [allgemeinerFehler, setAllgemeinerFehler] = useState(null);
  const [speichert, setSpeichert] = useState(false);
  const [bildDatei, setBildDatei] = useState(null);
  const [scannerOffen, setScannerOffen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        if (bearbeiten) {
          const a = await api.artikel(artikelId);
          setWerte({ ...LEER, ...Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v ?? ''])), kaufpreis: preisFeld(a.kaufpreis), marktwert: preisFeld(a.marktwert), katalog_id: a.katalog_id });
          if (a.katalog_id) setKatalogEintrag(await api.katalogEintrag(a.katalog_id).catch(() => null));
          return;
        }
        const basis = { ...LEER, typ: p.typ ?? 'spiel', titel: p.titel ?? '', barcode: p.barcode ?? '' };
        if (p.katalog) {
          const eintrag = await api.katalogEintrag(p.katalog);
          setKatalogEintrag(eintrag);
          Object.assign(basis, {
            typ: eintrag.typ,
            titel: eintrag.titel,
            katalog_id: eintrag.id,
            cover_url: eintrag.cover_url ?? '',
            plattform: eintrag.typ === 'konsole' ? eintrag.titel : eintrag.plattformen.length === 1 ? eintrag.plattformen[0] : '',
          });
        }
        setWerte(basis);
      } catch (e) {
        setAllgemeinerFehler(e.message);
      }
    })();
  }, [artikelId, p.katalog]); // Formular nur beim Wechsel des Artikels neu laden

  const bildVorschau = useMemo(() => (bildDatei ? URL.createObjectURL(bildDatei) : null), [bildDatei]);
  useEffect(() => () => bildVorschau && URL.revokeObjectURL(bildVorschau), [bildVorschau]);

  if (!werte) {
    return (
      <Layout route={route} titel={bearbeiten ? 'Artikel bearbeiten' : 'Neuer Artikel'} zurueck>
        {allgemeinerFehler ? <p className="text-gefahr" role="alert">{allgemeinerFehler}</p> : <p className="text-leise">Wird geladen …</p>}
      </Layout>
    );
  }

  const setze = (feld) => (e) => {
    const wert = e?.target ? e.target.value : e;
    setWerte((w) => ({ ...w, [feld]: wert }));
    if (fehler[feld]) setFehler((f) => ({ ...f, [feld]: undefined }));
  };

  const plattformVorschlaege = [...new Set([...(katalogEintrag?.plattformen ?? []), ...PLATTFORMEN])];

  async function speichern(e) {
    e.preventDefault();
    if (!werte.titel.trim()) {
      setFehler({ titel: 'Bitte einen Titel bzw. eine Bezeichnung angeben.' });
      return;
    }
    setSpeichert(true);
    setAllgemeinerFehler(null);
    try {
      const daten = { ...werte };
      delete daten.bild_url;
      // Eigener Eintrag → zusätzlich im lokalen Katalog ablegen, damit er später
      // per Suche und Barcode-Scan wiedergefunden wird.
      if (!bearbeiten && !daten.katalog_id && inKatalogSpeichern) {
        const eintrag = await api.katalogAnlegen({
          typ: daten.typ, titel: daten.titel, plattformen: daten.plattform ? [daten.plattform] : [], cover_url: daten.cover_url,
        });
        daten.katalog_id = eintrag.id;
      }
      const felder = Object.keys(LEER);
      const nutzdaten = Object.fromEntries(felder.map((f) => [f, daten[f]]));
      let artikel = bearbeiten ? await api.artikelAendern(artikelId, nutzdaten) : await api.artikelAnlegen(nutzdaten);
      if (bildDatei) {
        try {
          artikel = await api.bildHochladen(artikel.id, bildDatei);
        } catch (bildFehler) {
          zeigeHinweis(`Gespeichert, aber das Foto konnte nicht hochgeladen werden: ${bildFehler.message}`, 'fehler');
        }
      }
      zeigeHinweis(bearbeiten ? 'Änderungen gespeichert.' : `„${artikel.titel}“ wurde zur Sammlung hinzugefügt.`);
      navigiere(`/artikel/${artikel.id}`);
    } catch (fehlerObjekt) {
      if (fehlerObjekt instanceof ApiFehler && Object.keys(fehlerObjekt.felder).length) setFehler(fehlerObjekt.felder);
      setAllgemeinerFehler(fehlerObjekt.message);
      setSpeichert(false);
    }
  }

  const vorschauUrl = bildVorschau ?? werte.bild_url ?? werte.cover_url;

  return (
    <Layout route={route} titel={bearbeiten ? 'Artikel bearbeiten' : 'Neuer Artikel'} zurueck>
      <form onSubmit={speichern} className="mx-auto max-w-3xl space-y-4 pb-8" noValidate>
        <div className="karte flex gap-4 p-4">
          <Cover url={vorschauUrl} typ={werte.typ} alt="" className="h-32 w-24 shrink-0 rounded-xl" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {katalogEintrag ? (
              <>
                <p className="text-xs font-semibold tracking-wide text-leise uppercase">
                  {katalogEintrag.quelle === 'igdb' ? 'Aus IGDB übernommen' : 'Aus deinem Katalog'}
                </p>
                <p className="line-clamp-2 font-semibold">{katalogEintrag.titel}</p>
                <p className="text-xs text-leise">{[katalogEintrag.erscheinungsjahr, katalogEintrag.hersteller].filter(Boolean).join(' · ')}</p>
              </>
            ) : (
              <p className="text-sm text-leise">Eigener Eintrag – alle Angaben frei wählbar.</p>
            )}
            <label className="knopf-sekundaer mt-auto w-fit cursor-pointer px-3 py-1.5">
              <Symbol name="kamera" className="size-4" />
              {bildDatei || werte.bild_datei ? 'Anderes Foto' : 'Eigenes Foto'}
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only"
                onChange={(e) => setBildDatei(e.target.files?.[0] ?? null)} />
            </label>
          </div>
        </div>

        <Abschnitt titel="Grunddaten">
          <Feld label="Artikeltyp" fehler={fehler.typ} breit>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Artikeltyp">
              {ARTIKELTYPEN.map((t) => (
                <button key={t.value} type="button" role="radio" aria-checked={werte.typ === t.value}
                  onClick={() => setze('typ')(t.value)}
                  className={`${werte.typ === t.value ? 'chip-aktiv' : 'chip'} justify-center rounded-xl py-2`}>
                  <Symbol name={t.value} className="size-4" />{t.label}
                </button>
              ))}
            </div>
          </Feld>
          <Feld label="Titel / Bezeichnung *" fehler={fehler.titel} breit>
            {(id) => <input id={id} className="eingabe" value={werte.titel} onChange={setze('titel')} required maxLength={200}
              placeholder={werte.typ === 'spiel' ? 'z. B. The Legend of Zelda: Ocarina of Time' : werte.typ === 'konsole' ? 'z. B. Nintendo 64' : 'z. B. Controller Pak'} />}
          </Feld>
          <Feld label="Plattform / System" fehler={fehler.plattform}>
            {(id) => (
              <>
                <input id={id} className="eingabe" value={werte.plattform} onChange={setze('plattform')} list="plattformen" placeholder="z. B. Nintendo 64" />
                <datalist id="plattformen">{plattformVorschlaege.map((pl) => <option key={pl} value={pl} />)}</datalist>
              </>
            )}
          </Feld>
          <Feld label="Region" fehler={fehler.region}>
            {(id) => <Auswahl id={id} wert={werte.region} onChange={setze('region')} optionen={REGIONEN} />}
          </Feld>
          <Feld label="Zustand" fehler={fehler.zustand}>
            {(id) => <Auswahl id={id} wert={werte.zustand} onChange={setze('zustand')} optionen={ZUSTAENDE} />}
          </Feld>
          <Feld label="Vollständigkeit" fehler={fehler.vollstaendigkeit}>
            {(id) => <Auswahl id={id} wert={werte.vollstaendigkeit} onChange={setze('vollstaendigkeit')} optionen={VOLLSTAENDIGKEITEN} />}
          </Feld>
          {werte.zustand && (
            <p className="-mt-1 text-xs text-leise sm:col-span-2">{ZUSTAENDE.find((z) => z.value === werte.zustand)?.beschreibung}</p>
          )}
        </Abschnitt>

        <Abschnitt titel="Variante" hinweis="Sonderfarben, Editionen und Modellrevisionen unterscheiden">
          <Feld label="Farbe / Sonderfarbe" fehler={fehler.farbe}>
            {(id) => (
              <>
                <input id={id} className="eingabe" value={werte.farbe} onChange={setze('farbe')} list="farben" placeholder="z. B. Atomic Purple" />
                <datalist id="farben">{FARBVORSCHLAEGE.map((f) => <option key={f} value={f} />)}</datalist>
              </>
            )}
          </Feld>
          <Feld label="Edition / Variante" fehler={fehler.edition}>
            {(id) => <input id={id} className="eingabe" value={werte.edition} onChange={setze('edition')} placeholder="z. B. Zelda 25th Anniversary" />}
          </Feld>
          <Feld label="Modellnummer" fehler={fehler.modellnummer}>
            {(id) => <input id={id} className="eingabe" value={werte.modellnummer} onChange={setze('modellnummer')} placeholder="z. B. SCPH-1002, HEG-001 (OLED)" />}
          </Feld>
          <Feld label="Seriennummer" fehler={fehler.seriennummer}>
            {(id) => <input id={id} className="eingabe" value={werte.seriennummer} onChange={setze('seriennummer')} autoComplete="off" />}
          </Feld>
        </Abschnitt>

        <Abschnitt titel="Kauf & Details">
          <Feld label="Kaufpreis (€)" fehler={fehler.kaufpreis}>
            {(id) => <input id={id} className="eingabe" value={werte.kaufpreis} onChange={setze('kaufpreis')} inputMode="decimal" placeholder="z. B. 49,99" />}
          </Feld>
          <Feld label="Kaufdatum" fehler={fehler.kaufdatum}>
            {(id) => <input id={id} type="date" className="eingabe" value={werte.kaufdatum} onChange={setze('kaufdatum')} />}
          </Feld>
          <Feld label="Marktwert (€, eigene Schätzung)" fehler={fehler.marktwert}>
            {(id) => <input id={id} className="eingabe" value={werte.marktwert} onChange={setze('marktwert')} inputMode="decimal" placeholder="optional, pro Stück" />}
          </Feld>
          <Feld label="Barcode (EAN/UPC)" fehler={fehler.barcode}>
            {(id) => (
              <div className="flex gap-2">
                <input id={id} className="eingabe font-mono" value={werte.barcode} onChange={setze('barcode')} inputMode="numeric" autoComplete="off" />
                <button type="button" className="knopf-sekundaer px-3" onClick={() => setScannerOffen(true)} aria-label="Barcode scannen">
                  <Symbol name="scan" />
                </button>
              </div>
            )}
          </Feld>
          <Feld label="Anzahl" fehler={fehler.anzahl}>
            {(id) => <input id={id} type="number" min="1" max="9999" className="eingabe" value={werte.anzahl} onChange={setze('anzahl')} />}
          </Feld>
          <Feld label="Eigene Notizen" fehler={fehler.notizen} breit>
            {(id) => <textarea id={id} rows={4} className="eingabe" value={werte.notizen} onChange={setze('notizen')}
              placeholder="z. B. Modul mit Aufkleber-Kratzer, gekauft auf dem Flohmarkt …" />}
          </Feld>
          <details className="sm:col-span-2">
            <summary className="cursor-pointer text-sm text-leise">Coverbild-Adresse (optional)</summary>
            <input className="eingabe mt-2" value={werte.cover_url} onChange={setze('cover_url')} placeholder="https://…" inputMode="url" />
            {fehler.cover_url && <p className="mt-1 text-sm text-gefahr">{fehler.cover_url}</p>}
          </details>
        </Abschnitt>

        {!bearbeiten && !werte.katalog_id && (
          <label className="flex items-start gap-3 rounded-xl border border-rand p-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-akzent" checked={inKatalogSpeichern} onChange={(e) => setInKatalogSpeichern(e.target.checked)} />
            <span>
              <strong>Im eigenen Katalog speichern</strong>
              <span className="block text-leise">Der Eintrag erscheint künftig in der Suche und wird beim erneuten Scannen des Barcodes sofort erkannt.</span>
            </span>
          </label>
        )}

        {allgemeinerFehler && <p className="rounded-xl bg-gefahr/10 p-3 text-sm text-gefahr" role="alert">{allgemeinerFehler}</p>}

        <div className="unten-sicher sticky bottom-16 z-20 -mx-4 flex gap-2 border-t border-rand/60 bg-flaeche/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:px-0">
          <button type="button" className="knopf-sekundaer flex-1 md:flex-none" onClick={() => window.history.back()}>Abbrechen</button>
          <button type="submit" className="knopf-primaer flex-[2] md:flex-none" disabled={speichert}>
            <Symbol name="haken" className="size-4" />
            {speichert ? 'Wird gespeichert …' : bearbeiten ? 'Speichern' : 'Hinzufügen'}
          </button>
        </div>
      </form>

      {scannerOffen && (
        <BarcodeScanner
          onErkannt={(code) => { setze('barcode')(code); setScannerOffen(false); }}
          onSchliessen={() => setScannerOffen(false)}
        />
      )}
    </Layout>
  );
}

function Abschnitt({ titel, hinweis, children }) {
  return (
    <fieldset className="karte grid gap-4 p-4 sm:grid-cols-2">
      <legend className="float-left mb-0 w-full sm:col-span-2">
        <span className="font-semibold">{titel}</span>
        {hinweis && <span className="block text-xs text-leise">{hinweis}</span>}
      </legend>
      {children}
    </fieldset>
  );
}

function Feld({ label, fehler, breit, children }) {
  const id = useId();
  const inhalt = typeof children === 'function' ? children(id) : children;
  return (
    <div className={breit ? 'sm:col-span-2' : ''}>
      {typeof children === 'function' ? <label htmlFor={id} className="beschriftung">{label}</label> : <span className="beschriftung">{label}</span>}
      {inhalt}
      {fehler && <p className="mt-1 text-sm text-gefahr" role="alert">{fehler}</p>}
    </div>
  );
}

function Auswahl({ id, wert, onChange, optionen }) {
  return (
    <select id={id} className="eingabe" value={wert ?? ''} onChange={onChange}>
      <option value="">– keine Angabe –</option>
      {optionen.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
