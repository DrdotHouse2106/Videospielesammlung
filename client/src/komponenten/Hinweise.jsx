// Kurze Einblendungen („Toasts“) für Erfolgs- und Fehlermeldungen.
import { createContext, useCallback, useContext, useState } from 'react';
import Symbol from './Symbole.jsx';

const HinweisKontext = createContext(() => {});

export function HinweisAnbieter({ children }) {
  const [hinweise, setHinweise] = useState([]);

  const zeige = useCallback((text, art = 'erfolg') => {
    const id = Math.random().toString(36).slice(2);
    setHinweise((liste) => [...liste, { id, text, art }]);
    setTimeout(() => setHinweise((liste) => liste.filter((h) => h.id !== id)), art === 'fehler' ? 6000 : 3500);
  }, []);

  return (
    <HinweisKontext.Provider value={zeige}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6" aria-live="polite">
        {hinweise.map((h) => (
          <div
            key={h.id}
            role={h.art === 'fehler' ? 'alert' : 'status'}
            className="karte pointer-events-auto flex max-w-md items-center gap-2 px-4 py-3 text-sm shadow-xl"
          >
            <Symbol name={h.art === 'fehler' ? 'warnung' : 'haken'} className={`size-5 shrink-0 ${h.art === 'fehler' ? 'text-gefahr' : 'text-erfolg'}`} />
            <span>{h.text}</span>
          </div>
        ))}
      </div>
    </HinweisKontext.Provider>
  );
}

export const useHinweis = () => useContext(HinweisKontext);
