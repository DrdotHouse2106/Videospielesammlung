// Seite eines Spiels/Geräts im globalen Katalog – auch ohne Anmeldung erreichbar (PUBLIC_CATALOG).
import { useEffect, useState } from 'react';
import {
  ARTIKELTYPEN, REGIONEN, VOLLSTAENDIGKEITEN, beschriftung, istModerator,
} from '../../../shared/konstanten.js';
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

  return (
    <Layout route={route} titel={e.titel} zurueck="/katalog">
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
          <div className="space-y-2">
            <h2 className="text-2xl font-bold">{e.titel}</h2>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="abzeichen">{beschriftung(ARTIKELTYPEN, e.typ)}</span>
              {daten.plattformen.map((p) => (
                <a key={p.id} href={`#/katalog?plattform=${p.id}`} className="abzeichen text-akzent-hell hover:underline" title={p.name}>{p.kurz}</a>
              ))}
              {e.erscheinungsjahr && <span className="abzeichen">{e.erscheinungsjahr}</span>}
              {e.status !== 'freigegeben' && <StatusAbzeichen status={e.status} />}
            </div>
            {e.hersteller && <p className="text-sm text-leise">{e.hersteller}</p>}
            {e.beschreibung && <p className="line-clamp-6 text-sm whitespace-pre-line">{e.beschreibung}</p>}
          </div>

          {e.eigener && e.status !== 'freigegeben' && (
            <div className="rounded-xl border border-rand p-3 text-sm">
              {e.status === 'privat' && <p>Dieser Eintrag ist <strong>privat</strong> – nur du siehst ihn.</p>}
              {e.status === 'eingereicht' && <p>Eingereicht – das Moderationsteam prüft den Eintrag.</p>}
              {e.status === 'abgelehnt' && <p className="text-gefahr">Abgelehnt{e.pruefung_notiz ? `: ${e.pruefung_notiz}` : ''}</p>}
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

          <KaufenBox links={daten.kaufen} />

          <VariantenListe katalogId={e.id} katalogTyp={e.typ} varianten={daten.varianten} onGeaendert={laden} />

          <PreisVerlauf katalogId={e.id} historie={daten.historie} darfMelden={Boolean(benutzer) && e.status === 'freigegeben'} onGeaendert={laden} />

          {benutzer && <Scans katalogId={e.id} nurLesen />}
          {!benutzer && daten.medienAnzahl > 0 && (
            <p className="karte p-4 text-sm text-leise">{daten.medienAnzahl} Scans (Cover, Handbuch …) von Nutzern – nach der Anmeldung sichtbar.</p>
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
