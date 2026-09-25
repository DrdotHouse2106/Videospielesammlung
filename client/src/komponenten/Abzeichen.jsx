import { REGIONEN, VOLLSTAENDIGKEITEN, ZUSTAENDE, beschriftung } from '../../../shared/konstanten.js';

/** Kompakte Kennzeichnungen (Region, Vollständigkeit, Zustand, Varianten) für Listen. */
export default function Abzeichen({ artikel, mitZustand = false }) {
  const eintraege = [
    artikel.region && { text: beschriftung(REGIONEN, artikel.region, 'kurz'), klasse: artikel.region === 'pal_de' ? 'text-akzent-hell' : '' },
    artikel.vollstaendigkeit && { text: beschriftung(VOLLSTAENDIGKEITEN, artikel.vollstaendigkeit, 'kurz'), klasse: artikel.vollstaendigkeit === 'cib' ? 'text-erfolg' : '' },
    mitZustand && artikel.zustand && { text: beschriftung(ZUSTAENDE, artikel.zustand), klasse: artikel.zustand === 'defekt' ? 'text-gefahr' : '' },
    artikel.anzahl > 1 && { text: `${artikel.anzahl}×`, klasse: '' },
  ].filter(Boolean);
  if (!eintraege.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {eintraege.map((e) => (
        <span key={e.text} className={`abzeichen ${e.klasse}`}>{e.text}</span>
      ))}
    </div>
  );
}
