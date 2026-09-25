// Links zu Impressum, Datenschutz, Nutzungsbedingungen und Sicherheit – auf jeder Seite.
export default function Fusszeile({ className = '' }) {
  const links = [
    ['impressum', 'Impressum'],
    ['datenschutz', 'Datenschutz'],
    ['nutzungsbedingungen', 'Nutzungsbedingungen'],
    ['sicherheit', 'Sicherheitslücke melden'],
  ];
  return (
    <footer className={`mx-auto max-w-6xl px-4 py-6 text-center text-xs text-leise ${className}`}>
      <nav aria-label="Rechtliches" className="flex flex-wrap justify-center gap-x-4 gap-y-1">
        {links.map(([slug, label]) => <a key={slug} href={`#/seite/${slug}`} className="hover:text-text hover:underline">{label}</a>)}
      </nav>
    </footer>
  );
}
