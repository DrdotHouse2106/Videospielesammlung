// Glocke mit Zahl ungelesener Benachrichtigungen – fragt regelmäßig und beim Zurückkehren in die App nach.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Symbol from './Symbole.jsx';

export default function Glocke() {
  const [anzahl, setAnzahl] = useState(0);
  useEffect(() => {
    let aktiv = true;
    const laden = () => {
      if (document.visibilityState !== 'visible') return;
      api.benachrichtigungenAnzahl().then((a) => aktiv && setAnzahl(a.ungelesen)).catch(() => {});
    };
    laden();
    const timer = setInterval(laden, 60_000);
    document.addEventListener('visibilitychange', laden);
    window.addEventListener('benachrichtigungen-gelesen', laden);
    return () => {
      aktiv = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', laden);
      window.removeEventListener('benachrichtigungen-gelesen', laden);
    };
  }, []);
  return (
    <a href="#/benachrichtigungen" className="relative rounded-lg p-2 text-leise hover:bg-karte hover:text-text"
      aria-label={anzahl ? `Benachrichtigungen, ${anzahl} ungelesen` : 'Benachrichtigungen'}>
      <Symbol name="glocke" className="size-5" />
      {anzahl > 0 && (
        <span className="absolute top-0.5 right-0.5 flex min-w-4 items-center justify-center rounded-full bg-gefahr px-1 text-[10px] leading-4 font-bold text-white">
          {anzahl > 99 ? '99+' : anzahl}
        </span>
      )}
    </a>
  );
}
