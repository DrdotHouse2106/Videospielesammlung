import Cover from './Cover.jsx';
import Abzeichen from './Abzeichen.jsx';

export default function ArtikelKarte({ artikel }) {
  const variante = [artikel.edition, artikel.farbe, artikel.modellnummer].filter(Boolean).join(' · ');
  return (
    <a
      href={`#/artikel/${artikel.id}`}
      className="karte group flex flex-col overflow-hidden transition hover:border-akzent/60 hover:bg-karte-hover"
    >
      <Cover url={artikel.bild_url} typ={artikel.typ} alt={artikel.titel} className="aspect-[3/4] w-full" />
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <h3 className="line-clamp-2 text-sm leading-snug font-semibold">{artikel.titel}</h3>
        {artikel.plattform && <p className="truncate text-xs text-leise">{artikel.plattform}</p>}
        {variante && <p className="truncate text-xs text-akzent-hell">{variante}</p>}
        <div className="mt-auto pt-1">
          <Abzeichen artikel={artikel} />
        </div>
      </div>
    </a>
  );
}
