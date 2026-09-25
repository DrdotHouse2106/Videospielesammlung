import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ROLLEN } from '../../../shared/konstanten.js';
import { datumDe } from '../format.js';
import { useSitzung } from '../sitzung.js';
import Layout from '../komponenten/Layout.jsx';
import { useHinweis } from '../komponenten/Hinweise.jsx';

export default function Admin({ route }) {
  const { benutzer } = useSitzung();
  const zeigeHinweis = useHinweis();
  const [liste, setListe] = useState(null);
  const [fehler, setFehler] = useState(null);

  const laden = () => api.adminBenutzer().then(setListe).catch((e) => setFehler(e.message));
  useEffect(() => { laden(); }, []);

  const aktion = (fn, meldung) => async () => {
    try {
      await fn();
      zeigeHinweis(meldung);
      laden();
    } catch (e) {
      zeigeHinweis(e.message, 'fehler');
    }
  };

  return (
    <Layout route={route} titel="Benutzerverwaltung" zurueck="/einstellungen">
      <div className="mx-auto max-w-4xl space-y-3">
        {fehler && <p className="text-gefahr" role="alert">{fehler}</p>}
        {liste?.map((b) => (
          <section key={b.id} className="karte space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <strong>{b.anzeigename || b.benutzername}</strong>
              <span className="text-sm text-leise">@{b.benutzername}</span>
              {b.rolle !== 'nutzer' && <span className="abzeichen text-akzent-hell">{ROLLEN.find((r) => r.value === b.rolle)?.label}</span>}
              {b.totp_aktiv ? <span className="abzeichen text-erfolg">2FA</span> : <span className="abzeichen">ohne 2FA</span>}
              {b.sammlung_oeffentlich ? <span className="abzeichen">öffentlich</span> : null}
              {b.gesperrt ? <span className="abzeichen text-gefahr">gesperrt</span> : null}
            </div>
            <p className="text-xs text-leise">
              {b.eintraege} Einträge · registriert {datumDe(b.erstellt_am)} · zuletzt angemeldet {b.letzte_anmeldung ? datumDe(b.letzte_anmeldung) : 'nie'}
            </p>
            {b.id !== benutzer?.id && (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="knopf-sekundaer px-3 py-1.5" onClick={aktion(
                  () => api.adminBenutzerAendern(b.id, { gesperrt: !b.gesperrt }), b.gesperrt ? 'Entsperrt.' : 'Gesperrt und abgemeldet.',
                )}>{b.gesperrt ? 'Entsperren' : 'Sperren'}</button>
                <label className="flex items-center gap-2 text-sm">
                  <span className="sr-only">Rolle</span>
                  <select className="eingabe py-1.5" value={b.rolle} onChange={(e) => aktion(() => api.adminBenutzerAendern(b.id, { rolle: e.target.value }), 'Rolle geändert.')()}>
                    {ROLLEN.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </label>
                {b.totp_aktiv ? (
                  <button type="button" className="knopf-sekundaer px-3 py-1.5" onClick={() => window.confirm(`2FA für ${b.benutzername} zurücksetzen? Nur tun, wenn die Identität geprüft wurde.`)
                    && aktion(() => api.admin2faZuruecksetzen(b.id), '2FA zurückgesetzt.')()}>2FA zurücksetzen</button>
                ) : null}
                <button type="button" className="knopf-sekundaer px-3 py-1.5" onClick={() => {
                  const pw = window.prompt(`Neues Passwort für ${b.benutzername} (mind. 10 Zeichen):`);
                  if (pw) aktion(() => api.adminPasswort(b.id, pw), 'Passwort gesetzt, alle Sitzungen beendet.')();
                }}>Passwort setzen</button>
                <button type="button" className="knopf-gefahr px-3 py-1.5" onClick={() => window.confirm(`Konto ${b.benutzername} mit allen Daten endgültig löschen?`)
                  && aktion(() => api.adminBenutzerLoeschen(b.id), 'Konto gelöscht.')()}>Löschen</button>
              </div>
            )}
          </section>
        ))}
      </div>
    </Layout>
  );
}
