// Nachrichten der Tauschbörse: Liste der Unterhaltungen, einzelne Unterhaltung mit Bewertung und Blockieren.
import { useEffect, useRef, useState } from 'react';
import { BEWERTUNGSWERTE } from '../../../shared/konstanten.js';
import { api } from '../api.js';
import { useSitzung } from '../sitzung.js';
import Layout from '../komponenten/Layout.jsx';
import Cover from '../komponenten/Cover.jsx';
import Symbol from '../komponenten/Symbole.jsx';
import { useHinweis } from '../komponenten/Hinweise.jsx';
import { AnbieterAbzeichen, Bewertung, preisText } from '../komponenten/BoerseTeile.jsx';

const uhrzeit = (iso) => new Date(`${iso.replace(' ', 'T')}Z`).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Symbol mit Zahl ungelesener Nachrichten für die Kopfzeile. */
export function NachrichtenKnopf() {
  const { auth } = useSitzung();
  const [anzahl, setAnzahl] = useState(0);
  useEffect(() => {
    if (!auth?.boerse) return undefined;
    let aktiv = true;
    const laden = () => {
      if (document.visibilityState !== 'visible') return;
      api.nachrichtenAnzahl().then((a) => aktiv && setAnzahl(a.ungelesen)).catch(() => {});
    };
    laden();
    const timer = setInterval(laden, 60_000);
    document.addEventListener('visibilitychange', laden);
    window.addEventListener('nachrichten-gelesen', laden);
    return () => {
      aktiv = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', laden);
      window.removeEventListener('nachrichten-gelesen', laden);
    };
  }, [auth?.boerse]);
  if (!auth?.boerse) return null;
  return (
    <a href="#/nachrichten" className="relative rounded-lg p-2 text-leise hover:bg-karte hover:text-text"
      aria-label={anzahl ? `Nachrichten, ${anzahl} ungelesen` : 'Nachrichten'}>
      <Symbol name="nachricht" className="size-5" />
      {anzahl > 0 && (
        <span className="absolute top-0.5 right-0.5 flex min-w-4 items-center justify-center rounded-full bg-akzent px-1 text-[10px] leading-4 font-bold text-akzent-text">
          {anzahl > 99 ? '99+' : anzahl}
        </span>
      )}
    </a>
  );
}

export default function Nachrichten({ route }) {
  const [liste, setListe] = useState(null);
  const [fehler, setFehler] = useState(null);
  useEffect(() => { api.unterhaltungen().then(setListe).catch((e) => setFehler(e.message)); }, []);
  return (
    <Layout route={route} titel="Nachrichten" zurueck="/boerse">
      <div className="mx-auto max-w-2xl space-y-2 pb-8">
        {fehler && <p className="text-gefahr" role="alert">{fehler}</p>}
        {!liste ? <p className="text-leise">Wird geladen …</p> : liste.length === 0 ? (
          <p className="karte p-6 text-center text-leise">Noch keine Nachrichten. Schreibe einem Anbieter direkt aus einem Angebot der <a className="underline" href="#/boerse">Tauschbörse</a>.</p>
        ) : liste.map((u) => (
          <a key={u.id} href={`#/nachrichten/${u.id}`} className={`karte flex gap-3 p-3 hover:bg-karte-hover ${u.ungelesen ? 'border-akzent/60' : ''}`}>
            <Cover url={u.cover_url} alt="" className="aspect-[3/4] w-10 shrink-0 rounded" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2">
                <span className="truncate font-semibold">{u.partner ?? 'Gelöschtes Konto'}</span>
                <span className="abzeichen">{u.rolle === 'anbieter' ? 'Anfrage an dich' : 'Deine Anfrage'}</span>
              </p>
              <p className="truncate text-sm">{u.titel}</p>
              <p className="truncate text-xs text-leise">{u.letzte_nachricht}</p>
            </div>
            <div className="shrink-0 text-right text-xs text-leise">
              <p>{uhrzeit(u.letzte_nachricht_am)}</p>
              {u.ungelesen > 0 && <span className="mt-1 inline-block rounded-full bg-akzent px-1.5 font-bold text-akzent-text">{u.ungelesen}</span>}
            </div>
          </a>
        ))}
      </div>
    </Layout>
  );
}

export function Unterhaltung({ route, id }) {
  const zeigeHinweis = useHinweis();
  const [u, setU] = useState(null);
  const [fehler, setFehler] = useState(null);
  const [text, setText] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const ende = useRef(null);

  const laden = () => api.unterhaltung(id).then((d) => { setU(d); window.dispatchEvent(new Event('nachrichten-gelesen')); }).catch((e) => setFehler(e.message));
  useEffect(() => {
    laden();
    const timer = setInterval(() => document.visibilityState === 'visible' && laden(), 30_000);
    return () => clearInterval(timer);
  }, [id]);
  useEffect(() => { ende.current?.scrollIntoView({ block: 'end' }); }, [u?.nachrichten?.length]);

  async function senden(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setLaeuft(true);
    try {
      setU(await api.nachrichtSenden(id, text));
      setText('');
    } catch (err) {
      zeigeHinweis(Object.values(err.felder ?? {})[0] ?? err.message, 'fehler');
    } finally {
      setLaeuft(false);
    }
  }

  if (!u) {
    return (
      <Layout route={route} titel="Nachrichten" zurueck="/nachrichten">
        {fehler ? <p className="text-gefahr" role="alert">{fehler}</p> : <p className="text-leise">Wird geladen …</p>}
      </Layout>
    );
  }

  const blockieren = async () => {
    const ja = !u.partner.blockiert;
    if (ja && !window.confirm(`${u.partner.name} blockieren? Ihr könnt euch dann keine Nachrichten mehr schreiben und seht eure Angebote nicht mehr.`)) return;
    try {
      await (ja ? api.blockieren(u.partner.id) : api.entblocken(u.partner.id));
      zeigeHinweis(ja ? 'Benutzer blockiert.' : 'Blockierung aufgehoben.');
      laden();
    } catch (err) { zeigeHinweis(err.message, 'fehler'); }
  };

  return (
    <Layout route={route} titel={u.partner?.name ?? 'Nachrichten'} zurueck="/nachrichten">
      <div className="mx-auto max-w-2xl space-y-3 pb-8">
        {u.angebot ? (
          <a href={`#/boerse/angebot/${u.angebot.id}`} className="karte flex items-center gap-3 p-3 hover:bg-karte-hover">
            <Cover url={u.angebot.cover_url} typ={u.angebot.typ} alt="" className="aspect-[3/4] w-10 shrink-0 rounded" />
            <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{u.titel}</span>
              <span className="text-xs text-leise">{preisText(u.angebot)}{u.angebot.status !== 'aktiv' ? ` · ${u.angebot.status}` : ''}</span></span>
            <Symbol name="weiter" className="size-5 text-leise" />
          </a>
        ) : <p className="karte p-3 text-sm text-leise">{u.titel} – das Angebot ist nicht mehr verfügbar.</p>}

        {u.partner && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <a className="font-semibold hover:underline" href={`#/boerse/anbieter/${u.partner.id}`}>{u.partner.name}</a>
            <AnbieterAbzeichen anbieter={u.partner} />
            <Bewertung bewertung={u.partner.bewertung} klein />
            <span className="flex-1" />
            <button type="button" className="text-xs text-leise underline hover:text-gefahr" onClick={blockieren}>{u.partner.blockiert ? 'Blockierung aufheben' : 'Blockieren'}</button>
          </div>
        )}

        <ol className="space-y-2" aria-label="Nachrichten">
          {u.nachrichten.map((n) => (
            <li key={n.id} className={`flex ${n.eigene ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${n.eigene ? 'bg-akzent text-akzent-text' : 'karte'}`}>
                <p className="break-words whitespace-pre-wrap">{n.text}</p>
                <p className={`mt-1 text-[10px] ${n.eigene ? 'text-akzent-text/80' : 'text-leise'}`}>{uhrzeit(n.erstellt_am)}</p>
              </div>
            </li>
          ))}
        </ol>
        <div ref={ende} />

        {u.partner && !u.partner.blockiert && (
          <form onSubmit={senden} className="flex items-end gap-2">
            <textarea className="eingabe" rows={2} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Nachricht schreiben …" aria-label="Nachricht"
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) senden(e); }} />
            <button type="submit" className="knopf-primaer" disabled={laeuft || !text.trim()} aria-label="Senden"><Symbol name="weiter" className="size-5" /></button>
          </form>
        )}
        <p className="text-xs text-leise">Tipp: Zahle nie per Vorkasse an Unbekannte ohne Käuferschutz und gib keine Passwörter oder Codes weiter.</p>

        {u.darf_bewerten && <BewertungFormular unterhaltung={u} onFertig={laden} />}
      </div>
    </Layout>
  );
}

function BewertungFormular({ unterhaltung: u, onFertig }) {
  const zeigeHinweis = useHinweis();
  const [wert, setWert] = useState(u.meine_bewertung?.wert ?? null);
  const [text, setText] = useState(u.meine_bewertung?.text ?? '');
  const [offen, setOffen] = useState(!u.meine_bewertung);
  async function speichern(e) {
    e.preventDefault();
    try {
      await api.bewerten(u.id, { wert, text });
      zeigeHinweis('Danke für deine Bewertung!');
      setOffen(false);
      onFertig();
    } catch (err) {
      zeigeHinweis(Object.values(err.felder ?? {})[0] ?? err.message, 'fehler');
    }
  }
  if (!offen) {
    return (
      <p className="text-sm text-leise">
        Deine Bewertung: {BEWERTUNGSWERTE.find((b) => b.value === u.meine_bewertung?.wert)?.icon} {u.meine_bewertung?.text}
        {' '}<button type="button" className="underline" onClick={() => setOffen(true)}>Ändern</button>
      </p>
    );
  }
  return (
    <form onSubmit={speichern} className="karte space-y-2 p-4">
      <h3 className="font-semibold">{u.partner.name} bewerten</h3>
      <p className="text-xs text-leise">Bewerte erst, wenn der Handel abgeschlossen ist (oder wenn es Probleme gab). Bewertungen sind im Profil für alle angemeldeten Benutzer sichtbar.</p>
      <div className="flex gap-2">
        {BEWERTUNGSWERTE.map((b) => (
          <button key={b.value} type="button" className={wert === b.value ? 'chip-aktiv' : 'chip'} onClick={() => setWert(b.value)}>{b.icon} {b.label}</button>
        ))}
      </div>
      <input className="eingabe" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder={wert === 1 ? 'Optional: z. B. „Schneller Versand, alles wie beschrieben“' : 'Bitte kurz begründen'} />
      <button type="submit" className="knopf-primaer" disabled={wert === null}>Bewertung speichern</button>
    </form>
  );
}
