// Scans & Dokumente zu einem Spiel/Gerät: Cover-Scans, Handbücher, Labels …
import { useEffect, useState } from 'react';
import { MEDIENARTEN, beschriftung, istModerator } from '../../../shared/konstanten.js';
import StatusAbzeichen from './StatusAbzeichen.jsx';
import { api } from '../api.js';
import { dateigroesse } from '../format.js';
import { useSitzung } from '../sitzung.js';
import Symbol from './Symbole.jsx';
import { useHinweis } from './Hinweise.jsx';

const mm = (px, dpi) => Math.round((px / dpi) * 25.4);

export default function Scans({ katalogId, artikelId, nurLesen = false, onKatalogVerknuepft }) {
  const zeigeHinweis = useHinweis();
  const { status, benutzer } = useSitzung();
  const [medien, setMedien] = useState(katalogId ? null : []);
  const [formularOffen, setFormularOffen] = useState(false);

  const laden = (id = katalogId) => id && api.medien(id).then(setMedien).catch((e) => zeigeHinweis(e.message, 'fehler'));
  useEffect(() => { laden(); }, [katalogId]);

  async function sichtbarkeitUmschalten(m) {
    try {
      const neu = m.sichtbarkeit === 'privat' || m.sichtbarkeit === 'abgelehnt' ? 'eingereicht' : 'privat';
      await api.mediumAendern(m.id, { sichtbarkeit: neu });
      zeigeHinweis(neu === 'eingereicht' ? 'Zur Freigabe eingereicht – das Moderationsteam prüft den Scan.' : 'Scan ist wieder privat.');
      laden();
    } catch (e) {
      zeigeHinweis(e.message, 'fehler');
    }
  }

  async function loeschen(m) {
    if (!window.confirm(`„${m.titel || beschriftung(MEDIENARTEN, m.art)}“ wirklich löschen?`)) return;
    try {
      await api.mediumLoeschen(m.id);
      laden();
    } catch (e) {
      zeigeHinweis(e.message, 'fehler');
    }
  }

  return (
    <section className="karte space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold"><Symbol name="dokument" className="size-5" />Scans & Dokumente</h3>
        {!nurLesen && !formularOffen && (
          <button type="button" className="knopf-sekundaer px-3 py-1.5" onClick={() => setFormularOffen(true)}>
            <Symbol name="hochladen" className="size-4" />Hinzufügen
          </button>
        )}
      </div>

      {formularOffen && (
        <HochladeFormular
          artikelId={artikelId}
          teilenErlaubt={status?.medienTeilenErlaubt !== false}
          moderator={istModerator(benutzer)}
          maxMb={status?.maxMedienMb}
          onFertig={(medium) => {
            setFormularOffen(false);
            if (medium) {
              zeigeHinweis('Scan gespeichert.');
              if (!katalogId) onKatalogVerknuepft?.(medium.katalog_id);
              else laden();
            }
          }}
        />
      )}

      {medien === null && <p className="text-sm text-leise">Wird geladen …</p>}
      {medien?.length === 0 && !formularOffen && (
        <p className="text-sm text-leise">
          {nurLesen
            ? 'Keine freigegebenen Scans vorhanden.'
            : 'Noch keine Scans. Lade hochauflösende Cover-Scans (z. B. 600 dpi) hoch, um sie bei Bedarf in Originalgröße nachzudrucken – oder das Handbuch als PDF.'}
        </p>
      )}

      {medien?.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {medien.map((m) => {
            const istBild = m.mime.startsWith('image/');
            return (
              <li key={m.id} className="flex flex-col overflow-hidden rounded-xl border border-rand">
                <a href={m.url} target="_blank" rel="noreferrer" className="flex aspect-square items-center justify-center bg-karte-hover">
                  {m.vorschau_url
                    ? <img src={m.vorschau_url} alt={m.titel || beschriftung(MEDIENARTEN, m.art)} loading="lazy" className="size-full object-contain" />
                    : <Symbol name="dokument" className="size-12 text-leise/60" />}
                </a>
                <div className="flex flex-1 flex-col gap-1 p-2 text-xs">
                  <p className="font-semibold text-text">{beschriftung(MEDIENARTEN, m.art)}</p>
                  {m.titel && <p className="truncate text-leise">{m.titel}</p>}
                  <p className="text-leise">
                    {istBild && m.breite ? `${m.breite}×${m.hoehe} px` : m.seiten ? `${m.seiten} Seiten` : 'PDF'}
                    {m.dpi && istBild ? ` · ${m.dpi} dpi ≈ ${mm(m.breite, m.dpi)}×${mm(m.hoehe, m.dpi)} mm` : ''}
                    {` · ${dateigroesse(m.groesse)}`}
                  </p>
                  {!m.eigenes && (
                    <p className="flex items-start gap-1 rounded-md bg-akzent/10 px-1.5 py-1 text-akzent-hell">
                      <Symbol name="benutzer" className="mt-0.5 size-3 shrink-0" />
                      <span>Nutzer-Upload von {m.hochgeladen_von}{m.geprueft_am ? ` · geprüft ${new Date(`${m.geprueft_am}Z`).toLocaleDateString('de-DE')}` : ''}</span>
                    </p>
                  )}
                  {m.eigenes && <StatusAbzeichen status={m.sichtbarkeit} className="w-fit" />}
                  {m.eigenes && m.sichtbarkeit === 'abgelehnt' && m.pruefung_notiz && <p className="text-gefahr">{m.pruefung_notiz}</p>}
                  <div className="mt-auto flex flex-wrap gap-1 pt-1">
                    {istBild && (
                      <a href={`#/druck/${m.id}`} className="rounded-lg p-1.5 text-leise hover:bg-karte-hover hover:text-text" title="Drucken" aria-label="Drucken">
                        <Symbol name="drucker" className="size-4" />
                      </a>
                    )}
                    <a href={`${m.original_url}?download=1`} className="rounded-lg p-1.5 text-leise hover:bg-karte-hover hover:text-text" title="Original herunterladen" aria-label="Original herunterladen">
                      <Symbol name="herunterladen" className="size-4" />
                    </a>
                    {m.eigenes && !nurLesen && status?.medienTeilenErlaubt !== false && (
                      <button type="button" onClick={() => sichtbarkeitUmschalten(m)} className="rounded-lg p-1.5 text-leise hover:bg-karte-hover hover:text-text"
                        title={['privat', 'abgelehnt'].includes(m.sichtbarkeit) ? 'Zur Freigabe für alle einreichen' : 'Wieder privat machen'} aria-label="Sichtbarkeit ändern">
                        <Symbol name={['privat', 'abgelehnt'].includes(m.sichtbarkeit) ? 'hochladen' : 'schloss'} className="size-4" />
                      </button>
                    )}
                    {m.darf_bearbeiten && !nurLesen && (
                      <button type="button" onClick={() => loeschen(m)} className="rounded-lg p-1.5 text-leise hover:bg-gefahr/10 hover:text-gefahr" title="Löschen" aria-label="Löschen">
                        <Symbol name="muell" className="size-4" />
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function HochladeFormular({ artikelId, teilenErlaubt, moderator, maxMb, onFertig }) {
  const [datei, setDatei] = useState(null);
  const [werte, setWerte] = useState({ art: 'cover_vorne', sichtbarkeit: 'privat', titel: '', dpi: '' });
  const [fortschritt, setFortschritt] = useState(null);
  const [fehler, setFehler] = useState(null);
  const setze = (f) => (e) => setWerte((w) => ({ ...w, [f]: e.target.value }));

  async function absenden(e) {
    e.preventDefault();
    if (!datei) return setFehler('Bitte eine Datei auswählen.');
    setFehler(null);
    setFortschritt(0);
    try {
      onFertig(await api.mediumHochladen(artikelId, werte, datei, setFortschritt));
    } catch (err) {
      setFehler(Object.values(err.felder ?? {})[0] ?? err.message);
      setFortschritt(null);
    }
  }

  return (
    <form onSubmit={absenden} className="space-y-3 rounded-xl border border-rand p-3">
      <label className="block">
        <span className="beschriftung">Datei (JPG, PNG, WebP, TIFF oder PDF{maxMb ? `, max. ${maxMb} MB` : ''})</span>
        <input type="file" accept="image/jpeg,image/png,image/webp,image/tiff,application/pdf,.tif,.tiff"
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-akzent file:px-3 file:py-2 file:font-semibold file:text-akzent-text"
          onChange={(e) => setDatei(e.target.files?.[0] ?? null)} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className="beschriftung">Art</span>
          <select className="eingabe" value={werte.art} onChange={setze('art')}>
            {MEDIENARTEN.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </label>
        <label>
          <span className="beschriftung">Sichtbarkeit</span>
          <select className="eingabe" value={werte.sichtbarkeit} onChange={setze('sichtbarkeit')} disabled={!teilenErlaubt}>
            <option value="privat">Nur für mich</option>
            <option value="eingereicht">Zur Freigabe für alle einreichen</option>
            {moderator && <option value="freigegeben">Direkt freigeben (Moderation)</option>}
          </select>
        </label>
        <label>
          <span className="beschriftung">Bezeichnung (optional)</span>
          <input className="eingabe" value={werte.titel} onChange={setze('titel')} placeholder="z. B. PAL-Cover, USK-Version" maxLength={200} />
        </label>
        <label>
          <span className="beschriftung">Scan-Auflösung in dpi (optional)</span>
          <input className="eingabe" value={werte.dpi} onChange={setze('dpi')} inputMode="numeric" placeholder="wird sonst aus der Datei gelesen" />
        </label>
      </div>
      {werte.sichtbarkeit !== 'privat' && (
        <p className="text-xs text-leise">
          Nach der Freigabe durch das Moderationsteam sehen alle angemeldeten Benutzer den Scan – deutlich gekennzeichnet als
          Nutzer-Upload mit deinem Namen. Cover und Handbücher sind urheberrechtlich geschützt: Reiche nur Scans ein,
          die du selbst erstellt hast und deren Weitergabe zulässig ist.
        </p>
      )}
      {fortschritt !== null && (
        <div className="h-2 overflow-hidden rounded-full bg-karte-hover" role="progressbar" aria-valuenow={Math.round(fortschritt * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-akzent transition-all" style={{ width: `${Math.round(fortschritt * 100)}%` }} />
        </div>
      )}
      {fehler && <p className="text-sm text-gefahr" role="alert">{fehler}</p>}
      <div className="flex gap-2">
        <button type="button" className="knopf-sekundaer" onClick={() => onFertig(null)} disabled={fortschritt !== null}>Abbrechen</button>
        <button type="submit" className="knopf-primaer" disabled={fortschritt !== null}>
          {fortschritt === null ? 'Hochladen' : fortschritt < 1 ? `Lädt hoch … ${Math.round(fortschritt * 100)} %` : 'Wird verarbeitet …'}
        </button>
      </div>
    </form>
  );
}
