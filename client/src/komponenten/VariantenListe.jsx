// Bekannte Varianten/Revisionen eines Katalogeintrags als Sammel-Checkliste.
import { useState } from 'react';
import { REGIONEN, beschriftung, istModerator } from '../../../shared/konstanten.js';
import { api } from '../api.js';
import { navigiere } from '../router.js';
import { useSitzung } from '../sitzung.js';
import Symbol from './Symbole.jsx';
import StatusAbzeichen from './StatusAbzeichen.jsx';
import { useHinweis } from './Hinweise.jsx';

export default function VariantenListe({ katalogId, katalogTyp, varianten, onGeaendert }) {
  const { benutzer } = useSitzung();
  const zeigeHinweis = useHinweis();
  const [formOffen, setFormOffen] = useState(false);
  const moderator = istModerator(benutzer);
  const vorhanden = varianten.filter((v) => v.meine > 0).length;

  const aktion = async (fn, meldung) => {
    try { await fn(); if (meldung) zeigeHinweis(meldung); onGeaendert?.(); } catch (e) { zeigeHinweis(e.message, 'fehler'); }
  };

  return (
    <section className="karte space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold">
          <Symbol name="sammlung" className="size-5" />Varianten & Revisionen
          {benutzer && varianten.length > 0 && <span className="abzeichen">{vorhanden}/{varianten.length} in deiner Sammlung</span>}
        </h3>
        {benutzer && !formOffen && (
          <button type="button" className="knopf-sekundaer px-3 py-1.5" onClick={() => setFormOffen(true)}>
            <Symbol name="plus" className="size-4" />{moderator ? 'Variante anlegen' : 'Variante vorschlagen'}
          </button>
        )}
      </div>
      {varianten.length === 0 && !formOffen && (
        <p className="text-sm text-leise">Noch keine Varianten erfasst (z. B. Modellnummern, Sonderfarben oder Editionen).</p>
      )}
      {varianten.length > 0 && (
        <ul className="divide-y divide-rand">
          {varianten.map((v) => (
            <li key={v.id} className="flex items-center gap-3 py-2">
              <span className={`flex size-6 shrink-0 items-center justify-center rounded-full ${v.meine ? 'bg-erfolg/20 text-erfolg' : 'bg-karte-hover text-leise/50'}`}
                title={v.meine ? `${v.meine}× in deiner Sammlung` : 'Nicht in deiner Sammlung'}>
                {v.meine ? <Symbol name="haken" className="size-4" /> : <span className="size-1.5 rounded-full bg-current" />}
              </span>
              <span className="min-w-0 flex-1 text-sm">
                <span className="block font-medium">{v.bezeichnung}{v.meine > 1 ? ` · ${v.meine}×` : ''}</span>
                <span className="block text-xs text-leise">
                  {[v.modellnummer !== v.bezeichnung && v.modellnummer, v.farbe, v.edition, beschriftung(REGIONEN, v.region, 'kurz'), v.erscheinungsjahr]
                    .filter(Boolean).join(' · ')}
                </span>
                {v.status !== 'freigegeben' && <StatusAbzeichen status={v.status} className="mt-1" />}
                {v.status === 'abgelehnt' && v.pruefung_notiz && <span className="block text-xs text-gefahr">{v.pruefung_notiz}</span>}
              </span>
              {benutzer && (
                <button type="button" className="knopf-sekundaer shrink-0 px-2.5 py-1 text-xs"
                  onClick={() => navigiere('/neu/formular', { katalog: katalogId, typ: katalogTyp, variante: v.id })}>
                  <Symbol name="plus" className="size-3.5" />Hinzufügen
                </button>
              )}
              {v.eigene && ['privat', 'abgelehnt'].includes(v.status) && (
                <button type="button" className="text-xs text-akzent-hell underline" onClick={() => aktion(() => api.varianteAendern(v.id, { einreichen: true }), 'Zur Prüfung eingereicht.')}>
                  Einreichen
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {formOffen && <VarianteFormular moderator={moderator} onFertig={async (daten) => {
        if (!daten) return setFormOffen(false);
        await api.varianteAnlegen(katalogId, daten);
        zeigeHinweis(daten.veroeffentlichen ? 'Variante veröffentlicht.' : daten.einreichen ? 'Variante zur Prüfung eingereicht.' : 'Variante privat gespeichert.');
        setFormOffen(false);
        onGeaendert?.();
      }} />}
    </section>
  );
}

function VarianteFormular({ moderator, onFertig }) {
  const [w, setW] = useState({ bezeichnung: '', modellnummer: '', farbe: '', edition: '', region: '', erscheinungsjahr: '', beschreibung: '', freigabe: moderator ? 'veroeffentlichen' : 'einreichen' });
  const [fehler, setFehler] = useState(null);
  const setze = (f) => (e) => setW((x) => ({ ...x, [f]: e.target.value }));
  return (
    <form className="space-y-3 rounded-xl border border-rand p-3" onSubmit={async (e) => {
      e.preventDefault();
      try {
        const { freigabe, ...daten } = w;
        await onFertig({ ...daten, einreichen: freigabe === 'einreichen', veroeffentlichen: freigabe === 'veroeffentlichen' });
      } catch (err) { setFehler(Object.values(err.felder ?? {})[0] ?? err.message); }
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label><span className="beschriftung">Bezeichnung</span><input className="eingabe" value={w.bezeichnung} onChange={setze('bezeichnung')} placeholder="z. B. PSone, Slim, OLED" /></label>
        <label><span className="beschriftung">Modellnummer</span><input className="eingabe" value={w.modellnummer} onChange={setze('modellnummer')} placeholder="z. B. SCPH-1002" /></label>
        <label><span className="beschriftung">Farbe</span><input className="eingabe" value={w.farbe} onChange={setze('farbe')} placeholder="z. B. Atomic Purple" /></label>
        <label><span className="beschriftung">Edition</span><input className="eingabe" value={w.edition} onChange={setze('edition')} placeholder="z. B. Pikachu Edition" /></label>
        <label><span className="beschriftung">Region</span>
          <select className="eingabe" value={w.region} onChange={setze('region')}>
            <option value="">– alle / unbekannt –</option>
            {REGIONEN.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        <label><span className="beschriftung">Erscheinungsjahr</span><input className="eingabe" inputMode="numeric" value={w.erscheinungsjahr} onChange={setze('erscheinungsjahr')} /></label>
        <label className="sm:col-span-2"><span className="beschriftung">Beschreibung (optional)</span><input className="eingabe" value={w.beschreibung} onChange={setze('beschreibung')} placeholder="Erkennungsmerkmale, Unterschiede …" /></label>
        <label className="sm:col-span-2"><span className="beschriftung">Sichtbarkeit</span>
          <select className="eingabe" value={w.freigabe} onChange={setze('freigabe')}>
            <option value="privat">Nur für mich</option>
            <option value="einreichen">Zur Aufnahme in die globale Datenbank einreichen</option>
            {moderator && <option value="veroeffentlichen">Direkt veröffentlichen (Moderation)</option>}
          </select>
        </label>
      </div>
      {fehler && <p className="text-sm text-gefahr" role="alert">{fehler}</p>}
      <div className="flex gap-2">
        <button type="button" className="knopf-sekundaer" onClick={() => onFertig(null)}>Abbrechen</button>
        <button type="submit" className="knopf-primaer">Speichern</button>
      </div>
    </form>
  );
}
