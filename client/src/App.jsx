import { useEffect, useState } from 'react';
import { api } from './api.js';
import { useRoute, passt } from './router.js';
import { HinweisAnbieter } from './komponenten/Hinweise.jsx';
import Layout from './komponenten/Layout.jsx';
import Sammlung from './seiten/Sammlung.jsx';
import Hinzufuegen from './seiten/Hinzufuegen.jsx';
import ArtikelFormular from './seiten/ArtikelFormular.jsx';
import ArtikelDetail from './seiten/ArtikelDetail.jsx';
import Statistik from './seiten/Statistik.jsx';
import Einstellungen from './seiten/Einstellungen.jsx';

function Seite({ route, status }) {
  const { pfad } = route;
  if (pfad === '/') return <Sammlung route={route} />;
  if (pfad === '/neu') return <Hinzufuegen route={route} status={status} />;
  if (pfad === '/neu/formular') return <ArtikelFormular key={JSON.stringify(route.parameter)} route={route} />;
  if (pfad === '/statistik') return <Statistik route={route} />;
  if (pfad === '/einstellungen') return <Einstellungen route={route} status={status} />;
  let treffer = passt('/artikel/:id/bearbeiten', pfad);
  if (treffer) return <ArtikelFormular key={`b${treffer.id}`} route={route} artikelId={treffer.id} />;
  treffer = passt('/artikel/:id', pfad);
  if (treffer) return <ArtikelDetail key={treffer.id} route={route} id={treffer.id} />;
  return (
    <Layout route={route} titel="Seite nicht gefunden">
      <p className="text-leise">Diese Seite gibt es nicht. <a href="#/" className="underline">Zur Sammlung</a></p>
    </Layout>
  );
}

export default function App() {
  const route = useRoute();
  const [status, setStatus] = useState(null);
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    api.status().then(setStatus).catch(() => {});
    const an = () => setOffline(false);
    const aus = () => setOffline(true);
    window.addEventListener('online', an);
    window.addEventListener('offline', aus);
    return () => {
      window.removeEventListener('online', an);
      window.removeEventListener('offline', aus);
    };
  }, []);

  return (
    <HinweisAnbieter>
      {offline && (
        <div className="bg-warnung px-4 py-1.5 text-center text-sm font-medium text-black" role="status">
          Offline – du siehst die zuletzt geladenen Daten. Änderungen sind erst wieder mit Verbindung möglich.
        </div>
      )}
      <Seite route={route} status={status} />
    </HinweisAnbieter>
  );
}
