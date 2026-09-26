// Einzelnes Angebot: Details, Anbieter (mit Anbieterkennzeichnung bei Händlern), Kontakt oder – für den Anbieter – Verwaltung.
import { useEffect, useState } from 'react';
import { REGIONEN, ZUSTAENDE, VOLLSTAENDIGKEITEN, beschriftung } from '../../../shared/konstanten.js';
import { api } from '../api.js';
import { datumDe } from '../format.js';
import { navigiere } from '../router.js';
import Layout from '../komponenten/Layout.jsx';
import Cover from '../komponenten/Cover.jsx';
import Symbol from '../komponenten/Symbole.jsx';
import MeldenKnopf from '../komponenten/MeldenKnopf.jsx';
import { useHinweis } from '../komponenten/Hinweise.jsx';
import {
  AngebotFormular, AnbieterAbzeichen, Bewertung, preisText, statusText,
} from '../komponenten/BoerseTeile.jsx';

export default function BoerseAngebot({ route, id }) {
  const zeigeHinweis = useHinweis();
  const [a, setA] = useState(null);
  const [fehler, setFehler] = useState(null);
  const [bearbeiten, setBearbeiten] = useState(false);
  const [katalog, setKatalog] = useState(null);
  const laden = () => api.angebot(id).then(setA).catch((e) => setFehler(e.message));
  useEffect(() => { laden(); }, [id]);
  useEffect(() => {
    if (a?.eigenes && bearbeiten && !katalog) api.katalogSeite(a.katalog_id).then(setKatalog).catch(() => {});
  }, [a, bearbeiten]);

  if (!a) {
    return (
      <Layout route={route} titel="Angebot" zurueck="/boerse">
        {fehler ? <p className="text-gefahr" role="alert">{fehler}</p> : <p className="text-leise">Wird geladen …</p>}
      </Layout>
    );
  }

  const aktion = async (fn, meldung) => {
    try { await fn(); zeigeHinweis(meldung); laden(); } catch (err) { zeigeHinweis(err.message, 'fehler'); }
  };
  const angaben = [
    ['Plattform', a.plattform],
    ['Variante', a.variante],
    ['Zustand', beschriftung(ZUSTAENDE, a.zustand)],
    ['Vollständigkeit', beschriftung(VOLLSTAENDIGKEITEN, a.vollstaendigkeit)],
    ['Region', beschriftung(REGIONEN, a.region)],
    ['Anzahl', a.anzahl > 1 ? `${a.anzahl} Stück` : null],
    ['Übergabe', [a.versand && 'Versand', a.abholung && `Abholung${a.plz_bereich ? ` (PLZ ${a.plz_bereich}xxx)` : ''}`].filter(Boolean).join(' oder ')],
    ['Eingestellt', datumDe(a.erstellt_am)],
    ...(a.eigenes ? [['Läuft ab', datumDe(a.laeuft_ab)], ['Artikelnummer', a.sku]] : []),
  ].filter(([, w]) => w);

  return (
    <Layout route={route} titel={a.titel} zurueck="/boerse">
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3">
          <Cover url={a.cover_url} typ={a.typ} alt={a.titel} className="mx-auto aspect-[3/4] w-1/2 rounded-2xl border border-rand md:w-full" />
          <a href={`#/katalog/${a.katalog_id}`} className="knopf-sekundaer w-full">Zur Spieleseite</a>
        </div>
        <div className="min-w-0 space-y-4">
          <div className="space-y-1">
            <h2 className="text-2xl font-bold">{a.titel}</h2>
            <p className="text-2xl font-bold text-akzent-hell">{preisText(a)}</p>
            <p className="flex flex-wrap gap-1.5">
              {a.art === 'beides' && <span className="abzeichen">Tausch möglich</span>}
              {a.status !== 'aktiv' && <span className="abzeichen bg-warnung/20 text-warnung">{statusText(a.status)}</span>}
              {a.gesucht_von > 0 && <span className="abzeichen text-akzent-hell">{a.gesucht_von} {a.gesucht_von === 1 ? 'Sammler sucht' : 'Sammler suchen'} das</span>}
            </p>
          </div>

          <dl className="karte divide-y divide-rand">
            {angaben.map(([label, wert]) => (
              <div key={label} className="grid grid-cols-[8rem_1fr] gap-2 px-4 py-2.5 text-sm">
                <dt className="text-leise">{label}</dt><dd className="break-words">{wert}</dd>
              </div>
            ))}
          </dl>
          {a.beschreibung && <section className="karte p-4"><h3 className="mb-1 text-sm font-semibold text-leise">Beschreibung</h3><p className="text-sm whitespace-pre-wrap">{a.beschreibung}</p></section>}

          {a.eigenes ? (
            <section className="karte space-y-3 p-4">
              <h3 className="font-semibold">Dein Angebot</h3>
              <p className="text-sm text-leise">{a.anfragen ? `${a.anfragen} ${a.anfragen === 1 ? 'Anfrage' : 'Anfragen'} – siehe ` : 'Anfragen erscheinen unter '}<a className="text-akzent-hell underline" href="#/nachrichten">Nachrichten</a>.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="knopf-primaer px-3 py-1.5" onClick={() => setBearbeiten(true)} disabled={a.status === 'entfernt'}><Symbol name="stift" className="size-4" />Bearbeiten</button>
                {a.status === 'aktiv' && <button type="button" className="knopf-sekundaer px-3 py-1.5" onClick={() => aktion(() => api.angebotAendern(a.id, { status: 'reserviert' }), 'Als reserviert markiert.')}>Reservieren</button>}
                {a.status === 'reserviert' && <button type="button" className="knopf-sekundaer px-3 py-1.5" onClick={() => aktion(() => api.angebotAendern(a.id, { status: 'aktiv' }), 'Wieder verfügbar.')}>Reservierung aufheben</button>}
                {['aktiv', 'reserviert'].includes(a.status) && (
                  <>
                    <button type="button" className="knopf-sekundaer px-3 py-1.5" onClick={() => aktion(() => api.angebotAendern(a.id, { status: 'verkauft' }), 'Als verkauft/getauscht markiert.')}>Verkauft/getauscht</button>
                    <button type="button" className="knopf-sekundaer px-3 py-1.5" onClick={() => aktion(() => api.angebotAendern(a.id, { verlaengern: true }), 'Laufzeit verlängert.')}>Verlängern</button>
                    <button type="button" className="knopf-sekundaer px-3 py-1.5" onClick={() => aktion(() => api.angebotAendern(a.id, { status: 'beendet' }), 'Angebot beendet.')}>Beenden</button>
                  </>
                )}
                {['beendet', 'abgelaufen', 'verkauft'].includes(a.status) && (
                  <button type="button" className="knopf-sekundaer px-3 py-1.5" onClick={() => aktion(() => api.angebotAendern(a.id, { status: 'aktiv' }), 'Angebot wieder eingestellt.')}>Wieder einstellen</button>
                )}
                <button type="button" className="knopf-gefahr px-3 py-1.5" onClick={async () => {
                  if (!window.confirm('Angebot endgültig löschen? Bestehende Unterhaltungen bleiben erhalten.')) return;
                  try { await api.angebotLoeschen(a.id); zeigeHinweis('Angebot gelöscht.'); navigiere('/boerse/meine'); } catch (err) { zeigeHinweis(err.message, 'fehler'); }
                }}>Löschen</button>
              </div>
            </section>
          ) : (
            <Kontakt angebot={a} />
          )}

          <AnbieterBox anbieter={a.anbieter} />
          {!a.eigenes && <div className="text-right"><MeldenKnopf bereich="angebot" zielId={a.id} /></div>}
        </div>
      </div>
      {bearbeiten && (
        <AngebotFormular angebot={a} plattformen={katalog?.plattformen ?? []} varianten={katalog?.varianten ?? []}
          onFertig={(neu) => { setBearbeiten(false); if (neu) setA(neu); }} />
      )}
    </Layout>
  );
}

function Kontakt({ angebot: a }) {
  const zeigeHinweis = useHinweis();
  const [text, setText] = useState(`Hallo, ich interessiere mich für „${a.titel}“. `);
  const [laeuft, setLaeuft] = useState(false);
  if (a.meine_anfrage) {
    return (
      <section className="karte flex flex-wrap items-center justify-between gap-2 p-4">
        <p className="text-sm">Du hast den Anbieter bereits angeschrieben.</p>
        <a className="knopf-primaer px-3 py-1.5" href={`#/nachrichten/${a.meine_anfrage}`}><Symbol name="nachricht" className="size-4" />Zur Unterhaltung</a>
      </section>
    );
  }
  async function senden(e) {
    e.preventDefault();
    setLaeuft(true);
    try {
      const r = await api.angebotAnfragen(a.id, text);
      navigiere(`/nachrichten/${r.unterhaltung_id}`);
    } catch (err) {
      zeigeHinweis(Object.values(err.felder ?? {})[0] ?? err.message, 'fehler');
    } finally {
      setLaeuft(false);
    }
  }
  return (
    <form onSubmit={senden} className="karte space-y-2 p-4">
      <h3 className="font-semibold">{a.art === 'tausch' ? 'Tausch anfragen' : 'Anbieter kontaktieren'}</h3>
      <textarea className="eingabe" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
      <p className="text-xs text-leise">Deine E-Mail-Adresse bleibt verborgen. Vereinbart Bezahlung und Versand direkt – am besten mit Käuferschutz.</p>
      <button type="submit" className="knopf-primaer" disabled={laeuft || !text.trim()}><Symbol name="nachricht" className="size-4" />Nachricht senden</button>
    </form>
  );
}

/** Anbieter mit Bewertung – bei Händlern mit Anbieterkennzeichnung (Impressum). */
export function AnbieterBox({ anbieter: b }) {
  const k = b.kennzeichnung;
  return (
    <section className="karte space-y-2 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Symbol name={b.gewerblich ? 'laden' : 'benutzer'} className="size-5 text-akzent-hell" />
        <a href={`#/boerse/anbieter/${b.id}`} className="font-semibold hover:underline">{b.name}</a>
        <AnbieterAbzeichen anbieter={b} />
        <Bewertung bewertung={b.bewertung} klein />
      </div>
      {b.mitglied_seit && <p className="text-xs text-leise">Dabei seit {datumDe(b.mitglied_seit)}{b.aktive_angebote ? ` · ${b.aktive_angebote} aktive Angebote` : ''}</p>}
      {b.gewerblich && k ? (
        <details className="rounded-lg border border-rand p-2">
          <summary className="cursor-pointer font-medium">Anbieterkennzeichnung (Impressum)</summary>
          <div className="mt-2 space-y-1 text-xs">
            <p className="font-semibold">{k.firma}</p>
            <p className="whitespace-pre-line">{k.anschrift}</p>
            {k.vertreten && <p>Vertreten durch: {k.vertreten}</p>}
            <p>E-Mail: {k.email}{k.telefon ? ` · Telefon: ${k.telefon}` : ''}</p>
            {k.register && <p>Registereintrag: {k.register}</p>}
            {k.ustid && <p>USt-IdNr.: {k.ustid}</p>}
            {k.shop_url && <p>Shop: <a className="text-akzent-hell underline" href={k.shop_url} target="_blank" rel="nofollow noopener noreferrer">{k.shop_url.replace(/^https:\/\//, '')}</a></p>}
            {k.versandinfo && <><p className="pt-1 font-semibold">Versand und Zahlung</p><p className="whitespace-pre-line">{k.versandinfo}</p></>}
            {k.widerruf && <><p className="pt-1 font-semibold">Widerruf und AGB</p><p className="whitespace-pre-line">{k.widerruf}</p></>}
          </div>
        </details>
      ) : (
        <p className="text-xs text-leise">Privatverkauf – in der Regel ohne Gewährleistung und Widerrufsrecht.</p>
      )}
    </section>
  );
}
