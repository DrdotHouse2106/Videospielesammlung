// Admin → Einstellungen: Server-Einstellungen über die Weboberfläche (Vorrang vor der .env, wirken sofort).
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { datumDe } from '../format.js';
import { useSitzung } from '../sitzung.js';
import Symbol from '../komponenten/Symbole.jsx';
import { useHinweis } from '../komponenten/Hinweise.jsx';

const HERKUNFT = {
  web: ['Weboberfläche', 'text-akzent-hell'],
  env: ['.env', 'text-erfolg'],
  standard: ['Standard', ''],
};

export default function AdminEinstellungen() {
  const { benutzer } = useSitzung();
  const zeigeHinweis = useHinweis();
  const [daten, setDaten] = useState(null);
  const [werte, setWerte] = useState({});
  const [zuruecksetzen, setZuruecksetzen] = useState(new Set());
  const [entfernen, setEntfernen] = useState(new Set());
  const [fehler, setFehler] = useState({});
  const [bestaetigung, setBestaetigung] = useState(null); // { passwort, code }
  const [speichert, setSpeichert] = useState(false);

  const laden = () => api.adminEinstellungen().then((d) => { setDaten(d); setWerte({}); setZuruecksetzen(new Set()); setEntfernen(new Set()); setFehler({}); })
    .catch((e) => zeigeHinweis(e.message, 'fehler'));
  useEffect(() => { laden(); }, []);

  const gruppen = useMemo(() => {
    const m = new Map();
    for (const e of daten?.einstellungen ?? []) {
      if (!m.has(e.gruppe)) m.set(e.gruppe, []);
      m.get(e.gruppe).push(e);
    }
    return [...m];
  }, [daten]);

  if (!daten) return <p className="text-leise">Wird geladen …</p>;

  const perSchluessel = new Map(daten.einstellungen.map((e) => [e.schluessel, e]));
  const geaendert = [
    ...Object.keys(werte).filter((k) => !(perSchluessel.get(k)?.typ === 'geheim' && !werte[k])),
    ...zuruecksetzen, ...entfernen,
  ];
  const sicherheitsrelevant = geaendert.some((k) => perSchluessel.get(k)?.sicher);

  const setze = (k, w) => {
    setWerte((x) => ({ ...x, [k]: w }));
    setZuruecksetzen((s) => { const n = new Set(s); n.delete(k); return n; });
    setEntfernen((s) => { const n = new Set(s); n.delete(k); return n; });
  };
  const umschalten = (setter, k) => {
    setter((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
    setWerte((x) => { const { [k]: _weg, ...rest } = x; return rest; });
  };

  async function speichern(bestaetigt) {
    if (sicherheitsrelevant && !bestaetigt) {
      setBestaetigung({ passwort: '', code: '' });
      return;
    }
    setSpeichert(true);
    try {
      const antwort = await api.adminEinstellungenSpeichern({
        werte, zuruecksetzen: [...zuruecksetzen], entfernen: [...entfernen],
        ...(bestaetigt ? { passwort: bestaetigt.passwort, code: bestaetigt.code } : {}),
      });
      setBestaetigung(null);
      zeigeHinweis(antwort.geaendert.length ? `${antwort.geaendert.length} Einstellung(en) gespeichert – sofort aktiv.` : 'Keine Änderungen.');
      setDaten({ ...daten, einstellungen: antwort.einstellungen, protokoll: antwort.protokoll, affiliate: antwort.affiliate });
      setWerte({}); setZuruecksetzen(new Set()); setEntfernen(new Set()); setFehler({});
    } catch (e) {
      if (e.felder) setFehler(e.felder);
      if (e.code === 'bestaetigung_noetig' && bestaetigt) zeigeHinweis(e.message, 'fehler');
      else if (e.code === 'bestaetigung_noetig') setBestaetigung({ passwort: '', code: '' });
      else { setBestaetigung(null); zeigeHinweis(Object.values(e.felder ?? {})[0] ?? e.message, 'fehler'); }
    } finally {
      setSpeichert(false);
    }
  }

  return (
    <div className="space-y-4 pb-24">
      <p className="karte p-3 text-sm text-leise">
        Hier gesetzte Werte haben <strong className="text-text">Vorrang vor der .env</strong> und wirken sofort – ohne Neustart.
        Die .env bleibt die Grundeinstellung: „Auf .env-Wert zurücksetzen“ entfernt den Wert aus der Datenbank.
        API-Schlüssel werden verschlüsselt gespeichert und nie wieder vollständig angezeigt.
        Änderungen mit <Symbol name="schloss" className="inline size-3.5" /> erfordern dein Passwort{benutzer?.totp_aktiv ? ' und einen 2FA-Code' : ''}.
      </p>

      {gruppen.map(([gruppe, liste]) => (
        <section key={gruppe} className="karte space-y-4 p-4">
          <h2 className="font-semibold">{gruppe}</h2>
          {gruppe.startsWith('Affiliate') && daten.affiliate && <AffiliateStatus a={daten.affiliate} />}
          {liste.map((e) => (
            <Feld key={e.schluessel} e={e} wert={werte[e.schluessel]} fehler={fehler[e.schluessel]}
              zuruecksetzenVorgemerkt={zuruecksetzen.has(e.schluessel)} entfernenVorgemerkt={entfernen.has(e.schluessel)}
              onWert={(w) => setze(e.schluessel, w)}
              onZuruecksetzen={() => umschalten(setZuruecksetzen, e.schluessel)}
              onEntfernen={() => umschalten(setEntfernen, e.schluessel)} />
          ))}
        </section>
      ))}

      <section className="karte space-y-2 p-4">
        <h2 className="font-semibold">Nur über die .env änderbar</h2>
        <p className="text-sm text-leise">
          Diese Werte betreffen Pfade, Netzwerk und Verschlüsselung. Eine Fehleinstellung könnte den Server aussperren oder unsicher machen –
          deshalb bleiben sie der .env vorbehalten (Änderung erfordert einen Neustart):
        </p>
        <div className="flex flex-wrap gap-1.5">{daten.nurEnv.map((k) => <code key={k} className="abzeichen">{k}</code>)}</div>
      </section>

      <section className="karte space-y-2 p-4">
        <h2 className="font-semibold">Änderungsprotokoll</h2>
        {daten.protokoll.length === 0 ? <p className="text-sm text-leise">Noch keine Änderungen über die Weboberfläche.</p> : (
          <ul className="divide-y divide-rand text-sm">
            {daten.protokoll.map((p) => (
              <li key={p.id} className="py-2">
                <p><strong>{p.titel}</strong> <span className="text-leise">· {p.aktion === 'zurueckgesetzt' ? 'auf .env zurückgesetzt' : p.aktion === 'entfernt' ? 'entfernt' : 'geändert'}</span></p>
                <p className="text-xs break-all text-leise">
                  {p.alt ?? '–'} → {p.neu ?? '–'} · {p.benutzer ?? 'unbekannt'} · {datumDe(p.erstellt_am)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {geaendert.length > 0 && (
        <div className="fixed inset-x-0 bottom-20 z-40 px-4 md:bottom-4">
          <div className="karte mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 border-akzent/60 p-3 shadow-xl">
            <span className="text-sm">{geaendert.length} ungespeicherte Änderung(en){sicherheitsrelevant ? ' – Bestätigung nötig' : ''}</span>
            <div className="flex gap-2">
              <button type="button" className="knopf-sekundaer px-3 py-1.5" onClick={laden}>Verwerfen</button>
              <button type="button" className="knopf-primaer px-3 py-1.5" disabled={speichert} onClick={() => speichern(null)}>
                {sicherheitsrelevant && <Symbol name="schloss" className="size-4" />}Speichern
              </button>
            </div>
          </div>
        </div>
      )}

      {bestaetigung && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Änderung bestätigen">
          <form className="karte w-full max-w-sm space-y-3 p-4" onSubmit={(ev) => { ev.preventDefault(); speichern(bestaetigung); }}>
            <h2 className="text-lg font-semibold">Änderung bestätigen</h2>
            <p className="text-sm text-leise">Diese Änderung betrifft Schlüssel oder sicherheitsrelevante Einstellungen.</p>
            <label className="block"><span className="beschriftung">Dein Passwort</span>
              <input className="eingabe" type="password" autoComplete="current-password" autoFocus value={bestaetigung.passwort}
                onChange={(ev) => setBestaetigung({ ...bestaetigung, passwort: ev.target.value })} /></label>
            {benutzer?.totp_aktiv && (
              <label className="block"><span className="beschriftung">2FA-Code</span>
                <input className="eingabe" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={bestaetigung.code}
                  onChange={(ev) => setBestaetigung({ ...bestaetigung, code: ev.target.value.replace(/\D/g, '') })} /></label>
            )}
            <div className="flex gap-2">
              <button type="button" className="knopf-sekundaer" onClick={() => setBestaetigung(null)}>Abbrechen</button>
              <button type="submit" className="knopf-primaer" disabled={speichert || !bestaetigung.passwort}>Bestätigen & speichern</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Feld({ e, wert, fehler, zuruecksetzenVorgemerkt, entfernenVorgemerkt, onWert, onZuruecksetzen, onEntfernen }) {
  const [herkunftText, herkunftFarbe] = HERKUNFT[e.herkunft];
  const aktuell = wert ?? e.wert ?? '';
  const id = `einstellung-${e.schluessel}`;
  let eingabe;
  if (e.typ === 'jaNein') {
    const an = ['true', '1', 'ja', 'yes', 'on'].includes(String(aktuell).toLowerCase());
    eingabe = (
      <select id={id} className="eingabe" value={e.wert === '' && wert === undefined ? '' : an ? 'true' : 'false'} onChange={(ev) => onWert(ev.target.value)}>
        {e.wert === '' && wert === undefined && <option value="" disabled>Standard</option>}
        <option value="true">Ja</option>
        <option value="false">Nein</option>
      </select>
    );
  } else if (e.typ === 'auswahl') {
    eingabe = (
      <select id={id} className="eingabe" value={aktuell || e.optionen[0][0]} onChange={(ev) => onWert(ev.target.value)}>
        {e.optionen.map(([w, l]) => <option key={w} value={w}>{l}</option>)}
      </select>
    );
  } else if (e.typ === 'geheim') {
    eingabe = (
      <input id={id} className="eingabe font-mono" type="password" autoComplete="new-password" value={wert ?? ''} onChange={(ev) => onWert(ev.target.value)}
        placeholder={e.gesetzt ? `${e.maskiert} – neuen Wert eingeben (leer = unverändert)` : 'Nicht gesetzt – Wert eingeben'} />
    );
  } else {
    eingabe = (
      <input id={id} className="eingabe" value={aktuell} onChange={(ev) => onWert(ev.target.value)} placeholder={e.platzhalter ?? ''}
        inputMode={e.typ === 'zahl' ? 'numeric' : e.typ === 'dezimal' ? 'decimal' : e.typ === 'url' ? 'url' : undefined} />
    );
  }
  return (
    <div className={`space-y-1 ${zuruecksetzenVorgemerkt || entfernenVorgemerkt ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-sm font-semibold">{e.titel}</label>
        {e.sicher && <Symbol name="schloss" className="size-3.5 text-leise" titel="Bestätigung mit Passwort nötig" />}
        <span className={`abzeichen text-[11px] ${herkunftFarbe}`}>{herkunftText}</span>
        <code className="text-[11px] text-leise">{e.schluessel}</code>
      </div>
      {eingabe}
      {fehler && <p className="text-xs text-gefahr" role="alert">{fehler}</p>}
      {e.hinweis && <p className="text-xs text-leise">{e.hinweis}</p>}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {e.herkunft === 'web' && (
          <>
            <span className="text-leise">
              In der .env: {e.env_wert !== '' ? <code>{e.env_wert}</code> : 'nicht gesetzt'}
              {e.geaendert_am ? ` · geändert ${datumDe(e.geaendert_am)}${e.geaendert_von ? ` von ${e.geaendert_von}` : ''}` : ''}
            </span>
            <button type="button" className="text-akzent-hell underline" onClick={onZuruecksetzen}>
              {zuruecksetzenVorgemerkt ? 'Zurücksetzen rückgängig' : 'Auf .env-Wert zurücksetzen'}
            </button>
          </>
        )}
        {e.typ === 'geheim' && e.gesetzt && (
          <button type="button" className="text-gefahr underline" onClick={onEntfernen}>
            {entfernenVorgemerkt ? 'Entfernen rückgängig' : 'Schlüssel entfernen'}
          </button>
        )}
      </div>
    </div>
  );
}

const QUELLE = {
  eigen: 'eigene ID aus .env bzw. Einstellungen',
  standard: 'Standard-ID aus dem Code (Domain freigegeben)',
  keine: 'keine ID – Links ohne Partnerkennung',
};

function AffiliateStatus({ a }) {
  return (
    <div className="rounded-xl border border-rand p-3 text-xs text-leise">
      {!a.aktiv ? <p>Kauflinks sind abgeschaltet.</p> : (
        <>
          <p><strong className="text-text">Amazon:</strong> {QUELLE[a.amazon]}</p>
          <p><strong className="text-text">eBay:</strong> {QUELLE[a.ebay]}</p>
        </>
      )}
      <p className="mt-1">
        Standard-IDs aus dem Code gelten nur, wenn die öffentliche Adresse (PUBLIC_URL) auf eine dieser Domains zeigt:{' '}
        {a.domains.length ? a.domains.join(', ') : 'keine eingetragen'}. Partnerprogramme erlauben Links nur auf Websites,
        die im Partnerkonto angemeldet sind – trage hier deshalb eigene IDs ein, wenn du eine eigene Installation betreibst.
      </p>
    </div>
  );
}
