// Moderation: Einreichungen (Katalog, Varianten, Scans) prüfen und Plattformen pflegen.
import { useEffect, useState } from 'react';
import { ARTIKELTYPEN, MEDIENARTEN, REGIONEN, beschriftung } from '../../../shared/konstanten.js';
import { api } from '../api.js';
import { datumDe, dateigroesse } from '../format.js';
import { ladePlattformenNeu, nachHersteller, usePlattformen } from '../plattformen.js';
import Layout from '../komponenten/Layout.jsx';
import Symbol from '../komponenten/Symbole.jsx';
import { useHinweis } from '../komponenten/Hinweise.jsx';

const REITER = [['katalog', 'Katalog'], ['varianten', 'Varianten'], ['medien', 'Scans'], ['plattformen', 'Plattformen']];

export default function Moderation({ route }) {
  const zeigeHinweis = useHinweis();
  const reiter = route.parameter.reiter ?? 'katalog';
  const [schlange, setSchlange] = useState(null);

  const laden = () => api.warteschlange().then(setSchlange).catch((e) => zeigeHinweis(e.message, 'fehler'));
  useEffect(() => { laden(); }, []);

  const entscheide = async (bereich, id, aktion, daten = {}) => {
    try {
      await api.moderiere(bereich, id, aktion, daten);
      zeigeHinweis(aktion === 'freigeben' ? 'Freigegeben.' : aktion === 'ablehnen' ? 'Abgelehnt.' : 'Zusammengeführt.');
      laden();
    } catch (e) {
      zeigeHinweis(Object.values(e.felder ?? {})[0] ?? e.message, 'fehler');
    }
  };
  const ablehnen = (bereich, id) => {
    const grund = window.prompt('Begründung für die Ablehnung (wird dem Nutzer angezeigt):');
    if (grund !== null) entscheide(bereich, id, 'ablehnen', { grund });
  };

  return (
    <Layout route={route} titel="Moderation" zurueck="/einstellungen">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4" role="tablist">
          {REITER.map(([wert, label]) => (
            <a key={wert} href={`#/moderation?reiter=${wert}`} role="tab" aria-selected={reiter === wert} className={reiter === wert ? 'chip-aktiv' : 'chip'}>
              {label}{schlange && wert !== 'plattformen' && schlange[wert].length > 0 && <span className="ml-1 rounded-full bg-warnung px-1.5 text-[11px] text-black">{schlange[wert].length}</span>}
            </a>
          ))}
        </div>

        {!schlange && reiter !== 'plattformen' && <p className="text-leise">Wird geladen …</p>}

        {schlange && reiter === 'katalog' && (
          <Liste leer="Keine offenen Katalog-Einreichungen." eintraege={schlange.katalog} render={(k) => (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <a href={`#/katalog/${k.id}`} className="font-semibold hover:underline">{k.titel}</a>
                <span className="abzeichen">{beschriftung(ARTIKELTYPEN, k.typ)}</span>
                {k.plattformen.map((p) => <span key={p} className="abzeichen">{p}</span>)}
                {k.erscheinungsjahr && <span className="abzeichen">{k.erscheinungsjahr}</span>}
              </div>
              <p className="text-xs text-leise">von {k.eingereicht_von} · {datumDe(k.eingereicht_am)} · in {k.artikel_anzahl} Sammlung(en)</p>
              {k.beschreibung && <p className="text-sm">{k.beschreibung}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="knopf-primaer px-3 py-1.5" onClick={() => entscheide('katalog', k.id, 'freigeben')}>Freigeben</button>
                <button type="button" className="knopf-gefahr px-3 py-1.5" onClick={() => ablehnen('katalog', k.id)}>Ablehnen</button>
                <Zusammenfuehren eintrag={k} onZiel={(ziel) => entscheide('katalog', k.id, 'zusammenfuehren', { ziel_id: ziel.id })} />
              </div>
            </>
          )} />
        )}

        {schlange && reiter === 'varianten' && (
          <Liste leer="Keine offenen Varianten." eintraege={schlange.varianten} render={(v) => (
            <>
              <p><strong>{v.bezeichnung}</strong> für <a href={`#/katalog/${v.katalog_id}`} className="underline">{v.katalog_titel}</a></p>
              <p className="text-xs text-leise">
                {[v.modellnummer, v.farbe, v.edition, beschriftung(REGIONEN, v.region, 'kurz'), v.erscheinungsjahr].filter(Boolean).join(' · ')}
                {' · '}von {v.eingereicht_von}
              </p>
              {v.beschreibung && <p className="text-sm">{v.beschreibung}</p>}
              <div className="flex gap-2">
                <button type="button" className="knopf-primaer px-3 py-1.5" onClick={() => entscheide('varianten', v.id, 'freigeben')}>Freigeben</button>
                <button type="button" className="knopf-gefahr px-3 py-1.5" onClick={() => ablehnen('varianten', v.id)}>Ablehnen</button>
              </div>
            </>
          )} />
        )}

        {schlange && reiter === 'medien' && (
          <Liste leer="Keine offenen Scans." eintraege={schlange.medien} render={(m) => (
            <div className="flex gap-3">
              <a href={m.url} target="_blank" rel="noreferrer" className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-karte-hover">
                {m.vorschau_url ? <img src={m.vorschau_url} alt="" className="size-full object-contain" /> : <Symbol name="dokument" className="size-10 text-leise" />}
              </a>
              <div className="min-w-0 flex-1 space-y-1">
                <p><strong>{beschriftung(MEDIENARTEN, m.art)}</strong>{m.titel ? ` – ${m.titel}` : ''} für <a href={`#/katalog/${m.katalog_id}`} className="underline">{m.katalog_titel}</a></p>
                <p className="text-xs text-leise">
                  {m.breite ? `${m.breite}×${m.hoehe} px` : m.seiten ? `${m.seiten} Seiten` : 'PDF'}{m.dpi ? ` · ${m.dpi} dpi` : ''} · {dateigroesse(m.groesse)} · von {m.eingereicht_von}
                </p>
                <p className="text-xs text-warnung">Urheberrecht prüfen: Nur freigeben, wenn das Teilen zulässig ist.</p>
                <div className="flex gap-2">
                  <button type="button" className="knopf-primaer px-3 py-1.5" onClick={() => entscheide('medien', m.id, 'freigeben')}>Freigeben</button>
                  <button type="button" className="knopf-gefahr px-3 py-1.5" onClick={() => ablehnen('medien', m.id)}>Ablehnen</button>
                </div>
              </div>
            </div>
          )} />
        )}

        {reiter === 'plattformen' && <PlattformenPflegen />}
      </div>
    </Layout>
  );
}

function Liste({ eintraege, render, leer }) {
  if (!eintraege.length) return <p className="karte p-4 text-sm text-leise">{leer}</p>;
  return (
    <ul className="space-y-3">
      {eintraege.map((e) => <li key={e.id} className="karte space-y-2 p-4">{render(e)}</li>)}
    </ul>
  );
}

function Zusammenfuehren({ eintrag, onZiel }) {
  const [offen, setOffen] = useState(false);
  const [q, setQ] = useState(eintrag.titel);
  const [treffer, setTreffer] = useState([]);
  useEffect(() => {
    if (!offen || q.trim().length < 2) return undefined;
    const t = setTimeout(() => api.katalogSuche(q, eintrag.typ).then((r) => setTreffer([...r.lokal, ...r.online]
      .filter((k) => k.id !== eintrag.id && k.status === 'freigegeben'))), 300);
    return () => clearTimeout(t);
  }, [q, offen]);
  if (!offen) return <button type="button" className="knopf-sekundaer px-3 py-1.5" onClick={() => setOffen(true)}>Duplikat? Zusammenführen …</button>;
  return (
    <div className="w-full space-y-2 rounded-xl border border-rand p-3">
      <input className="eingabe" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Bestehenden Eintrag suchen" />
      <ul className="max-h-60 divide-y divide-rand overflow-y-auto text-sm">
        {treffer.map((k) => (
          <li key={k.id} className="flex items-center justify-between gap-2 py-1.5">
            <span>{k.titel} <span className="text-leise">{[k.erscheinungsjahr, k.quelle === 'igdb' ? 'IGDB' : null].filter(Boolean).join(' · ')}</span></span>
            <button type="button" className="knopf-primaer px-2.5 py-1 text-xs" onClick={() => window.confirm(`„${eintrag.titel}“ in „${k.titel}“ zusammenführen? Alle Artikel, Scans und Kommentare werden übernommen.`) && onZiel(k)}>
              Übernehmen
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="text-sm underline" onClick={() => setOffen(false)}>Abbrechen</button>
    </div>
  );
}

function PlattformenPflegen() {
  const zeigeHinweis = useHinweis();
  const plattformen = usePlattformen();
  const leer = { id: null, name: '', kurz: '', hersteller: '', typ: 'konsole', erscheinungsjahr: '', aliase: '' };
  const [w, setW] = useState(leer);
  const setze = (f) => (e) => setW((x) => ({ ...x, [f]: e.target.value }));
  async function speichern(e) {
    e.preventDefault();
    try {
      if (w.id) await api.plattformAendern(w.id, w); else await api.plattformAnlegen(w);
      zeigeHinweis('Plattform gespeichert.');
      setW(leer);
      ladePlattformenNeu();
    } catch (err) { zeigeHinweis(Object.values(err.felder ?? {})[0] ?? err.message, 'fehler'); }
  }
  return (
    <div className="space-y-4">
      <form onSubmit={speichern} className="karte grid gap-3 p-4 sm:grid-cols-3">
        <h2 className="font-semibold sm:col-span-3">{w.id ? `Plattform bearbeiten: ${w.name}` : 'Neue Plattform'}</h2>
        <input className="eingabe" value={w.name} onChange={setze('name')} placeholder="Name (z. B. Evercade)" />
        <input className="eingabe" value={w.kurz} onChange={setze('kurz')} placeholder="Kürzel (z. B. EVC)" />
        <input className="eingabe" value={w.hersteller} onChange={setze('hersteller')} placeholder="Hersteller" />
        <select className="eingabe" value={w.typ} onChange={setze('typ')}>
          <option value="konsole">Konsole</option><option value="handheld">Handheld</option><option value="computer">Computer</option><option value="sonstige">Sonstige</option>
        </select>
        <input className="eingabe" value={w.erscheinungsjahr ?? ''} onChange={setze('erscheinungsjahr')} placeholder="Jahr" inputMode="numeric" />
        <input className="eingabe" value={w.aliase} onChange={setze('aliase')} placeholder="Alternative Namen, kommagetrennt" />
        <div className="flex gap-2 sm:col-span-3">
          {w.id && <button type="button" className="knopf-sekundaer" onClick={() => setW(leer)}>Abbrechen</button>}
          <button type="submit" className="knopf-primaer">Speichern</button>
        </div>
      </form>
      {nachHersteller(plattformen).map(([hersteller, liste]) => (
        <section key={hersteller} className="karte p-4">
          <h3 className="mb-2 text-sm font-semibold text-leise uppercase">{hersteller}</h3>
          <ul className="flex flex-wrap gap-2">
            {liste.map((p) => (
              <li key={p.id}>
                <button type="button" className="chip" title={p.aliase.join(', ')}
                  onClick={() => setW({ ...p, erscheinungsjahr: p.erscheinungsjahr ?? '', aliase: p.aliase.join(', ') })}>
                  <strong>{p.kurz}</strong> {p.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
