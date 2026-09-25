// Links zu externen Seiten mit Cover, Handbuch & Co. – statt die Dateien selbst bereitzustellen.
import { useEffect, useState } from 'react';
import { MEDIENARTEN, beschriftung, istModerator } from '../../../shared/konstanten.js';
import { api } from '../api.js';
import { useSitzung } from '../sitzung.js';
import Symbol from './Symbole.jsx';
import StatusAbzeichen from './StatusAbzeichen.jsx';
import MeldenKnopf from './MeldenKnopf.jsx';
import { useHinweis } from './Hinweise.jsx';

/**
 * @param links  vorhandene Liste (z. B. aus der Katalogseite) – sonst wird sie geladen
 * @param katalogFreigegeben  nur freigegebene Einträge können Links für alle erhalten
 */
export default function ExterneLinks({ katalogId, links: vorgegeben, katalogFreigegeben = true, onGeaendert }) {
  const { benutzer } = useSitzung();
  const zeigeHinweis = useHinweis();
  const [geladen, setGeladen] = useState(null);
  const [formOffen, setFormOffen] = useState(false);
  const links = vorgegeben ?? geladen ?? [];

  const laden = () => {
    if (vorgegeben) return onGeaendert?.();
    return api.externeLinks(katalogId).then(setGeladen).catch(() => setGeladen([]));
  };
  useEffect(() => { if (!vorgegeben && katalogId && benutzer) laden(); }, [katalogId]);
  if (!katalogId || (!links.length && !benutzer)) return null;

  return (
    <section className="karte space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold"><Symbol name="link" className="size-5" />Cover & Handbücher im Netz</h3>
        {benutzer && !formOffen && (
          <button type="button" className="knopf-sekundaer px-3 py-1.5" onClick={() => setFormOffen(true)}>
            <Symbol name="plus" className="size-4" />Link
          </button>
        )}
      </div>

      {links.length === 0 && !formOffen && (
        <p className="text-sm text-leise">Noch keine Links. Kennst du eine Seite, die Cover oder das Handbuch zu diesem Spiel anbietet? Schlag sie vor!</p>
      )}

      {links.length > 0 && (
        <ul className="divide-y divide-rand">
          {links.map((l) => (
            <li key={l.id} className="flex items-center gap-2 py-2 text-sm">
              <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="flex min-w-0 flex-1 items-center gap-3 hover:underline">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-karte-hover">
                  <Symbol name={l.art === 'handbuch' ? 'dokument' : 'bild'} className="size-5 text-akzent-hell" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{l.titel || beschriftung(MEDIENARTEN, l.art)}</span>
                  <span className="block truncate text-xs text-leise">
                    {beschriftung(MEDIENARTEN, l.art)} · <span className="font-mono">{l.domain}</span> ↗
                  </span>
                </span>
              </a>
              {l.status !== 'freigegeben' && <StatusAbzeichen status={l.status} />}
              {l.status === 'freigegeben' && !l.eigener && <MeldenKnopf bereich="link" zielId={l.id} klein />}
              {l.darf_loeschen && (
                <button type="button" className="rounded-lg p-1.5 text-leise hover:bg-gefahr/10 hover:text-gefahr" aria-label="Link entfernen"
                  onClick={async () => {
                    if (!window.confirm('Link entfernen?')) return;
                    try { await api.externenLinkLoeschen(l.id); laden(); } catch (e) { zeigeHinweis(e.message, 'fehler'); }
                  }}>
                  <Symbol name="muell" className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {formOffen && (
        <LinkFormular
          moderator={istModerator(benutzer)}
          katalogFreigegeben={katalogFreigegeben}
          onFertig={async (daten) => {
            if (!daten) return setFormOffen(false);
            const neu = await api.externenLinkAnlegen(katalogId, daten);
            zeigeHinweis(neu.status === 'eingereicht' ? 'Danke! Der Link wird vom Moderationsteam geprüft.' : 'Link gespeichert.');
            setFormOffen(false);
            laden();
          }}
        />
      )}

      <p className="text-xs text-leise">
        Externe Seiten – für deren Inhalte sind die jeweiligen Betreiber verantwortlich. Links zu Seiten, die Inhalte offensichtlich
        ohne Erlaubnis anbieten, werden entfernt.
      </p>
    </section>
  );
}

function LinkFormular({ moderator, katalogFreigegeben, onFertig }) {
  const [w, setW] = useState({ art: 'handbuch', url: '', titel: '', sichtbarkeit: katalogFreigegeben ? (moderator ? 'freigegeben' : 'eingereicht') : 'privat' });
  const [fehler, setFehler] = useState(null);
  const setze = (f) => (e) => setW((x) => ({ ...x, [f]: e.target.value }));
  return (
    <form className="space-y-3 rounded-xl border border-rand p-3" onSubmit={async (e) => {
      e.preventDefault();
      try { await onFertig(w); } catch (err) { setFehler(Object.values(err.felder ?? {})[0] ?? err.message); }
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className="beschriftung">Was zeigt der Link?</span>
          <select className="eingabe" value={w.art} onChange={setze('art')}>
            {MEDIENARTEN.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </label>
        <label>
          <span className="beschriftung">Bezeichnung (optional)</span>
          <input className="eingabe" value={w.titel} onChange={setze('titel')} placeholder="z. B. Offizielle Anleitung (PDF)" maxLength={200} />
        </label>
        <label className="sm:col-span-2">
          <span className="beschriftung">Adresse – möglichst direkt zum Cover bzw. Handbuch</span>
          <input className="eingabe" value={w.url} onChange={setze('url')} placeholder="https://…" inputMode="url" autoComplete="off" />
        </label>
        <label className="sm:col-span-2">
          <span className="beschriftung">Sichtbarkeit</span>
          <select className="eingabe" value={w.sichtbarkeit} onChange={setze('sichtbarkeit')}>
            <option value="privat">Nur für mich (Lesezeichen)</option>
            {katalogFreigegeben && <option value="eingereicht">Für alle vorschlagen (wird geprüft)</option>}
            {katalogFreigegeben && moderator && <option value="freigegeben">Direkt veröffentlichen (Moderation)</option>}
          </select>
        </label>
      </div>
      <p className="text-xs text-leise">Bitte nur Seiten vorschlagen, die die Inhalte rechtmäßig anbieten (z. B. Hersteller, offizielle Archive).</p>
      {fehler && <p className="text-sm text-gefahr" role="alert">{fehler}</p>}
      <div className="flex gap-2">
        <button type="button" className="knopf-sekundaer" onClick={() => onFertig(null)}>Abbrechen</button>
        <button type="submit" className="knopf-primaer">Speichern</button>
      </div>
    </form>
  );
}
