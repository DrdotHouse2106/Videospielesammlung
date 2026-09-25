// Plattform-Stammdaten einmal laden und in der ganzen App verwenden.
import { useEffect, useState } from 'react';
import { HERSTELLER_REIHENFOLGE } from '../../shared/konstanten.js';
import { api } from './api.js';

let zwischenspeicher = null;
let laufend = null;
const abonnenten = new Set();

export function ladePlattformenNeu() {
  laufend = api.plattformenAlle().then((liste) => {
    zwischenspeicher = liste;
    abonnenten.forEach((f) => f(liste));
    return liste;
  }).catch(() => zwischenspeicher ?? []).finally(() => { laufend = null; });
  return laufend;
}

export function usePlattformen() {
  const [liste, setListe] = useState(zwischenspeicher ?? []);
  useEffect(() => {
    abonnenten.add(setListe);
    if (!zwischenspeicher && !laufend) ladePlattformenNeu();
    return () => abonnenten.delete(setListe);
  }, []);
  return liste;
}

/** Plattformen nach Hersteller gruppieren: [[hersteller, [plattformen…]], …] */
export function nachHersteller(liste) {
  const gruppen = new Map();
  for (const p of liste) {
    if (!gruppen.has(p.hersteller)) gruppen.set(p.hersteller, []);
    gruppen.get(p.hersteller).push(p);
  }
  const rang = (h) => { const i = HERSTELLER_REIHENFOLGE.indexOf(h); return i === -1 ? 50 : i; };
  return [...gruppen.entries()].sort(([a], [b]) => rang(a) - rang(b) || a.localeCompare(b));
}
