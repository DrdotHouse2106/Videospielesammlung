import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestServer } from './hilfen.js';

let server;
let admin;
let shop;
let shopId;
const aufrufe = [];
const erp = { rechnungen: [], mails: [] };
const json = (daten, status = 200) => new Response(JSON.stringify(daten), { status, headers: { 'Content-Type': 'application/json' } });

async function fetchFn(url, optionen = {}) {
  const u = new URL(String(url));
  aufrufe.push({ url: String(url), methode: optionen.method ?? 'GET', body: optionen.body });
  const pfad = decodeURIComponent(u.pathname);
  if (u.host === 'erp.example.com') {
    if (pfad === '/api/resource/Customer' && (optionen.method ?? 'GET') === 'GET') return json({ data: [] });
    if (pfad === '/api/resource/Customer') return json({ data: { name: 'CUST-1' } });
    if (pfad === '/api/resource/Sales Invoice') {
      const r = JSON.parse(optionen.body);
      const netto = r.items[0].rate - (r.discount_amount ?? 0);
      const rechnung = { ...r, name: `SINV-${erp.rechnungen.length + 1}`, grand_total: Math.round(netto * 119) / 100 };
      erp.rechnungen.push(rechnung);
      return json({ data: rechnung });
    }
    if (pfad.startsWith('/api/resource/Sales Invoice/')) return json({ data: { docstatus: 1, status: 'Unpaid', outstanding_amount: 1 } });
    if (pfad === '/api/method/frappe.core.doctype.communication.email.make') { erp.mails.push(JSON.parse(optionen.body)); return json({}); }
  }
  if (u.host === 'api.stripe.com') {
    if (pfad === '/v1/coupons') return json({ id: 'coupon_1' });
    if (pfad === '/v1/checkout/sessions') return json({ url: 'https://checkout.stripe.com/c/1' });
  }
  if (u.host === 'api-m.sandbox.paypal.com') {
    if (pfad === '/v1/oauth2/token') return json({ access_token: 't', expires_in: 3600 });
    if (pfad === '/v1/catalogs/products') return json({ id: 'PROD-1' });
    if (pfad === '/v1/billing/plans') return json({ id: `P-${aufrufe.length}` });
    if (pfad === '/v1/billing/subscriptions') return json({ id: 'I-9', links: [{ rel: 'approve', href: 'https://paypal.example/approve' }] });
  }
  return json({}, 404);
}

const post = (c, pfad, daten) => c.api(pfad, { methode: 'POST', daten });
const heute = () => new Date().toISOString().slice(0, 10);
const inTagen = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

before(async () => {
  server = await starteTestServer({
    fetchFn,
    env: {
      PUBLIC_URL: 'https://zockdb.example',
      PAYMENT_STRIPE_SECRET_KEY: 'sk_test', PAYMENT_STRIPE_WEBHOOK_SECRET: 'whsec',
      PAYMENT_PAYPAL_CLIENT_ID: 'a', PAYMENT_PAYPAL_SECRET: 'b', PAYMENT_PAYPAL_WEBHOOK_ID: 'c', PAYMENT_PAYPAL_MODE: 'sandbox',
      ERPNEXT_URL: 'https://erp.example.com', ERPNEXT_API_KEY: 'k', ERPNEXT_API_SECRET: 's', ERPNEXT_COMPANY: 'ZockDB',
    },
  });
  admin = await server.registriere('admin');
  shop = await server.registriere('shop');
  await shop.api('/api/boerse/haendler', { methode: 'PUT', daten: { firma: 'Shop GmbH', anschrift: 'Weg 1, 12345 Ort', email: 'info@shop.example' } });
  shopId = server.db.prepare("SELECT id FROM benutzer WHERE benutzername = 'shop'").get().id;
  await post(admin, `/api/admin/benutzer/${shopId}/haendler`, { verifiziert: true });
});
after(async () => { await server.stoppe(); });

test('Rechnung ist ohne weitere Einstellung verfügbar (Standard)', async () => {
  const u = (await shop.api('/api/boerse/zahlung')).json;
  assert.equal(u.anbieter.rechnung, true);
});

test('Wechsel auf ein kleineres Paket: Rest wird verrechnet, Überschuss bleibt als Guthaben', async () => {
  let r = await post(shop, '/api/boerse/zahlung/checkout', { produkt: 'paket', angebote: 5000, anbieter: 'rechnung' });
  assert.equal(r.status, 200, r.text);
  assert.equal(erp.rechnungen[0].items[0].rate, 29.9);
  assert.equal(erp.rechnungen[0].discount_amount, undefined);

  const rest = server.kontext.zahlung.restwert(server.db.prepare("SELECT * FROM abos WHERE angebote = 5000").get());
  assert.ok(rest > 25 && rest < 29.9, `Restwert ${rest}`);

  r = await post(shop, '/api/boerse/zahlung/checkout', { produkt: 'paket', angebote: 500, anbieter: 'rechnung' });
  assert.equal(r.status, 200, r.text);
  const zweite = erp.rechnungen[1];
  assert.equal(zweite.items[0].rate, 9.9, 'voller Preis auf der Rechnung');
  assert.equal(zweite.discount_amount, 9.9, 'vollständig verrechnet');
  assert.equal(zweite.apply_discount_on, 'Net Total');
  assert.match(zweite.remarks, /Verrechnung Guthaben aus Abowechsel/);
  assert.match(erp.mails[1].content, /keine Zahlung nötig/);
  const z2 = server.db.prepare('SELECT * FROM zahlungen ORDER BY id DESC LIMIT 1').get();
  assert.equal(z2.brutto, 0);
  assert.ok(z2.bezahlt_am, 'nichts zu zahlen = bezahlt');

  const u = (await shop.api('/api/boerse/zahlung')).json;
  assert.equal(Math.round(u.guthaben * 100) / 100, Math.round((rest - 9.9) * 100) / 100, 'Überschuss als Guthaben');
  assert.equal(u.abos.find((a) => a.angebote === 5000).status, 'beendet');
  assert.equal((await shop.api('/api/boerse/haendler')).json.paket, 500);

  // Folgerechnung verrechnet das Guthaben
  const abo500 = server.db.prepare("SELECT id FROM abos WHERE angebote = 500").get().id;
  server.db.prepare('UPDATE zahlungen SET zeitraum_bis = ? WHERE abo_id = ?').run(inTagen(5), abo500);
  const vorher = u.guthaben;
  assert.equal((await server.kontext.zahlung.pruefeRechnungen()).gestellt, 1);
  assert.equal(erp.rechnungen[2].discount_amount, 9.9);
  const nachher = (await shop.api('/api/boerse/zahlung')).json.guthaben;
  assert.equal(Math.round((vorher - nachher) * 100) / 100, 9.9);
});

test('Wechsel auf ein größeres Paket per Stripe: Verrechnung als einmaliger Rabatt', async () => {
  const guthaben = (await shop.api('/api/boerse/zahlung')).json.guthaben;
  const abo500 = server.db.prepare("SELECT * FROM abos WHERE angebote = 500").get();
  const rest = server.kontext.zahlung.restwert(abo500);
  const r = await post(shop, '/api/boerse/zahlung/checkout', { produkt: 'paket', angebote: 1000, anbieter: 'stripe' });
  assert.equal(r.status, 200, r.text);
  const coupon = new URLSearchParams(aufrufe.find((a) => a.url.endsWith('/v1/coupons')).body);
  const erwartet = Math.round(Math.round(Math.min(guthaben + rest, 14.9) * 119) / 100 * 100);
  assert.equal(coupon.get('amount_off'), String(erwartet));
  assert.equal(coupon.get('duration'), 'once');
  const sitzung = new URLSearchParams(aufrufe.find((a) => a.url.endsWith('/v1/checkout/sessions')).body);
  assert.equal(sitzung.get('discounts[0][coupon]'), 'coupon_1');
});

test('Wechsel per PayPal: günstigerer erster Monat', async () => {
  const r = await post(shop, '/api/boerse/zahlung/checkout', { produkt: 'paket', angebote: 1000, anbieter: 'paypal' });
  assert.equal(r.status, 200, r.text);
  const plan = JSON.parse(aufrufe.filter((a) => a.url.endsWith('/v1/billing/plans')).at(-1).body);
  assert.equal(plan.billing_cycles[0].tenure_type, 'TRIAL');
  assert.equal(plan.billing_cycles[0].total_cycles, 1);
  assert.equal(plan.billing_cycles[1].pricing_scheme.fixed_price.value, '18.92', '(14,90 € + 1 €) + 19 %');
  const erster = Number(plan.billing_cycles[0].pricing_scheme?.fixed_price?.value ?? 0);
  assert.ok(erster < 18.92, 'erster Monat günstiger');
  assert.ok(server.db.prepare("SELECT verrechnung_netto FROM abos WHERE anbieter = 'paypal'").get().verrechnung_netto > 0);
  assert.equal(heute().length, 10);
});
