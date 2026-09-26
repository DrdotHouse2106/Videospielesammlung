import { useEffect, useState } from 'react';
import { MARKE } from '../../../shared/marke.js';
import { ARTIKELTYPEN, beschriftung, istModerator } from '../../../shared/konstanten.js';
import StatusAbzeichen from '../komponenten/StatusAbzeichen.jsx';
import { api } from '../api.js';
import Layout from '../komponenten/Layout.jsx';
import { useSitzung } from '../sitzung.js';
import Symbol from '../komponenten/Symbole.jsx';
import { useHinweis } from '../komponenten/Hinweise.jsx';

export default function Einstellungen({ route }) {
  const zeigeHinweis = useHinweis();
  const { status, benutzer, abmelden } = useSitzung();
  const [eigene, setEigene] = useState([]);
  const [importiert, setImportiert] = useState(null);

  const ladeEigene = () => api.eigeneKatalogeintraege().then(setEigene).catch(() => {});
  useEffect(() => { ladeEigene(); }, []);

  async function importieren(e) {
    const datei = e.target.files?.[0];
    e.target.value = '';
    if (!datei) return;
    try {
      const daten = JSON.parse(await datei.text());
      const ergebnis = await api.importieren(daten);
      setImportiert(ergebnis);
      zeigeHinweis(`${ergebnis.importiert} Artikel importiert.`);
      ladeEigene();
    } catch (fehler) {
      zeigeHinweis(fehler instanceof SyntaxError ? 'Die Datei ist keine gültige JSON-Datei.' : fehler.message, 'fehler');
    }
  }

  async function eintragLoeschen(eintrag) {
    if (!window.confirm(`Katalogeintrag „${eintrag.titel}“ löschen? Artikel in deiner Sammlung bleiben erhalten.`)) return;
    try {
      await api.katalogLoeschen(eintrag.id);
      ladeEigene();
    } catch (fehler) {
      zeigeHinweis(fehler.message, 'fehler');
    }
  }

  return (
    <Layout route={route} titel="Mehr">
      <div className="mx-auto max-w-3xl space-y-4">
        <nav className="karte divide-y divide-rand overflow-hidden" aria-label="Weitere Seiten">
          {[
            ['#/konto', 'benutzer', 'Konto & Sicherheit', benutzer?.totp_aktiv ? 'Passwort, 2FA aktiv, Sichtbarkeit' : 'Passwort, Zwei-Faktor-Anmeldung, Sichtbarkeit'],
            ['#/katalog', 'suche', 'Katalog', 'Alle Spiele, Konsolen & Zubehör nach Plattform'],
            ['#/community', 'community', 'Community', 'Öffentliche Sammlungen anderer Benutzer'],
            ['#/erfolge', 'pokal', 'Erfolge & Sammlungsziele', 'Abzeichen freischalten, Fortschritt je Plattform'],
            ['#/statistik', 'statistik', 'Statistik', 'Verteilung nach Plattform, Region, Zustand'],
            ...(istModerator(benutzer) ? [['#/moderation', 'schild', 'Moderation', 'Einreichungen prüfen, Plattformen pflegen']] : []),
            ...(benutzer?.rolle === 'admin' ? [['#/admin', 'benutzer', 'Administration', 'Übersicht, Benutzer & Moderatoren, Rechtliches, Preisimport']] : []),
          ].map(([href, symbol, titel, text]) => (
            <a key={href} href={href} className="flex items-center gap-3 p-4 hover:bg-karte-hover">
              <Symbol name={symbol} className="size-5 shrink-0 text-akzent-hell" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{titel}</span>
                <span className="block truncate text-xs text-leise">{text}</span>
              </span>
              <Symbol name="weiter" className="size-5 text-leise" />
            </a>
          ))}
          <button type="button" onClick={abmelden} className="flex w-full items-center gap-3 p-4 text-left hover:bg-karte-hover">
            <Symbol name="abmelden" className="size-5 shrink-0 text-leise" />
            <span className="flex-1 font-semibold">Abmelden <span className="font-normal text-leise">({benutzer?.benutzername})</span></span>
          </button>
        </nav>

        <section className="karte space-y-2 p-4">
          <h2 className="font-semibold">Serverstatus</h2>
          <Zeile label="Online-Suche (IGDB)" ok={status?.igdbKonfiguriert}
            text={status?.igdbKonfiguriert ? 'Aktiv' : 'Nicht eingerichtet – TWITCH_CLIENT_ID/SECRET in .env setzen'} />
          <Zeile label="Barcode-Datenbanken" ok={status?.barcodeAnbieter?.length > 0}
            text={status?.barcodeAnbieter?.length ? status.barcodeAnbieter.join(', ') : 'Keine – nur gelernte Barcodes'} />
          <Zeile label="Marktpreise" ok={status?.priceChartingAktiv}
            text={status?.priceChartingAktiv ? 'PriceCharting aktiv' : 'Nur eigene Schätzungen & Community-Werte'} />
          <Zeile label="Registrierung" ok
            text={`${status?.registrierungOffen ? 'Offen' : 'Geschlossen'}${status?.zweiFaktorPflicht ? ' · 2FA ist Pflicht' : ''}`} />
          <Zeile label="Kamera für Scanner" ok={window.isSecureContext}
            text={window.isSecureContext ? 'Verfügbar (sichere Verbindung)' : 'Nur über HTTPS verfügbar'} />
          {status?.version && <p className="pt-1 text-xs text-leise">Version {status.version}</p>}
        </section>

        <section className="karte space-y-3 p-4">
          <h2 className="font-semibold">Datensicherung</h2>
          <p className="text-sm text-leise">
            Exportiere deine Sammlung als JSON (vollständige Sicherung, wieder importierbar) oder als CSV für Excel/LibreOffice.
          </p>
          <div className="flex flex-wrap gap-2">
            <a className="knopf-sekundaer" href="/api/export.json" download><Symbol name="herunterladen" className="size-4" />JSON-Export</a>
            <a className="knopf-sekundaer" href="/api/export.csv" download><Symbol name="herunterladen" className="size-4" />CSV-Export (Excel)</a>
            <label className="knopf-sekundaer cursor-pointer">
              <Symbol name="hochladen" className="size-4" />JSON importieren
              <input type="file" accept="application/json,.json" className="sr-only" onChange={importieren} />
            </label>
            <a className="knopf-sekundaer" href="#/import"><Symbol name="hochladen" className="size-4" />CSV importieren (CLZ, Excel)</a>
          </div>
          {importiert?.fehlerhaft?.length > 0 && (
            <div className="rounded-xl bg-warnung/10 p-3 text-sm">
              <p className="font-semibold text-warnung">{importiert.fehlerhaft.length} Einträge wurden übersprungen:</p>
              <ul className="mt-1 list-disc pl-5">
                {importiert.fehlerhaft.slice(0, 20).map((f) => (
                  <li key={f.zeile}>Nr. {f.zeile}{f.titel ? ` („${f.titel}“)` : ''}: {Object.values(f.fehler).join(' ')}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="karte p-4">
          <h2 className="font-semibold">Meine Katalogeinträge</h2>
          <p className="mb-3 text-sm text-leise">
            Selbst angelegte Einträge für Hardware, Zubehör und Raritäten. Private Einträge siehst nur du – über „Einreichen“
            kannst du sie für die globale Datenbank vorschlagen.
          </p>
          {eigene.length === 0 ? (
            <p className="text-sm text-leise">Noch keine eigenen Einträge.</p>
          ) : (
            <ul className="divide-y divide-rand text-sm">
              {eigene.map((e) => (
                <li key={e.id} className="flex items-center gap-2 py-2">
                  <Symbol name={e.typ} className="size-4 shrink-0 text-leise" />
                  <a href={`#/katalog/${e.id}`} className="min-w-0 flex-1 truncate hover:underline">
                    {e.titel}
                    <span className="text-leise"> · {beschriftung(ARTIKELTYPEN, e.typ)}{e.plattformen[0] ? ` · ${e.plattformen[0]}` : ''}</span>
                  </a>
                  <StatusAbzeichen status={e.status} />
                  {e.status !== 'freigegeben' && (
                  <button type="button" onClick={() => eintragLoeschen(e)} className="rounded-lg p-1.5 text-leise hover:bg-gefahr/10 hover:text-gefahr" aria-label={`${e.titel} löschen`}>
                    <Symbol name="muell" className="size-4" />
                  </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <a href="#/seite/sicherheit" className="karte flex items-start gap-3 border-akzent/40 p-4 text-sm hover:bg-karte-hover">
          <Symbol name="schild" className="size-6 shrink-0 text-akzent-hell" />
          <span>
            <strong className="block">Sicherheit ist uns sehr wichtig</strong>
            <span className="text-leise">Du hast eine Sicherheitslücke gefunden? Wir freuen uns über jeden Hinweis – hier erfährst du, wie du sie vertraulich meldest.</span>
          </span>
        </a>

        <section className="karte space-y-2 p-4 text-sm">
          <h2 className="font-semibold">Als App installieren</h2>
          <p className="text-leise">
            <strong className="text-text">Android (Chrome):</strong> Menü ⋮ → „App installieren“ bzw. „Zum Startbildschirm hinzufügen“.<br />
            <strong className="text-text">iPhone/iPad (Safari):</strong> Teilen-Symbol → „Zum Home-Bildschirm“.
          </p>
        </section>

        <section className="space-y-1 px-1 pb-4 text-xs text-leise">
          <p>{MARKE.name} ist <a className="underline" href="https://github.com/DrdotHouse2106/ZockDB" target="_blank" rel="noreferrer">quelloffen auf GitHub</a> unter der PolyForm-Noncommercial-Lizenz – private und gemeinnützige Nutzung frei, kommerzielle Nutzung nur mit Erlaubnis.</p>
          <p>Marktpreise optional von <a className="underline" href="https://www.pricecharting.com" target="_blank" rel="noreferrer">PriceCharting</a>, Wechselkurs von der Europäischen Zentralbank.</p>
          <p>Spieldaten und Coverbilder werden von <a className="underline" href="https://www.igdb.com" target="_blank" rel="noreferrer">IGDB.com</a> bereitgestellt.</p>
        </section>
      </div>
    </Layout>
  );
}

function Zeile({ label, ok, text }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${ok ? 'bg-erfolg' : 'bg-warnung'}`} aria-hidden="true" />
      <span className="w-40 shrink-0 text-leise">{label}</span>
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{text}</span>
    </div>
  );
}
