// Kleiner, sicherer Markdown-Renderer für die rechtlichen Seiten.
// Erzeugt ausschließlich React-Elemente (kein innerHTML) – Unterstützt: Überschriften (#, ##, ###),
// Absätze, Listen (-, *, 1.), **fett**, *kursiv*, [Links](https://…) und Zeilenumbrüche.

function inline(text, schluessel) {
  const teile = [];
  const muster = /(\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let rest = 0;
  let treffer;
  let i = 0;
  while ((treffer = muster.exec(text))) {
    if (treffer.index > rest) teile.push(text.slice(rest, treffer.index));
    const k = `${schluessel}-${i++}`;
    if (treffer[2]) teile.push(<strong key={k}>{treffer[2]}</strong>);
    else if (treffer[3]) teile.push(<em key={k}>{treffer[3]}</em>);
    else {
      const url = treffer[5];
      const erlaubt = /^(https?:\/\/|mailto:|#\/)/i.test(url);
      teile.push(erlaubt
        ? <a key={k} href={url} className="text-akzent-hell underline" {...(url.startsWith('#') ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>{treffer[4]}</a>
        : treffer[4]);
    }
    rest = muster.lastIndex;
  }
  if (rest < text.length) teile.push(text.slice(rest));
  return teile;
}

function mitUmbruechen(zeilen, schluessel) {
  return zeilen.flatMap((z, i) => (i ? [<br key={`${schluessel}-br${i}`} />, ...inline(z, `${schluessel}-${i}`)] : inline(z, `${schluessel}-${i}`)));
}

export default function Markdown({ text }) {
  const bloecke = String(text ?? '').replace(/\r/g, '').split(/\n{2,}/);
  return (
    <div className="space-y-3 leading-relaxed">
      {bloecke.map((block, bi) => {
        const zeilen = block.split('\n').filter((z) => z.trim() !== '');
        if (!zeilen.length) return null;
        const erste = zeilen[0];
        const ueberschrift = erste.match(/^(#{1,3})\s+(.*)$/);
        if (ueberschrift && zeilen.length === 1) {
          const stufe = ueberschrift[1].length;
          const klassen = ['text-2xl font-bold', 'mt-6 text-xl font-semibold', 'mt-4 text-lg font-semibold'][stufe - 1];
          const Tag = `h${stufe + 1}`;
          return <Tag key={bi} className={klassen}>{inline(ueberschrift[2], `h${bi}`)}</Tag>;
        }
        if (zeilen.every((z) => /^\s*[-*]\s+/.test(z))) {
          return <ul key={bi} className="list-disc space-y-1 pl-6">{zeilen.map((z, i) => <li key={i}>{inline(z.replace(/^\s*[-*]\s+/, ''), `l${bi}-${i}`)}</li>)}</ul>;
        }
        if (zeilen.every((z) => /^\s*\d+\.\s+/.test(z))) {
          return <ol key={bi} className="list-decimal space-y-1 pl-6">{zeilen.map((z, i) => <li key={i}>{inline(z.replace(/^\s*\d+\.\s+/, ''), `o${bi}-${i}`)}</li>)}</ol>;
        }
        if (ueberschrift) {
          // Überschrift direkt gefolgt von Text im selben Block
          const Tag = `h${ueberschrift[1].length + 1}`;
          return (
            <div key={bi} className="space-y-2">
              <Tag className="mt-4 text-lg font-semibold">{inline(ueberschrift[2], `h${bi}`)}</Tag>
              <p>{mitUmbruechen(zeilen.slice(1), `p${bi}`)}</p>
            </div>
          );
        }
        return <p key={bi}>{mitUmbruechen(zeilen, `p${bi}`)}</p>;
      })}
    </div>
  );
}
