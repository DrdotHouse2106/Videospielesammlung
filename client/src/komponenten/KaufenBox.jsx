// „Hier kaufen“ – Affiliate-/Partnerlinks, immer als Anzeige gekennzeichnet.
import { euro } from '../format.js';
import Symbol from './Symbole.jsx';

export default function KaufenBox({ links }) {
  if (!links?.length) return null;
  return (
    <section className="karte space-y-3 p-4" aria-label="Kaufmöglichkeiten">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Hier zum Kauf verfügbar</h3>
        <span className="abzeichen" title="Werbung / Affiliate-Link">Anzeige</span>
      </div>
      <ul className="space-y-2">
        {links.map((l) => (
          <li key={l.url}>
            <a href={l.url} target="_blank" rel="sponsored noopener noreferrer"
              className="flex items-center gap-3 rounded-xl border border-rand p-3 hover:border-akzent/60 hover:bg-karte-hover">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-akzent/15 text-sm font-bold text-akzent-hell">
                {l.anbieter.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{l.anbieter}</span>
                <span className="block truncate text-xs text-leise">{l.titel ?? (l.art === 'suche' ? 'Angebote durchsuchen' : 'Zum Angebot')}</span>
              </span>
              {l.preis != null && <span className="font-bold tabular-nums">{euro(l.preis)}</span>}
              <Symbol name="weiter" className="size-5 shrink-0 text-leise" />
            </a>
          </li>
        ))}
      </ul>
      <p className="text-xs text-leise">
        Affiliate-Links: Kaufst du über einen dieser Links, erhalten wir ggf. eine kleine Provision. Für dich ändert sich der Preis nicht –
        du unterstützt damit den Betrieb dieses Dienstes.
      </p>
    </section>
  );
}
