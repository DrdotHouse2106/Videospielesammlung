// Bausteine der Tauschbörse: Angebotskarte, Anbieter-Abzeichen, Formulare für Angebot und Wunsch,
// Kasten auf der Katalogseite.
import { useEffect, useState } from 'react';
import {
  ANGEBOTSARTEN, ANGEBOTSSTATUS, REGIONEN, ZUSTAENDE, VOLLSTAENDIGKEITEN, beschriftung,
} from '../../../shared/konstanten.js';
import { api } from '../api.js';
import { euro, preisFeld } from '../format.js';
import { navigiere } from '../router.js';
import Cover from './Cover.jsx';
import Symbol from './Symbole.jsx';
import { useHinweis } from './Hinweise.jsx';

const ersterFehler = (err) => Object.values(err.felder ?? {})[0] ?? err.message;

/** Preisangabe eines Angebots: „24,90 €“, „VB 24,90 €“, „Preis auf Anfrage“ oder „Nur Tausch“. */
export function preisText(a) {
  if (a.art === 'tausch') return 'Nur Tausch';
  if (a.preis == null) return 'Preis auf Anfrage';
  return `${a.verhandelbar ? 'VB ' : ''}${euro(a.preis)}`;
}

export function Bewertung({ bewertung, klein = false }) {
  if (!bewertung?.gesamt) return <span className="text-xs text-leise">Noch keine Bewertungen</span>;
  const anteil = Math.round((bewertung.positiv / bewertung.gesamt) * 100);
  return (
    <span className={`${klein ? 'text-xs' : 'text-sm'} text-leise`} title={`${bewertung.positiv} positiv · ${bewertung.neutral} neutral · ${bewertung.negativ} negativ`}>
      👍 {anteil} % positiv ({bewertung.gesamt})
    </span>
  );
}

export function AnbieterAbzeichen({ anbieter }) {
  if (!anbieter?.gewerblich) return <span className="abzeichen">Privat</span>;
  return (
    <span className={`abzeichen ${anbieter.verifiziert ? 'bg-erfolg/15 text-erfolg' : ''}`}
      title={anbieter.verifiziert ? 'Gewerblicher Anbieter – Angaben vom Betreiber geprüft' : 'Gewerblicher Anbieter'}>
      {anbieter.verifiziert ? '✓ Händler' : 'Händler'}
    </span>
  );
}

export function AngebotKarte({ angebot: a, mitTitel = true }) {
  const details = [
    a.plattform_kurz,
    beschriftung(REGIONEN, a.region, 'kurz'),
    beschriftung(VOLLSTAENDIGKEITEN, a.vollstaendigkeit, 'kurz'),
    beschriftung(ZUSTAENDE, a.zustand),
    a.variante,
  ].filter(Boolean);
  return (
    <a href={`#/boerse/angebot/${a.id}`} className="karte flex gap-3 p-3 hover:bg-karte-hover">
      {(mitTitel || a.foto) && (
        <div className="relative shrink-0">
          <Cover url={a.foto ?? a.cover_url} typ={a.typ} alt="" className="aspect-[3/4] w-14 rounded-lg" />
          {a.fotos_anzahl > 0 && <span className="absolute right-0.5 bottom-0.5 rounded bg-black/70 px-1 text-[10px] text-white">📷 {a.fotos_anzahl}</span>}
        </div>
      )}
      <div className="min-w-0 flex-1">
        {mitTitel && <p className="truncate font-semibold">{a.titel}</p>}
        <p className="truncate text-xs text-leise">{details.join(' · ') || 'Keine Angaben zum Zustand'}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-leise">
          <AnbieterAbzeichen anbieter={a.anbieter} />
          <span>{a.anbieter?.name}</span>
          {a.art !== 'verkauf' && <span className="abzeichen">{a.art === 'tausch' ? 'Tausch' : 'Tausch möglich'}</span>}
          {a.status === 'reserviert' && <span className="abzeichen bg-warnung/20 text-warnung">Reserviert</span>}
          {a.abholung && a.plz_bereich && <span>Abholung {a.plz_bereich}xxx</span>}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-bold tabular-nums">{preisText(a)}</p>
        {a.anzahl > 1 && <p className="text-xs text-leise">{a.anzahl} Stück</p>}
        {a.gesucht_von > 0 && <p className="text-xs text-akzent-hell">{a.gesucht_von} suchen das</p>}
      </div>
    </a>
  );
}

function Modal({ titel, onSchliessen, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={titel}>
      <div className="karte max-h-[90dvh] w-full max-w-lg overflow-y-auto p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{titel}</h2>
          <button type="button" className="rounded-lg p-1.5 text-leise hover:bg-karte-hover" aria-label="Schließen" onClick={onSchliessen}>
            <Symbol name="schliessen" className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Auswahl({ label, wert, onChange, liste, leer = 'Keine Angabe', feld = 'label' }) {
  return (
    <label className="block">
      <span className="beschriftung">{label}</span>
      <select className="eingabe" value={wert ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{leer}</option>
        {liste.map((e) => <option key={e.value} value={e.value}>{e[feld] ?? e.label}</option>)}
      </select>
    </label>
  );
}

/**
 * Angebot anlegen oder bearbeiten. Beim Anlegen entweder für einen Katalogeintrag (`katalogId`)
 * oder aus einem Exemplar der Sammlung (`artikel`).
 */
export function AngebotFormular({ angebot, katalogId, artikel, plattformen = [], varianten = [], onFertig }) {
  const zeigeHinweis = useHinweis();
  const quelle = angebot ?? artikel ?? {};
  const [w, setW] = useState({
    art: angebot?.art ?? 'verkauf',
    preis: preisFeld(angebot?.preis ?? null),
    verhandelbar: angebot?.verhandelbar ?? false,
    zustand: quelle.zustand ?? null,
    vollstaendigkeit: quelle.vollstaendigkeit ?? null,
    region: quelle.region ?? null,
    plattform_id: quelle.plattform_id ?? (plattformen.length === 1 ? plattformen[0].id : null),
    variante_id: quelle.variante_id ?? null,
    beschreibung: angebot?.beschreibung ?? '',
    anzahl: angebot?.anzahl ?? 1,
    versand: angebot?.versand ?? true,
    abholung: angebot?.abholung ?? false,
    plz_bereich: angebot?.plz_bereich ?? '',
  });
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState(null);
  const setze = (feld) => (wert) => setW((alt) => ({ ...alt, [feld]: wert }));

  async function speichern(e) {
    e.preventDefault();
    setLaeuft(true);
    setFehler(null);
    try {
      const daten = { ...w, preis: w.art === 'tausch' ? '' : w.preis };
      const ergebnis = angebot
        ? await api.angebotAendern(angebot.id, daten)
        : await api.angebotAnlegen({ ...daten, ...(artikel ? { artikel_id: artikel.id } : { katalog_id: katalogId }) });
      zeigeHinweis(angebot ? 'Angebot gespeichert.' : 'Angebot eingestellt. Sammler mit passender Wunschliste werden informiert.');
      onFertig(ergebnis);
    } catch (err) {
      setFehler(ersterFehler(err));
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <Modal titel={angebot ? 'Angebot bearbeiten' : 'Anbieten'} onSchliessen={() => onFertig(null)}>
      <form onSubmit={speichern} className="space-y-3">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Angebotsart">
          {ANGEBOTSARTEN.map((a) => (
            <button key={a.value} type="button" role="radio" aria-checked={w.art === a.value}
              className={w.art === a.value ? 'chip-aktiv' : 'chip'} onClick={() => setze('art')(a.value)}>{a.label}</button>
          ))}
        </div>
        {w.art !== 'tausch' && (
          <div className="grid grid-cols-[1fr_auto] items-end gap-3">
            <label className="block">
              <span className="beschriftung">Preisvorstellung (€)</span>
              <input className="eingabe" inputMode="decimal" value={w.preis} onChange={(e) => setze('preis')(e.target.value)} placeholder="leer = Preis auf Anfrage" />
            </label>
            <label className="flex items-center gap-2 pb-3 text-sm">
              <input type="checkbox" checked={w.verhandelbar} onChange={(e) => setze('verhandelbar')(e.target.checked)} />VB
            </label>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Auswahl label="Zustand" wert={w.zustand} onChange={setze('zustand')} liste={ZUSTAENDE} />
          <Auswahl label="Vollständigkeit" wert={w.vollstaendigkeit} onChange={setze('vollstaendigkeit')} liste={VOLLSTAENDIGKEITEN} />
          <Auswahl label="Region" wert={w.region} onChange={setze('region')} liste={REGIONEN} />
          {plattformen.length > 1 && (
            <Auswahl label="Plattform" wert={w.plattform_id} onChange={(v) => setze('plattform_id')(v ? Number(v) : null)}
              liste={plattformen.map((p) => ({ value: p.id, label: p.name }))} />
          )}
          {varianten.length > 0 && (
            <Auswahl label="Variante" wert={w.variante_id} onChange={(v) => setze('variante_id')(v ? Number(v) : null)}
              liste={varianten.filter((v) => v.status === 'freigegeben').map((v) => ({ value: v.id, label: v.bezeichnung }))} />
          )}
          <label className="block">
            <span className="beschriftung">Anzahl</span>
            <input className="eingabe" type="number" min={1} max={9999} value={w.anzahl} onChange={(e) => setze('anzahl')(e.target.value)} />
          </label>
        </div>
        <label className="block">
          <span className="beschriftung">Beschreibung</span>
          <textarea className="eingabe" rows={3} maxLength={3000} value={w.beschreibung} onChange={(e) => setze('beschreibung')(e.target.value)}
            placeholder="z. B. Modul mit leichten Kratzern auf dem Label, Anleitung vollständig" />
        </label>
        <fieldset className="grid grid-cols-2 items-end gap-3">
          <legend className="beschriftung">Übergabe</legend>
          <div className="space-y-1 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={w.versand} onChange={(e) => setze('versand')(e.target.checked)} />Versand</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={w.abholung} onChange={(e) => setze('abholung')(e.target.checked)} />Abholung</label>
          </div>
          <label className="block">
            <span className="beschriftung">PLZ-Bereich</span>
            <input className="eingabe" inputMode="numeric" maxLength={5} value={w.plz_bereich} onChange={(e) => setze('plz_bereich')(e.target.value)} placeholder="z. B. 40" />
          </label>
        </fieldset>
        <p className="text-xs text-leise">
          Angezeigt werden nur die ersten zwei Ziffern der Postleitzahl. Das Angebot läuft automatisch ab und lässt sich mit einem Klick verlängern.
          Verboten sind Raubkopien, Reproduktionen und Nachdrucke ohne Kennzeichnung sowie Flash- und Kopiermodule.
        </p>
        {fehler && <p className="text-sm text-gefahr" role="alert">{fehler}</p>}
        <div className="flex gap-2">
          <button type="button" className="knopf-sekundaer" onClick={() => onFertig(null)}>Abbrechen</button>
          <button type="submit" className="knopf-primaer" disabled={laeuft}>{angebot ? 'Speichern' : 'Angebot einstellen'}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Wunschlisteneintrag mit optionalen Bedingungen (Plattform, Region, Mindestzustand, CIB, Höchstpreis). */
export function WunschFormular({ katalogId, titel, wunsch, plattformen = [], onFertig }) {
  const zeigeHinweis = useHinweis();
  const [w, setW] = useState({
    plattform_id: wunsch?.plattform_id ?? null,
    region: wunsch?.region ?? null,
    min_zustand: wunsch?.min_zustand ?? null,
    nur_cib: wunsch?.nur_cib ?? false,
    max_preis: preisFeld(wunsch?.max_preis ?? null),
    notiz: wunsch?.notiz ?? '',
  });
  const [fehler, setFehler] = useState(null);
  const setze = (feld) => (wert) => setW((alt) => ({ ...alt, [feld]: wert }));

  async function speichern(e) {
    e.preventDefault();
    try {
      const r = await api.wunschSetzen(katalogId, w);
      zeigeHinweis(r.treffer ? `Gespeichert – ${r.treffer} passende${r.treffer === 1 ? 's Angebot' : ' Angebote'} gefunden!` : 'Auf der Wunschliste. Du wirst benachrichtigt, sobald jemand es anbietet.');
      onFertig(r);
    } catch (err) {
      setFehler(ersterFehler(err));
    }
  }

  return (
    <Modal titel={`Wunschliste: ${titel}`} onSchliessen={() => onFertig(null)}>
      <form onSubmit={speichern} className="space-y-3">
        <p className="text-sm text-leise">Alle Angaben sind optional. Du bekommst eine Benachrichtigung, sobald ein passendes Angebot eingestellt wird.</p>
        <div className="grid grid-cols-2 gap-3">
          {plattformen.length > 1 && (
            <Auswahl label="Plattform" wert={w.plattform_id} leer="Egal" onChange={(v) => setze('plattform_id')(v ? Number(v) : null)}
              liste={plattformen.map((p) => ({ value: p.id, label: p.name }))} />
          )}
          <Auswahl label="Region" wert={w.region} leer="Egal" onChange={setze('region')} liste={REGIONEN} />
          <Auswahl label="Mindestens Zustand" wert={w.min_zustand} leer="Egal" onChange={setze('min_zustand')} liste={ZUSTAENDE} />
          <label className="block">
            <span className="beschriftung">Höchstpreis (€)</span>
            <input className="eingabe" inputMode="decimal" value={w.max_preis} onChange={(e) => setze('max_preis')(e.target.value)} placeholder="Egal" />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={w.nur_cib} onChange={(e) => setze('nur_cib')(e.target.checked)} />Nur komplett in OVP (CIB)
        </label>
        <label className="block">
          <span className="beschriftung">Notiz (nur für dich)</span>
          <input className="eingabe" maxLength={500} value={w.notiz} onChange={(e) => setze('notiz')(e.target.value)} />
        </label>
        {fehler && <p className="text-sm text-gefahr" role="alert">{fehler}</p>}
        <div className="flex gap-2">
          <button type="button" className="knopf-sekundaer" onClick={() => onFertig(null)}>Abbrechen</button>
          <button type="submit" className="knopf-primaer">Speichern</button>
        </div>
      </form>
    </Modal>
  );
}

/** Kasten „Tauschbörse“ auf der Katalogseite: Zahlen, Wunschliste, Anbieten, aktuelle Angebote. */
export function BoerseBox({ katalog, info, plattformen, varianten, angemeldet, onGeaendert }) {
  const zeigeHinweis = useHinweis();
  const [angebote, setAngebote] = useState(null);
  const [formular, setFormular] = useState(null); // 'angebot' | 'wunsch'
  const laden = () => api.angebote({ katalog_id: katalog.id, sortierung: 'preis_auf' }).then(setAngebote).catch(() => setAngebote(null));
  useEffect(() => { if (angemeldet && info?.angebote) laden(); }, [katalog.id, angemeldet, info?.angebote]);
  if (!info) return null;

  const wunschEntfernen = async () => {
    try { await api.wunschEntfernen(katalog.id); zeigeHinweis('Von der Wunschliste entfernt.'); onGeaendert(); } catch (e) { zeigeHinweis(e.message, 'fehler'); }
  };

  return (
    <section className="karte space-y-3 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold"><Symbol name="boerse" className="size-5" />Tauschbörse</h3>
        <a href={`#/boerse?katalog_id=${katalog.id}`} className="text-xs text-akzent-hell underline">Alle Angebote</a>
      </div>
      <p>
        <strong>{info.angebote}</strong> {info.angebote === 1 ? 'Angebot' : 'Angebote'}{info.ab_preis != null && <> ab <strong>{euro(info.ab_preis)}</strong></>}
        {' · '}<strong>{info.gesucht}</strong> {info.gesucht === 1 ? 'Sammler sucht' : 'Sammler suchen'} das
      </p>
      {angemeldet ? (
        <>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="knopf-primaer px-3 py-1.5" onClick={() => setFormular('angebot')}>
              <Symbol name="boerse" className="size-4" />Anbieten
            </button>
            <button type="button" className="knopf-sekundaer px-3 py-1.5" onClick={() => setFormular('wunsch')}>
              <Symbol name="herz" className="size-4" />{info.mein_wunsch ? 'Wunsch bearbeiten' : 'Auf die Wunschliste'}
            </button>
            {info.mein_wunsch && <button type="button" className="text-xs text-leise underline" onClick={wunschEntfernen}>Von der Wunschliste entfernen</button>}
          </div>
          {info.meine_angebote?.length > 0 && (
            <p className="text-xs text-leise">
              Du bietest das an: {info.meine_angebote.map((a, i) => (
                <span key={a.id}>{i > 0 && ', '}<a className="text-akzent-hell underline" href={`#/boerse/angebot/${a.id}`}>{preisText(a)}</a></span>
              ))}
            </p>
          )}
          {angebote?.eintraege?.length > 0 && (
            <div className="space-y-2">
              {angebote.eintraege.filter((a) => !a.eigenes).slice(0, 5).map((a) => <AngebotKarte key={a.id} angebot={a} mitTitel={false} />)}
            </div>
          )}
        </>
      ) : (
        <a href="#/" className="knopf-sekundaer px-3 py-1.5">Anmelden, um zu kaufen oder zu tauschen</a>
      )}
      {formular === 'angebot' && (
        <AngebotFormular katalogId={katalog.id} plattformen={plattformen} varianten={varianten}
          onFertig={(a) => { setFormular(null); if (a) { onGeaendert(); laden(); navigiere(`/boerse/angebot/${a.id}`); } }} />
      )}
      {formular === 'wunsch' && (
        <WunschFormular katalogId={katalog.id} titel={katalog.titel} wunsch={info.mein_wunsch} plattformen={plattformen}
          onFertig={(r) => { setFormular(null); if (r) onGeaendert(); }} />
      )}
    </section>
  );
}

export const statusText = (s) => beschriftung(ANGEBOTSSTATUS, s);
