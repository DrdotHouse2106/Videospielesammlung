// Seiten, die über Links aus E-Mails erreicht werden – mit und ohne Anmeldung nutzbar:
// Passwort vergessen, neues Passwort festlegen, E-Mail-Adresse bestätigen.
import { useEffect, useState } from 'react';
import { MARKE } from '../../../shared/marke.js';
import { api } from '../api.js';
import { useSitzung } from '../sitzung.js';
import Fusszeile from '../komponenten/Fusszeile.jsx';
import { captchaNachweis, CaptchaHinweis } from '../captcha.jsx';

function Rahmen({ titel, children }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <a href="#/" className="flex flex-col items-center gap-2 text-center">
          <img src="/icons/icon.svg" alt="" className="size-14" />
          <span className="text-2xl font-bold">{MARKE.name}</span>
        </a>
        <div className="karte space-y-4 p-5">
          <h1 className="text-lg font-semibold">{titel}</h1>
          {children}
        </div>
        <Fusszeile className="py-2" />
      </div>
    </div>
  );
}

export function PasswortVergessen() {
  const { auth } = useSitzung();
  const [zustimmung, setZustimmung] = useState(false);
  const [kennung, setKennung] = useState('');
  const [status, setStatus] = useState(null); // { ok, text }
  const [laedt, setLaedt] = useState(false);
  async function absenden(e) {
    e.preventDefault();
    setLaedt(true);
    try {
      const a = await api.passwortVergessen(kennung, await captchaNachweis(auth?.captcha, 'passwort', { zustimmung }));
      setStatus({ ok: true, text: a.hinweis });
    } catch (err) {
      setStatus({ ok: false, text: Object.values(err.felder ?? {})[0] ?? err.message });
    } finally {
      setLaedt(false);
    }
  }
  return (
    <Rahmen titel="Passwort vergessen">
      {status?.ok ? (
        <>
          <p className="text-sm">{status.text}</p>
          <p className="text-sm text-leise">Keine E-Mail bekommen? Schau im Spam-Ordner nach. Ohne bestätigte E-Mail-Adresse hilft dir der Administrator weiter.</p>
          <a href="#/" className="knopf-sekundaer w-full">Zur Anmeldung</a>
        </>
      ) : (
        <form onSubmit={absenden} className="space-y-4">
          <p className="text-sm text-leise">Gib deinen Benutzernamen oder deine E-Mail-Adresse ein. Wir schicken dir einen Link, mit dem du ein neues Passwort festlegen kannst.</p>
          <label className="block">
            <span className="beschriftung">Benutzername oder E-Mail-Adresse</span>
            <input className="eingabe" value={kennung} onChange={(e) => setKennung(e.target.value)} autoComplete="username" autoCapitalize="none" required autoFocus />
          </label>
          <CaptchaHinweis info={auth?.captcha} zustimmung={zustimmung} setZustimmung={setZustimmung} />
          {status && <p className="rounded-xl bg-gefahr/10 p-3 text-sm text-gefahr" role="alert">{status.text}</p>}
          <button type="submit" className="knopf-primaer w-full" disabled={laedt || !kennung.trim()}>{laedt ? 'Bitte warten …' : 'Link anfordern'}</button>
          <a href="#/" className="block text-center text-sm text-akzent-hell underline">Zurück zur Anmeldung</a>
        </form>
      )}
    </Rahmen>
  );
}

export function PasswortNeu({ token }) {
  const { aktualisiere } = useSitzung();
  const [pw, setPw] = useState({ a: '', b: '' });
  const [fehler, setFehler] = useState(null);
  const [fertig, setFertig] = useState(false);
  const [laedt, setLaedt] = useState(false);
  async function absenden(e) {
    e.preventDefault();
    if (pw.a !== pw.b) return setFehler('Die Passwörter stimmen nicht überein.');
    setLaedt(true);
    setFehler(null);
    try {
      await api.passwortZuruecksetzen(token, pw.a);
      setFertig(true);
      aktualisiere();
    } catch (err) {
      setFehler(Object.values(err.felder ?? {})[0] ?? err.message);
    } finally {
      setLaedt(false);
    }
  }
  return (
    <Rahmen titel="Neues Passwort festlegen">
      {fertig ? (
        <>
          <p className="text-sm">Dein Passwort wurde geändert. Aus Sicherheitsgründen wurden alle Geräte abgemeldet – melde dich mit dem neuen Passwort an.</p>
          <a href="#/" className="knopf-primaer w-full">Zur Anmeldung</a>
        </>
      ) : (
        <form onSubmit={absenden} className="space-y-4">
          <label className="block">
            <span className="beschriftung">Neues Passwort (mindestens 10 Zeichen)</span>
            <input type="password" className="eingabe" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} autoComplete="new-password" required autoFocus />
          </label>
          <label className="block">
            <span className="beschriftung">Passwort wiederholen</span>
            <input type="password" className="eingabe" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} autoComplete="new-password" required />
          </label>
          {fehler && <p className="rounded-xl bg-gefahr/10 p-3 text-sm text-gefahr" role="alert">{fehler}</p>}
          <button type="submit" className="knopf-primaer w-full" disabled={laedt}>{laedt ? 'Bitte warten …' : 'Passwort speichern'}</button>
        </form>
      )}
    </Rahmen>
  );
}

export function EmailBestaetigen({ token }) {
  const { aktualisiere, auth } = useSitzung();
  const [ergebnis, setErgebnis] = useState(null);
  useEffect(() => {
    api.emailBestaetigen(token)
      .then((a) => { setErgebnis({ ok: true, text: `Danke! Deine E-Mail-Adresse ${a.email} ist jetzt bestätigt.` }); aktualisiere(); })
      .catch((e) => setErgebnis({ ok: false, text: e.message }));
  }, [token]);
  return (
    <Rahmen titel="E-Mail-Adresse bestätigen">
      {!ergebnis ? <p className="text-sm text-leise">Wird geprüft …</p> : (
        <>
          <p className={`text-sm ${ergebnis.ok ? '' : 'text-gefahr'}`} role={ergebnis.ok ? undefined : 'alert'}>{ergebnis.text}</p>
          <a href={auth?.angemeldet ? '#/konto' : '#/'} className="knopf-primaer w-full">{auth?.angemeldet ? 'Zum Konto' : 'Zur Anmeldung'}</a>
        </>
      )}
    </Rahmen>
  );
}
