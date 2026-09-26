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
const erp = { kunden: [], rechnungen: [], zahlungen: [], mails: [], bezahlt: new Set(), fehler: false };

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
    if (u.pathname.startsWith('/v1/invoices/')) return json({ id: u.pathname.split('/').pop(), payment_intent: 'pi_1' });
    if (u.pathname === '/v1/refunds') return json({ id: `re_${aufrufe.length}` });
  }
  if (u.host === 'api-m.sandbox.paypal.com') {
    if (u.pathname === '/v1/oauth2/token') return json({ access_token: 'pp_tok', expires_in: 3600 });
    if (u.pathname === '/v1/catalogs/products') return json({ id: 'PROD-1' });
    if (/^\/v1\/payments\/sale\/[^/]+\/refund$/.test(u.pathname)) return json({ id: 'REF-1', state: 'completed' });
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
    const rechnungLesen = pfad.match(/^\/api\/resource\/Sales Invoice\/(.+)$/);
    if (rechnungLesen) {
      const r = erp.rechnungen.find((x) => x.name === rechnungLesen[1]);
      return json({ data: { ...r, docstatus: 1, status: erp.bezahlt.has(r.name) ? 'Paid' : 'Unpaid', outstanding_amount: erp.bezahlt.has(r.name) ? 0 : r.grand_total } });
    }
    if (pfad === '/api/method/frappe.core.doctype.communication.email.make') { erp.mails.push(JSON.parse(optionen.body)); return json({ message: { name: 'COMM-1' } }); }
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
      ERPNEXT_TAX_TEMPLATE: 'USt 19%', ERPNEXT_ACCOUNT_STRIPE: 'Stripe - ZDB', PAYMENT_INVOICE_ENABLED: 'true',
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
  assert.deepEqual(u.anbieter, { stripe: true, paypal: true, rechnung: true });
  assert.equal(u.zahlungsziel, 7);
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
  const start = Math.floor(Date.parse('2099-01-01T00:00:00Z') / 1000);
  const rechnung = { id: 'in_1', subscription: 'sub_1', amount_paid: 1178, lines: { data: [{ period: { start, end: ende } }] } };
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
  // Leistungszeitraum in den Feldern und im Positionstext
  assert.equal(erp.rechnungen[0].from_date, '2099-01-01');
  assert.equal(erp.rechnungen[0].to_date, '2099-01-30');
  assert.match(erp.rechnungen[0].items[0].description, /Leistungszeitraum: 01\.01\.2099 – 30\.01\.2099/);
  assert.match(erp.rechnungen[0].remarks, /Bezahlt über Stripe \(in_1\)/);
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

test('Zahlung per Rechnung: ERPNext verschickt, Zahlungseingang wird erkannt, Überfälligkeit pausiert', async () => {
  const r = await post(shop, '/api/boerse/zahlung/checkout', { produkt: 'paket', angebote: 5000, anbieter: 'rechnung' });
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json.rechnung);
  const rechnung = erp.rechnungen.at(-1);
  const heute = new Date().toISOString().slice(0, 10);
  const faellig = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  assert.equal(rechnung.due_date, faellig, '7 Tage Zahlungsziel');
  assert.equal(rechnung.from_date, heute);
  assert.ok(rechnung.to_date > heute);
  assert.match(rechnung.remarks, /Zahlbar bis/);
  assert.equal(erp.zahlungen.filter((x) => x.references[0].reference_name === rechnung.name).length, 0, 'keine Zahlung verbucht');
  const mail = erp.mails.at(-1);
  assert.equal(mail.name, rechnung.name);
  assert.equal(mail.recipients, 'info@shop.example');
  assert.equal(mail.send_email, 1);
  assert.equal(mail.print_format, 'Standard');
  // Leistung beginnt sofort
  let h = (await shop.api('/api/boerse/haendler')).json;
  assert.equal(h.paket, 5000);
  assert.equal(h.paket_bis, rechnung.to_date);

  // Überfällig → pausiert
  const zid = server.db.prepare('SELECT id FROM zahlungen WHERE erpnext_rechnung = ?').get(rechnung.name).id;
  server.db.prepare("UPDATE zahlungen SET faellig_am = '2000-01-01' WHERE id = ?").run(zid);
  let e = await server.kontext.zahlung.pruefeRechnungen();
  assert.equal(e.pausiert, 1);
  h = (await shop.api('/api/boerse/haendler')).json;
  assert.equal(h.paket, null, 'Paket pausiert – es gilt das kostenlose Limit');
  assert.ok((await shop.api('/api/benachrichtigungen')).json.eintraege.some((b) => b.titel.includes('überfällig')));

  // Zahlungseingang in ERPNext gebucht → wieder frei
  erp.bezahlt.add(rechnung.name);
  e = await server.kontext.zahlung.pruefeRechnungen();
  assert.equal(e.bezahlt, 1);
  h = (await shop.api('/api/boerse/haendler')).json;
  assert.equal(h.paket, 5000);
  assert.ok(server.db.prepare('SELECT bezahlt_am FROM zahlungen WHERE id = ?').get(zid).bezahlt_am);

  // Folgerechnung sieben Tage vor Ende des Zeitraums
  const aboId = server.db.prepare("SELECT id FROM abos WHERE anbieter = 'rechnung'").get().id;
  const bald = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  server.db.prepare('UPDATE zahlungen SET zeitraum_bis = ? WHERE id = ?').run(bald, zid);
  const vorher = erp.rechnungen.length;
  e = await server.kontext.zahlung.pruefeRechnungen();
  assert.equal(e.gestellt, 1);
  const folge = erp.rechnungen.at(-1);
  assert.equal(erp.rechnungen.length, vorher + 1);
  assert.equal(folge.from_date, new Date(Date.parse(`${bald}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10), 'lückenlos anschließend');
  assert.equal((await server.kontext.zahlung.pruefeRechnungen()).gestellt, 0, 'nicht doppelt');

  // Kündigen: keine Folgerechnungen mehr
  assert.equal((await post(shop, `/api/boerse/zahlung/abos/${aboId}/kuendigen`, {})).json.status, 'gekuendigt');
  server.db.prepare('UPDATE zahlungen SET zeitraum_bis = ? WHERE abo_id = ?').run(bald, aboId);
  assert.equal((await server.kontext.zahlung.pruefeRechnungen()).gestellt, 0);
});

test('Paketwechsel beendet das bisherige Abo', async () => {
  const ende = Math.floor(Date.parse('2099-01-31T00:00:00Z') / 1000);
  stripeAbos.set('sub_2', { id: 'sub_2', status: 'active', customer: 'cus_1', current_period_end: ende, metadata: { benutzer_id: String(shopId), produkt: 'paket', angebote: '1000' } });
  await stripeEreignis('invoice.paid', { id: 'in_3', subscription: 'sub_2', amount_paid: 1773, lines: { data: [{ period: { start: ende - 2592000, end: ende } }] } });
  await warte();
  const abos = (await shop.api('/api/boerse/zahlung')).json.abos.filter((a) => a.produkt === 'paket');
  assert.equal(abos.find((a) => a.angebote === 1000).status, 'aktiv');
  assert.equal(abos.find((a) => a.angebote === 500).status, 'beendet');
  assert.equal(abos.find((a) => a.angebote === 5000).status, 'beendet', 'auch ein Rechnungs-Abo wird ersetzt');
  assert.equal((await shop.api('/api/boerse/haendler')).json.paket, 1000);
  assert.ok(aufrufe.some((a) => a.url.endsWith('/v1/subscriptions/sub_1') && a.methode === 'DELETE'));
});

test('Erstattungen und Guthaben-Auszahlung erzeugen Gutschriften in ERPNext', async () => {
  const stripeZahlung = server.db.prepare("SELECT * FROM zahlungen WHERE extern_id = 'in_1'").get();
  let r = await post(shop, `/api/admin/zahlungen/${stripeZahlung.id}/erstatten`, { betrag: 5 });
  assert.equal(r.status, 403, 'nur für Administratoren');
  r = await post(admin, `/api/admin/zahlungen/${stripeZahlung.id}/erstatten`, { betrag: '99' });
  assert.equal(r.status, 400, 'nicht mehr als gezahlt');
  r = await post(admin, `/api/admin/zahlungen/${stripeZahlung.id}/erstatten`, { betrag: '5,00', grund: 'Kulanz' });
  assert.equal(r.status, 200, r.text);
  const refund = new URLSearchParams(aufrufe.find((a) => a.url.endsWith('/v1/refunds')).body);
  assert.equal(refund.get('payment_intent'), 'pi_1');
  assert.equal(refund.get('amount'), '500');
  await warte();
  const gutschrift = erp.rechnungen.at(-1);
  assert.equal(gutschrift.is_return, 1);
  assert.equal(gutschrift.return_against, stripeZahlung.erpnext_rechnung);
  assert.equal(gutschrift.items[0].qty, -1);
  assert.equal(gutschrift.items[0].rate, 4.2, '5,00 € brutto = 4,20 € netto');
  assert.equal(gutschrift.taxes[0].rate, 19);
  assert.equal(gutschrift.customer, 'CUST-1');

  // Stripe meldet die Erstattung per Webhook – keine doppelte Gutschrift, nur eine spätere Differenz
  const vorher = erp.rechnungen.length;
  await stripeEreignis('charge.refunded', { id: 'ch_1', invoice: 'in_1', amount_refunded: 500 });
  await warte();
  assert.equal(erp.rechnungen.length, vorher);
  await stripeEreignis('charge.refunded', { id: 'ch_1', invoice: 'in_1', amount_refunded: 800 });
  await warte();
  assert.equal(erp.rechnungen.length, vorher + 1);
  assert.equal(server.db.prepare('SELECT SUM(brutto) AS s FROM gutschriften WHERE zahlung_id = ?').get(stripeZahlung.id).s, 8);

  // PayPal: Erstattung über die API, der Webhook zur selben Erstattung wird erkannt
  const paypalZahlung = server.db.prepare("SELECT * FROM zahlungen WHERE extern_id = 'SALE-1'").get();
  r = await post(admin, `/api/admin/zahlungen/${paypalZahlung.id}/erstatten`, {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.brutto, 24.87, 'ohne Betrag = voll');
  await paypalEreignis('PAYMENT.SALE.REFUNDED', { id: 'REF-1', sale_id: 'SALE-1', amount: { total: '24.87' } });
  assert.equal(server.db.prepare('SELECT COUNT(*) AS n FROM gutschriften WHERE zahlung_id = ?').get(paypalZahlung.id).n, 1);

  // Guthaben auszahlen
  server.db.prepare('UPDATE benutzer SET guthaben = 10 WHERE id = ?').run(shopId);
  r = await post(admin, `/api/admin/benutzer/${shopId}/guthaben-auszahlen`, {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.netto, 10);
  assert.equal(r.json.brutto, 11.9);
  assert.equal((await shop.api('/api/boerse/zahlung')).json.guthaben, 0);
  assert.ok((await shop.api('/api/boerse/zahlung')).json.gutschriften.length >= 3);
  const alle = (await admin.api('/api/admin/zahlungen')).json;
  assert.equal(alle.find((x) => x.extern_id === 'in_1').erstattet, 8);
});

test('Kontolöschung beendet laufende Abos sofort beim Zahlungsanbieter', async () => {
  const offen = server.db.prepare("SELECT anbieter, extern_id FROM abos WHERE benutzer_id = ? AND status IN ('aktiv', 'gekuendigt', 'pausiert')").all(shopId);
  assert.ok(offen.some((a) => a.anbieter === 'stripe'), 'es gibt ein laufendes Stripe-Abo');
  const r = await shop.api('/api/konto', { methode: 'DELETE', daten: { passwort: 'sehr-geheimes-passwort' } });
  assert.equal(r.status, 204, r.text);
  for (const a of offen.filter((x) => x.anbieter === 'stripe')) {
    assert.ok(aufrufe.some((x) => x.methode === 'DELETE' && x.url.endsWith(`/v1/subscriptions/${a.extern_id}`)), `Stripe-Abo ${a.extern_id} beendet`);
  }
  // Zahlungen bleiben für die Buchhaltung erhalten (ohne Kontobezug)
  assert.ok(server.db.prepare('SELECT COUNT(*) AS n FROM zahlungen WHERE benutzer_id IS NULL').get().n > 0);
  // Spätere Stripe-Meldungen zum gelöschten Konto werden bestätigt statt endlos wiederholt
  stripeAbos.set('sub_weg', { id: 'sub_weg', status: 'active', metadata: { benutzer_id: String(shopId), produkt: 'paket', angebote: '500' } });
  const antwort = await stripeEreignis('invoice.paid', { id: 'in_weg', subscription: 'sub_weg', amount_paid: 1178, lines: { data: [{ period: { start: 1, end: 2 } }] } });
  assert.equal(antwort.status, 200);
});
