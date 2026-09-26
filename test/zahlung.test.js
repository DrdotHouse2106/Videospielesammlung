import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { starteTestServer } from './hilfen.js';
import { stripeFormular, pruefeStripeSignatur } from '../server/services/zahlung.js';

const WEBHOOK_GEHEIMNIS = 'whsec_test';
let server;
let admin;
let shop;
let shopId;
const aufrufe = [];
const stripeAbos = new Map();
const paypalAbos = new Map();
const erp = { kunden: [], rechnungen: [], zahlungen: [], fehler: false };

const json = (daten, status = 200) => new Response(JSON.stringify(daten), { status, headers: { 'Content-Type': 'application/json' } });

// Nachgebildete APIs von Stripe, PayPal und ERPNext
async function fetchFn(url, optionen = {}) {
  const u = new URL(String(url));
  aufrufe.push({ url: String(url), methode: optionen.method ?? 'GET', body: optionen.body, headers: optionen.headers });
  if (u.host === 'api.stripe.com') {
    assert.equal(optionen.headers.Authorization, 'Bearer sk_test_123');
    if (u.pathname === '/v1/checkout/sessions') return json({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' });
    const sub = u.pathname.match(/^\/v1\/subscriptions\/(.+)$/);
    if (sub && optionen.method === 'GET') return json(stripeAbos.get(sub[1]));
    if (sub) return json({ id: sub[1], cancel_at_period_end: true });
    if (u.pathname === '/v1/billing_portal/sessions') return json({ url: 'https://billing.stripe.com/p/session_1' });
  }
  if (u.host === 'api-m.sandbox.paypal.com') {
    if (u.pathname === '/v1/oauth2/token') return json({ access_token: 'pp_tok', expires_in: 3600 });
    if (u.pathname === '/v1/catalogs/products') return json({ id: 'PROD-1' });
    if (u.pathname === '/v1/billing/plans') return json({ id: `P-${JSON.parse(optionen.body).billing_cycles[0].pricing_scheme.fixed_price.value}` });
    if (u.pathname === '/v1/billing/subscriptions') {
      const body = JSON.parse(optionen.body);
      const id = `I-${paypalAbos.size + 1}`;
      paypalAbos.set(id, { id, custom_id: body.custom_id, plan_id: body.plan_id, status: 'APPROVAL_PENDING', billing_info: { next_billing_time: '2099-02-01T10:00:00Z' } });
      return json({ id, links: [{ rel: 'approve', href: `https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=${id}` }] });
    }
    if (u.pathname === '/v1/notifications/verify-webhook-signature') {
      return json({ verification_status: JSON.parse(optionen.body).transmission_sig === 'echt' ? 'SUCCESS' : 'FAILURE' });
    }
    const sub = u.pathname.match(/^\/v1\/billing\/subscriptions\/([^/]+)$/);
    if (sub) return json(paypalAbos.get(sub[1]));
  }
  if (u.host === 'erp.example.com') {
    assert.equal(optionen.headers.Authorization, 'token key123:geheim456');
    if (erp.fehler) return json({ exception: 'Server nicht bereit' }, 500);
    const pfad = decodeURIComponent(u.pathname);
    if (pfad === '/api/resource/Customer' && (optionen.method ?? 'GET') === 'GET') return json({ data: erp.kunden.filter((k) => u.search.includes(encodeURIComponent(k.customer_name).replace(/%20/g, '%20'))) });
    if (pfad === '/api/resource/Customer') { const k = { ...JSON.parse(optionen.body), name: `CUST-${erp.kunden.length + 1}` }; erp.kunden.push(k); return json({ data: k }); }
    if (pfad === '/api/resource/Sales Taxes and Charges Template/USt 19%') return json({ data: { taxes: [{ charge_type: 'On Net Total', account_head: 'USt 19% - ZDB', description: 'USt 19%', rate: 19 }] } });
    if (pfad === '/api/resource/Sales Invoice') {
      const r = JSON.parse(optionen.body);
      const netto = r.items[0].rate;
      const rechnung = { ...r, name: `ACC-SINV-2026-${String(erp.rechnungen.length + 1).padStart(5, '0')}`, grand_total: Math.round(netto * 119) / 100 };
      erp.rechnungen.push(rechnung);
      return json({ data: rechnung });
    }
    if (pfad === '/api/resource/Payment Entry') { const z = { ...JSON.parse(optionen.body), name: `ACC-PAY-${erp.zahlungen.length + 1}` }; erp.zahlungen.push(z); return json({ data: z }); }
    if (pfad === '/api/method/frappe.utils.print_format.download_pdf') return new Response(Buffer.from('%PDF-1.4 Rechnung'), { status: 200, headers: { 'Content-Type': 'application/pdf' } });
  }
  return json({ fehler: `unbekannt: ${url}` }, 404);
}

function stripeEreignis(typ, objekt) {
  const text = JSON.stringify({ id: `evt_${crypto.randomUUID()}`, type: typ, data: { object: objekt } });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', WEBHOOK_GEHEIMNIS).update(`${t}.${text}`).digest('hex');
  return fetch(`${server.basis}/api/zahlung/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${sig}` }, body: text });
}

function paypalEreignis(typ, resource, signatur = 'echt') {
  return fetch(`${server.basis}/api/zahlung/paypal/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'PAYPAL-TRANSMISSION-SIG': signatur, 'PAYPAL-TRANSMISSION-ID': 'tx1',
      'PAYPAL-TRANSMISSION-TIME': new Date().toISOString(), 'PAYPAL-AUTH-ALGO': 'SHA256withRSA', 'PAYPAL-CERT-URL': 'https://api.paypal.com/cert',
    },
    body: JSON.stringify({ id: `WH-${crypto.randomUUID()}`, event_type: typ, resource }),
  });
}

const post = (c, pfad, daten) => c.api(pfad, { methode: 'POST', daten });
const put = (c, pfad, daten) => c.api(pfad, { methode: 'PUT', daten });
const warte = () => new Promise((r) => setTimeout(r, 50));

before(async () => {
  server = await starteTestServer({
    fetchFn,
    env: {
      PUBLIC_URL: 'https://zockdb.example',
      PAYMENT_STRIPE_SECRET_KEY: 'sk_test_123', PAYMENT_STRIPE_WEBHOOK_SECRET: WEBHOOK_GEHEIMNIS,
      PAYMENT_PAYPAL_CLIENT_ID: 'pp_id', PAYMENT_PAYPAL_SECRET: 'pp_geheim', PAYMENT_PAYPAL_WEBHOOK_ID: 'WH-ID', PAYMENT_PAYPAL_MODE: 'sandbox',
      ERPNEXT_URL: 'https://erp.example.com', ERPNEXT_API_KEY: 'key123', ERPNEXT_API_SECRET: 'geheim456', ERPNEXT_COMPANY: 'ZockDB',
      ERPNEXT_TAX_TEMPLATE: 'USt 19%', ERPNEXT_ACCOUNT_STRIPE: 'Stripe - ZDB',
    },
  });
  admin = await server.registriere('admin');
  shop = await server.registriere('shop');
  await put(shop, '/api/boerse/haendler', { firma: 'Retro Shop GmbH', anschrift: 'Weg 1, 12345 Ort', email: 'info@shop.example', ustid: 'DE123456789' });
  shopId = server.db.prepare("SELECT id FROM benutzer WHERE benutzername = 'shop'").get().id;
});
after(async () => { await server.stoppe(); });

test('Stripe-Hilfsfunktionen: Formular und Signatur', () => {
  assert.equal(stripeFormular({ a: { b: 1 }, c: [{ d: 'x' }], e: ['f'] }).toString(), 'a%5Bb%5D=1&c%5B0%5D%5Bd%5D=x&e%5B0%5D=f');
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', 'geheim').update(`${t}.inhalt`).digest('hex');
  assert.equal(pruefeStripeSignatur('inhalt', `t=${t},v1=${sig}`, 'geheim'), true);
  assert.equal(pruefeStripeSignatur('anders', `t=${t},v1=${sig}`, 'geheim'), false);
  assert.equal(pruefeStripeSignatur('inhalt', `t=${t - 3600},v1=${sig}`, 'geheim'), false, 'zu alt');
});

test('Buchen nur für verifizierte Händler und nur eingestellte Pakete', async () => {
  let r = await post(shop, '/api/boerse/zahlung/checkout', { produkt: 'paket', angebote: 500, anbieter: 'stripe' });
  assert.equal(r.status, 403);
  await post(admin, `/api/admin/benutzer/${shopId}/haendler`, { verifiziert: true });
  r = await post(shop, '/api/boerse/zahlung/checkout', { produkt: 'paket', angebote: 12000, anbieter: 'stripe' });
  assert.equal(r.status, 400, 'individuelle Kontingente nicht selbst buchbar');
  const u = (await shop.api('/api/boerse/zahlung')).json;
  assert.deepEqual(u.anbieter, { stripe: true, paypal: true });
  assert.equal(u.paypal_gebuehr, 1);
});

test('Stripe: Checkout, Zahlung, Freischaltung, ERPNext-Rechnung, Verlängerung, Kündigung', async () => {
  let r = await post(shop, '/api/boerse/zahlung/checkout', { produkt: 'paket', angebote: 500, anbieter: 'stripe' });
  assert.equal(r.status, 200, r.text);
  assert.match(r.json.url, /^https:\/\/checkout\.stripe\.com/);
  const formular = new URLSearchParams(aufrufe.find((a) => a.url.endsWith('/v1/checkout/sessions')).body);
  assert.equal(formular.get('mode'), 'subscription');
  assert.equal(formular.get('line_items[0][price_data][unit_amount]'), '1178', '9,90 € netto + 19 % = 11,78 €');
  assert.equal(formular.get('payment_method_types[1]'), 'sepa_debit');
  assert.equal(formular.get('subscription_data[metadata][angebote]'), '500');
  assert.equal(formular.get('customer_email'), 'info@shop.example');

  // Ungültige Signatur wird abgelehnt
  const falsch = await fetch(`${server.basis}/api/zahlung/stripe/webhook`, { method: 'POST', headers: { 'Stripe-Signature': 't=1,v1=abc' }, body: '{}' });
  assert.equal(falsch.status, 400);

  const ende = Math.floor(Date.parse('2099-01-31T00:00:00Z') / 1000);
  stripeAbos.set('sub_1', { id: 'sub_1', status: 'active', customer: 'cus_1', current_period_end: ende, metadata: { benutzer_id: String(shopId), produkt: 'paket', angebote: '500' } });
  // Rechnung kommt vor der Checkout-Meldung an – das Abo wird aus den Metadaten angelegt
  const rechnung = { id: 'in_1', subscription: 'sub_1', amount_paid: 1178, lines: { data: [{ period: { end: ende } }] } };
  assert.equal((await stripeEreignis('invoice.paid', rechnung)).status, 200);
  assert.equal((await stripeEreignis('invoice.paid', rechnung)).status, 200, 'doppelte Meldung ist harmlos');
  assert.equal((await stripeEreignis('checkout.session.completed', { subscription: 'sub_1', customer: 'cus_1' })).status, 200);
  await warte();

  const h = (await shop.api('/api/boerse/haendler')).json;
  assert.equal(h.paket, 500);
  assert.equal(h.paket_bis, '2099-02-03', 'bezahlter Zeitraum + 3 Tage Puffer');
  const zahlungen = server.db.prepare('SELECT * FROM zahlungen').all();
  assert.equal(zahlungen.length, 1);
  assert.equal(zahlungen[0].netto, 9.9);
  assert.equal(zahlungen[0].erpnext_rechnung, 'ACC-SINV-2026-00001');
  assert.equal(zahlungen[0].erpnext_zahlung, 'ACC-PAY-1');
  assert.equal(erp.kunden[0].customer_name, 'Retro Shop GmbH');
  assert.equal(erp.kunden[0].tax_id, 'DE123456789');
  assert.equal(erp.rechnungen[0].items[0].rate, 9.9);
  assert.equal(erp.rechnungen[0].taxes[0].rate, 19);
  assert.equal(erp.rechnungen[0].docstatus, 1);
  assert.equal(erp.zahlungen[0].references[0].reference_name, 'ACC-SINV-2026-00001');
  assert.equal(erp.zahlungen[0].reference_no, 'in_1');

  // Verlängerung: neue Rechnung, gleicher Kunde
  const ende2 = Math.floor(Date.parse('2099-02-28T00:00:00Z') / 1000);
  await stripeEreignis('invoice.paid', { id: 'in_2', subscription: 'sub_1', amount_paid: 1178, lines: { data: [{ period: { end: ende2 } }] } });
  await warte();
  assert.equal((await shop.api('/api/boerse/haendler')).json.paket_bis, '2099-03-03');
  assert.equal(erp.rechnungen.length, 2);
  assert.equal(erp.kunden.length, 1);

  // Rechnung als PDF
  const zid = (await shop.api('/api/boerse/zahlung')).json.zahlungen[0].id;
  const pdf = await shop.api(`/api/boerse/zahlung/rechnung/${zid}.pdf`);
  assert.equal(pdf.status, 200);
  assert.match(pdf.puffer.toString(), /^%PDF/);
  const fremd = await server.registriere('fremd');
  assert.equal((await fremd.api(`/api/boerse/zahlung/rechnung/${zid}.pdf`)).status, 404);

  // Kündigung zum Periodenende
  const abo = (await shop.api('/api/boerse/zahlung')).json.abos[0];
  r = await post(shop, `/api/boerse/zahlung/abos/${abo.id}/kuendigen`, {});
  assert.equal(r.json.status, 'gekuendigt');
  assert.ok(aufrufe.some((a) => a.url.endsWith('/v1/subscriptions/sub_1') && a.body?.includes('cancel_at_period_end=true')));
  assert.equal((await shop.api('/api/boerse/haendler')).json.paket, 500, 'bleibt bis Periodenende aktiv');
  r = await post(shop, '/api/boerse/zahlung/portal', {});
  assert.match(r.json.url, /billing\.stripe\.com/);
});

test('PayPal: Plan inkl. Zahlungsgebühr, Aktivierung, Zahlung, ERPNext-Fehler wird nachgeholt', async () => {
  let r = await post(shop, '/api/boerse/zahlung/checkout', { produkt: 'api', anbieter: 'paypal' });
  assert.equal(r.status, 200, r.text);
  assert.match(r.json.url, /sandbox\.paypal\.com/);
  const plan = JSON.parse(aufrufe.find((a) => a.url.endsWith('/v1/billing/plans')).body);
  assert.equal(plan.billing_cycles[0].pricing_scheme.fixed_price.value, '24.87', '(19,90 € + 1 € Gebühr) + 19 % = 24,87 €');
  // Zweiter Checkout mit gleichem Preis nutzt denselben Plan
  const vorher = aufrufe.filter((a) => a.url.endsWith('/v1/billing/plans')).length;
  await post(shop, '/api/boerse/zahlung/checkout', { produkt: 'api', anbieter: 'paypal' });
  assert.equal(aufrufe.filter((a) => a.url.endsWith('/v1/billing/plans')).length, vorher);

  // Falsche Signatur
  assert.equal((await paypalEreignis('BILLING.SUBSCRIPTION.ACTIVATED', paypalAbos.get('I-1'), 'gefaelscht')).status, 400);

  // Rückkehr von PayPal: sofortige Prüfung
  paypalAbos.get('I-1').status = 'ACTIVE';
  r = await post(shop, '/api/boerse/zahlung/paypal/bestaetigen', { subscription_id: 'I-1' });
  assert.equal(r.json.status, 'ACTIVE');
  let h = (await shop.api('/api/boerse/haendler')).json;
  assert.equal(h.api, true);
  assert.equal(h.api_bis, '2099-02-04');

  // Zahlung, ERPNext gerade nicht erreichbar → wird später nachgeholt
  erp.fehler = true;
  assert.equal((await paypalEreignis('PAYMENT.SALE.COMPLETED', { id: 'SALE-1', billing_agreement_id: 'I-1', amount: { total: '24.87', currency: 'EUR' } })).status, 200);
  await warte();
  let z = server.db.prepare("SELECT * FROM zahlungen WHERE extern_id = 'SALE-1'").get();
  assert.equal(z.netto, 20.9);
  assert.equal(z.erpnext_rechnung, null);
  assert.match(z.erpnext_fehler, /HTTP 500/);
  erp.fehler = false;
  assert.equal(await server.kontext.erpnext.nachholen(), 1);
  z = server.db.prepare("SELECT * FROM zahlungen WHERE extern_id = 'SALE-1'").get();
  assert.ok(z.erpnext_rechnung);
  assert.equal(z.erpnext_zahlung, null, 'ohne PayPal-Konto nur Rechnung');

  // Kündigung durch PayPal-Webhook
  await paypalEreignis('BILLING.SUBSCRIPTION.CANCELLED', { id: 'I-1' });
  const abos = (await shop.api('/api/boerse/zahlung')).json.abos;
  assert.equal(abos.find((a) => a.anbieter === 'paypal').status, 'gekuendigt');
  h = (await shop.api('/api/boerse/haendler')).json;
  assert.equal(h.api, true, 'bleibt bis zum Ende des bezahlten Zeitraums');

  // Administration sieht alle Zahlungen
  const alle = (await admin.api('/api/admin/zahlungen')).json;
  assert.equal(alle.length, 3);
  assert.equal(alle[0].haendler, 'shop');
  assert.equal((await shop.api('/api/admin/zahlungen')).status, 403);
});

test('Paketwechsel beendet das bisherige Abo', async () => {
  const ende = Math.floor(Date.parse('2099-01-31T00:00:00Z') / 1000);
  stripeAbos.set('sub_2', { id: 'sub_2', status: 'active', customer: 'cus_1', current_period_end: ende, metadata: { benutzer_id: String(shopId), produkt: 'paket', angebote: '1000' } });
  await stripeEreignis('invoice.paid', { id: 'in_3', subscription: 'sub_2', amount_paid: 1773, lines: { data: [{ period: { end: ende } }] } });
  await warte();
  const abos = (await shop.api('/api/boerse/zahlung')).json.abos.filter((a) => a.produkt === 'paket');
  assert.equal(abos.find((a) => a.angebote === 1000).status, 'aktiv');
  assert.equal(abos.find((a) => a.angebote === 500).status, 'beendet');
  assert.equal((await shop.api('/api/boerse/haendler')).json.paket, 1000);
  assert.ok(aufrufe.some((a) => a.url.endsWith('/v1/subscriptions/sub_1') && a.methode === 'DELETE'));
});
