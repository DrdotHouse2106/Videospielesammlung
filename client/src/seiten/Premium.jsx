// „Schnäppchen & Premium“: Push aufs Handy, Schnäppchen-Alarm (kostenlos), Frühzugang und Speicherpakete (Abos)
// sowie der gesetzlich vorgeschriebene Kündigungsknopf („Verträge hier kündigen“).
import { useEffect, useState } from 'react';
import { MARKE } from '../../../shared/marke.js';
import { api } from '../api.js';
import { euro, datumDe } from '../format.js';
import Layout from '../komponenten/Layout.jsx';
import Symbol from '../komponenten/Symbole.jsx';
import SpeicherAnzeige from '../komponenten/SpeicherAnzeige.jsx';
import { useHinweis } from '../komponenten/Hinweise.jsx';

const PRODUKT_TEXT = {
  fruehzugang: () => 'Frühzugang (Schnäppchen-Alarm)',
  speicher: (a) => `Speicherpaket +${a.angebote.toLocaleString('de-DE')} GB`,
};
const STATUS_TEXT = { aktiv: 'aktiv', gekuendigt: 'gekündigt', pausiert: 'pausiert (Rechnung offen)', beendet: 'beendet' };

export default function Premium({ route }) {
  const zeigeHinweis = useHinweis();
  const [d, setD] = useState(null);
  const laden = () => api.premium().then(setD).catch((e) => zeigeHinweis(e.message, 'fehler'));
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
    const t1 = setTimeout(laden, 3000);
    const t2 = setTimeout(laden, 8000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [rueckkehr]);

  return (
    <Layout route={route} titel="Schnäppchen & Premium">
      <div className="mx-auto max-w-3xl space-y-4 pb-8">
        <PushSchalter />
        <SchnaeppchenAlarm />
        {!d ? <p className="text-leise">Wird geladen …</p> : (
          <>
            {d.fruehzugang.boerse && <Fruehzugang d={d} onGebucht={laden} />}
            <Speicher d={d} onGebucht={laden} />
            <Vertraege d={d} onGeaendert={laden} kuendigenOffen={route.parameter.kuendigen === '1'} />
          </>
        )}
      </div>
    </Layout>
  );
}

// ── Push aufs Handy ─────────────────────────────────────────────
const schluesselZuBytes = (b64) => {
  const roh = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(roh, (z) => z.charCodeAt(0));
};

export function PushSchalter() {
  const zeigeHinweis = useHinweis();
  const unterstuetzt = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const installiert = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone;
  const [abo, setAbo] = useState(null);
  const [laeuft, setLaeuft] = useState(false);
  useEffect(() => {
    if (!unterstuetzt) return;
    navigator.serviceWorker.getRegistration().then((reg) => reg?.pushManager.getSubscription()).then((s) => setAbo(s ?? null)).catch(() => {});
  }, []);

  async function einschalten() {
    setLaeuft(true);
    try {
      const erlaubnis = await Notification.requestPermission();
      if (erlaubnis !== 'granted') throw new Error('Benachrichtigungen wurden im Browser nicht erlaubt. Du kannst das in den Browser- bzw. Handy-Einstellungen ändern.');
      const reg = await navigator.serviceWorker.ready;
      const { schluessel } = await api.pushSchluessel();
      const neu = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: schluesselZuBytes(schluessel) });
      const geraet = /android/i.test(navigator.userAgent) ? 'Android' : ios ? 'iPhone/iPad' : /mac/i.test(navigator.userAgent) ? 'Mac' : /windows/i.test(navigator.userAgent) ? 'Windows' : 'Browser';
      await api.pushAbonnieren({ abo: neu.toJSON(), geraet });
      setAbo(neu);
      zeigeHinweis('Push-Benachrichtigungen sind auf diesem Gerät eingeschaltet.');
    } catch (e) {
      zeigeHinweis(e.message, 'fehler');
    } finally {
      setLaeuft(false);
    }
  }
  async function ausschalten() {
    setLaeuft(true);
    try {
      await api.pushAbbestellen(abo.endpoint).catch(() => {});
      await abo.unsubscribe();
      setAbo(null);
      zeigeHinweis('Push-Benachrichtigungen auf diesem Gerät ausgeschaltet.');
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <section className="karte space-y-2 p-4 text-sm">
      <h2 className="flex items-center gap-2 font-semibold"><Symbol name="glocke" className="size-5 text-akzent-hell" />Push-Benachrichtigungen aufs Handy</h2>
      {!unterstuetzt ? (
        <p className="text-leise">
          {ios && !installiert
            ? `Auf dem iPhone funktioniert Push nur, wenn ${MARKE.name} zum Home-Bildschirm hinzugefügt wurde: Teilen-Symbol → „Zum Home-Bildschirm“. Danach die App von dort öffnen.`
            : 'Dieser Browser unterstützt keine Push-Benachrichtigungen.'}
        </p>
      ) : (
        <>
          <p className="text-leise">Schnäppchen, Wunschlisten-Treffer und Nachrichten sofort aufs Gerät – auch wenn die App geschlossen ist.</p>
          <div className="flex flex-wrap gap-2">
            {abo ? (
              <>
                <button type="button" className="knopf-sekundaer" disabled={laeuft} onClick={() => api.pushTest().then((r) => zeigeHinweis(r.gesendet ? 'Testnachricht gesendet.' : 'Keine Geräte erreicht.'))}>Test senden</button>
                <button type="button" className="knopf-sekundaer" disabled={laeuft} onClick={ausschalten}>Auf diesem Gerät ausschalten</button>
              </>
            ) : <button type="button" className="knopf-primaer" disabled={laeuft} onClick={einschalten}>Auf diesem Gerät einschalten</button>}
          </div>
          {abo && <p className="text-xs text-erfolg">✓ Auf diesem Gerät eingeschaltet</p>}
        </>
      )}
    </section>
  );
}

// ── Schnäppchen-Alarm (kostenlos) ───────────────────────────────
function SchnaeppchenAlarm() {
  const zeigeHinweis = useHinweis();
  const [e, setE] = useState(null);
  const [plattformen, setPlattformen] = useState([]);
  useEffect(() => {
    api.schnaeppchenEinstellungen().then(setE).catch(() => setE(false));
    api.plattformenAlle().then((l) => setPlattformen((Array.isArray(l) ? l : []).filter((p) => p.katalog > 0))).catch(() => {});
  }, []);
  if (e === false) return null;
  if (!e) return null;
  const setze = (feld, wert) => setE((alt) => ({ ...alt, [feld]: wert }));
  async function speichern(ev) {
    ev.preventDefault();
    try {
      setE(await api.schnaeppchenSpeichern(e));
      zeigeHinweis(e.aktiv ? 'Schnäppchen-Alarm gespeichert.' : 'Schnäppchen-Alarm ausgeschaltet.');
    } catch (err) {
      zeigeHinweis(Object.values(err.felder ?? {})[0] ?? err.message, 'fehler');
    }
  }
  return (
    <form onSubmit={speichern} className="karte space-y-3 p-4 text-sm">
      <h2 className="flex items-center gap-2 font-semibold"><Symbol name="wert" className="size-5 text-akzent-hell" />Schnäppchen-Alarm <span className="abzeichen">kostenlos</span></h2>
      <p className="text-leise">
        Benachrichtigung, sobald jemand ein Spiel deutlich unter dem Marktwert anbietet. Der Marktwert stammt aus echten Verkäufen
        in der Börse, sonst aus Marktpreisen.
      </p>
      <label className="flex items-center gap-2">
        <input type="checkbox" className="size-4 accent-akzent" checked={e.aktiv} onChange={(x) => setze('aktiv', x.target.checked)} />
        <span className="font-medium">Schnäppchen-Alarm einschalten</span>
      </label>
      <label className="block">
        <span className="beschriftung">Wann ist es ein Schnäppchen?</span>
        <select className="eingabe" value={e.schwelle} onChange={(x) => setze('schwelle', Number(x.target.value))} disabled={!e.aktiv}>
          {[30, 40, 50, 60, 70, 80].filter((w) => w <= e.max_schwelle).map((w) => <option key={w} value={w}>mindestens {100 - w} % unter Marktwert</option>)}
        </select>
      </label>
      <fieldset className="space-y-1" disabled={!e.aktiv}>
        <legend className="beschriftung">Für welche Angebote?</legend>
        {[['wunschliste', 'Nur Spiele auf meiner Wunschliste'], ['plattformen', 'Alle Spiele bestimmter Plattformen'], ['alle', 'Alle Angebote']].map(([w, l]) => (
          <label key={w} className="flex items-center gap-2"><input type="radio" name="umfang" className="accent-akzent" checked={e.umfang === w} onChange={() => setze('umfang', w)} />{l}</label>
        ))}
      </fieldset>
      {e.aktiv && e.umfang === 'plattformen' && (
        <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
          {plattformen.map((p) => {
            const an = e.plattformen.includes(p.id);
            return (
              <button type="button" key={p.id} className={an ? 'chip-aktiv' : 'chip'} aria-pressed={an}
                onClick={() => setze('plattformen', an ? e.plattformen.filter((x) => x !== p.id) : [...e.plattformen, p.id])}>{p.kurz || p.name}</button>
            );
          })}
        </div>
      )}
      <p className="text-xs text-leise">
        {e.fruehzugang_bis
          ? `✓ Frühzugang aktiv bis ${datumDe(e.fruehzugang_bis)}: Du erfährst von Schnäppchen sofort.`
          : `Ohne Frühzugang kommen Schnäppchen-Benachrichtigungen ${e.fruehzugang_minuten} Minuten nach Einstellen des Angebots.`}
        {' '}Tipp: Schalte Push-Benachrichtigungen ein, um nichts zu verpassen.
      </p>
      <button type="submit" className="knopf-primaer">Speichern</button>
    </form>
  );
}

// ── Buchen (Verbraucher) ────────────────────────────────────────
function Buchen({ d, produkt, angebote = null, preis, onGebucht }) {
  const zeigeHinweis = useHinweis();
  const [offen, setOffen] = useState(false);
  const [zustimmung, setZustimmung] = useState(false);
  const [laeuft, setLaeuft] = useState(null);
  const arten = [
    d.anbieter.stripe && ['stripe', 'Karte oder SEPA-Lastschrift'],
    d.anbieter.paypal && ['paypal', `PayPal (+${euro(d.paypal_gebuehr * (1 + d.steuersatz / 100))} Gebühr)`],
    d.anbieter.rechnung && ['rechnung', `Rechnung (${d.zahlungsziel} Tage Zahlungsziel)`],
  ].filter(Boolean);
  if (!arten.length) return <p className="text-xs text-leise">Online-Buchung ist auf diesem Server noch nicht eingerichtet.</p>;
  if (!offen) return <button type="button" className="knopf-primaer w-fit" onClick={() => setOffen(true)}>Buchen – {euro(preis)} / Monat</button>;
  async function buchen(anbieter) {
    setLaeuft(anbieter);
    try {
      const r = await api.premiumBuchen({ produkt, angebote, anbieter, sofort_beginnen: zustimmung });
      if (r.url) { window.location.href = r.url; return; }
      zeigeHinweis(`Gebucht! Die Rechnung kommt per E-Mail (zahlbar bis ${datumDe(r.faellig_am)}).`);
      setOffen(false);
      onGebucht();
    } catch (e) {
      zeigeHinweis(Object.values(e.felder ?? {})[0] ?? e.message, 'fehler');
    } finally {
      setLaeuft(null);
    }
  }
  return (
    <div className="space-y-2 rounded-xl border border-rand p-3">
      <p><strong>{euro(preis)} pro Monat</strong> inkl. MwSt. · monatlich kündbar zum Ende des Zeitraums</p>
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-akzent" checked={zustimmung} onChange={(e) => setZustimmung(e.target.checked)} />
        <span>
          Ich verlange ausdrücklich, dass {MARKE.name} sofort mit der Leistung beginnt. Mir ist bekannt, dass ich bei einem Widerruf
          innerhalb von 14 Tagen einen anteiligen Betrag zahle und mein Widerrufsrecht mit vollständiger Erfüllung erlischt
          (<a className="underline" href="#/seite/nutzungsbedingungen" target="_blank">Widerrufsbelehrung</a>).
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        {arten.map(([a, l]) => (
          <button key={a} type="button" className="knopf-primaer" disabled={!zustimmung || Boolean(laeuft)} onClick={() => buchen(a)}>
            {laeuft === a ? 'Einen Moment …' : `Zahlungspflichtig bestellen · ${l}`}
          </button>
        ))}
      </div>
      <button type="button" className="text-xs text-leise underline" onClick={() => setOffen(false)}>Abbrechen</button>
    </div>
  );
}

function Fruehzugang({ d, onGebucht }) {
  const f = d.fruehzugang;
  const laufend = d.abos.find((a) => a.produkt === 'fruehzugang' && ['aktiv', 'pausiert'].includes(a.status));
  return (
    <section className="karte space-y-2 p-4 text-sm">
      <h2 className="flex items-center gap-2 font-semibold"><Symbol name="glocke" className="size-5 text-akzent-hell" />Frühzugang</h2>
      <p>
        Mit Frühzugang erfährst du von Schnäppchen <strong>sofort</strong> – alle anderen {f.minuten} Minuten später.
        Ideal für seltene Spiele, die schnell weg sind. Jeder kann den Frühzugang buchen; so steht es auch in den Nutzungsbedingungen.
      </p>
      {f.bis ? <p className="text-erfolg">✓ Aktiv bis {datumDe(f.bis)}</p> : null}
      {!laufend && <Buchen d={d} produkt="fruehzugang" preis={f.preis} onGebucht={onGebucht} />}
    </section>
  );
}

function Speicher({ d, onGebucht }) {
  const s = d.speicher;
  const laufend = d.abos.find((a) => a.produkt === 'speicher' && ['aktiv', 'pausiert'].includes(a.status));
  const [wahl, setWahl] = useState(null);
  return (
    <section className="karte space-y-3 p-4 text-sm">
      <h2 className="flex items-center gap-2 font-semibold"><Symbol name="bild" className="size-5 text-akzent-hell" />Speicherplatz für Fotos und Scans</h2>
      <SpeicherAnzeige info={s} kompakt />
      <p className="text-leise">
        Kostenlos sind {(s.standardMb / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB enthalten.
        {s.extraMb ? ` Dein Speicherpaket: +${(s.extraMb / 1024).toLocaleString('de-DE')} GB bis ${datumDe(s.extraBis)}.` : ''}
      </p>
      {s.pakete.length === 0 ? <p className="text-leise">Auf diesem Server werden keine Speicherpakete angeboten.</p> : (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            {s.pakete.map((p) => {
              const aktuell = laufend?.angebote === p.gb;
              return (
                <button type="button" key={p.gb} disabled={aktuell} onClick={() => setWahl(p)}
                  className={`karte p-3 text-left ${wahl?.gb === p.gb ? 'border-akzent' : ''} ${aktuell ? 'opacity-70' : 'hover:border-akzent/60'}`}>
                  <span className="block text-lg font-bold">+{p.gb.toLocaleString('de-DE')} GB</span>
                  <span className="block">{euro(p.preis)} / Monat</span>
                  {aktuell && <span className="text-xs text-erfolg">✓ gebucht</span>}
                </button>
              );
            })}
          </div>
          {laufend && <p className="text-xs text-leise">Ein Wechsel auf ein anderes Paket ersetzt das bisherige; der nicht genutzte Rest wird verrechnet.</p>}
          {wahl && <Buchen key={wahl.gb} d={d} produkt="speicher" angebote={wahl.gb} preis={wahl.preis} onGebucht={() => { setWahl(null); onGebucht(); }} />}
        </>
      )}
    </section>
  );
}

// ── Verträge (mit gesetzlichem Kündigungsknopf) ────────────────
function Vertraege({ d, onGeaendert, kuendigenOffen }) {
  const zeigeHinweis = useHinweis();
  const [kuendigen, setKuendigen] = useState(kuendigenOffen);
  useEffect(() => { if (kuendigenOffen) document.getElementById('vertraege')?.scrollIntoView({ block: 'start' }); }, []);
  const laufend = d.abos.filter((a) => ['aktiv', 'pausiert'].includes(a.status));
  if (!d.abos.length && !d.zahlungen.length) {
    return kuendigenOffen ? <p className="karte p-4 text-sm text-leise" id="vertraege">Du hast derzeit keine laufenden Verträge für Frühzugang oder Speicher.</p> : null;
  }
  async function jetztKuendigen(abo) {
    try {
      await api.premiumKuendigen(abo.id);
      zeigeHinweis(`Gekündigt. ${PRODUKT_TEXT[abo.produkt](abo)} läuft noch bis ${datumDe(abo.laeuft_bis)}.`);
      onGeaendert();
    } catch (e) {
      zeigeHinweis(e.message, 'fehler');
    }
  }
  return (
    <section className="karte space-y-3 p-4 text-sm" id="vertraege">
      <h2 className="font-semibold">Deine Abos</h2>
      <ul className="divide-y divide-rand">
        {d.abos.map((a) => (
          <li key={a.id} className="py-2">
            <p className="font-medium">{PRODUKT_TEXT[a.produkt](a)}</p>
            <p className="text-xs text-leise">{STATUS_TEXT[a.status] ?? a.status}{a.laeuft_bis ? ` · bis ${datumDe(a.laeuft_bis)}` : ''}</p>
          </li>
        ))}
      </ul>
      {d.zahlungen.length > 0 && (
        <details>
          <summary className="cursor-pointer text-leise">Rechnungen ({d.zahlungen.length})</summary>
          <ul className="mt-1 space-y-1 text-xs">
            {d.zahlungen.map((z) => (
              <li key={z.id}>{datumDe(z.erstellt_am)} · {z.beschreibung} · {euro(z.brutto)}
                {z.rechnung && <> · <a className="underline" href={`/api/zahlung/rechnung/${z.id}.pdf`} download>PDF</a></>}</li>
            ))}
          </ul>
        </details>
      )}
      {laufend.length > 0 && (
        <div className="space-y-2">
          <button type="button" className="knopf-sekundaer" onClick={() => setKuendigen((k) => !k)}>Verträge hier kündigen</button>
          {kuendigen && (
            <div className="space-y-2 rounded-xl border border-rand p-3">
              <p>Welches Abo möchtest du kündigen? Die Kündigung gilt zum Ende des bezahlten Zeitraums; bis dahin bleibt alles freigeschaltet.</p>
              {laufend.map((a) => (
                <button key={a.id} type="button" className="knopf-gefahr" onClick={() => jetztKuendigen(a)}>
                  {PRODUKT_TEXT[a.produkt](a)} jetzt kündigen
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
