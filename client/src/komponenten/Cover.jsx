import { useState } from 'react';
import Symbol from './Symbole.jsx';

/** Coverbild mit Platzhalter, falls kein Bild vorhanden ist oder es nicht lädt. */
export default function Cover({ url, typ = 'spiel', alt = '', className = '' }) {
  const [fehler, setFehler] = useState(false);
  const zeigeBild = url && !fehler;
  return (
    <div className={`flex items-center justify-center overflow-hidden bg-karte-hover ${className}`}>
      {zeigeBild ? (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFehler(true)}
          className={`size-full ${typ === 'spiel' ? 'object-cover' : 'object-contain p-2'}`}
        />
      ) : (
        <Symbol name={typ} className="size-1/3 text-leise/50" />
      )}
    </div>
  );
}
