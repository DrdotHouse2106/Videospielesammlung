// Gewerbliche Anbieter: Anbieterkennzeichnung pflegen und Angebote per CSV-Datei hochladen bzw. synchronisieren.
import { useEffect, useState } from 'react';
import { HAENDLER_FELDER } from '../../../shared/konstanten.js';
import { MARKE } from '../../../shared/marke.js';
import { api } from '../api.js';
import { anzahl } from '../format.js';
import Layout from '../komponenten/Layout.jsx';
import Symbol from '../komponenten/Symbole.jsx';
import { useHinweis } from '../komponenten/Hinweise.jsx';

const ersterFehler = (err) => Object.values(err.felder ?? {})[0] ?? err.message;

async function leseDatei(datei) {
  const puffer = await datei.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(puffer);
  } catch {
    return new TextDecoder('windows-1252').decode(puffer);
  }
}

const VORLAGE = 'Artikelnummer;EAN;ZockDB-ID;Titel;Plattform;Preis;Bestand;Zustand;Vollständigkeit;Region;Beschreibung\r\n'
  + 'SNES-0001;;;Super Mario World;SNES;29,90;3;sehr gut;CIB;PAL;Mit Anleitung\r\n';

export default function Haendler({ route }) {
  const zeigeHinweis = useHinweis();
  const [profil, setProfil] = useState(null);
  const laden = () => api.haendler().then(setProfil).catch((e) => zeigeHinweis(e.message, 'fehler'));
  useEffect(() => { laden(); }, []);

  return (
    <Layout route={route} titel="Händlerbereich" zurueck="/boerse/meine">
      <div className="mx-auto max-w-4xl space-y-4 pb-8">
        {!profil ? <p className="text-leise">Wird geladen …</p> : (
          <>
            <Vorteile profil={profil} />
            <Kennzeichnung profil={profil} onGespeichert={setProfil} />
            {profil.status && <MassenUpload profil={profil} />}
          </>
        )}
      </div>
    </Layout>
  );
}

function Vorteile({ profil }) {
  return (
    <section className="karte space-y-2 p-4 text-sm">
      <h2 className="flex items-center gap-2 font-semibold"><Symbol name="laden" className="size-5 text-akzent-hell" />Als Händler auf {MARKE.name}</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li><strong>Massen-Upload per CSV</strong> – z. B. direkt aus dem Export deines Shops (Shopware, WooCommerce, JTL …) oder einer Tabelle. Mit Artikelnummer wird der Bestand bei jedem Upload abgeglichen.</li>
        <li><strong>Sammler mit passender Wunschliste</strong> werden automatisch über deine Angebote informiert.</li>
        <li><strong>Nachfrage-Auswertung</strong>: Welche Spiele gesucht werden, wie viel Sammler zahlen würden und wofür es noch kein Angebot gibt (für verifizierte Händler).</li>
        <li><strong>Händlerprofil</strong> mit Anbieterkennzeichnung, Link zu deinem Shop und Bewertungen.</li>
        <li>Verifizierte Händler: bis zu {profil.status === 'verifiziert' ? anzahl(profil.limit) : 'mehrere tausend'} aktive Angebote.</li>
      </ul>
      <p className="text-xs text-leise">
        Status: {profil.status === 'verifiziert' ? '✓ Verifizierter Händler' : profil.status === 'angemeldet' ? 'Als Händler angemeldet – die Verifizierung durch den Betreiber steht noch aus.' : 'Privat'}
        {' · '}{anzahl(profil.aktive_angebote)} von {anzahl(profil.limit)} aktiven Angeboten
      </p>
    </section>
  );
}

function Kennzeichnung({ profil, onGespeichert }) {
  const zeigeHinweis = useHinweis();
  const [offen, setOffen] = useState(!profil.status);
  const [w, setW] = useState(() => Object.fromEntries(HAENDLER_FELDER.map(({ feld }) => [feld, profil.daten?.[feld] ?? ''])));
  const [felderFehler, setFelderFehler] = useState({});
  const [bestaetigt, setBestaetigt] = useState(Boolean(profil.status));

  async function speichern(e) {
    e.preventDefault();
    setFelderFehler({});
    try {
      const neu = await api.haendlerSpeichern(w);
      zeigeHinweis(neu.status === 'verifiziert' ? 'Gespeichert.' : 'Gespeichert. Der Betreiber prüft deine Angaben und verifiziert dein Konto.');
      onGespeichert(neu);
      setOffen(false);
    } catch (err) {
      setFelderFehler(err.felder ?? {});
      zeigeHinweis(ersterFehler(err), 'fehler');
    }
  }

  async function privat() {
    if (!window.confirm('Wieder als privater Anbieter auftreten? Die Anbieterkennzeichnung wird gelöscht und der Massen-Upload ist nicht mehr möglich.')) return;
    try { onGespeichert(await api.haendlerSpeichern({ privat: true })); zeigeHinweis('Du trittst wieder privat auf.'); } catch (err) { zeigeHinweis(err.message, 'fehler'); }
  }

  if (!offen) {
    return (
      <section className="karte flex flex-wrap items-center gap-2 p-4 text-sm">
        <span className="flex-1"><strong>{profil.daten?.firma}</strong> · {profil.daten?.email}</span>
        <button type="button" className="knopf-sekundaer px-3 py-1.5" onClick={() => setOffen(true)}>Anbieterkennzeichnung bearbeiten</button>
        <button type="button" className="text-xs text-leise underline" onClick={privat}>Wieder privat</button>
      </section>
    );
  }

  return (
    <form onSubmit={speichern} className="karte space-y-3 p-4">
      <h2 className="font-semibold">Anbieterkennzeichnung</h2>
      <p className="text-sm text-leise">
        Wer gewerblich verkauft, muss sich als Händler zu erkennen geben und Name, Anschrift und Kontakt angeben. Diese Angaben
        erscheinen bei deinen Angeboten. Änderungen an Firma oder Anschrift müssen neu geprüft werden.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {HAENDLER_FELDER.map(({ feld, label, pflicht, mehrzeilig }) => (
          <label key={feld} className={`block ${mehrzeilig ? 'sm:col-span-2' : ''}`}>
            <span className="beschriftung">{label}{pflicht && ' *'}</span>
            {mehrzeilig
              ? <textarea className="eingabe" rows={feld === 'anschrift' ? 2 : 3} value={w[feld]} onChange={(e) => setW({ ...w, [feld]: e.target.value })} />
              : <input className="eingabe" value={w[feld]} onChange={(e) => setW({ ...w, [feld]: e.target.value })}
                  type={feld === 'email' ? 'email' : feld === 'shop_url' ? 'url' : 'text'} placeholder={feld === 'shop_url' ? 'https://' : undefined} />}
            {felderFehler[feld] && <span className="text-xs text-gefahr">{felderFehler[feld]}</span>}
          </label>
        ))}
      </div>
      {!profil.status && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={bestaetigt} onChange={(e) => setBestaetigt(e.target.checked)} />
          <span>Ich verkaufe gewerblich, die Angaben sind richtig, und ich halte die Pflichten gegenüber Verbrauchern ein (u. a. Widerrufsrecht, Gewährleistung, Preisangaben inkl. MwSt.).</span>
        </label>
      )}
      <div className="flex gap-2">
        {profil.status && <button type="button" className="knopf-sekundaer" onClick={() => setOffen(false)}>Abbrechen</button>}
        <button type="submit" className="knopf-primaer" disabled={!bestaetigt}>{profil.status ? 'Speichern' : 'Als Händler anmelden'}</button>
      </div>
    </form>
  );
}

function MassenUpload({ profil }) {
  const zeigeHinweis = useHinweis();
  const [text, setText] = useState(null);
  const [name, setName] = useState('');
  const [analyse, setAnalyse] = useState(null);
  const [zuordnung, setZuordnung] = useState({});
  const [optionen, setOptionen] = useState({ beendeFehlende: false, versand: true, abholung: false, verhandelbar: false, plz_bereich: profil.plz ?? '' });
  const [laeuft, setLaeuft] = useState(false);
  const [ergebnis, setErgebnis] = useState(null);

  async function dateiGewaehlt(e) {
    const datei = e.target.files?.[0];
    e.target.value = '';
    if (!datei) return;
    if (datei.size > 15 * 1024 * 1024) return zeigeHinweis('Die Datei ist größer als 15 MB. Bitte aufteilen.', 'fehler');
    try {
      const inhalt = await leseDatei(datei);
      const a = await api.haendlerImportAnalyse(inhalt);
      setText(inhalt); setName(datei.name); setAnalyse(a); setZuordnung(a.zuordnung); setErgebnis(null);
    } catch (err) {
      zeigeHinweis(ersterFehler(err), 'fehler');
    }
  }

  async function starten() {
    if (optionen.beendeFehlende && !window.confirm('Alle deine Angebote mit Artikelnummer, die nicht in dieser Datei stehen, werden beendet. Fortfahren?')) return;
    setLaeuft(true);
    try {
      const { beendeFehlende, ...standard } = optionen;
      const r = await api.haendlerImport({ text, zuordnung, beendeFehlende, standard });
      setErgebnis(r);
      zeigeHinweis(`${r.angelegt} angelegt, ${r.aktualisiert} aktualisiert, ${r.beendet} beendet.`);
    } catch (err) {
      zeigeHinweis(ersterFehler(err), 'fehler');
    } finally {
      setLaeuft(false);
    }
  }

  const vorlage = `data:text/csv;charset=utf-8,${encodeURIComponent(`﻿${VORLAGE}`)}`;
  const zugeordnet = zuordnung.titel !== undefined || zuordnung.katalog_id !== undefined || zuordnung.barcode !== undefined;

  return (
    <section className="karte space-y-3 p-4">
      <h2 className="flex items-center gap-2 font-semibold"><Symbol name="hochladen" className="size-5 text-akzent-hell" />Massen-Upload (CSV)</h2>
      <p className="text-sm text-leise">
        Die Spiele werden über die <strong>ZockDB-ID</strong>, den <strong>Barcode (EAN)</strong> oder <strong>Titel + Plattform</strong> dem Katalog zugeordnet.
        Mit einer <strong>Artikelnummer</strong> werden bestehende Angebote aktualisiert statt doppelt angelegt; Bestand 0 beendet ein Angebot.
        Die ZockDB-IDs deiner Angebote stehen im <a className="underline" href="/api/boerse/meine.csv" download>CSV-Export</a>.
      </p>
      <div className="flex flex-wrap gap-2">
        <label className="knopf-primaer w-fit cursor-pointer">
          <Symbol name="hochladen" className="size-4" />CSV-Datei wählen
          <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={dateiGewaehlt} />
        </label>
        <a className="knopf-sekundaer" href={vorlage} download="zockdb-angebote-vorlage.csv"><Symbol name="herunterladen" className="size-4" />Vorlage</a>
      </div>

      {analyse && (
        <div className="space-y-3">
          <p className="text-sm"><strong>{name}</strong> · {anzahl(analyse.zeilen)} Zeilen</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {analyse.felder.map((f) => (
              <label key={f.feld} className="block">
                <span className="beschriftung">{f.titel}</span>
                <select className="eingabe" value={zuordnung[f.feld] ?? ''} onChange={(e) => setZuordnung({ ...zuordnung, [f.feld]: e.target.value === '' ? undefined : Number(e.target.value) })}>
                  <option value="">– nicht vorhanden –</option>
                  {analyse.kopf.map((k, i) => <option key={i} value={i}>{k || `Spalte ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-leise"><tr><th className="p-1">Zeile</th><th className="p-1">Artikelnr.</th><th className="p-1">Titel</th><th className="p-1">Preis</th><th className="p-1">Bestand</th><th className="p-1">Zuordnung</th></tr></thead>
              <tbody>
                {analyse.vorschau.map((z, i) => (
                  <tr key={i} className="border-t border-rand">
                    <td className="p-1">{i + 2}</td><td className="p-1">{z.sku}</td><td className="p-1">{z.titel}</td>
                    <td className="p-1">{z.preis ?? '–'}</td><td className="p-1">{Number.isNaN(z.bestand) ? '?' : z.bestand}</td>
                    <td className={`p-1 ${z.katalog_id ? 'text-erfolg' : 'text-gefahr'}`}>{z.katalog_id ? `✓ ${z.katalog_titel}` : z.grund}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-xs text-leise">Vorschau mit der automatisch erkannten Zuordnung.</p>
          </div>
          <fieldset className="grid gap-2 text-sm sm:grid-cols-2">
            <legend className="beschriftung">Für alle Angebote</legend>
            <label className="flex items-center gap-2"><input type="checkbox" checked={optionen.versand} onChange={(e) => setOptionen({ ...optionen, versand: e.target.checked })} />Versand</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={optionen.abholung} onChange={(e) => setOptionen({ ...optionen, abholung: e.target.checked })} />Abholung</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={optionen.verhandelbar} onChange={(e) => setOptionen({ ...optionen, verhandelbar: e.target.checked })} />Preise verhandelbar (VB)</label>
            <label className="flex items-center gap-2">PLZ-Bereich <input className="eingabe w-20" inputMode="numeric" maxLength={5} value={optionen.plz_bereich} onChange={(e) => setOptionen({ ...optionen, plz_bereich: e.target.value })} /></label>
            <label className="flex items-start gap-2 sm:col-span-2">
              <input type="checkbox" className="mt-1" checked={optionen.beendeFehlende} onChange={(e) => setOptionen({ ...optionen, beendeFehlende: e.target.checked })} />
              <span>Bestand synchronisieren: eigene Angebote mit Artikelnummer, die <strong>nicht</strong> in der Datei stehen, beenden</span>
            </label>
          </fieldset>
          <button type="button" className="knopf-primaer" disabled={laeuft || !zugeordnet} onClick={starten}>
            {laeuft ? 'Wird hochgeladen …' : `${anzahl(analyse.zeilen)} Zeilen hochladen`}
          </button>
        </div>
      )}

      {ergebnis && (
        <div className="space-y-2 rounded-xl border border-rand p-3 text-sm" role="status">
          <p><strong>{ergebnis.angelegt}</strong> neu · <strong>{ergebnis.aktualisiert}</strong> aktualisiert · <strong>{ergebnis.beendet}</strong> beendet · <strong>{ergebnis.uebersprungen}</strong> übersprungen</p>
          {ergebnis.sammler_informiert > 0 && <p className="text-erfolg">{ergebnis.sammler_informiert} Sammler mit passender Wunschliste wurden benachrichtigt.</p>}
          {ergebnis.fehlerhaft.length > 0 && (
            <details>
              <summary className="cursor-pointer">Übersprungene Zeilen anzeigen</summary>
              <ul className="mt-1 max-h-64 space-y-0.5 overflow-y-auto text-xs">
                {ergebnis.fehlerhaft.map((f) => <li key={f.zeile}>Zeile {f.zeile}{f.titel ? ` (${f.titel})` : ''}: {f.grund}</li>)}
              </ul>
            </details>
          )}
          <a className="knopf-sekundaer w-fit px-3 py-1.5" href="#/boerse/meine">Zu meinen Angeboten</a>
        </div>
      )}
      <p className="text-xs text-leise">Preise gelten als Endpreise inkl. MwSt. Nicht zugeordnete Spiele kannst du im Katalog vorschlagen oder einzeln anbieten.</p>
    </section>
  );
}
