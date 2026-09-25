import Cover from './Cover.jsx';
import Abzeichen from './Abzeichen.jsx';

export default function ArtikelKarte({ artikel, href, exemplare }) {
  const variante = [artikel.edition, artikel.farbe, artikel.modellnummer].filter(Boolean).join(' · ');
  return (
    <a
      href={href ?? `#/artikel/${artikel.id}`}
      className="karte group flex flex-col overflow-hidden transition hover:border-akzent/60 hover:bg-karte-hover"
    >
      <Cover url={artikel.bild_url} typ={artikel.typ} alt={artikel.titel} className="aspect-[3/4] w-full" />
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <h3 className="line-clamp-2 text-sm leading-snug font-semibold">{artikel.titel}</h3>
        {artikel.plattform && (
          <p className="flex items-center gap-1.5 truncate text-xs text-leise">
            {artikel.plattform_kurz && <span className="abzeichen shrink-0 px-1 py-0 text-akzent-hell">{artikel.plattform_kurz}</span>}
            <span className="truncate">{artikel.plattform}</span>
          </p>
        )}
        {exemplare > 1
          ? <p className="text-xs font-semibold text-akzent-hell">{exemplare} Exemplare / Varianten</p>
          : variante && <p className="truncate text-xs text-akzent-hell">{variante}</p>}
        <div className="mt-auto pt-1">
          <Abzeichen artikel={artikel} />
        </div>
      </div>
    </a>
  );
}
