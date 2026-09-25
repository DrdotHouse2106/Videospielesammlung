// Minimaler Hash-Router: #/pfad?parameter=wert
import { useEffect, useState } from 'react';

function lesen() {
  const roh = window.location.hash.replace(/^#/, '') || '/';
  const [pfad, suche = ''] = roh.split('?');
  return { pfad: pfad || '/', parameter: Object.fromEntries(new URLSearchParams(suche)) };
}

export function useRoute() {
  const [route, setRoute] = useState(lesen);
  useEffect(() => {
    const aktualisieren = () => {
      setRoute(lesen());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', aktualisieren);
    return () => window.removeEventListener('hashchange', aktualisieren);
  }, []);
  return route;
}

export function navigiere(pfad, parameter) {
  const suche = parameter ? new URLSearchParams(
    Object.fromEntries(Object.entries(parameter).filter(([, w]) => w !== undefined && w !== null && w !== '')),
  ).toString() : '';
  window.location.hash = suche ? `${pfad}?${suche}` : pfad;
}

/** Vergleicht einen Pfad mit einem Muster wie "/artikel/:id" und liefert die Platzhalter. */
export function passt(muster, pfad) {
  const a = muster.split('/');
  const b = pfad.split('/');
  if (a.length !== b.length) return null;
  const werte = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) werte[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return werte;
}
