import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, leereZwischenspeicher } from './api.js';
import { useRoute, passt, navigiere } from './router.js';
import { SitzungKontext } from './sitzung.js';
import { HinweisAnbieter } from './komponenten/Hinweise.jsx';
import Layout from './komponenten/Layout.jsx';
import Anmelden from './seiten/Anmelden.jsx';
import Sammlung from './seiten/Sammlung.jsx';
import Hinzufuegen from './seiten/Hinzufuegen.jsx';
import ArtikelFormular from './seiten/ArtikelFormular.jsx';
import ArtikelDetail from './seiten/ArtikelDetail.jsx';
import Statistik from './seiten/Statistik.jsx';
import Einstellungen from './seiten/Einstellungen.jsx';
import Wert from './seiten/Wert.jsx';
import Konto from './seiten/Konto.jsx';
import Community from './seiten/Community.jsx';
import CommunitySammlung from './seiten/CommunitySammlung.jsx';
import Admin from './seiten/Admin.jsx';
import Druck from './seiten/Druck.jsx';
import Katalog from './seiten/Katalog.jsx';
import KatalogSeite from './seiten/KatalogSeite.jsx';
import Moderation from './seiten/Moderation.jsx';

function Seite({ route }) {
  const { pfad } = route;
  if (pfad === '/') return <Sammlung route={route} />;
  if (pfad === '/neu') return <Hinzufuegen route={route} />;
  if (pfad === '/neu/formular') return <ArtikelFormular key={JSON.stringify(route.parameter)} route={route} />;
  if (pfad === '/wert') return <Wert route={route} />;
  if (pfad === '/statistik') return <Statistik route={route} />;
  if (pfad === '/einstellungen') return <Einstellungen route={route} />;
  if (pfad === '/konto') return <Konto route={route} />;
  if (pfad === '/community') return <Community route={route} />;
  if (pfad === '/admin') return <Admin route={route} />;
  if (pfad === '/moderation') return <Moderation route={route} />;
  if (pfad === '/katalog') return <Katalog route={route} />;
  let t = passt('/artikel/:id/bearbeiten', pfad);
  if (t) return <ArtikelFormular key={`b${t.id}`} route={route} artikelId={t.id} />;
  t = passt('/artikel/:id', pfad);
  if (t) return <ArtikelDetail key={t.id} route={route} id={t.id} />;
  t = passt('/community/:name/:id', pfad);
  if (t) return <ArtikelDetail key={`${t.name}/${t.id}`} route={route} id={t.id} sammlerName={t.name} />;
  t = passt('/community/:name', pfad);
  if (t) return <CommunitySammlung key={t.name} route={route} name={t.name} />;
  t = passt('/katalog/:id', pfad);
  if (t) return <KatalogSeite key={t.id} route={route} id={t.id} />;
  t = passt('/druck/:id', pfad);
  if (t) return <Druck key={t.id} route={route} id={t.id} />;
  return (
    <Layout route={route} titel="Seite nicht gefunden">
      <p className="text-leise">Diese Seite gibt es nicht. <a href="#/" className="underline">Zur Sammlung</a></p>
    </Layout>
  );
}

export default function App() {
  const route = useRoute();
  const [auth, setAuth] = useState(null); // Antwort von /api/auth/status
  const [status, setStatus] = useState(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [fehler, setFehler] = useState(null);

  const aktualisiere = useCallback(async () => {
    try {
      const a = await api.authStatus();
      setAuth(a);
      setFehler(null);
      if (a.angemeldet) api.status().then(setStatus).catch(() => {});
    } catch (e) {
      setFehler(e.message);
    }
  }, []);

  const abmelden = useCallback(async () => {
    await api.abmelden().catch(() => {});
    await leereZwischenspeicher().catch(() => {});
    setStatus(null);
    navigiere('/');
    await aktualisiere();
  }, [aktualisiere]);

  useEffect(() => {
    aktualisiere();
    const an = () => setOffline(false);
    const aus = () => setOffline(true);
    const abgemeldet = () => setAuth((a) => (a ? { ...a, angemeldet: false, benutzer: null } : a));
    const zweiFaktorPflicht = () => navigiere('/konto', { pflicht: '1' });
    window.addEventListener('online', an);
    window.addEventListener('offline', aus);
    window.addEventListener('vss:abgemeldet', abgemeldet);
    window.addEventListener('vss:2fa-pflicht', zweiFaktorPflicht);
    return () => {
      window.removeEventListener('online', an);
      window.removeEventListener('offline', aus);
      window.removeEventListener('vss:abgemeldet', abgemeldet);
      window.removeEventListener('vss:2fa-pflicht', zweiFaktorPflicht);
    };
  }, [aktualisiere]);

  const kontext = useMemo(() => ({ benutzer: auth?.benutzer ?? null, auth, status, aktualisiere, abmelden }), [auth, status, aktualisiere, abmelden]);

  let inhalt;
  if (!auth) {
    inhalt = (
      <div className="flex min-h-dvh items-center justify-center p-6 text-center text-leise">
        {fehler ? <p role="alert">{fehler} <button type="button" className="underline" onClick={aktualisiere}>Erneut versuchen</button></p> : 'Wird geladen …'}
      </div>
    );
  } else if (!auth.angemeldet && auth.oeffentlicherKatalog && route.pfad.startsWith('/katalog')) {
    // Öffentlicher Katalog ohne Anmeldung
    const t = passt('/katalog/:id', route.pfad);
    inhalt = t ? <KatalogSeite key={t.id} route={route} id={t.id} /> : <Katalog route={route} />;
  } else if (!auth.angemeldet) {
    inhalt = <Anmelden />;
  } else if (auth.zweiFaktorPflicht && !auth.benutzer.totp_aktiv) {
    inhalt = <Konto route={{ pfad: '/konto', parameter: { pflicht: '1' } }} />;
  } else {
    inhalt = <Seite route={route} />;
  }

  return (
    <SitzungKontext.Provider value={kontext}>
      <HinweisAnbieter>
        {offline && (
          <div className="bg-warnung px-4 py-1.5 text-center text-sm font-medium text-black" role="status">
            Offline – du siehst die zuletzt geladenen Daten. Änderungen sind erst wieder mit Verbindung möglich.
          </div>
        )}
        {inhalt}
      </HinweisAnbieter>
    </SitzungKontext.Provider>
  );
}
