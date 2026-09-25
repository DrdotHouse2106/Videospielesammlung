import { useEffect, useState } from 'react';
import { ARTIKELTYPEN, beschriftung } from '../../../shared/konstanten.js';
import { api } from '../api.js';
import Layout from '../komponenten/Layout.jsx';
import Symbol from '../komponenten/Symbole.jsx';
import { useHinweis } from '../komponenten/Hinweise.jsx';

export default function Einstellungen({ route, status }) {
  const zeigeHinweis = useHinweis();
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
    <Layout route={route} titel="Einstellungen & Daten">
      <div className="mx-auto max-w-3xl space-y-4">
        <section className="karte space-y-2 p-4">
          <h2 className="font-semibold">Status</h2>
          <Zeile label="Online-Suche (IGDB)" ok={status?.igdbKonfiguriert}
            text={status?.igdbKonfiguriert ? 'Aktiv' : 'Nicht eingerichtet – TWITCH_CLIENT_ID/SECRET in .env setzen'} />
          <Zeile label="Barcode-Datenbanken" ok={status?.barcodeAnbieter?.length > 0}
            text={status?.barcodeAnbieter?.length ? status.barcodeAnbieter.join(', ') : 'Keine – nur gelernte Barcodes'} />
          <Zeile label="Zugangsschutz" ok={status?.zugangsschutz}
            text={status?.zugangsschutz ? 'Aktiv (Benutzername/Passwort)' : 'Aus – für den Betrieb im Internet empfohlen'} />
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
          <h2 className="font-semibold">Eigene Katalogeinträge</h2>
          <p className="mb-3 text-sm text-leise">Selbst angelegte Einträge für Hardware, Zubehör und Raritäten, die in keiner Online-Datenbank stehen.</p>
          {eigene.length === 0 ? (
            <p className="text-sm text-leise">Noch keine eigenen Einträge.</p>
          ) : (
            <ul className="divide-y divide-rand text-sm">
              {eigene.map((e) => (
                <li key={e.id} className="flex items-center gap-2 py-2">
                  <Symbol name={e.typ} className="size-4 shrink-0 text-leise" />
                  <span className="min-w-0 flex-1 truncate">
                    {e.titel}
                    <span className="text-leise"> · {beschriftung(ARTIKELTYPEN, e.typ)}{e.plattformen[0] ? ` · ${e.plattformen[0]}` : ''}</span>
                  </span>
                  <button type="button" onClick={() => eintragLoeschen(e)} className="rounded-lg p-1.5 text-leise hover:bg-gefahr/10 hover:text-gefahr" aria-label={`${e.titel} löschen`}>
                    <Symbol name="muell" className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="karte space-y-2 p-4 text-sm">
          <h2 className="font-semibold">Als App installieren</h2>
          <p className="text-leise">
            <strong className="text-text">Android (Chrome):</strong> Menü ⋮ → „App installieren“ bzw. „Zum Startbildschirm hinzufügen“.<br />
            <strong className="text-text">iPhone/iPad (Safari):</strong> Teilen-Symbol → „Zum Home-Bildschirm“.
          </p>
        </section>

        <section className="space-y-1 px-1 pb-4 text-xs text-leise">
          <p>Videospielesammlung ist freie Software unter der MIT-Lizenz.</p>
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
      <span className="min-w-0 flex-1">{text}</span>
    </div>
  );
}
