// Administration: Übersicht, Benutzer & Rollen (Moderatoren ernennen), Server-Einstellungen, rechtliche Seiten, Preisimport.
import { useEffect, useState } from 'react';
import { ROLLEN } from '../../../shared/konstanten.js';
import { api } from '../api.js';
import { anzahl, datumDe, dateigroesse } from '../format.js';
import { useSitzung } from '../sitzung.js';
import Layout from '../komponenten/Layout.jsx';
import Symbol from '../komponenten/Symbole.jsx';
import SpeicherAnzeige from '../komponenten/SpeicherAnzeige.jsx';
import AdminEinstellungen from './AdminEinstellungen.jsx';
import { useHinweis } from '../komponenten/Hinweise.jsx';

const REITER = [['uebersicht', 'Übersicht'], ['benutzer', 'Benutzer & Rollen'], ['einstellungen', 'Einstellungen'], ['rechtliches', 'Rechtliches'], ['preise', 'Preisimport'], ['sicherungen', 'Sicherungen']];

export default function Admin({ route }) {
  const reiter = route.parameter.reiter ?? 'uebersicht';
  const [daten, setDaten] = useState(null);
  const [fehler, setFehler] = useState(null);
  const laden = () => api.adminUebersicht().then(setDaten).catch((e) => setFehler(e.message));
  useEffect(() => { laden(); }, [reiter]);

  return (
    <Layout route={route} titel="Administration" zurueck="/einstellungen">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4" role="tablist">
          {REITER.map(([wert, label]) => (
            <a key={wert} href={`#/admin?reiter=${wert}`} role="tab" aria-selected={reiter === wert} className={reiter === wert ? 'chip-aktiv' : 'chip'}>{label}</a>
          ))}
        </div>
        {fehler && <p className="text-gefahr" role="alert">{fehler}</p>}
        {reiter === 'uebersicht' && daten && <Uebersicht d={daten} />}
        {reiter === 'benutzer' && <Benutzer />}
        {reiter === 'einstellungen' && <AdminEinstellungen />}
        {reiter === 'rechtliches' && <Rechtliches />}
        {reiter === 'preise' && daten && <Preisimport d={daten} onNeu={laden} />}
        {reiter === 'sicherungen' && <Sicherungen />}
      </div>
    </Layout>
  );
}

function Kachel({ titel, wert, hinweis, href }) {
  const Tag = href ? 'a' : 'div';
  return (
    <Tag href={href} className={`karte block p-4 ${href ? 'hover:border-akzent/60 hover:bg-karte-hover' : ''}`}>
      <p className="text-xs font-semibold tracking-wide text-leise uppercase">{titel}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{wert}</p>
      {hinweis && <p className="text-xs text-leise">{hinweis}</p>}
    </Tag>
  );
}

function Uebersicht({ d }) {
  const offenGesamt = Object.values(d.offen).reduce((a, b) => a + b, 0);
  const dienste = [
    ['IGDB (Spieldaten)', d.dienste.igdb], ['eBay-Angebote', d.dienste.ebay], ['PriceCharting', d.dienste.priceCharting],
    ['Affiliate-Links', d.dienste.affiliate], ['Öffentlicher Katalog', d.dienste.oeffentlicherKatalog],
    ['Registrierung offen', d.dienste.registrierungOffen], ['2FA-Pflicht', d.dienste.zweiFaktorPflicht], ['Scans teilen erlaubt', d.dienste.medienTeilen],
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kachel titel="Benutzer" wert={anzahl(d.benutzer)} hinweis={`+${d.neueBenutzer7Tage} in 7 Tagen`} href="#/admin?reiter=benutzer" />
        <Kachel titel="Moderationsteam" wert={anzahl(d.moderatoren)} hinweis="Admins & Moderatoren" href="#/admin?reiter=benutzer" />
        <Kachel titel="Mit 2FA" wert={`${anzahl(d.mitZweiFaktor)} / ${anzahl(d.benutzer)}`} />
        <Kachel titel="Offene Prüfungen" wert={anzahl(offenGesamt)} hinweis={`${d.offen.meldungen} Meldungen`} href="#/moderation" />
        <Kachel titel="Katalog (global)" wert={anzahl(d.katalogFreigegeben)} hinweis={`${anzahl(d.katalogPrivat)} private Einträge`} href="#/katalog" />
        <Kachel titel="Artikel in Sammlungen" wert={anzahl(d.artikel)} />
        <Kachel titel="Freigegebene Scans" wert={anzahl(d.medienFreigegeben)} />
        <Kachel titel="Preisdaten" wert={anzahl(d.preisdaten)} href="#/admin?reiter=preise" />
        {d.speicher && <Kachel titel="Upload-Speicher gesamt" wert={dateigroesse(d.speicher.gesamt) || '0 KB'} />}
      </div>
      {offenGesamt > 0 && (
        <a href="#/moderation" className="karte flex items-center gap-3 border-warnung/50 p-4 text-sm hover:bg-karte-hover">
          <Symbol name="warnung" className="size-5 text-warnung" />
          <span className="flex-1">
            Offen: {d.offen.katalog} Katalogeinträge, {d.offen.varianten} Varianten, {d.offen.medien} Scans, {d.offen.links} Links, {d.offen.meldungen} Meldungen
          </span>
          <Symbol name="weiter" className="size-5 text-leise" />
        </a>
      )}
      <section className="karte space-y-1 p-4 text-sm">
        <h2 className="mb-1 font-semibold">KI-Vorprüfung</h2>
        {d.ki.aktiv ? (
          <>
            <p>Anbieter: <strong>{d.ki.anbieter}</strong> · Modell: <strong>{d.ki.modell}</strong></p>
            <p className="text-leise">
              Automatisch freigeben: {d.ki.automatischFreigeben ? 'ja' : 'nein'} · automatisch ablehnen: {d.ki.automatischAblehnen ? 'ja' : 'nein'} ·
              ab {Math.round(d.ki.mindestKonfidenz * 100)} % Sicherheit
            </p>
            <p className="text-leise">
              Letzte 7 Tage: {d.ki.letzte7Tage.length ? d.ki.letzte7Tage.map((z) => `${z.anzahl}× ${z.ergebnis}`).join(', ') : 'keine Prüfungen'}
            </p>
            <a href="#/moderation?reiter=ki" className="text-akzent-hell underline">Zum KI-Protokoll</a>
          </>
        ) : (
          <p className="text-leise">Aus. Aktivieren über <code>AI_PROVIDER</code> und <code>AI_API_KEY</code> in der .env (Claude, Gemini oder OpenAI-kompatibel).</p>
        )}
      </section>
      <section className="karte p-4">
        <h2 className="mb-2 font-semibold">Dienste & Einstellungen</h2>
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {dienste.map(([label, an]) => (
            <li key={label} className="flex items-center gap-2">
              <span className={`size-2 rounded-full ${an ? 'bg-erfolg' : 'bg-leise/40'}`} aria-hidden="true" />{label}: <strong>{an ? 'an' : 'aus'}</strong>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-leise">Geändert werden diese Einstellungen in der .env-Datei des Servers (siehe README).</p>
      </section>
    </div>
  );
}

function Benutzer() {
  const { benutzer } = useSitzung();
  const zeigeHinweis = useHinweis();
  const [liste, setListe] = useState(null);
  const [suche, setSuche] = useState('');
  const [rolle, setRolle] = useState('');
  const laden = () => api.adminBenutzer().then(setListe).catch((e) => zeigeHinweis(e.message, 'fehler'));
  useEffect(() => { laden(); }, []);

  const aktion = (fn, meldung) => async () => {
    try { await fn(); zeigeHinweis(meldung); laden(); } catch (e) { zeigeHinweis(e.message, 'fehler'); }
  };
  const gefiltert = (liste ?? []).filter((b) => (!rolle || b.rolle === rolle)
    && (!suche || `${b.benutzername} ${b.anzeigename ?? ''}`.toLowerCase().includes(suche.toLowerCase())));

  return (
    <div className="space-y-3">
      <p className="karte p-3 text-sm text-leise">
        <strong className="text-text">Rollen:</strong> <em>Moderatoren</em> prüfen Einreichungen und Meldungen, bearbeiten Katalogeinträge,
        Varianten, Plattformen und Kauflinks. <em>Administratoren</em> dürfen zusätzlich Benutzer verwalten und die rechtlichen Seiten ändern.
      </p>
      <div className="flex gap-2">
        <input className="eingabe flex-1" type="search" placeholder="Benutzer suchen …" value={suche} onChange={(e) => setSuche(e.target.value)} />
        <select className="eingabe w-40" value={rolle} onChange={(e) => setRolle(e.target.value)} aria-label="Nach Rolle filtern">
          <option value="">Alle Rollen</option>
          {ROLLEN.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>
      {gefiltert.map((b) => (
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
            {b.email ? `${b.email} · ` : 'ohne E-Mail · '}{b.eintraege} Einträge · registriert {datumDe(b.erstellt_am)} · zuletzt angemeldet {b.letzte_anmeldung ? datumDe(b.letzte_anmeldung) : 'nie'}
          </p>
          <SpeicherAnzeige info={b.speicher} kompakt />
          <p className="text-xs text-leise">
            Speicherlimit: {b.speicher.eigenesLimit === null ? `Standard (${b.rolle === 'admin' ? 'unbegrenzt für Admins' : `${anzahl(b.speicher.standardMb)} MB`})`
              : b.speicher.eigenesLimit === 0 ? 'unbegrenzt' : `${anzahl(b.speicher.eigenesLimit)} MB (individuell)`}
            {' · '}
            <button type="button" className="text-akzent-hell underline" onClick={() => {
              const eingabe = window.prompt(`Speicherlimit für ${b.benutzername} in MB (0 = unbegrenzt, leer = Standard):`, b.speicher.eigenesLimit ?? '');
              if (eingabe === null) return;
              const wert = eingabe.trim() === '' ? null : Number(eingabe.trim().replace(',', '.'));
              aktion(() => api.adminBenutzerAendern(b.id, { speicher_limit_mb: wert }), 'Speicherlimit gespeichert.')();
            }}>ändern</button>
          </p>
          {b.id !== benutzer?.id ? (
            <div className="flex flex-wrap items-center gap-2">
              {b.rolle === 'nutzer' && (
                <button type="button" className="knopf-primaer px-3 py-1.5" onClick={aktion(() => api.adminBenutzerAendern(b.id, { rolle: 'moderator' }), `${b.benutzername} ist jetzt Moderator.`)}>
                  <Symbol name="schild" className="size-4" />Zum Moderator machen
                </button>
              )}
              <label className="flex items-center gap-2 text-sm">
                <span className="text-leise">Rolle:</span>
                <select className="eingabe py-1.5" value={b.rolle} onChange={(e) => aktion(() => api.adminBenutzerAendern(b.id, { rolle: e.target.value }), 'Rolle geändert.')()}>
                  {ROLLEN.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </label>
              <button type="button" className="knopf-sekundaer px-3 py-1.5" onClick={aktion(
                () => api.adminBenutzerAendern(b.id, { gesperrt: !b.gesperrt }), b.gesperrt ? 'Entsperrt.' : 'Gesperrt und abgemeldet.',
              )}>{b.gesperrt ? 'Entsperren' : 'Sperren'}</button>
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
          ) : <p className="text-xs text-leise">Das bist du.</p>}
        </section>
      ))}
      {liste && gefiltert.length === 0 && <p className="text-sm text-leise">Keine Benutzer gefunden.</p>}
    </div>
  );
}

function Rechtliches() {
  const [seiten, setSeiten] = useState([]);
  useEffect(() => { api.seiten().then(setSeiten).catch(() => {}); }, []);
  return (
    <div className="space-y-3">
      <p className="karte p-3 text-sm">
        Diese Seiten sind für alle ohne Anmeldung erreichbar und in der Fußzeile verlinkt. Sie enthalten <strong>Vorlagen</strong> –
        bitte alle Angaben in [eckigen Klammern] ersetzen. Die Vorlagen sind keine Rechtsberatung.
      </p>
      <ul className="karte divide-y divide-rand overflow-hidden">
        {seiten.map((s) => (
          <li key={s.slug}>
            <a href={`#/seite/${s.slug}`} className="flex items-center gap-3 p-4 hover:bg-karte-hover">
              <Symbol name="dokument" className="size-5 text-akzent-hell" />
              <span className="flex-1"><strong>{s.titel}</strong><span className="block text-xs text-leise">zuletzt geändert {datumDe(s.aktualisiert_am)}</span></span>
              <span className="text-sm text-leise">Ansehen & bearbeiten</span>
              <Symbol name="weiter" className="size-5 text-leise" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Preisimport({ d, onNeu }) {
  const zeigeHinweis = useHinweis();
  const p = d.preisimport;
  return (
    <div className="space-y-3">
      <section className="karte space-y-2 p-4 text-sm">
        <h2 className="font-semibold">Automatischer Preisimport</h2>
        <p className="text-leise">
          Holt regelmäßig aktuelle Angebote über die offizielle eBay-API (inkl. Affiliate-Links) und Marktpreise von PriceCharting –
          für alle freigegebenen Katalogeinträge, die jemand sammelt. Die Werte erscheinen im Preisverlauf.
        </p>
        <p>Status: <strong>{p.aktiv ? (p.laeuft ? 'läuft gerade' : 'bereit') : 'keine Preisquelle eingerichtet'}</strong>
          {p.aktiv && d.dienste && ` · eBay ${d.dienste.ebay ? 'an' : 'aus'} · PriceCharting ${d.dienste.priceCharting ? 'an' : 'aus'}`}
        </p>
        {p.intervallStunden > 0 && p.aktiv && <p>Automatisch alle {p.intervallStunden} Stunden.</p>}
        {p.letzterLauf && <p>Letzter Lauf: {new Date(p.letzterLauf).toLocaleString('de-DE')} – {p.verarbeitet} Einträge aktualisiert.</p>}
        {p.fehler?.length > 0 && <ul className="list-disc pl-5 text-gefahr">{p.fehler.map((f) => <li key={f}>{f}</li>)}</ul>}
        <button type="button" className="knopf-primaer" disabled={!p.aktiv || p.laeuft} onClick={async () => {
          try { await api.preisimportStarten(); zeigeHinweis('Preisimport gestartet – das kann einige Minuten dauern.'); setTimeout(onNeu, 3000); } catch (e) { zeigeHinweis(e.message, 'fehler'); }
        }}>
          <Symbol name="aktualisieren" className="size-4" />Jetzt aktualisieren
        </button>
      </section>
      {!p.aktiv && (
        <p className="karte p-3 text-sm text-leise">
          Einrichtung: kostenlosen Zugang unter developer.ebay.com anlegen und <code>EBAY_CLIENT_ID</code> / <code>EBAY_CLIENT_SECRET</code> in der
          .env setzen (optional zusätzlich <code>PRICECHARTING_TOKEN</code>). Details in der README.
        </p>
      )}
    </div>
  );
}

function Sicherungen() {
  const zeigeHinweis = useHinweis();
  const [s, setS] = useState(null);
  const [laeuft, setLaeuft] = useState(false);
  const laden = () => api.adminSicherungen().then(setS).catch((e) => zeigeHinweis(e.message, 'fehler'));
  useEffect(() => { laden(); }, []);
  if (!s) return <p className="text-leise">Wird geladen …</p>;
  const Liste = ({ titel, eintraege }) => (
    <section className="karte space-y-2 p-4 text-sm">
      <h2 className="font-semibold">{titel} ({eintraege.length})</h2>
      {eintraege.length === 0 ? <p className="text-leise">Noch keine Sicherung vorhanden.</p> : (
        <ul className="divide-y divide-rand">
          {eintraege.map((e) => (
            <li key={e.name} className="flex flex-wrap justify-between gap-2 py-1.5">
              <code className="break-all">{e.name}</code>
              <span className="text-leise">{dateigroesse(e.groesse)} · {new Date(e.erstellt_am).toLocaleString('de-DE')}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
  return (
    <div className="space-y-3">
      <section className="karte space-y-2 p-4 text-sm">
        <h2 className="font-semibold">Automatische Datenbank-Sicherung</h2>
        {!s.verzeichnis ? <p className="text-leise">Nicht verfügbar (Datenbank im Arbeitsspeicher).</p> : (
          <>
            <p className="text-leise">
              {s.aktiv ? `Aktiv: täglich eine Sicherung, aufbewahrt werden die letzten ${s.tage} Tage und ${s.monate} Monate.` : 'Ausgeschaltet (Administration → Einstellungen).'}
              {' '}Ordner: <code className="break-all">{s.verzeichnis}</code>
            </p>
            <p className="text-leise">
              Gesichert wird die Datenbank (Sammlungen, Konten, Katalog, Einstellungen). Fotos und Scans liegen im Upload-Ordner –
              sichere das gesamte Datenverzeichnis zusätzlich, z. B. per Proxmox-Backup, und bewahre eine Kopie außer Haus auf.
            </p>
            {s.letzterFehler && <p className="text-gefahr">Letzter Fehler: {s.letzterFehler}</p>}
            <button type="button" className="knopf-primaer" disabled={laeuft} onClick={async () => {
              setLaeuft(true);
              try { setS(await api.adminSicherungStarten()); zeigeHinweis('Sicherung erstellt.'); } catch (e) { zeigeHinweis(e.message, 'fehler'); }
              setLaeuft(false);
            }}>{laeuft ? 'Wird gesichert …' : 'Jetzt sichern'}</button>
          </>
        )}
      </section>
      <Liste titel="Tägliche Sicherungen" eintraege={s.taeglich} />
      <Liste titel="Monatliche Sicherungen" eintraege={s.monatlich} />
    </div>
  );
}
