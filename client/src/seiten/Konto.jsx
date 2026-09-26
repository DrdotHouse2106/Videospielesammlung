import { useEffect, useState } from 'react';
import { MARKE } from '../../../shared/marke.js';
import { api } from '../api.js';
import { useSitzung } from '../sitzung.js';
import { datumDe } from '../format.js';
import Layout from '../komponenten/Layout.jsx';
import Symbol from '../komponenten/Symbole.jsx';
import SpeicherAnzeige from '../komponenten/SpeicherAnzeige.jsx';
import { useHinweis } from '../komponenten/Hinweise.jsx';

export default function Konto({ route }) {
  const { auth, aktualisiere, abmelden } = useSitzung();
  const zeigeHinweis = useHinweis();
  const [konto, setKonto] = useState(null);
  const pflicht = route.parameter.pflicht === '1' && !konto?.totp_aktiv;

  const laden = () => api.konto().then(setKonto).catch((e) => zeigeHinweis(e.message, 'fehler'));
  useEffect(() => { laden(); }, []);

  async function speichereProfil(aenderung) {
    try {
      setKonto({ ...konto, ...(await api.kontoAendern(aenderung)) });
      zeigeHinweis('Gespeichert.');
      aktualisiere();
    } catch (e) {
      zeigeHinweis(e.message, 'fehler');
    }
  }

  return (
    <Layout route={route} titel="Konto & Sicherheit" zurueck={pflicht ? undefined : '/einstellungen'}>
      <div className="mx-auto max-w-2xl space-y-4 pb-8">
        {pflicht && (
          <p className="flex gap-2 rounded-xl border border-warnung/50 bg-warnung/10 p-3 text-sm" role="alert">
            <Symbol name="schild" className="size-5 shrink-0 text-warnung" />
            Auf diesem Server ist die Zwei-Faktor-Anmeldung Pflicht. Bitte richte sie ein, um die Sammlung zu nutzen.
          </p>
        )}
        {!konto ? <p className="text-leise">Wird geladen …</p> : (
          <>
            <Profil konto={konto} onSpeichern={speichereProfil} />
            <ZweiFaktor konto={konto} pflicht={auth?.zweiFaktorPflicht} onGeaendert={() => { laden(); aktualisiere(); }} />
            {!pflicht && (
              <>
                <Sichtbarkeit konto={konto} onSpeichern={speichereProfil} />
                <section className="karte space-y-3 p-4">
                  <h2 className="flex items-center gap-2 font-semibold"><Symbol name="dokument" className="size-5" />Speicherplatz</h2>
                  <SpeicherAnzeige info={konto.speicher} />
                </section>
                <PasswortAendern />
                <section className="karte space-y-3 p-4">
                  <h2 className="font-semibold">Sitzungen</h2>
                  <p className="text-sm text-leise">Du bist angemeldet seit {datumDe(konto.letzte_anmeldung)}. Hast du dich auf einem fremden Gerät angemeldet? Beende alle anderen Sitzungen.</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="knopf-sekundaer" onClick={async () => {
                      await api.ueberallAbmelden();
                      zeigeHinweis('Alle anderen Geräte wurden abgemeldet.');
                    }}>Andere Geräte abmelden</button>
                    <button type="button" className="knopf-sekundaer" onClick={abmelden}><Symbol name="abmelden" className="size-4" />Abmelden</button>
                  </div>
                </section>
                <KontoLoeschen />
              </>
            )}
            {pflicht && <button type="button" className="knopf-sekundaer" onClick={abmelden}><Symbol name="abmelden" className="size-4" />Abmelden</button>}
          </>
        )}
      </div>
    </Layout>
  );
}

function Profil({ konto, onSpeichern }) {
  const [name, setName] = useState(konto.anzeigename ?? '');
  return (
    <section className="karte space-y-3 p-4">
      <h2 className="flex items-center gap-2 font-semibold"><Symbol name="benutzer" className="size-5" />Profil</h2>
      <p className="text-sm text-leise">
        Benutzername: <strong className="text-text">{konto.benutzername}</strong>
        {konto.rolle === 'admin' && <span className="abzeichen ml-2">Administrator</span>}
      </p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); onSpeichern({ anzeigename: name }); }}>
        <label className="flex-1">
          <span className="sr-only">Anzeigename</span>
          <input className="eingabe" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Anzeigename" />
        </label>
        <button type="submit" className="knopf-sekundaer">Speichern</button>
      </form>
    </section>
  );
}

function Sichtbarkeit({ konto, onSpeichern }) {
  return (
    <section className="karte space-y-3 p-4">
      <h2 className="flex items-center gap-2 font-semibold"><Symbol name="community" className="size-5" />Sammlung teilen</h2>
      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1 size-5 accent-akzent" checked={konto.sammlung_oeffentlich}
          onChange={(e) => onSpeichern({ sammlung_oeffentlich: e.target.checked })} />
        <span className="text-sm">
          <strong>Meine Sammlung für alle angemeldeten Benutzer sichtbar machen</strong>
          <span className="block text-leise">
            Andere sehen Titel, Plattform, Region, Zustand, Vollständigkeit, Farbe, Edition, Modellnummer und deine Fotos.
            Kaufpreis, Kaufdatum, Marktwert, Seriennummer, Barcode und Notizen bleiben immer privat.
          </span>
        </span>
      </label>
      {konto.sammlung_oeffentlich && (
        <a className="text-sm text-akzent-hell underline" href={`#/community/${encodeURIComponent(konto.benutzername)}`}>So sehen andere deine Sammlung</a>
      )}
    </section>
  );
}

function Wiederherstellungscodes({ codes, onFertig }) {
  const text = `${MARKE.name} – Wiederherstellungscodes\nJeder Code funktioniert genau einmal.\n\n${codes.join('\n')}\n`;
  const herunterladen = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'wiederherstellungscodes.txt' });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-3 rounded-xl border border-warnung/50 bg-warnung/10 p-4">
      <p className="text-sm"><strong>Bewahre diese Codes sicher auf!</strong> Wenn du dein Handy verlierst, kommst du nur damit wieder in dein Konto. Sie werden nur jetzt angezeigt.</p>
      <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
        {codes.map((c) => <li key={c} className="rounded-lg bg-karte px-2 py-1 text-center">{c}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="knopf-sekundaer" onClick={herunterladen}><Symbol name="herunterladen" className="size-4" />Als Datei speichern</button>
        <button type="button" className="knopf-sekundaer" onClick={() => navigator.clipboard?.writeText(text)}>Kopieren</button>
        <button type="button" className="knopf-primaer" onClick={onFertig}>Ich habe die Codes gesichert</button>
      </div>
    </div>
  );
}

function ZweiFaktor({ konto, pflicht, onGeaendert }) {
  const zeigeHinweis = useHinweis();
  const [schritt, setSchritt] = useState(null); // null | 'passwort' | 'qr' | 'codes' | 'deaktivieren' | 'neue-codes'
  const [passwort, setPasswort] = useState('');
  const [code, setCode] = useState('');
  const [einrichtung, setEinrichtung] = useState(null);
  const [codes, setCodes] = useState(null);
  const [fehler, setFehler] = useState(null);

  const zuruecksetzen = () => { setSchritt(null); setPasswort(''); setCode(''); setFehler(null); setEinrichtung(null); };
  const ausfuehren = (fn) => async (e) => {
    e.preventDefault();
    setFehler(null);
    try { await fn(); } catch (err) { setFehler(Object.values(err.felder ?? {})[0] ?? err.message); }
  };

  return (
    <section className="karte space-y-3 p-4">
      <h2 className="flex items-center gap-2 font-semibold"><Symbol name="schild" className="size-5" />Zwei-Faktor-Anmeldung (2FA)</h2>
      <p className="flex items-center gap-2 text-sm">
        <span className={`size-2 rounded-full ${konto.totp_aktiv ? 'bg-erfolg' : 'bg-warnung'}`} aria-hidden="true" />
        {konto.totp_aktiv
          ? `Aktiv – noch ${konto.wiederherstellungscodesUebrig} Wiederherstellungscodes übrig.`
          : 'Nicht aktiv. Empfohlen, wenn die App im Internet erreichbar ist.'}
      </p>

      {codes && <Wiederherstellungscodes codes={codes} onFertig={() => { setCodes(null); onGeaendert(); }} />}

      {!schritt && !codes && (
        <div className="flex flex-wrap gap-2">
          {!konto.totp_aktiv && <button type="button" className="knopf-primaer" onClick={() => setSchritt('passwort')}>2FA einrichten</button>}
          {konto.totp_aktiv && <button type="button" className="knopf-sekundaer" onClick={() => setSchritt('neue-codes')}>Neue Wiederherstellungscodes</button>}
          {konto.totp_aktiv && !pflicht && <button type="button" className="knopf-gefahr" onClick={() => setSchritt('deaktivieren')}>2FA deaktivieren</button>}
        </div>
      )}

      {schritt === 'passwort' && (
        <form className="space-y-3" onSubmit={ausfuehren(async () => {
          setEinrichtung(await api.totpEinrichten(passwort));
          setPasswort('');
          setSchritt('qr');
        })}>
          <p className="text-sm text-leise">Du brauchst eine Authenticator-App, z. B. Aegis, 2FAS, Google Authenticator, Microsoft Authenticator oder einen Passwortmanager mit TOTP-Funktion.</p>
          <PasswortFeld wert={passwort} onChange={setPasswort} label="Zur Bestätigung: dein Passwort" />
          <Aktionen fehler={fehler} onAbbrechen={zuruecksetzen} text="Weiter" />
        </form>
      )}

      {schritt === 'qr' && einrichtung && (
        <form className="space-y-3" onSubmit={ausfuehren(async () => {
          const antwort = await api.totpBestaetigen(code);
          setCodes(antwort.wiederherstellungscodes);
          zeigeHinweis('Zwei-Faktor-Anmeldung aktiviert.');
          zuruecksetzen();
        })}>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>Scanne den QR-Code mit deiner Authenticator-App.</li>
            <li>Gib den angezeigten 6-stelligen Code ein.</li>
          </ol>
          {/* SVG wird vom eigenen Server erzeugt (Bibliothek „qrcode“) */}
          <div className="mx-auto w-52 rounded-xl bg-white p-2 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: einrichtung.qrSvg }} />
          <details className="text-sm">
            <summary className="cursor-pointer text-leise">QR-Code lässt sich nicht scannen? Schlüssel manuell eingeben</summary>
            <p className="mt-2 font-mono break-all select-all">{einrichtung.geheimnis.match(/.{1,4}/g).join(' ')}</p>
            <a className="mt-1 inline-block text-akzent-hell underline" href={einrichtung.otpauthUrl}>Auf diesem Gerät in der App öffnen</a>
          </details>
          <label className="block">
            <span className="beschriftung">Code aus der App</span>
            <input className="eingabe text-center font-mono text-xl tracking-[0.3em]" value={code} onChange={(e) => setCode(e.target.value)}
              inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" autoFocus />
          </label>
          <Aktionen fehler={fehler} onAbbrechen={zuruecksetzen} text="Aktivieren" />
        </form>
      )}

      {schritt === 'neue-codes' && (
        <form className="space-y-3" onSubmit={ausfuehren(async () => {
          setCodes((await api.neueWiederherstellungscodes(passwort)).wiederherstellungscodes);
          zuruecksetzen();
        })}>
          <p className="text-sm text-leise">Alle bisherigen Wiederherstellungscodes werden ungültig.</p>
          <PasswortFeld wert={passwort} onChange={setPasswort} label="Passwort" />
          <Aktionen fehler={fehler} onAbbrechen={zuruecksetzen} text="Neue Codes erzeugen" />
        </form>
      )}

      {schritt === 'deaktivieren' && (
        <form className="space-y-3" onSubmit={ausfuehren(async () => {
          await api.totpDeaktivieren({ passwort, code });
          zeigeHinweis('Zwei-Faktor-Anmeldung deaktiviert.');
          zuruecksetzen();
          onGeaendert();
        })}>
          <PasswortFeld wert={passwort} onChange={setPasswort} label="Passwort" />
          <label className="block">
            <span className="beschriftung">Aktueller Code aus der App</span>
            <input className="eingabe font-mono" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} />
          </label>
          <Aktionen fehler={fehler} onAbbrechen={zuruecksetzen} text="Deaktivieren" gefahr />
        </form>
      )}
    </section>
  );
}

function PasswortAendern() {
  const zeigeHinweis = useHinweis();
  const [werte, setWerte] = useState({ altesPasswort: '', neuesPasswort: '', wiederholung: '' });
  const [fehler, setFehler] = useState(null);
  const setze = (f) => (v) => setWerte((w) => ({ ...w, [f]: v }));
  async function absenden(e) {
    e.preventDefault();
    setFehler(null);
    if (werte.neuesPasswort !== werte.wiederholung) return setFehler('Die neuen Passwörter stimmen nicht überein.');
    try {
      await api.passwortAendern({ altesPasswort: werte.altesPasswort, neuesPasswort: werte.neuesPasswort });
      setWerte({ altesPasswort: '', neuesPasswort: '', wiederholung: '' });
      zeigeHinweis('Passwort geändert. Andere Geräte wurden abgemeldet.');
    } catch (err) {
      setFehler(Object.values(err.felder ?? {})[0] ?? err.message);
    }
  }
  return (
    <form className="karte space-y-3 p-4" onSubmit={absenden}>
      <h2 className="flex items-center gap-2 font-semibold"><Symbol name="schloss" className="size-5" />Passwort ändern</h2>
      <PasswortFeld wert={werte.altesPasswort} onChange={setze('altesPasswort')} label="Bisheriges Passwort" />
      <div className="grid gap-3 sm:grid-cols-2">
        <PasswortFeld wert={werte.neuesPasswort} onChange={setze('neuesPasswort')} label="Neues Passwort (min. 10 Zeichen)" neu />
        <PasswortFeld wert={werte.wiederholung} onChange={setze('wiederholung')} label="Neues Passwort wiederholen" neu />
      </div>
      <Aktionen fehler={fehler} text="Passwort ändern" />
    </form>
  );
}

function KontoLoeschen() {
  const { aktualisiere } = useSitzung();
  const [offen, setOffen] = useState(false);
  const [passwort, setPasswort] = useState('');
  const [fehler, setFehler] = useState(null);
  return (
    <section className="karte space-y-3 border-gefahr/40 p-4">
      <h2 className="font-semibold text-gefahr">Konto löschen</h2>
      {!offen ? (
        <button type="button" className="knopf-gefahr" onClick={() => setOffen(true)}>Konto und alle Daten löschen …</button>
      ) : (
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          if (!window.confirm('Wirklich endgültig löschen? Alle Artikel, Fotos und Scans gehen verloren.')) return;
          try {
            await api.kontoLoeschen(passwort);
            await aktualisiere();
          } catch (err) {
            setFehler(Object.values(err.felder ?? {})[0] ?? err.message);
          }
        }}>
          <p className="text-sm text-leise">Tipp: Erstelle vorher unter „Mehr → Datensicherung“ einen Export.</p>
          <PasswortFeld wert={passwort} onChange={setPasswort} label="Passwort zur Bestätigung" />
          <Aktionen fehler={fehler} onAbbrechen={() => setOffen(false)} text="Endgültig löschen" gefahr />
        </form>
      )}
    </section>
  );
}

function PasswortFeld({ wert, onChange, label, neu }) {
  return (
    <label className="block">
      <span className="beschriftung">{label}</span>
      <input type="password" className="eingabe" value={wert} onChange={(e) => onChange(e.target.value)} autoComplete={neu ? 'new-password' : 'current-password'} />
    </label>
  );
}

function Aktionen({ fehler, onAbbrechen, text, gefahr }) {
  return (
    <>
      {fehler && <p className="text-sm text-gefahr" role="alert">{fehler}</p>}
      <div className="flex gap-2">
        {onAbbrechen && <button type="button" className="knopf-sekundaer" onClick={onAbbrechen}>Abbrechen</button>}
        <button type="submit" className={gefahr ? 'knopf-gefahr' : 'knopf-primaer'}>{text}</button>
      </div>
    </>
  );
}
