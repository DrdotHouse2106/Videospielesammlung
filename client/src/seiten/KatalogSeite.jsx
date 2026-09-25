// Seite eines Spiels/Geräts im globalen Katalog – auch ohne Anmeldung erreichbar (PUBLIC_CATALOG).
import { useEffect, useState } from 'react';
import {
  ARTIKELTYPEN, REGIONEN, VOLLSTAENDIGKEITEN, MEDIENARTEN, beschriftung, istModerator,
} from '../../../shared/konstanten.js';
import { nachHersteller, usePlattformen } from '../plattformen.js';
import MeldenKnopf from '../komponenten/MeldenKnopf.jsx';
import Markdown from '../komponenten/Markdown.jsx';
import { katalogPfad } from '../../../shared/seo.js';
import ExterneLinks from '../komponenten/ExterneLinks.jsx';
import { api } from '../api.js';
import { navigiere } from '../router.js';
import { euro, anzahl } from '../format.js';
import { useSitzung } from '../sitzung.js';
import Layout from '../komponenten/Layout.jsx';
import Cover from '../komponenten/Cover.jsx';
import Symbol from '../komponenten/Symbole.jsx';
import StatusAbzeichen from '../komponenten/StatusAbzeichen.jsx';
import VariantenListe from '../komponenten/VariantenListe.jsx';
import PreisVerlauf from '../komponenten/PreisVerlauf.jsx';
import KaufenBox from '../komponenten/KaufenBox.jsx';
import Kommentare from '../komponenten/Kommentare.jsx';
import Scans from '../komponenten/Scans.jsx';
import { useHinweis } from '../komponenten/Hinweise.jsx';

export default function KatalogSeite({ route, id }) {
  const { benutzer } = useSitzung();
  const zeigeHinweis = useHinweis();
  const [daten, setDaten] = useState(null);
  const [fehler, setFehler] = useState(null);
  const [bearbeiten, setBearbeiten] = useState(false);

  const laden = () => api.katalogSeite(id).then(setDaten).catch((e) => setFehler(e.message));
  useEffect(() => { laden(); }, [id]);

  if (!daten) {
    return (
      <Layout route={route} titel="Katalog" zurueck="/katalog">
        {fehler ? <p className="text-gefahr" role="alert">{fehler}</p> : <p className="text-leise">Wird geladen …</p>}
      </Layout>
    );
  }

  const { eintrag: e } = daten;
  const aktion = async (fn, meldung) => {
    try { await fn(); zeigeHinweis(meldung); laden(); } catch (err) { zeigeHinweis(err.message, 'fehler'); }
  };
  const pal = daten.marktpreise.pal ?? Object.values(daten.marktpreise)[0];
  const c = daten.community;
  const darfBearbeiten = istModerator(benutzer) || (e.eigener && e.status !== 'freigegeben');

  return (
    <Layout route={route} titel={e.titel} zurueck="/katalog"
      aktionen={darfBearbeiten && !bearbeiten && (
        <button type="button" className="rounded-lg p-2 text-leise hover:bg-karte hover:text-text" aria-label="Katalogeintrag bearbeiten" onClick={() => setBearbeiten(true)}>
          <Symbol name="stift" />
        </button>
      )}>
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 md:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3">
          <Cover url={e.cover_url} typ={e.typ} alt={e.titel} className="mx-auto aspect-[3/4] w-1/2 rounded-2xl border border-rand md:w-full" />
          {benutzer ? (
            <button type="button" className="knopf-primaer w-full" onClick={() => navigiere('/neu/formular', { katalog: e.id, typ: e.typ })}>
              <Symbol name="plus" className="size-4" />{daten.meineExemplare.length ? 'Weiteres Exemplar hinzufügen' : 'Zur Sammlung hinzufügen'}
            </button>
          ) : (
            <a href="#/" className="knopf-primaer w-full">Anmelden, um es zu sammeln</a>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          {bearbeiten && <KatalogBearbeiten eintrag={e} plattformIds={daten.plattformen.map((p) => p.id)} onFertig={(neu) => { setBearbeiten(false); if (neu) laden(); }} />}
          <div className="space-y-2">
            <h2 className="text-2xl font-bold">{e.titel}</h2>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="abzeichen">{beschriftung(ARTIKELTYPEN, e.typ)}</span>
              {daten.plattformen.map((p) => (
                <a key={p.id} href={`#/katalog?plattform=${p.id}`} className="abzeichen text-akzent-hell hover:underline" title={p.name}>{p.kurz}</a>
              ))}
              {e.erscheinungsjahr && <span className="abzeichen">{e.erscheinungsjahr}</span>}
              {e.status !== 'freigegeben' && <StatusAbzeichen status={e.status} />}
              {e.status === 'freigegeben' && e.automatisch_geprueft === 1 && (
                <span className="abzeichen" title="Dieser Eintrag wurde automatisch durch eine KI geprüft und freigegeben.">KI-geprüft</span>
              )}
            </div>
            {e.hersteller && <p className="text-sm text-leise">{e.hersteller}</p>}
            {e.beschreibung && <p className="text-sm whitespace-pre-line">{e.beschreibung}</p>}
            <div className="flex flex-wrap gap-3 text-xs text-leise">
              {e.quelle === 'igdb' && <span>Daten: IGDB.com{e.manuell_bearbeitet ? ' (vom Moderationsteam überarbeitet)' : ''}</span>}
              {e.status === 'freigegeben' && <MeldenKnopf bereich="katalog" zielId={e.id} />}
              {e.status === 'freigegeben' && (
                <a href={katalogPfad(e, daten.plattformen[0]?.kurz)} className="underline hover:text-text" title="Öffentliche Seite – auch für Suchmaschinen">Öffentliche Seite</a>
              )}
            </div>
          </div>

          {(e.sammlerhinweise || (e.status === 'freigegeben' && benutzer && !istModerator(benutzer))) && (
            <section className="karte space-y-2 p-4">
              <h3 className="flex items-center gap-2 font-semibold"><Symbol name="dokument" className="size-5" />Sammlerhinweise</h3>
              {e.sammlerhinweise
                ? <div className="text-sm"><Markdown text={e.sammlerhinweise} /></div>
                : <p className="text-sm text-leise">Noch keine Sammlerhinweise. Weißt du etwas über Varianten, Lieferumfang oder Besonderheiten?</p>}
              {e.status === 'freigegeben' && benutzer && !istModerator(benutzer) && <MeldenKnopf bereich="katalog" zielId={e.id} vorschlag />}
            </section>
          )}

          {e.eigener && e.status !== 'freigegeben' && (
            <div className="rounded-xl border border-rand p-3 text-sm">
              {e.status === 'privat' && <p>Dieser Eintrag ist <strong>privat</strong> – nur du siehst ihn.</p>}
              {e.status === 'eingereicht' && <p>Eingereicht – das Moderationsteam prüft den Eintrag.</p>}
              {e.status === 'abgelehnt' && !e.automatisch_geprueft && <p className="text-gefahr">Abgelehnt{e.pruefung_notiz ? `: ${e.pruefung_notiz}` : ''}</p>}
              {e.status === 'abgelehnt' && e.automatisch_geprueft === 1 && (
                <div className="space-y-2">
                  <p className="flex items-start gap-2 text-gefahr">
                    <span className="abzeichen shrink-0">KI</span>
                    <span>{e.pruefung_notiz}</span>
                  </p>
                  <p className="text-xs text-leise">
                    Diese Entscheidung wurde automatisch getroffen. Du kannst den Eintrag überarbeiten und erneut einreichen
                    oder eine Prüfung durch einen Moderator verlangen.
                  </p>
                  <button type="button" className="knopf-primaer px-3 py-1.5" onClick={() => aktion(() => api.menschlichePruefung('katalog', e.id), 'Ein Moderator prüft den Eintrag.')}>
                    Menschliche Überprüfung anfordern
                  </button>
                </div>
              )}
              <div className="mt-2 flex gap-2">
                {['privat', 'abgelehnt'].includes(e.status) && (
                  <button type="button" className="knopf-sekundaer px-3 py-1.5" onClick={() => aktion(() => api.katalogEinreichen(e.id), 'Zur Prüfung eingereicht.')}>
                    Für die globale Datenbank einreichen
                  </button>
                )}
                {e.status === 'eingereicht' && (
                  <button type="button" className="knopf-sekundaer px-3 py-1.5" onClick={() => aktion(() => api.katalogZurueckziehen(e.id), 'Einreichung zurückgezogen.')}>
                    Zurückziehen
                  </button>
                )}
              </div>
            </div>
          )}

          {daten.meineExemplare.length > 0 && (
            <section className="karte p-4">
              <h3 className="mb-2 font-semibold">In deiner Sammlung ({daten.meineExemplare.length})</h3>
              <ul className="divide-y divide-rand text-sm">
                {daten.meineExemplare.map((a) => (
                  <li key={a.id}>
                    <a href={`#/artikel/${a.id}`} className="flex items-center justify-between gap-2 py-2 hover:underline">
                      <span>{[a.modellnummer, a.farbe, a.edition].filter(Boolean).join(' · ') || a.titel}</span>
                      <span className="text-xs text-leise">{[beschriftung(REGIONEN, a.region, 'kurz'), beschriftung(VOLLSTAENDIGKEITEN, a.vollstaendigkeit, 'kurz')].filter(Boolean).join(' · ')}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="karte space-y-3 p-4 text-sm">
            <h3 className="flex items-center gap-2 font-semibold"><Symbol name="wert" className="size-5" />Wert & Verbreitung</h3>
            {pal && (
              <dl className="grid grid-cols-3 gap-2">
                {[['lose', 'Lose'], ['cib', 'CIB'], ['neu', 'Neu/OVP']].filter(([f]) => pal[f]).map(([f, l]) => (
                  <div key={f} className="rounded-lg bg-karte-hover px-2 py-1.5">
                    <dt className="text-xs text-leise">{l}</dt>
                    <dd className="font-bold tabular-nums">{euro(pal[f])}</dd>
                  </div>
                ))}
              </dl>
            )}
            <p>
              <strong>{anzahl(c.besitzer)}</strong> {c.besitzer === 1 ? 'Sammler besitzt' : 'Sammler besitzen'} das ·{' '}
              <strong>{anzahl(c.exemplare)}</strong> Exemplare
              {c.median_kaufpreis != null && <> · Median Kaufpreis <strong>{euro(c.median_kaufpreis)}</strong></>}
            </p>
          </section>

          <KaufenBox links={daten.kaufen} ebay={daten.ebayAngebote} />

          <VariantenListe katalogId={e.id} katalogTyp={e.typ} varianten={daten.varianten} onGeaendert={laden} />

          <PreisVerlauf katalogId={e.id} historie={daten.historie} darfMelden={Boolean(benutzer) && e.status === 'freigegeben'} onGeaendert={laden} />

          <ExterneLinks katalogId={e.id} links={daten.links} katalogFreigegeben={e.status === 'freigegeben'} onGeaendert={laden} />

          {benutzer && <Scans katalogId={e.id} nurLesen />}
          {!benutzer && daten.medienAnzahl > 0 && (
            <a href="#/" className="karte flex items-center gap-3 p-4 text-sm hover:bg-karte-hover">
              <Symbol name="dokument" className="size-6 shrink-0 text-akzent-hell" />
              <span className="flex-1">
                <strong className="block">Weitere Dateien zu diesem Spiel</strong>
                <span className="text-leise">
                  {daten.medienUebersicht.map((m) => `${m.anzahl}× ${beschriftung(MEDIENARTEN, m.art)}`).join(', ')} – nach der Anmeldung sichtbar.
                </span>
              </span>
              <span className="knopf-primaer shrink-0 px-3 py-1.5">Anmelden</span>
            </a>
          )}
          {benutzer && <Kommentare katalogId={e.id} />}
          {istModerator(benutzer) && <KauflinksVerwalten katalogId={e.id} onGeaendert={laden} />}
        </div>
      </div>
    </Layout>
  );
}

function KauflinksVerwalten({ katalogId, onGeaendert }) {
  const zeigeHinweis = useHinweis();
  const [offen, setOffen] = useState(false);
  const [links, setLinks] = useState([]);
  const [w, setW] = useState({ anbieter: '', titel: '', url: '', preis: '' });
  const laden = () => api.kauflinks(katalogId).then(setLinks);
  useEffect(() => { if (offen) laden(); }, [offen]);
  const setze = (f) => (e) => setW((x) => ({ ...x, [f]: e.target.value }));
  return (
    <section className="karte space-y-3 border-akzent/40 p-4 text-sm">
      <button type="button" className="flex w-full items-center justify-between font-semibold" onClick={() => setOffen((o) => !o)} aria-expanded={offen}>
        <span className="flex items-center gap-2"><Symbol name="schild" className="size-5" />Moderation: Kauflinks</span>
        <Symbol name={offen ? 'zurueck' : 'weiter'} className="size-4 -rotate-90" />
      </button>
      {offen && (
        <>
          <ul className="divide-y divide-rand">
            {links.map((l) => (
              <li key={l.id} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate">{l.anbieter} · {l.titel ?? l.url}{l.preis != null ? ` · ${euro(l.preis)}` : ''}</span>
                <button type="button" className="text-gefahr underline" onClick={async () => { await api.kauflinkLoeschen(l.id); laden(); onGeaendert(); }}>Entfernen</button>
              </li>
            ))}
          </ul>
          <form className="grid gap-2 sm:grid-cols-2" onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.kauflinkAnlegen(katalogId, w);
              setW({ anbieter: '', titel: '', url: '', preis: '' });
              laden();
              onGeaendert();
            } catch (err) { zeigeHinweis(Object.values(err.felder ?? {})[0] ?? err.message, 'fehler'); }
          }}>
            <input className="eingabe" value={w.anbieter} onChange={setze('anbieter')} placeholder="Shop (z. B. Amazon, RetroShop)" />
            <input className="eingabe" value={w.titel} onChange={setze('titel')} placeholder="Titel (z. B. CIB, PAL)" />
            <input className="eingabe sm:col-span-2" value={w.url} onChange={setze('url')} placeholder="https://… (Affiliate-Link)" inputMode="url" />
            <input className="eingabe" value={w.preis} onChange={setze('preis')} placeholder="Preis (optional)" inputMode="decimal" />
            <button type="submit" className="knopf-primaer">Kauflink hinzufügen</button>
          </form>
        </>
      )}
    </section>
  );
}

function KatalogBearbeiten({ eintrag, plattformIds, onFertig }) {
  const plattformen = usePlattformen();
  const zeigeHinweis = useHinweis();
  const [w, setW] = useState({
    titel: eintrag.titel, typ: eintrag.typ, erscheinungsjahr: eintrag.erscheinungsjahr ?? '', hersteller: eintrag.hersteller ?? '',
    cover_url: eintrag.cover_url ?? '', beschreibung: eintrag.beschreibung ?? '',
    sammlerhinweise: eintrag.sammlerhinweise ?? '', seo_titel: eintrag.seo_titel ?? '', seo_beschreibung: eintrag.seo_beschreibung ?? '',
  });
  const { benutzer } = useSitzung();
  const moderator = istModerator(benutzer);
  const [auswahl, setAuswahl] = useState(new Set(plattformIds));
  const setze = (f) => (e) => setW((x) => ({ ...x, [f]: e.target.value }));
  async function speichern(ev) {
    ev.preventDefault();
    try {
      const namen = plattformen.filter((p) => auswahl.has(p.id)).map((p) => p.name);
      await api.katalogAendern(eintrag.id, { ...w, plattformen: namen });
      zeigeHinweis('Katalogeintrag gespeichert.');
      onFertig(true);
    } catch (e) { zeigeHinweis(Object.values(e.felder ?? {})[0] ?? e.message, 'fehler'); }
  }
  return (
    <form onSubmit={speichern} className="karte space-y-3 border-akzent/40 p-4 text-sm">
      <h3 className="font-semibold">Katalogeintrag bearbeiten</h3>
      {eintrag.quelle === 'igdb' && <p className="text-xs text-leise">Aus IGDB übernommen – deine Änderungen werden bei späteren Importen nicht überschrieben.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2"><span className="beschriftung">Titel</span><input className="eingabe" value={w.titel} onChange={setze('titel')} /></label>
        <label><span className="beschriftung">Artikeltyp</span>
          <select className="eingabe" value={w.typ} onChange={setze('typ')}>{ARTIKELTYPEN.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
        </label>
        <label><span className="beschriftung">Erscheinungsjahr</span><input className="eingabe" inputMode="numeric" value={w.erscheinungsjahr} onChange={setze('erscheinungsjahr')} /></label>
        <label><span className="beschriftung">Hersteller / Publisher</span><input className="eingabe" value={w.hersteller} onChange={setze('hersteller')} /></label>
        <label><span className="beschriftung">Coverbild (https://…)</span><input className="eingabe" value={w.cover_url} onChange={setze('cover_url')} inputMode="url" /></label>
        <label className="sm:col-span-2"><span className="beschriftung">Beschreibung</span><textarea className="eingabe" rows={5} value={w.beschreibung} onChange={setze('beschreibung')} /></label>
        <label className="sm:col-span-2">
          <span className="beschriftung">Sammlerhinweise (Markdown)</span>
          <textarea className="eingabe font-mono text-xs" rows={6} value={w.sammlerhinweise} onChange={setze('sammlerhinweise')}
            placeholder={'## PAL-Versionen\n- **Erstauflage:** rotes USK-Logo, mehrsprachige Anleitung\n- **Players Choice:** …\n\n## Lieferumfang\n- Modul, Anleitung, Karton, Poster'} />
          <span className="text-xs text-leise">Eigene Worte statt kopierter Texte – z. B. Varianten, Lieferumfang, Revisionen, Fälschungsmerkmale. Erscheint auch auf der öffentlichen Seite.</span>
        </label>
      </div>
      {moderator && (
        <details className="rounded-xl border border-rand p-3">
          <summary className="cursor-pointer font-semibold">Suchmaschinen (optional)</summary>
          <p className="mt-2 text-xs text-leise">Leer lassen = automatisch aus Titel, Plattform, Jahr, Preisen und Sammleranzahl erzeugt.</p>
          <div className="mt-2 grid gap-3">
            <label><span className="beschriftung">Seitentitel ({w.seo_titel.length}/60 empfohlen)</span>
              <input className="eingabe" maxLength={120} value={w.seo_titel} onChange={setze('seo_titel')} placeholder="z. B. Super Mario 64 (N64) – Wert & PAL-Varianten" /></label>
            <label><span className="beschriftung">Beschreibung ({w.seo_beschreibung.length}/155 empfohlen)</span>
              <textarea className="eingabe" rows={3} maxLength={300} value={w.seo_beschreibung} onChange={setze('seo_beschreibung')} /></label>
          </div>
        </details>
      )}
      <fieldset>
        <legend className="beschriftung">Plattformen</legend>
        <div className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-rand p-2">
          {nachHersteller(plattformen).map(([hersteller, liste]) => (
            <div key={hersteller}>
              <p className="text-xs font-semibold text-leise">{hersteller}</p>
              <div className="flex flex-wrap gap-1.5 py-1">
                {liste.map((p) => {
                  const an = auswahl.has(p.id);
                  return (
                    <button key={p.id} type="button" aria-pressed={an} className={`${an ? 'chip-aktiv' : 'chip'} px-2.5 py-1 text-xs`}
                      onClick={() => setAuswahl((a) => { const n = new Set(a); if (an) n.delete(p.id); else n.add(p.id); return n; })}>{p.kurz}</button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </fieldset>
      <div className="flex gap-2">
        <button type="button" className="knopf-sekundaer" onClick={() => onFertig(false)}>Abbrechen</button>
        <button type="submit" className="knopf-primaer">Speichern</button>
      </div>
    </form>
  );
}
