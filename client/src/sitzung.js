import { createContext, useContext } from 'react';

/** Angemeldeter Benutzer + Serverstatus, bereitgestellt von App.jsx. */
export const SitzungKontext = createContext({ benutzer: null, status: null, aktualisiere: () => {}, abmelden: () => {} });
export const useSitzung = () => useContext(SitzungKontext);
