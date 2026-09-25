// Balken für den belegten Speicherplatz (eigene Fotos und Scans)
import { dateigroesse } from '../format.js';

export default function SpeicherAnzeige({ info, kompakt = false }) {
  if (!info) return null;
  if (info.limit === null) {
    return <p className="text-sm text-leise">{dateigroesse(info.belegt) || '0 KB'} belegt · kein Speicherlimit</p>;
  }
  const anteil = info.limit > 0 ? Math.min(1, info.belegt / info.limit) : 1;
  const farbe = anteil >= 1 ? 'bg-gefahr' : anteil >= 0.9 ? 'bg-warnung' : 'bg-akzent';
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap justify-between gap-x-2 text-sm">
        <span>{dateigroesse(info.belegt) || '0 KB'} von {dateigroesse(info.limit)} belegt</span>
        <span className={anteil >= 1 ? 'font-semibold text-gefahr' : 'text-leise'}>
          {anteil >= 1 ? 'Speicher voll' : `${dateigroesse(info.frei)} frei`}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-karte-hover" role="progressbar"
        aria-label="Belegter Speicherplatz" aria-valuenow={Math.round(anteil * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full ${farbe}`} style={{ width: `${Math.max(anteil * 100, info.belegt ? 1 : 0)}%` }} />
      </div>
      {!kompakt && (
        <p className="text-xs text-leise">
          Gezählt werden deine Artikelfotos sowie private, eingereichte und abgelehnte Scans. Freigegebene Scans gehören
          zur gemeinsamen Datenbank und zählen nicht mehr mit. Tipp: Statt eigener Uploads kannst du Cover und Handbücher
          auch auf externe Seiten verlinken.
        </p>
      )}
    </div>
  );
}
