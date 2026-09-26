import Symbol from './Symbole.jsx';
import { MARKE } from '../../../shared/marke.js';
import { navigiere } from '../router.js';
import { useSitzung } from '../sitzung.js';
import Fusszeile from './Fusszeile.jsx';

const NAVIGATION = [
  { pfad: '/', label: 'Sammlung', symbol: 'sammlung' },
  { pfad: '/wert', label: 'Wert', symbol: 'wert' },
  { pfad: '/neu', label: 'Hinzufügen', symbol: 'plus', hervorgehoben: true },
  { pfad: '/neu?scan=1', label: 'Scannen', symbol: 'scan' },
  { pfad: '/einstellungen', label: 'Mehr', symbol: 'einstellungen' },
];

// Zusätzliche Einträge nur in der Desktop-Navigation
const NUR_DESKTOP = [
  { pfad: '/katalog', label: 'Katalog', symbol: 'suche' },
  { pfad: '/community', label: 'Community', symbol: 'community' },
];

const MEHR_PFADE = ['/einstellungen', '/konto', '/statistik', '/admin', '/druck', '/moderation', '/katalog', '/community', '/seite'];

function istAktiv(eintrag, route) {
  if (eintrag.pfad === '/') return route.pfad === '/' || route.pfad.startsWith('/artikel');
  if (eintrag.pfad === '/einstellungen') return MEHR_PFADE.some((p) => route.pfad.startsWith(p));
  if (eintrag.pfad === '/neu?scan=1') return route.pfad === '/neu' && route.parameter.scan === '1';
  if (eintrag.pfad === '/neu') return route.pfad.startsWith('/neu') && route.parameter.scan !== '1';
  return route.pfad.startsWith(eintrag.pfad);
}

export default function Layout({ route, titel, zurueck, aktionen, children }) {
  const { benutzer } = useSitzung();
  // Öffentliche Katalogseiten ohne Anmeldung: schlanker Rahmen ohne Navigation
  if (!benutzer) {
    return (
      <div className="min-h-dvh pb-10">
        <header className="sticky top-0 z-30 border-b border-rand/60 bg-flaeche/85 backdrop-blur-md" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
            <a href="#/katalog" className="flex items-center gap-2 font-bold" aria-label="Zum Katalog">
              <img src="/icons/icon.svg" alt="" className="size-8" />
              <span className="hidden sm:inline">{MARKE.name}</span>
            </a>
            <h1 className="min-w-0 flex-1 truncate text-lg font-bold">{titel}</h1>
            <a href="#/" className="knopf-primaer px-3 py-1.5">Anmelden</a>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 pt-4">{children}</main>
        <Fusszeile />
      </div>
    );
  }
  return (
    <div className="min-h-dvh pb-24 md:pb-10">
      <header className="sticky top-0 z-30 border-b border-rand/60 bg-flaeche/85 backdrop-blur-md" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
          {zurueck ? (
            <button
              type="button"
              onClick={() => (typeof zurueck === 'string' ? navigiere(zurueck) : window.history.back())}
              className="-ml-2 rounded-lg p-2 text-leise hover:bg-karte hover:text-text"
              aria-label="Zurück"
            >
              <Symbol name="zurueck" className="size-6" />
            </button>
          ) : (
            <a href="#/" className="flex items-center gap-2 font-bold" aria-label="Zur Sammlung">
              <img src="/icons/icon.svg" alt="" className="size-8" />
              <span className="hidden sm:inline">{MARKE.name}</span>
            </a>
          )}
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold sm:text-center md:text-left">{titel}</h1>
          {aktionen}
          <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Hauptnavigation">
            {[...NAVIGATION.slice(0, 2), ...NUR_DESKTOP, ...NAVIGATION.slice(2)].map((eintrag) => (
              <a
                key={eintrag.pfad}
                href={`#${eintrag.pfad}`}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ${
                  istAktiv(eintrag, route) ? 'bg-karte text-text' : 'text-leise hover:text-text'
                }`}
              >
                <Symbol name={eintrag.symbol} className="size-4" />
                {eintrag.label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-4">{children}</main>
      <Fusszeile />

      <nav
        className="unten-sicher fixed inset-x-0 bottom-0 z-40 border-t border-rand/60 bg-flaeche/95 backdrop-blur-md md:hidden"
        aria-label="Hauptnavigation"
      >
        <div className="mx-auto grid h-16 max-w-md grid-cols-5">
          {NAVIGATION.map((eintrag) => {
            const aktiv = istAktiv(eintrag, route);
            return (
              <a
                key={eintrag.pfad}
                href={`#${eintrag.pfad}`}
                className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${aktiv ? 'text-akzent-hell' : 'text-leise'}`}
                aria-current={aktiv ? 'page' : undefined}
              >
                {eintrag.hervorgehoben ? (
                  <span className="-mt-5 flex size-12 items-center justify-center rounded-2xl bg-akzent text-akzent-text shadow-lg shadow-akzent/30">
                    <Symbol name={eintrag.symbol} className="size-6" />
                  </span>
                ) : (
                  <Symbol name={eintrag.symbol} className="size-6" />
                )}
                {eintrag.label}
              </a>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
