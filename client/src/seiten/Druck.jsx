// Druckansicht für Cover-Scans: Ausdruck in Originalgröße (anhand der Scan-Auflösung),
// in einer festen Größe (z. B. DVD-Hülle) oder seitenfüllend – mit optionalen Schnittmarken.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MEDIENARTEN, beschriftung } from '../../../shared/konstanten.js';
import { api } from '../api.js';
import Layout from '../komponenten/Layout.jsx';
import Symbol from '../komponenten/Symbole.jsx';

const PAPIER = {
  'a4-hoch': { label: 'A4 hoch', b: 210, h: 297 },
  'a4-quer': { label: 'A4 quer', b: 297, h: 210 },
  'a3-hoch': { label: 'A3 hoch', b: 297, h: 420 },
  'a3-quer': { label: 'A3 quer', b: 420, h: 297 },
  'letter-hoch': { label: 'US Letter hoch', b: 215.9, h: 279.4 },
  'letter-quer': { label: 'US Letter quer', b: 279.4, h: 215.9 },
};

// Gängige Hüllenformate (Einleger/Inlay inkl. Rücken). Maße bitte vor dem Druck am Original prüfen.
const VORLAGEN = [
  { label: 'DVD-Hülle, Einleger komplett (273 × 183 mm)', b: 273, h: 183 },
  { label: 'CD-Jewelcase, Booklet vorne (120 × 120 mm)', b: 120, h: 120 },
  { label: 'CD-Jewelcase, Rückseite mit Rücken (151 × 118 mm)', b: 151, h: 118 },
];

const RAND_MM = 5; // Mindestrand, den die meisten Drucker brauchen
const PX_PRO_MM = 96 / 25.4;
const runde = (z) => Math.round(z * 10) / 10;

export default function Druck({ route, id }) {
  const [medium, setMedium] = useState(null);
  const [fehler, setFehler] = useState(null);
  const [modus, setModus] = useState('original');
  const [dpi, setDpi] = useState('');
  const [breite, setBreite] = useState('');
  const [hoehe, setHoehe] = useState('');
  const [verhaeltnis, setVerhaeltnis] = useState(true);
  const [papierWahl, setPapierWahl] = useState(null);
  const [schnittmarken, setSchnittmarken] = useState(true);
  const [geladen, setGeladen] = useState(false);
  const huelle = useRef(null);
  const [skalierung, setSkalierung] = useState(0.5);

  useEffect(() => {
    api.medium(id).then((m) => {
      setMedium(m);
      setDpi(String(m.dpi ?? 300));
      if (!m.dpi) setModus('seite');
    }).catch((e) => setFehler(e.message));
  }, [id]);

  // Bildgröße in mm berechnen
  const px = medium ? { b: medium.breite, h: medium.hoehe } : { b: 1, h: 1 };
  let bild = { b: 0, h: 0 };
  const dpiZahl = Number(dpi) || 300;
  if (modus === 'original') bild = { b: (px.b / dpiZahl) * 25.4, h: (px.h / dpiZahl) * 25.4 };
  if (modus === 'eigen') {
    const b = Number(String(breite).replace(',', '.')) || 0;
    const h = Number(String(hoehe).replace(',', '.')) || 0;
    bild = verhaeltnis ? { b, h: (b * px.h) / px.b } : { b, h };
  }

  // Papier automatisch wählen: kleinstes Format, auf das das Bild passt
  const passt = (p) => bild.b + 2 * RAND_MM <= p.b && bild.h + 2 * RAND_MM <= p.h;
  const autoPapier = Object.keys(PAPIER).find((k) => passt(PAPIER[k])) ?? (bild.b > bild.h ? 'a3-quer' : 'a3-hoch');
  const papierKey = papierWahl ?? (modus === 'seite' ? (px.b > px.h ? 'a4-quer' : 'a4-hoch') : autoPapier);
  const papier = PAPIER[papierKey];
  if (modus === 'seite') {
    const faktor = Math.min((papier.b - 2 * RAND_MM) / px.b, (papier.h - 2 * RAND_MM) / px.h);
    bild = { b: px.b * faktor, h: px.h * faktor };
  }
  const zuGross = !passt(papier);
  const effektiveDpi = bild.b ? Math.round(px.b / (bild.b / 25.4)) : 0;

  // Vorschau an die Bildschirmbreite anpassen
  useLayoutEffect(() => {
    if (!huelle.current) return undefined;
    const beobachter = new ResizeObserver(([e]) => setSkalierung(Math.min(1, e.contentRect.width / (papier.b * PX_PRO_MM))));
    beobachter.observe(huelle.current);
    return () => beobachter.disconnect();
  }, [papier.b, medium]);

  if (!medium) {
    return (
      <Layout route={route} titel="Drucken" zurueck>
        {fehler ? <p className="text-gefahr" role="alert">{fehler}</p> : <p className="text-leise">Wird geladen …</p>}
      </Layout>
    );
  }

  const druckStil = `
    @page { size: ${papier.b}mm ${papier.h}mm; margin: 0; }
    #druck-ausgabe { display: none; }
    @media print {
      html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
      #app { display: none !important; }
      #druck-ausgabe { display: block !important; }
    }`;

  const seite = (id, stil) => (
    <div id={id} className="relative flex items-center justify-center overflow-hidden bg-white" style={{ width: `${papier.b}mm`, height: `${papier.h}mm`, ...stil }}>
      <div className="relative" style={{ width: `${bild.b}mm`, height: `${bild.h}mm` }}>
        <img src={medium.url} alt="" onLoad={id === 'druckbereich' ? () => setGeladen(true) : undefined}
          style={{ width: '100%', height: '100%', display: 'block', objectFit: 'fill' }} />
        {schnittmarken && <Schnittmarken />}
      </div>
    </div>
  );

  return (
    <Layout route={route} titel="Scan drucken" zurueck>
      <style>{druckStil}</style>
      {/* Unskalierte Druckfassung direkt im <body>, damit beim Drucken nur sie erscheint */}
      {createPortal(<div id="druck-ausgabe">{seite('druck-seite')}</div>, document.body)}
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-4">
          <section className="karte space-y-3 p-4">
            <h2 className="font-semibold">{medium.titel || beschriftung(MEDIENARTEN, medium.art)}</h2>
            <p className="text-sm text-leise">{medium.breite} × {medium.hoehe} Pixel{medium.dpi ? ` · ${medium.dpi} dpi laut Datei` : ' · keine DPI-Angabe in der Datei'}</p>

            <fieldset className="space-y-2">
              <legend className="beschriftung">Druckgröße</legend>
              {[
                ['original', 'Originalgröße (laut Scan-Auflösung)'],
                ['eigen', 'Feste Größe in Millimetern'],
                ['seite', 'Seitenfüllend'],
              ].map(([wert, label]) => (
                <label key={wert} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="modus" className="accent-akzent" checked={modus === wert} onChange={() => { setModus(wert); setPapierWahl(null); }} />
                  {label}
                </label>
              ))}
            </fieldset>

            {modus === 'original' && (
              <label className="block">
                <span className="beschriftung">Auflösung des Scans (dpi)</span>
                <input className="eingabe" value={dpi} onChange={(e) => setDpi(e.target.value)} inputMode="numeric" />
                {!medium.dpi && <span className="mt-1 block text-xs text-warnung">Die Datei enthält keine DPI-Angabe. Trage die Auflösung ein, mit der du gescannt hast.</span>}
              </label>
            )}

            {modus === 'eigen' && (
              <div className="space-y-2">
                <label className="block">
                  <span className="beschriftung">Vorlage</span>
                  <select className="eingabe" value="" onChange={(e) => {
                    const v = VORLAGEN[Number(e.target.value)];
                    if (v) { setBreite(String(v.b)); setHoehe(String(v.h)); setVerhaeltnis(false); }
                  }}>
                    <option value="">– Vorlage wählen –</option>
                    {VORLAGEN.map((v, i) => <option key={v.label} value={i}>{v.label}</option>)}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label><span className="beschriftung">Breite (mm)</span>
                    <input className="eingabe" value={breite} onChange={(e) => setBreite(e.target.value)} inputMode="decimal" /></label>
                  <label><span className="beschriftung">Höhe (mm)</span>
                    <input className="eingabe" value={verhaeltnis ? (bild.h ? runde(bild.h) : '') : hoehe} onChange={(e) => setHoehe(e.target.value)} inputMode="decimal" disabled={verhaeltnis} /></label>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="accent-akzent" checked={verhaeltnis} onChange={(e) => setVerhaeltnis(e.target.checked)} />
                  Seitenverhältnis beibehalten
                </label>
              </div>
            )}

            <label className="block">
              <span className="beschriftung">Papier</span>
              <select className="eingabe" value={papierKey} onChange={(e) => setPapierWahl(e.target.value)}>
                {Object.entries(PAPIER).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-akzent" checked={schnittmarken} onChange={(e) => setSchnittmarken(e.target.checked)} />
              Schnittmarken drucken
            </label>

            <div className="rounded-xl bg-karte-hover p-3 text-sm">
              <p>Ausgabe: <strong>{runde(bild.b)} × {runde(bild.h)} mm</strong></p>
              <p className={effektiveDpi < 200 ? 'text-warnung' : 'text-leise'}>
                Druckauflösung ≈ {effektiveDpi} dpi{effektiveDpi < 200 ? ' – kann unscharf werden (empfohlen ≥ 300 dpi)' : ''}
              </p>
              {zuGross && <p className="text-gefahr">Das Bild passt nicht auf {papier.label}. Wähle ein größeres Papier oder eine kleinere Größe.</p>}
            </div>

            <button type="button" className="knopf-primaer w-full" onClick={() => window.print()} disabled={!geladen || !bild.b}>
              <Symbol name="drucker" className="size-4" />{geladen ? 'Drucken' : 'Bild wird geladen …'}
            </button>
            <p className="text-xs text-leise">
              Wichtig: Wähle im Druckdialog <strong>„Tatsächliche Größe“</strong> bzw. <strong>Skalierung 100 %</strong> und
              deaktiviere „An Seite anpassen“, sonst stimmen die Maße nicht. Für beste Ergebnisse Fotopapier und die höchste Druckqualität verwenden.
            </p>
          </section>
        </div>

        <div ref={huelle} className="min-w-0">
          <div style={{ width: papier.b * PX_PRO_MM * skalierung, height: papier.h * PX_PRO_MM * skalierung }} className="mx-auto shadow-xl">
            {seite('druckbereich', { transform: `scale(${skalierung})`, transformOrigin: 'top left' })}
          </div>
          <p className="mt-2 text-center text-xs text-leise">Vorschau ({papier.label}, verkleinert)</p>
        </div>
      </div>
    </Layout>
  );
}

/** Kurze Linien außerhalb der Bildecken zum exakten Zuschneiden. */
function Schnittmarken() {
  const linie = { position: 'absolute', background: '#000' };
  const laenge = '4mm';
  const abstand = '1mm';
  const dicke = '0.15mm';
  const ecken = [
    { top: 0, left: 0 }, { top: 0, right: 0 }, { bottom: 0, left: 0 }, { bottom: 0, right: 0 },
  ];
  return ecken.flatMap((ecke, i) => {
    const vertikal = ecke.top === 0 ? 'top' : 'bottom';
    const horizontal = ecke.left === 0 ? 'left' : 'right';
    return [
      // waagerechte Marke (verlängert die obere/untere Kante nach außen)
      <span key={`h${i}`} style={{ ...linie, [vertikal]: 0, [horizontal]: `calc(-${laenge} - ${abstand})`, width: laenge, height: dicke }} />,
      // senkrechte Marke (verlängert die linke/rechte Kante nach außen)
      <span key={`v${i}`} style={{ ...linie, [horizontal]: 0, [vertikal]: `calc(-${laenge} - ${abstand})`, width: dicke, height: laenge }} />,
    ];
  });
}
