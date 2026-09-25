// „Hier kaufen“ – Affiliate-/Partnerlinks, immer als Anzeige gekennzeichnet.
import { euro } from '../format.js';
import Symbol from './Symbole.jsx';

export default function KaufenBox({ links, ebay }) {
  const angebote = ebay?.angebote ?? [];
  if (!links?.length && !angebote.length) return null;
  return (
    <section className="karte space-y-3 p-4" aria-label="Kaufmöglichkeiten">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Hier zum Kauf verfügbar</h3>
        <span className="abzeichen" title="Werbung / Affiliate-Link">Anzeige</span>
      </div>
      {angebote.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold tracking-wide text-leise uppercase">
            Aktuelle Angebote bei eBay{ebay.statistik ? ` · Median ${euro(ebay.statistik.median)}` : ''}
          </p>
          <ul className="divide-y divide-rand rounded-xl border border-rand">
            {angebote.map((a) => (
              <li key={a.url}>
                <a href={a.url} target="_blank" rel="sponsored noopener noreferrer" className="flex items-center gap-3 p-2.5 text-sm hover:bg-karte-hover">
                  {a.bild ? <img src={a.bild} alt="" loading="lazy" className="size-10 shrink-0 rounded object-cover" /> : <span className="size-10 shrink-0 rounded bg-karte-hover" />}
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1">{a.titel}</span>
                    {a.zustand && <span className="block text-xs text-leise">{a.zustand}</span>}
                  </span>
                  <span className="shrink-0 font-bold tabular-nums">{euro(a.preis)}</span>
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-leise">Stand: {new Date(ebay.abgerufen_am).toLocaleString('de-DE')} – Preise können sich geändert haben.</p>
        </div>
      )}
      <ul className="space-y-2">
        {(links ?? []).map((l) => (
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
