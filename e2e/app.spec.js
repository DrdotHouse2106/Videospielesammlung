// Durchgang durch die wichtigsten Seiten auf Handy-Größe: Registrierung, Sammlung, nachgeladene Seiten, Börse.
import { test, expect, devices } from '@playwright/test';

const PASSWORT = 'e2e-sicheres-passwort';

/** Sammelt JavaScript-Fehler der Seite; am Ende jedes Tests darf keiner aufgetreten sein. */
function fehlerSammeln(page) {
  const fehler = [];
  page.on('pageerror', (e) => fehler.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) fehler.push(m.text()); });
  return fehler;
}

/** Nichts darf seitlich über den Bildschirm hinausragen. */
async function keinQuerScrollen(page) {
  const breiten = await page.evaluate(() => ({ inhalt: document.documentElement.scrollWidth, fenster: window.innerWidth }));
  expect(breiten.inhalt, 'Seite scrollt horizontal').toBeLessThanOrEqual(breiten.fenster + 1);
}

/** Meldet an – gibt es das Konto noch nicht (z. B. bei einzeln gestarteten Tests), wird es angelegt. */
async function anmelden(page, benutzername) {
  let antwort = await page.request.post('/api/auth/anmelden', { data: { benutzername, passwort: PASSWORT } });
  if (!antwort.ok()) {
    antwort = await page.request.post('/api/auth/registrieren', { data: { benutzername, passwort: PASSWORT, bedingungen_akzeptiert: true } });
  }
  expect(antwort.ok()).toBeTruthy();
}

test('Registrierung über die Oberfläche', async ({ page }) => {
  const fehler = fehlerSammeln(page);
  await page.goto('/?app=1');
  // Bei der Ersteinrichtung zeigt die Seite direkt die Registrierung (erstes Konto wird Administrator)
  await expect(page.getByText('Das erste Konto wird automatisch Administrator.')).toBeVisible();
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORT);
  await page.getByLabel('Passwort wiederholen').fill(PASSWORT);
  await page.getByRole('checkbox', { name: /Nutzungsbedingungen/ }).check();
  await page.getByRole('button', { name: 'Konto erstellen' }).click();
  await expect(page.getByRole('navigation').getByText('Sammlung')).toBeVisible();
  await keinQuerScrollen(page);
  expect(fehler).toEqual([]);
});

const SEITEN = [
  ['/wert', 'Wert'],
  ['/statistik', 'Statistik'],
  ['/konto', 'Konto'],
  ['/einstellungen', 'Mehr'],
  ['/erfolge', 'Erfolge'],
  ['/import', 'Sammlung importieren'],
  ['/katalog', 'Katalog'],
  ['/community', 'Community'],
  ['/benachrichtigungen', 'Benachrichtigungen'],
  ['/admin', 'Administration'],
  ['/admin?reiter=markt', 'Administration'],
  ['/boerse/meine?tab=statistik&tage=0', 'Meine Börse'],
  ['/boerse', 'Tauschbörse'],
  ['/boerse/meine?tab=statistik', 'Meine Börse'],
  ['/boerse/haendler', 'Händlerbereich'],
  ['/nachrichten', 'Nachrichten'],
  ['/seite/datenschutz', 'Datenschutz'],
];

for (const [pfad, titel] of SEITEN) {
  test(`Seite ${pfad} lädt nach und passt aufs Handy`, async ({ page }) => {
    const fehler = fehlerSammeln(page);
    await anmelden(page, 'admin');
    await page.goto(`/?app=1#${pfad}`);
    await expect(page.getByRole('heading', { level: 1, name: titel }).first()).toBeVisible();
    await expect(page.getByText('Wird geladen …')).toHaveCount(0);
    await keinQuerScrollen(page);
    expect(fehler).toEqual([]);
  });
}

test('Angebot in der Tauschbörse ansehen und anfragen', async ({ page, browser }) => {
  const fehler = fehlerSammeln(page);
  await anmelden(page, 'admin');
  const spiel = await (await page.request.post('/api/katalog', {
    data: { typ: 'spiel', titel: 'Super Metroid', plattformen: ['Super Nintendo'], veroeffentlichen: true },
  })).json();
  const angebot = await (await page.request.post('/api/boerse/angebote', {
    data: { katalog_id: spiel.id, preis: '60', zustand: 'gut', vollstaendigkeit: 'cib', beschreibung: 'Mit Anleitung' },
  })).json();

  // Zweiter Sammler fragt an
  // Eigenes Handy-Profil ohne Service-Worker: dessen Anfragen tragen in Playwright die Kennung „HeadlessChrome“
  // und würden als Bot nicht in der Statistik zählen
  const benKontext = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block', baseURL: test.info().project.use.baseURL });
  const ben = await benKontext.newPage();
  const benFehler = fehlerSammeln(ben);
  const reg = await ben.request.post('/api/auth/registrieren', { data: { benutzername: 'ben', passwort: PASSWORT, bedingungen_akzeptiert: true } });
  expect(reg.ok()).toBeTruthy();
  await ben.goto('/?app=1#/boerse');
  await ben.getByText('Super Metroid').first().click();
  await expect(ben.getByText('Mit Anleitung')).toBeVisible();
  await keinQuerScrollen(ben);
  const formular = ben.locator('form', { has: ben.getByRole('heading', { name: 'Anbieter kontaktieren' }) });
  await formular.locator('textarea').fill('Hallo, ist das Spiel noch zu haben?');
  await formular.getByRole('button', { name: 'Nachricht senden' }).click();
  await expect(ben).toHaveURL(/#\/nachrichten\/\d+/);
  await expect(ben.getByText('Hallo, ist das Spiel noch zu haben?')).toBeVisible();
  await keinQuerScrollen(ben);
  expect(benFehler).toEqual([]);
  await benKontext.close();

  // Der Anbieter sieht Anfrage und Aufruf in der Statistik
  await page.goto('/?app=1#/boerse/meine?tab=statistik');
  await expect(page.getByText('Deine Angebote im Zeitraum')).toBeVisible();
  await expect(page.getByText('1 Aufrufe · 1 Anfragen · 0 Treffer · 100 % Anfragequote')).toBeVisible();
  await page.goto(`/?app=1#/boerse/angebot/${angebot.id}`);
  await expect(page.getByText('Mit Anleitung')).toBeVisible();
  expect(fehler).toEqual([]);
});

test('Öffentliche Spieleseite ohne Anmeldung', async ({ page }) => {
  const antwort = await page.goto('/spiel/1');
  expect(antwort.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Super Metroid');
  await keinQuerScrollen(page);
});
