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
  const [zahlung, setZahlung] = useState(null);
  const laden = () => {
    api.haendler().then(setProfil).catch((e) => zeigeHinweis(e.message, 'fehler'));
    api.zahlungUebersicht().then(setZahlung).catch(() => setZahlung(null));
  };
  useEffect(() => { laden(); }, []);

  // Rückkehr von der Bezahlseite
  const rueckkehr = route.parameter.zahlung;
  useEffect(() => {
    if (!rueckkehr) return undefined;
    if (rueckkehr === 'abgebrochen') { zeigeHinweis('Bezahlung abgebrochen – es wurde nichts gebucht.'); return undefined; }
    zeigeHinweis('Danke! Die Zahlung wird verarbeitet …');
    if (rueckkehr === 'paypal') {
      const id = route.parameter.subscription_id ?? new URLSearchParams(window.location.search).get('subscription_id');
      api.paypalBestaetigen(id).then(laden).catch(() => {});
    }
    // Die Bestätigung des Zahlungsanbieters kommt meist nach wenigen Sekunden
    const t1 = setTimeout(laden, 3000);
    const t2 = setTimeout(laden, 8000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [rueckkehr]);

  return (
    <Layout route={route} titel="Händlerbereich" zurueck="/boerse/meine">
      <div className="mx-auto max-w-4xl space-y-4 pb-8">
        {!profil ? <p className="text-leise">Wird geladen …</p> : (
          <>
            <Vorteile profil={profil} />
            <Kennzeichnung profil={profil} onGespeichert={setProfil} />
            {profil.status && <MassenUpload profil={profil} />}
            <Pakete profil={profil} zahlung={zahlung} onGeaendert={setProfil} onGebucht={laden} />
            {profil.status && <ApiBereich profil={profil} zahlung={zahlung} onGebucht={laden} />}
            {zahlung && (zahlung.abos.length > 0 || zahlung.zahlungen.length > 0) && <AbosUndRechnungen zahlung={zahlung} onGeaendert={laden} />}
            <IndividuelleAnbindung profil={profil} />
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
        <li><strong>Händlerprofil</strong> mit Anbieterkennzeichnung, Link zu deinem Shop und Bewertungen.</li>
        <li><strong>Kostenlos bis {anzahl(profil.kostenlos)} aktive Angebote</strong> – mehr mit einem Händler-Paket, das zusätzlich die vollständige
          <strong> Nachfrage-Auswertung</strong> (welche Spiele gesucht werden, wie viel Sammler zahlen würden, wofür es noch kein Angebot gibt)
          und die <a className="underline" href="#/boerse/meine?tab=statistik"><strong>Statistik</strong></a> zu Aufrufen, Anfragen und Wunschlisten-Treffern je Angebot enthält.</li>
        <li><strong>API-Anbindung</strong> an deinen Shop oder dein ERP als Zusatzpaket: Der Bestand wird automatisch abgeglichen.</li>
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

const datum = (iso) => iso.split('-').reverse().join('.');
const euro = (n) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

/** Buchen über Stripe (Karte, SEPA-Lastschrift) oder PayPal (zzgl. Zahlungsgebühr). */
function BuchenKnoepfe({ profil, zahlung, produkt, angebote, preis, onGebucht }) {
  const zeigeHinweis = useHinweis();
  const [laeuft, setLaeuft] = useState(false);
  const a = zahlung?.anbieter;
  if (profil.status !== 'verifiziert' || !a || (!a.stripe && !a.paypal && !a.rechnung)) return null;
  // Verrechnet wird höchstens der Monatspreis – ein Rest bleibt als Guthaben
  const verrechnung = Math.min(zahlung.verrechenbar?.[produkt] ?? 0, preis ?? Infinity);
  const wechsel = zahlung.abos.some((x) => x.produkt === produkt && ['aktiv', 'gekuendigt', 'pausiert'].includes(x.status));
  const buchen = async (anbieter) => {
    const hinweisVerrechnung = verrechnung > 0
      ? `\n\n${wechsel ? 'Dein bisheriges Abo wird beendet und der nicht genutzte Rest gutgeschrieben. ' : ''}Mit der ersten Zahlung werden ${euro(verrechnung)} netto verrechnet.`
      : '';
    if (anbieter === 'rechnung' && !window.confirm(`Auf Rechnung kaufen? Die Rechnung kommt per E-Mail (Zahlungsziel ${zahlung.zahlungsziel} Tage). Das Paket ist sofort aktiv und verlängert sich monatlich, bis du kündigst.${hinweisVerrechnung}`)) return;
    if (anbieter !== 'rechnung' && hinweisVerrechnung && !window.confirm(`Weiter zur Bezahlung?${hinweisVerrechnung}`)) return;
    setLaeuft(true);
    try {
      const r = await api.zahlungCheckout({ produkt, angebote, anbieter });
      if (r.url) { window.location.href = r.url; return; }
      zeigeHinweis(`Gebucht! Rechnung ${r.rechnung} ist per E-Mail unterwegs – zahlbar bis ${datum(r.faellig_am)}.`);
      setLaeuft(false);
      onGebucht?.();
    } catch (e) {
      zeigeHinweis(Object.values(e.felder ?? {})[0] ?? e.message, 'fehler');
      setLaeuft(false);
    }
  };
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {a.rechnung && (
        <button type="button" className="knopf-primaer px-2.5 py-1 text-xs" disabled={laeuft} onClick={() => buchen('rechnung')}
          title={`Rechnung per E-Mail, zahlbar innerhalb von ${zahlung.zahlungsziel} Tagen`}>
          Auf Rechnung kaufen
        </button>
      )}
      {a.stripe && (
        <button type="button" className={`${a.rechnung ? 'knopf-sekundaer' : 'knopf-primaer'} px-2.5 py-1 text-xs`} disabled={laeuft} onClick={() => buchen('stripe')}>Karte/SEPA</button>
      )}
      {a.paypal && (
        <button type="button" className="knopf-sekundaer px-2.5 py-1 text-xs" disabled={laeuft} onClick={() => buchen('paypal')}
          title={`PayPal kostet ${euro(zahlung.paypal_gebuehr)} netto Zahlungsgebühr im Monat zusätzlich.`}>
          PayPal (+{euro(zahlung.paypal_gebuehr)})
        </button>
      )}
      {verrechnung > 0 && <p className="w-full text-[11px] text-erfolg">{wechsel ? 'Wechsel: ' : ''}{euro(verrechnung)} netto werden verrechnet.</p>}
    </div>
  );
}

const ABO_STATUS = { aktiv: 'Aktiv', gekuendigt: 'Gekündigt – läuft aus', beendet: 'Beendet', pausiert: 'Pausiert – Rechnung überfällig' };
const WEG = { stripe: 'Karte/SEPA', paypal: 'PayPal', rechnung: 'Rechnung' };

/** Gebuchte Abos (kündbar zum Periodenende) und Rechnungen als PDF. */
function AbosUndRechnungen({ zahlung, onGeaendert }) {
  const zeigeHinweis = useHinweis();
  const kuendigen = async (abo) => {
    if (!window.confirm(`Abo zum ${abo.laeuft_bis ? datum(abo.laeuft_bis) : 'Ende des Zeitraums'} kündigen? Bis dahin bleibt alles aktiv.`)) return;
    try { await api.aboKuendigen(abo.id); zeigeHinweis('Abo gekündigt.'); onGeaendert(); } catch (e) { zeigeHinweis(e.message, 'fehler'); }
  };
  const portal = async () => {
    try { window.location.href = (await api.zahlungPortal()).url; } catch (e) { zeigeHinweis(e.message, 'fehler'); }
  };
  return (
    <section className="karte space-y-3 p-4 text-sm">
      <h2 className="flex items-center gap-2 font-semibold"><Symbol name="dokument" className="size-5 text-akzent-hell" />Abos & Rechnungen</h2>
      {zahlung.guthaben > 0 && (
        <p className="rounded-xl border border-erfolg/50 bg-erfolg/10 p-3">
          Guthaben: <strong>{euro(zahlung.guthaben)}</strong> netto – wird mit deinen nächsten Rechnungen verrechnet.
        </p>
      )}
      {zahlung.abos.length > 0 && (
        <ul className="divide-y divide-rand rounded-xl border border-rand">
          {zahlung.abos.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 p-3">
              <span className="min-w-0 flex-1">
                <strong>{a.produkt === 'paket' ? `Händler-Paket ${anzahl(a.angebote)}` : 'API-Anbindung'}</strong>
                <span className="block text-xs text-leise">
                  {euro(a.netto)} netto/Monat · {WEG[a.anbieter] ?? a.anbieter} · {ABO_STATUS[a.status] ?? a.status}{a.laeuft_bis ? ` · bezahlt bis ${datum(a.laeuft_bis)}` : ''}
                </span>
              </span>
              {['aktiv', 'pausiert'].includes(a.status) && <button type="button" className="knopf-sekundaer px-3 py-1 text-xs" onClick={() => kuendigen(a)}>Kündigen</button>}
            </li>
          ))}
        </ul>
      )}
      {zahlung.abos.some((x) => x.anbieter === 'stripe') && (
        <button type="button" className="text-xs text-akzent-hell underline" onClick={portal}>Zahlungsdaten ändern (Stripe)</button>
      )}
      {zahlung.gutschriften?.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-rand p-3 text-xs">
          {zahlung.gutschriften.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>{datum(g.erstellt_am.slice(0, 10))} · Gutschrift: {g.grund}</span>
              <span className="tabular-nums">
                {euro(g.brutto)} {g.beleg ? <a className="ml-2 text-akzent-hell underline" href={`/api/boerse/zahlung/gutschrift/${g.id}.pdf`}>PDF</a> : <span className="ml-2 text-leise">folgt</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {zahlung.zahlungen.length > 0 && (
        <table className="w-full text-left text-xs">
          <thead className="text-leise"><tr><th className="py-1">Datum</th><th className="py-1">Leistung</th><th className="py-1 pl-3 text-right">Betrag</th><th className="py-1 pl-3 text-right">Rechnung</th></tr></thead>
          <tbody>
            {zahlung.zahlungen.map((r) => (
              <tr key={r.id} className="border-t border-rand">
                <td className="py-1.5 pr-3 whitespace-nowrap">{datum(r.erstellt_am.slice(0, 10))}</td>
                <td className="py-1.5">
                  {r.beschreibung}
                  {r.zeitraum_von && <span className="block text-leise">{datum(r.zeitraum_von)} – {datum(r.zeitraum_bis)}</span>}
                  {r.verrechnet > 0 && <span className="block text-erfolg">abzgl. Verrechnung {euro(r.verrechnet)} netto</span>}
                  {!r.bezahlt_am && r.faellig_am && <span className="block text-warnung">offen, fällig am {datum(r.faellig_am)}</span>}
                </td>
                <td className="py-1.5 pl-3 text-right tabular-nums whitespace-nowrap">{euro(r.brutto)}</td>
                <td className="py-1.5 pl-3 text-right">{r.rechnung ? <a className="text-akzent-hell underline" href={`/api/boerse/zahlung/rechnung/${r.id}.pdf`}>PDF</a> : <span className="text-leise">folgt</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
const euroMonat = (n) => `${n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })} / Monat`;

/** Kostenloses Kontingent und buchbare Händler-Pakete. */
function Pakete({ profil, zahlung, onGeaendert, onGebucht }) {
  const zeigeHinweis = useHinweis();
  const testStarten = async () => {
    if (!window.confirm(`${profil.test_tage} Tage kostenlos testen? Der Test kann nur einmal genutzt werden und endet automatisch – ohne Kosten und ohne Kündigung.`)) return;
    try { onGeaendert(await api.haendlerTestStarten()); zeigeHinweis('Testzugang gestartet – viel Spaß!'); } catch (e) { zeigeHinweis(e.message, 'fehler'); }
  };
  const stufen = [{ angebote: profil.kostenlos, preis: 0 }, ...profil.pakete];
  const aktuell = profil.paket ?? profil.kostenlos;
  return (
    <section className="karte space-y-3 p-4 text-sm">
      <h2 className="flex items-center gap-2 font-semibold"><Symbol name="wert" className="size-5 text-akzent-hell" />Pakete</h2>
      {profil.test_bis && (
        <p className="rounded-xl border border-erfolg/50 bg-erfolg/10 p-3">
          <strong>Kostenloser Testzugang bis {datum(profil.test_bis)}</strong> – inklusive API-Anbindung. Danach endet er automatisch;
          buche rechtzeitig ein Paket, damit deine Angebote aktiv bleiben.
        </p>
      )}
      {profil.test_moeglich && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-akzent/50 bg-akzent/10 p-3">
          <p className="min-w-0 flex-1"><strong>{profil.test_tage} Tage kostenlos testen:</strong> größtes Paket und API-Anbindung, endet automatisch.</p>
          <button type="button" className="knopf-primaer px-3 py-1.5" onClick={testStarten}>Test starten</button>
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {stufen.map((s) => {
          const gewaehlt = s.angebote === aktuell;
          return (
            <div key={s.angebote} className={`rounded-xl border p-3 ${gewaehlt ? 'border-akzent bg-akzent/10' : 'border-rand'}`}>
              <p className="font-semibold">{s.preis ? `Händler ${anzahl(s.angebote)}` : 'Kostenlos'}</p>
              <p className="text-lg font-bold">{s.preis ? euroMonat(s.preis) : '0 €'}</p>
              <p className="text-xs text-leise">bis {anzahl(s.angebote)} aktive Angebote{s.preis ? ' · Nachfrage-Auswertung & Statistik' : ' · auch per CSV-Upload'}</p>
              {s.preis > 0 && zahlung?.steuersatz > 0 && <p className="text-xs text-leise">zzgl. {zahlung.steuersatz.toLocaleString('de-DE')} % MwSt.</p>}
              {gewaehlt && <p className="mt-1 text-xs font-semibold text-akzent-hell">{s.preis ? `${profil.test_bis ? 'Test' : 'Gebucht'} bis ${datum(profil.paket_bis)}` : 'Aktuell'}</p>}
              {s.preis > 0 && !gewaehlt && <BuchenKnoepfe profil={profil} zahlung={zahlung} produkt="paket" angebote={s.angebote} preis={s.preis} onGebucht={onGebucht} />}
            </div>
          );
        })}
        {profil.pakete.length > 0 && (
          <div className={`rounded-xl border p-3 ${profil.paket > Math.max(...profil.pakete.map((p) => p.angebote)) ? 'border-akzent bg-akzent/10' : 'border-dashed border-rand'}`}>
            <p className="font-semibold">Individuell</p>
            <p className="text-lg font-bold">auf Anfrage</p>
            <p className="text-xs text-leise">mehr als {anzahl(Math.max(...profil.pakete.map((p) => p.angebote)))} aktive Angebote · Konditionen nach Absprache</p>
            {profil.paket > Math.max(...profil.pakete.map((p) => p.angebote)) && (
              <p className="mt-1 text-xs font-semibold text-akzent-hell">{anzahl(profil.paket)} Angebote, gebucht bis {datum(profil.paket_bis)}</p>
            )}
          </div>
        )}
      </div>
      <p className="text-xs text-leise">
        Zusatzpaket API-Anbindung: {euroMonat(profil.api_preis)}. {profil.preis_hinweis ?? ''}
        {' '}Läuft ein Paket aus, bleiben die {anzahl(profil.kostenlos)} zuletzt bearbeiteten Angebote aktiv; die übrigen werden beendet und lassen sich nach einer neuen Buchung wieder einstellen.
      </p>
      {profil.pakete.length > 0 && (
        <p>
          {profil.status !== 'verifiziert' ? 'Pakete sind nach der Verifizierung deines Händlerkontos buchbar. Kontakt: '
            : zahlung?.anbieter?.stripe || zahlung?.anbieter?.paypal ? 'Fragen oder individuelles Angebot: ' : 'Paket buchen oder wechseln: '}
          <KontaktLink kontakt={profil.kontakt} betreff={`${MARKE.name}: Händler-Paket`} />
        </p>
      )}
      {!profil.paket && profil.paket_gebucht && profil.paket_bis && <p className="text-xs text-warnung">Dein Paket ist am {datum(profil.paket_bis)} abgelaufen.</p>}
    </section>
  );
}

/** Kontaktangabe des Betreibers als Link (E-Mail oder https-Adresse). */
function KontaktLink({ kontakt, betreff }) {
  if (!kontakt) return <span>über das <a className="underline" href="#/seite/impressum">Impressum</a></span>;
  const href = kontakt.includes('@') && !kontakt.startsWith('http') ? `mailto:${kontakt}?subject=${encodeURIComponent(betreff)}` : kontakt;
  return <a className="text-akzent-hell underline" href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer">{kontakt}</a>;
}

function IndividuelleAnbindung({ profil }) {
  return (
    <section className="karte space-y-2 border-akzent/40 p-4 text-sm">
      <h2 className="flex items-center gap-2 font-semibold"><Symbol name="link" className="size-5 text-akzent-hell" />Dein System ist nicht dabei?</h2>
      <p>
        Wir entwickeln gern eine <strong>individuelle Anbindung an deine Warenwirtschaft (ERP) oder Shopsoftware</strong> – z. B. JTL-Wawi,
        WooCommerce, Plentymarkets, Xentral, Magento oder eine eigene Lösung. Danach trägst du hier im Händlerbereich nur noch deinen
        API-Schlüssel ein, und dein Bestand wird automatisch abgeglichen.
      </p>
      <p>Anfragen: <KontaktLink kontakt={profil.kontakt} betreff={`${MARKE.name}: Individuelle Anbindung`} /></p>
    </section>
  );
}

const SYSTEME = [
  ['shopware6', 'Shopware 6 (Admin-API)'],
  ['csv_url', 'CSV-Feed (Adresse eines Produktexports)'],
];

function ApiBereich({ profil, zahlung, onGebucht }) {
  const zeigeHinweis = useHinweis();
  const [info, setInfo] = useState(undefined);
  const [w, setW] = useState(null);
  const [laeuft, setLaeuft] = useState(false);
  const [test, setTest] = useState(null);
  const laden = () => api.anbindung().then((i) => {
    setInfo(i);
    setW({ typ: i?.typ ?? 'shopware6', url: i?.url ?? '', client_id: i?.client_id ?? '', client_secret: '', token: '', intervall_stunden: i?.intervall_stunden ?? 6, beende_fehlende: i?.beende_fehlende ?? false, aktiv: i?.aktiv ?? true });
  }).catch(() => setInfo(null));
  useEffect(() => { if (profil.api) laden(); }, [profil.api]);

  if (!profil.api) {
    return (
      <section className="karte space-y-2 p-4 text-sm">
        <h2 className="flex flex-wrap items-center gap-2 font-semibold">
          <Symbol name="schloss" className="size-5 text-akzent-hell" />Zusatzpaket API-Anbindung
          <span className="abzeichen text-akzent-hell">{euroMonat(profil.api_preis)}</span>
        </h2>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Automatischer Abgleich</strong> mit Shopware 6 oder einem CSV-Produktexport deiner Warenwirtschaft: neue Artikel, Preise und Bestand werden regelmäßig übernommen.</li>
          <li>Deine Zugangsdaten trägst du selbst ein; sie werden verschlüsselt gespeichert.</li>
          <li>Andere Systeme binden wir auf Wunsch individuell an (siehe unten).</li>
        </ul>
        {profil.preis_hinweis && <p className="text-xs text-leise">{profil.preis_hinweis}</p>}
        <BuchenKnoepfe profil={profil} zahlung={zahlung} produkt="api" preis={profil.api_preis} onGebucht={onGebucht} />
        <p>
          {profil.status !== 'verifiziert' ? 'Verfügbar nach der Verifizierung deines Händlerkontos. ' : ''}
          {zahlung?.anbieter?.stripe || zahlung?.anbieter?.paypal ? 'Fragen: ' : 'Buchen: '}<KontaktLink kontakt={profil.kontakt} betreff={`${MARKE.name}: Zusatzpaket API-Anbindung`} />
        </p>
        {profil.api_bis && <p className="text-xs text-leise">Dein Zusatzpaket ist am {datum(profil.api_bis)} abgelaufen.</p>}
      </section>
    );
  }
  if (info === undefined || !w) return <p className="text-leise">Wird geladen …</p>;

  const setze = (feld) => (e) => setW({ ...w, [feld]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const ausfuehren = async (fn, erfolg) => {
    setLaeuft(true);
    try { const r = await fn(); if (erfolg) zeigeHinweis(erfolg(r)); return r; } catch (err) { zeigeHinweis(ersterFehler(err), 'fehler'); laden(); return null; } finally { setLaeuft(false); }
  };
  const speichern = (e) => {
    e.preventDefault();
    ausfuehren(() => api.anbindungSpeichern({ ...w, intervall_stunden: Number(w.intervall_stunden) }), () => 'Anbindung gespeichert. Der erste Abgleich folgt in den nächsten Minuten.')
      .then((i) => { if (i) { setInfo(i); setW({ ...w, client_secret: '', token: '' }); } });
  };
  const e = info?.letztes_ergebnis;

  return (
    <section className="karte space-y-3 p-4 text-sm">
      <h2 className="flex items-center gap-2 font-semibold"><Symbol name="aktualisieren" className="size-5 text-akzent-hell" />Automatische Anbindung <span className="abzeichen text-erfolg">{profil.test_bis ? 'Test' : 'gebucht'} bis {datum(profil.api_bis)}</span></h2>
      <p className="text-leise">
        Deine Zugangsdaten werden verschlüsselt gespeichert und nie wieder angezeigt. Es werden nur Produktdaten gelesen – lege dafür
        möglichst einen Zugang mit reinen Leserechten an.
      </p>
      <form onSubmit={speichern} className="space-y-3">
        <label className="block"><span className="beschriftung">System</span>
          <select className="eingabe" value={w.typ} onChange={setze('typ')}>{SYSTEME.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label className="block"><span className="beschriftung">{w.typ === 'shopware6' ? 'Adresse des Shops' : 'Adresse des CSV-Exports'}</span>
          <input className="eingabe" type="url" required value={w.url} onChange={setze('url')} placeholder={w.typ === 'shopware6' ? 'https://mein-shop.de' : 'https://mein-shop.de/export/zockdb.csv'} />
        </label>
        {w.typ === 'shopware6' ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block"><span className="beschriftung">Zugangs-ID</span><input className="eingabe" value={w.client_id} onChange={setze('client_id')} autoComplete="off" /></label>
              <label className="block"><span className="beschriftung">Sicherheitsschlüssel</span>
                <input className="eingabe" type="password" value={w.client_secret} onChange={setze('client_secret')} autoComplete="new-password"
                  placeholder={info?.geheimnis_gesetzt && info.typ === 'shopware6' ? '•••••••• (unverändert)' : ''} /></label>
            </div>
            <p className="text-xs text-leise">
              In Shopware: <em>Einstellungen → System → Integrationen → Integration hinzufügen</em>, Leserechte für Produkte.
              Zuordnung über EAN oder Name; genauer mit den Zusatzfeldern <code>zockdb_id</code>, <code>zockdb_plattform</code>,
              <code>zockdb_zustand</code>, <code>zockdb_vollstaendigkeit</code> und <code>zockdb_region</code>. Die Artikelnummer dient als Abgleichsschlüssel.
            </p>
          </>
        ) : (
          <>
            <label className="block"><span className="beschriftung">Zugriffstoken (optional, wird als „Bearer“ gesendet)</span>
              <input className="eingabe" type="password" value={w.token} onChange={setze('token')} autoComplete="new-password"
                placeholder={info?.geheimnis_gesetzt && info.typ === 'csv_url' ? '•••••••• (unverändert)' : ''} /></label>
            <p className="text-xs text-leise">Die Datei braucht dieselben Spalten wie beim CSV-Upload (mindestens Artikelnummer, Titel/EAN/ZockDB-ID, Preis, Bestand).</p>
          </>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="beschriftung">Abgleich alle … Stunden</span>
            <input className="eingabe" type="number" min={1} max={168} value={w.intervall_stunden} onChange={setze('intervall_stunden')} /></label>
          <div className="space-y-1 self-end pb-2">
            <label className="flex items-center gap-2"><input type="checkbox" checked={w.aktiv} onChange={setze('aktiv')} />Automatischer Abgleich aktiv</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={w.beende_fehlende} onChange={setze('beende_fehlende')} />Nicht mehr gelistete Artikel beenden</label>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="knopf-primaer" disabled={laeuft}>Speichern</button>
          {info && (
            <>
              <button type="button" className="knopf-sekundaer" disabled={laeuft} onClick={() => ausfuehren(api.anbindungTesten, (r) => `Verbindung ok – ${r.artikel} Artikel gefunden.`).then((r) => r && setTest(r))}>Verbindung testen</button>
              <button type="button" className="knopf-sekundaer" disabled={laeuft} onClick={() => ausfuehren(api.anbindungAbgleichen, (r) => `${r.angelegt} neu, ${r.aktualisiert} aktualisiert, ${r.beendet} beendet.`).then(laden)}>Jetzt abgleichen</button>
              <button type="button" className="knopf-gefahr" disabled={laeuft} onClick={() => window.confirm('Anbindung und gespeicherte Zugangsdaten löschen? Deine Angebote bleiben bestehen.')
                && ausfuehren(api.anbindungEntfernen, () => 'Anbindung gelöscht.').then(laden)}>Löschen</button>
            </>
          )}
        </div>
      </form>
      {test && <p className="text-xs text-leise">Test: {test.artikel} Artikel, z. B. {test.vorschau.slice(0, 3).map((z) => z.titel || z.sku).join(', ')}</p>}
      {info && (
        <div className="rounded-xl border border-rand p-3 text-xs" role="status">
          <p>Letzter Abgleich: {info.letzter_lauf ? new Date(`${info.letzter_lauf.replace(' ', 'T')}Z`).toLocaleString('de-DE') : 'noch keiner'}{!info.aktiv && ' · automatischer Abgleich pausiert'}</p>
          {info.letzter_fehler && <p className="text-gefahr">Fehler: {info.letzter_fehler}</p>}
          {!info.letzter_fehler && e && <p>{e.angelegt} neu · {e.aktualisiert} aktualisiert · {e.beendet} beendet · {e.uebersprungen} übersprungen</p>}
          {!info.letzter_fehler && e?.fehlerhaft?.length > 0 && (
            <details><summary className="cursor-pointer">Übersprungene Artikel</summary>
              <ul className="mt-1 max-h-48 overflow-y-auto">{e.fehlerhaft.map((f, i) => <li key={i}>{f.titel ?? `Zeile ${f.zeile}`}: {f.grund}</li>)}</ul>
            </details>
          )}
          <p className="mt-1 text-leise">Nach fünf Fehlern in Folge wird der automatische Abgleich pausiert.</p>
        </div>
      )}
    </section>
  );
}
