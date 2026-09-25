import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { anzahl, datumDe } from '../format.js';
import { useSitzung } from '../sitzung.js';
import Layout from '../komponenten/Layout.jsx';
import Symbol from '../komponenten/Symbole.jsx';

export default function Community({ route }) {
  const { benutzer } = useSitzung();
  const [sammler, setSammler] = useState(null);
  const [fehler, setFehler] = useState(null);

  useEffect(() => { api.community().then(setSammler).catch((e) => setFehler(e.message)); }, []);

  return (
    <Layout route={route} titel="Community" zurueck="/einstellungen">
      <div className="mx-auto max-w-3xl space-y-4">
        <p className="text-sm text-leise">
          Öffentliche Sammlungen anderer Benutzer. Preise, Seriennummern und Notizen sind dabei nie sichtbar.
        </p>
        {!benutzer?.sammlung_oeffentlich && (
          <a href="#/konto" className="karte flex items-center gap-3 p-4 text-sm hover:bg-karte-hover">
            <Symbol name="community" className="size-6 shrink-0 text-akzent-hell" />
            <span className="flex-1">Deine Sammlung ist privat. <strong>Unter „Konto“ kannst du sie für andere sichtbar machen.</strong></span>
            <Symbol name="weiter" className="size-5 text-leise" />
          </a>
        )}
        {fehler && <p className="text-gefahr" role="alert">{fehler}</p>}
        {sammler?.length === 0 && <p className="karte p-4 text-sm text-leise">Noch hat niemand seine Sammlung geteilt.</p>}
        {sammler?.length > 0 && (
          <ul className="karte divide-y divide-rand overflow-hidden">
            {sammler.map((s) => (
              <li key={s.id}>
                <a href={`#/community/${encodeURIComponent(s.benutzername)}`} className="flex items-center gap-3 p-4 hover:bg-karte-hover">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-akzent/20 font-bold text-akzent-hell">
                    {s.anzeigename.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {s.anzeigename}
                      {s.id === benutzer?.id && <span className="abzeichen ml-2">Du</span>}
                    </span>
                    <span className="block text-xs text-leise">
                      {[
                        `${anzahl(s.stueck)} Stück`,
                        s.spiele ? `${anzahl(s.spiele)} ${s.spiele === 1 ? 'Spiel' : 'Spiele'}` : null,
                        s.konsolen ? `${anzahl(s.konsolen)} ${s.konsolen === 1 ? 'Konsole' : 'Konsolen'}` : null,
                        s.zubehoer ? `${anzahl(s.zubehoer)} Zubehör` : null,
                        `dabei seit ${datumDe(s.erstellt_am)}`,
                      ].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <Symbol name="weiter" className="size-5 shrink-0 text-leise" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Layout>
  );
}
