import { useState } from 'react';
import { api, ApiFehler } from '../api.js';
import { useSitzung } from '../sitzung.js';
import Symbol from '../komponenten/Symbole.jsx';

export default function Anmelden() {
  const { auth, aktualisiere } = useSitzung();
  const [modus, setModus] = useState(auth?.ersteinrichtung ? 'registrieren' : 'anmelden');
  const [werte, setWerte] = useState({ benutzername: '', passwort: '', passwort2: '', anzeigename: '' });
  const [zweiFaktor, setZweiFaktor] = useState(null); // { token }
  const [code, setCode] = useState('');
  const [mitWiederherstellung, setMitWiederherstellung] = useState(false);
  const [fehler, setFehler] = useState(null);
  const [felder, setFelder] = useState({});
  const [laedt, setLaedt] = useState(false);

  const setze = (feld) => (e) => setWerte((w) => ({ ...w, [feld]: e.target.value }));

  async function absenden(e) {
    e.preventDefault();
    setFehler(null);
    setFelder({});
    if (modus === 'registrieren' && werte.passwort !== werte.passwort2) {
      setFelder({ passwort2: 'Die Passwörter stimmen nicht überein.' });
      return;
    }
    setLaedt(true);
    try {
      if (zweiFaktor) {
        await api.zweiterFaktor(mitWiederherstellung
          ? { token: zweiFaktor.token, wiederherstellungscode: code }
          : { token: zweiFaktor.token, code });
        await aktualisiere();
      } else if (modus === 'registrieren') {
        await api.registrieren({ benutzername: werte.benutzername, passwort: werte.passwort, anzeigename: werte.anzeigename });
        await aktualisiere();
      } else {
        const antwort = await api.anmelden({ benutzername: werte.benutzername, passwort: werte.passwort });
        if (antwort.zweiFaktor) {
          setZweiFaktor({ token: antwort.token });
          setWerte((w) => ({ ...w, passwort: '' }));
        } else await aktualisiere();
      }
    } catch (err) {
      if (err instanceof ApiFehler && err.code === 'abgelaufen') {
        setZweiFaktor(null);
        setCode('');
      }
      setFehler(err.message);
      if (err.felder) setFelder(err.felder);
    } finally {
      setLaedt(false);
    }
  }

  const registrierungMoeglich = auth?.registrierungOffen;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <img src="/icons/icon.svg" alt="" className="size-16" />
          <h1 className="text-2xl font-bold">Videospielesammlung</h1>
          <p className="text-sm text-leise">Spiele, Konsolen und Zubehör verwalten – mit Barcode-Scanner und Wertübersicht.</p>
        </div>

        {auth?.ersteinrichtung && (
          <p className="rounded-xl border border-akzent/40 bg-akzent/10 p-3 text-sm">
            <strong>Willkommen!</strong> Es gibt noch kein Konto. Das erste Konto wird automatisch Administrator.
          </p>
        )}

        <form onSubmit={absenden} className="karte space-y-4 p-5" noValidate>
          {zweiFaktor ? (
            <>
              <div className="flex items-center gap-2">
                <Symbol name="schild" className="size-6 text-akzent-hell" />
                <h2 className="text-lg font-semibold">Zwei-Faktor-Anmeldung</h2>
              </div>
              <p className="text-sm text-leise">
                {mitWiederherstellung
                  ? 'Gib einen deiner Wiederherstellungscodes ein. Jeder Code funktioniert nur einmal.'
                  : 'Gib den 6-stelligen Code aus deiner Authenticator-App ein.'}
              </p>
              <label className="block">
                <span className="beschriftung">{mitWiederherstellung ? 'Wiederherstellungscode' : 'Code'}</span>
                <input
                  className="eingabe text-center font-mono text-xl tracking-[0.3em]"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode={mitWiederherstellung ? 'text' : 'numeric'}
                  autoComplete="one-time-code"
                  maxLength={mitWiederherstellung ? 12 : 6}
                  placeholder={mitWiederherstellung ? 'XXXX-XXXX' : '123456'}
                  autoFocus
                />
              </label>
              <button type="button" className="text-sm text-akzent-hell underline" onClick={() => { setMitWiederherstellung((m) => !m); setCode(''); }}>
                {mitWiederherstellung ? 'Doch Code aus der App verwenden' : 'Kein Zugriff auf die App? Wiederherstellungscode verwenden'}
              </button>
            </>
          ) : (
            <>
              {registrierungMoeglich && !auth?.ersteinrichtung && (
                <div className="grid grid-cols-2 gap-2" role="tablist">
                  {[['anmelden', 'Anmelden'], ['registrieren', 'Registrieren']].map(([wert, label]) => (
                    <button key={wert} type="button" role="tab" aria-selected={modus === wert}
                      className={`${modus === wert ? 'chip-aktiv' : 'chip'} justify-center rounded-xl py-2`}
                      onClick={() => { setModus(wert); setFehler(null); setFelder({}); }}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <Feld label="Benutzername" fehler={felder.benutzername}>
                <input className="eingabe" value={werte.benutzername} onChange={setze('benutzername')} autoComplete="username" autoCapitalize="none" required autoFocus />
              </Feld>
              {modus === 'registrieren' && (
                <Feld label="Anzeigename (optional)" fehler={felder.anzeigename}>
                  <input className="eingabe" value={werte.anzeigename} onChange={setze('anzeigename')} autoComplete="nickname" maxLength={60} />
                </Feld>
              )}
              <Feld label="Passwort" fehler={felder.passwort}>
                <input type="password" className="eingabe" value={werte.passwort} onChange={setze('passwort')}
                  autoComplete={modus === 'registrieren' ? 'new-password' : 'current-password'} required />
              </Feld>
              {modus === 'registrieren' && (
                <>
                  <Feld label="Passwort wiederholen" fehler={felder.passwort2}>
                    <input type="password" className="eingabe" value={werte.passwort2} onChange={setze('passwort2')} autoComplete="new-password" required />
                  </Feld>
                  <p className="text-xs text-leise">Mindestens 10 Zeichen. Nach der Registrierung kannst du unter „Konto“ die Zwei-Faktor-Anmeldung aktivieren.</p>
                </>
              )}
            </>
          )}

          {fehler && <p className="rounded-xl bg-gefahr/10 p-3 text-sm text-gefahr" role="alert">{fehler}</p>}

          <button type="submit" className="knopf-primaer w-full" disabled={laedt}>
            {laedt ? 'Bitte warten …' : zweiFaktor ? 'Bestätigen' : modus === 'registrieren' ? 'Konto erstellen' : 'Anmelden'}
          </button>
          {zweiFaktor && (
            <button type="button" className="knopf-sekundaer w-full" onClick={() => { setZweiFaktor(null); setCode(''); setFehler(null); }}>
              Abbrechen
            </button>
          )}
        </form>

        {auth?.oeffentlicherKatalog && !zweiFaktor && (
          <p className="text-center text-sm"><a href="#/katalog" className="text-akzent-hell underline">Katalog ohne Anmeldung durchstöbern</a></p>
        )}
        {!registrierungMoeglich && !zweiFaktor && (
          <p className="text-center text-xs text-leise">Die Registrierung neuer Konten ist auf diesem Server geschlossen.</p>
        )}
      </div>
    </div>
  );
}

function Feld({ label, fehler, children }) {
  return (
    <label className="block">
      <span className="beschriftung">{label}</span>
      {children}
      {fehler && <span className="mt-1 block text-sm text-gefahr">{fehler}</span>}
    </label>
  );
}
