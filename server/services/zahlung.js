// Automatische Zahlungsabwicklung für Händler-Pakete und das Zusatzpaket API-Anbindung.
//
//  - Stripe (Karte, SEPA-Lastschrift) über Stripe Checkout im Abo-Modus
//  - PayPal über PayPal-Abonnements, zzgl. Zahlungsgebühr (PAYMENT_PAYPAL_FEE)
//
// Ablauf: Händler wählt ein Paket → Bezahlseite des Anbieters → Webhook meldet die Zahlung → Paket wird bis zum Ende
// des bezahlten Zeitraums (plus drei Tage Puffer) freigeschaltet, eine Rechnung in ERPNext angelegt. Verlängerungen
// laufen genauso; nach Kündigung oder fehlgeschlagener Zahlung läuft das Paket einfach aus.
//
// Sicherheit: Webhooks werden geprüft (Stripe: HMAC-Signatur, PayPal: Prüfung über die PayPal-API). Zahlungen und Abos
// werden nur über ihre IDs beim Anbieter zugeordnet und doppelt eintreffende Meldungen ignoriert.
import crypto from 'node:crypto';
import { MARKE } from '../../shared/marke.js';
import { KontoFehler } from './konten.js';
import { ValidierungsFehler } from './validierung.js';

const PUFFER_TAGE = 3;
const TAG_MS = 86_400_000;
const STRIPE_API = 'https://api.stripe.com';
const STRIPE_VERSION = '2024-06-20';

const runde = (n) => Math.round(n * 100) / 100;
const datum = (ms) => new Date(ms).toISOString().slice(0, 10);
const plusPuffer = (ms) => datum(ms + PUFFER_TAGE * TAG_MS);
const inEinemMonat = () => { const d = new Date(); d.setMonth(d.getMonth() + 1); return d.getTime(); };
const spaeter = (a, b) => (!a ? b : !b ? a : a > b ? a : b);

/** Verschachtelte Parameter im Format der Stripe-API: { a: { b: 1 } } → a[b]=1 */
export function stripeFormular(objekt, praefix = '', teile = new URLSearchParams()) {
  for (const [schluessel, wert] of Object.entries(objekt)) {
    if (wert === undefined || wert === null) continue;
    const name = praefix ? `${praefix}[${schluessel}]` : schluessel;
    if (Array.isArray(wert)) {
      wert.forEach((w, i) => (typeof w === 'object' ? stripeFormular(w, `${name}[${i}]`, teile) : teile.append(`${name}[${i}]`, String(w))));
    } else if (typeof wert === 'object') stripeFormular(wert, name, teile);
    else teile.append(name, String(wert));
  }
  return teile;
}

/** Prüft die Signatur eines Stripe-Webhooks (Header „Stripe-Signature“: t=…,v1=…). */
export function pruefeStripeSignatur(rohText, kopf, geheimnis, { toleranzSek = 300, jetzt = Date.now() } = {}) {
  const teile = Object.fromEntries(String(kopf ?? '').split(',').map((t) => t.split('=')).filter((t) => t.length === 2).map(([a, b]) => [a.trim(), b.trim()]));
  const signaturen = String(kopf ?? '').split(',').filter((t) => t.trim().startsWith('v1=')).map((t) => t.trim().slice(3));
  if (!teile.t || !signaturen.length || !geheimnis) return false;
  if (Math.abs(jetzt / 1000 - Number(teile.t)) > toleranzSek) return false;
  const erwartet = crypto.createHmac('sha256', geheimnis).update(`${teile.t}.${rohText}`).digest('hex');
  return signaturen.some((s) => s.length === erwartet.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(erwartet)));
}

export function erstelleZahlungsDienst(db, { konfiguration, benachrichtigungen, erpnext, fetchFn = globalThis.fetch }) {
  const z = () => konfiguration.zahlung;
  const boerse = () => konfiguration.boerse;
  const stripeAktiv = () => Boolean(z().stripeSchluessel && z().stripeWebhookGeheimnis);
  const paypalAktiv = () => Boolean(z().paypalClientId && z().paypalGeheimnis && z().paypalWebhookId);
  const brutto = (netto) => runde(netto * (1 + z().steuersatz / 100));

  const q = {
    benutzer: db.prepare('SELECT * FROM benutzer WHERE id = ?'),
    abo: db.prepare('SELECT * FROM abos WHERE anbieter = ? AND extern_id = ?'),
    aboId: db.prepare('SELECT * FROM abos WHERE id = ?'),
    schluesselLesen: db.prepare('SELECT wert FROM zahlung_schluessel WHERE schluessel = ?'),
    schluesselSchreiben: db.prepare('INSERT OR REPLACE INTO zahlung_schluessel (schluessel, wert) VALUES (?, ?)'),
  };

  // ── Produkte und Preise ───────────────────────────────────────
  function produktFuer(produkt, angebote) {
    if (produkt === 'api') return { produkt: 'api', angebote: null, netto: boerse().apiPreis, name: `${MARKE.name} Zusatzpaket API-Anbindung` };
    if (produkt === 'paket') {
      const p = boerse().pakete.find((x) => x.angebote === Number(angebote));
      if (!p) throw new ValidierungsFehler({ angebote: 'Dieses Paket gibt es nicht. Größere Kontingente bitte individuell anfragen.' });
      return { produkt: 'paket', angebote: p.angebote, netto: p.preis, name: `${MARKE.name} Händler-Paket ${p.angebote.toLocaleString('de-DE')} Angebote` };
    }
    throw new ValidierungsFehler({ produkt: 'Unbekanntes Produkt.' });
  }

  function uebersicht(benutzerId) {
    return {
      anbieter: { stripe: stripeAktiv(), paypal: paypalAktiv() },
      steuersatz: z().steuersatz,
      paypal_gebuehr: z().paypalGebuehr,
      abos: db.prepare(`SELECT id, anbieter, produkt, angebote, netto, status, laeuft_bis, erstellt_am FROM abos
        WHERE benutzer_id = ? AND status != 'offen' ORDER BY id DESC`).all(benutzerId),
      zahlungen: db.prepare(`SELECT id, anbieter, beschreibung, netto, brutto, erstellt_am, zeitraum_bis, erpnext_rechnung IS NOT NULL AS rechnung
        FROM zahlungen WHERE benutzer_id = ? ORDER BY id DESC LIMIT 100`).all(benutzerId).map((r) => ({ ...r, rechnung: Boolean(r.rechnung) })),
    };
  }

  // ── Freischalten und Verbuchen ────────────────────────────────
  /** Abo aktiv setzen und das Paket bzw. die API-Anbindung bis `bis` (JJJJ-MM-TT) freischalten. Idempotent. */
  function aktiviere(abo, bis) {
    const vorher = q.aboId.get(abo.id);
    const neuBis = spaeter(vorher.laeuft_bis, bis);
    const status = vorher.status === 'gekuendigt' ? 'gekuendigt' : 'aktiv';
    db.prepare("UPDATE abos SET status = ?, laeuft_bis = ?, geaendert_am = datetime('now') WHERE id = ?").run(status, neuBis, abo.id);
    const b = q.benutzer.get(abo.benutzer_id);
    if (abo.produkt === 'paket') {
      db.prepare('UPDATE benutzer SET haendler_paket = ?, haendler_paket_bis = ?, haendler_test_bis = NULL WHERE id = ?')
        .run(abo.angebote, spaeter(b.haendler_test_bis ? null : b.haendler_paket_bis, neuBis), b.id);
    } else {
      db.prepare('UPDATE benutzer SET haendler_api_bis = ?, haendler_test_bis = NULL WHERE id = ?').run(spaeter(b.haendler_test_bis ? null : b.haendler_api_bis, neuBis), b.id);
    }
    if (vorher.status === 'offen') {
      benachrichtigungen.sende(b.id, {
        art: 'boerse',
        titel: abo.produkt === 'paket' ? `Händler-Paket ${abo.angebote.toLocaleString('de-DE')} ist gebucht` : 'Zusatzpaket API-Anbindung ist gebucht',
        text: 'Vielen Dank! Das Abo verlängert sich monatlich und ist jederzeit zum Ende des Zeitraums kündbar.',
        link: '#/boerse/haendler',
      });
      // Ein neues Paket ersetzt ein bisheriges Abo derselben Art (z. B. Wechsel von 500 auf 1.000)
      for (const alt of db.prepare("SELECT * FROM abos WHERE benutzer_id = ? AND produkt = ? AND id != ? AND status IN ('aktiv', 'gekuendigt')").all(b.id, abo.produkt, abo.id)) {
        beendeExtern(alt).catch((e) => console.warn('[zahlung] altes Abo beenden:', e.message));
        db.prepare("UPDATE abos SET status = 'beendet', geaendert_am = datetime('now') WHERE id = ?").run(alt.id);
      }
    }
  }

  /** Zahlung einmalig erfassen und Rechnung in ERPNext anstoßen. */
  function verbuche(abo, { anbieter, externId, bruttoBetrag, bis }) {
    if (!(bruttoBetrag > 0)) return null;
    const netto = runde(bruttoBetrag / (1 + z().steuersatz / 100));
    const monat = bis ? ` bis ${bis.split('-').reverse().join('.')}` : '';
    const beschreibung = abo.produkt === 'paket'
      ? `${MARKE.name} Händler-Paket ${abo.angebote.toLocaleString('de-DE')} Angebote${monat}`
      : `${MARKE.name} Zusatzpaket API-Anbindung${monat}`;
    const r = db.prepare(`INSERT OR IGNORE INTO zahlungen (abo_id, benutzer_id, anbieter, extern_id, produkt, beschreibung, netto, steuersatz, brutto, zeitraum_bis)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(abo.id, abo.benutzer_id, anbieter, externId, abo.produkt, beschreibung, netto, z().steuersatz, runde(bruttoBetrag), bis);
    if (!r.changes) return null; // bereits verbucht
    const id = Number(r.lastInsertRowid);
    erpnext.rechnungFuer(id).catch((e) => console.warn('[erpnext]', e.message));
    return id;
  }

  // ── Stripe ────────────────────────────────────────────────────
  async function stripe(methode, pfad, daten) {
    const antwort = await fetchFn(`${STRIPE_API}${pfad}`, {
      method: methode,
      headers: {
        Authorization: `Bearer ${z().stripeSchluessel}`,
        'Stripe-Version': STRIPE_VERSION,
        ...(daten ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: daten ? stripeFormular(daten).toString() : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const json = await antwort.json().catch(() => ({}));
    if (!antwort.ok) throw new KontoFehler(`Stripe: ${json.error?.message ?? `HTTP ${antwort.status}`}`, 502);
    return json;
  }

  /** Abo-Zeile zu einem Stripe-Abo (bei Bedarf aus den Metadaten des Abos angelegt). */
  async function stripeAbo(subscriptionId, sub = null) {
    let abo = q.abo.get('stripe', subscriptionId);
    if (abo) return abo;
    const s = sub ?? await stripe('GET', `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`);
    const m = s.metadata ?? {};
    const benutzerId = Number(m.benutzer_id);
    if (!benutzerId || !q.benutzer.get(benutzerId)) throw new Error(`Stripe-Abo ${subscriptionId} ohne gültigen Benutzer`);
    const p = produktFuer(m.produkt, m.angebote);
    db.prepare(`INSERT OR IGNORE INTO abos (benutzer_id, anbieter, extern_id, produkt, angebote, netto) VALUES (?, 'stripe', ?, ?, ?, ?)`)
      .run(benutzerId, subscriptionId, p.produkt, p.angebote, p.netto);
    if (s.customer) db.prepare('UPDATE benutzer SET stripe_kunde = ? WHERE id = ?').run(String(s.customer), benutzerId);
    abo = q.abo.get('stripe', subscriptionId);
    return abo;
  }

  async function stripeCheckout(b, p, kennzeichnung, basis) {
    const testBis = b.haendler_test_bis ? Date.parse(`${b.haendler_test_bis}T23:00:00Z`) : 0;
    const test = testBis > Date.now() + 2 * TAG_MS; // Stripe verlangt mindestens 48 Stunden
    const metadaten = { benutzer_id: String(b.id), produkt: p.produkt, angebote: p.angebote ? String(p.angebote) : '' };
    const sitzung = await stripe('POST', '/v1/checkout/sessions', {
      mode: 'subscription',
      locale: 'de',
      client_reference_id: String(b.id),
      ...(b.stripe_kunde ? { customer: b.stripe_kunde } : { customer_email: kennzeichnung?.email || b.email || undefined }),
      payment_method_types: ['card', 'sepa_debit'],
      line_items: [{
        quantity: 1,
        price_data: { currency: 'eur', unit_amount: Math.round(brutto(p.netto) * 100), recurring: { interval: 'month' }, product_data: { name: p.name } },
      }],
      metadata: metadaten,
      subscription_data: { metadata: metadaten, ...(test ? { trial_end: Math.floor(testBis / 1000) } : {}) },
      success_url: `${basis}/?app=1#/boerse/haendler?zahlung=erfolg`,
      cancel_url: `${basis}/?app=1#/boerse/haendler?zahlung=abgebrochen`,
    });
    return sitzung.url;
  }

  async function stripeWebhook(rohText, signatur) {
    if (!stripeAktiv()) throw new KontoFehler('Stripe ist nicht eingerichtet.', 404);
    if (!pruefeStripeSignatur(rohText, signatur, z().stripeWebhookGeheimnis)) throw new KontoFehler('Ungültige Signatur.', 400);
    const ereignis = JSON.parse(rohText);
    const o = ereignis.data?.object ?? {};
    switch (ereignis.type) {
      case 'checkout.session.completed': {
        if (!o.subscription) break;
        const sub = await stripe('GET', `/v1/subscriptions/${encodeURIComponent(o.subscription)}`);
        const abo = await stripeAbo(o.subscription, sub);
        if (o.customer) db.prepare('UPDATE benutzer SET stripe_kunde = ? WHERE id = ?').run(String(o.customer), abo.benutzer_id);
        // Im Testzeitraum bleibt der Test aktiv; freigeschaltet wird mit der ersten bezahlten Rechnung
        if (sub.status === 'trialing') {
          db.prepare("UPDATE abos SET status = 'aktiv', laeuft_bis = ?, geaendert_am = datetime('now') WHERE id = ?").run(datum(sub.trial_end * 1000), abo.id);
        } else if (sub.status === 'active' && sub.current_period_end) {
          aktiviere(abo, plusPuffer(sub.current_period_end * 1000));
        }
        break;
      }
      case 'invoice.paid': {
        const subId = o.subscription ?? o.parent?.subscription_details?.subscription;
        if (!subId) break;
        const abo = await stripeAbo(subId);
        const ende = o.lines?.data?.[0]?.period?.end ?? o.period_end;
        const bis = plusPuffer(ende * 1000);
        if (o.amount_paid > 0) {
          aktiviere(abo, bis);
          verbuche(abo, { anbieter: 'stripe', externId: o.id, bruttoBetrag: o.amount_paid / 100, bis: datum(ende * 1000) });
        }
        break;
      }
      case 'customer.subscription.updated': {
        const abo = q.abo.get('stripe', o.id);
        if (!abo) break;
        const status = o.cancel_at_period_end ? 'gekuendigt' : ['active', 'trialing'].includes(o.status) ? 'aktiv' : abo.status;
        db.prepare("UPDATE abos SET status = ?, geaendert_am = datetime('now') WHERE id = ? AND status != 'beendet'").run(status, abo.id);
        break;
      }
      case 'customer.subscription.deleted': {
        db.prepare("UPDATE abos SET status = 'beendet', geaendert_am = datetime('now') WHERE anbieter = 'stripe' AND extern_id = ?").run(o.id);
        break;
      }
      default:
        break;
    }
    return { ok: true };
  }

  // ── PayPal ────────────────────────────────────────────────────
  const paypalBasis = () => (z().paypalSandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com');
  let paypalToken = null;

  async function paypal(methode, pfad, daten) {
    if (!paypalToken || paypalToken.bis < Date.now()) {
      const t = await fetchFn(`${paypalBasis()}/v1/oauth2/token`, {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${z().paypalClientId}:${z().paypalGeheimnis}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
        signal: AbortSignal.timeout(20_000),
      });
      const j = await t.json().catch(() => ({}));
      if (!t.ok || !j.access_token) throw new KontoFehler('PayPal lehnt die Zugangsdaten ab.', 502);
      paypalToken = { wert: j.access_token, bis: Date.now() + Math.max(60, (j.expires_in ?? 600) - 60) * 1000 };
    }
    const antwort = await fetchFn(`${paypalBasis()}${pfad}`, {
      method: methode,
      headers: { Authorization: `Bearer ${paypalToken.wert}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: daten ? JSON.stringify(daten) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    if (antwort.status === 204) return {};
    const json = await antwort.json().catch(() => ({}));
    if (!antwort.ok) throw new KontoFehler(`PayPal: ${json.message ?? json.details?.[0]?.description ?? `HTTP ${antwort.status}`}`, 502);
    return json;
  }

  /** PayPal-Plan für einen Preis (einmal angelegt, danach wiederverwendet). */
  async function paypalPlan(p) {
    const betrag = brutto(p.netto + z().paypalGebuehr).toFixed(2);
    const schluessel = `paypal:${z().paypalSandbox ? 'sandbox' : 'live'}:plan:${p.produkt}:${p.angebote ?? ''}:${betrag}`;
    const vorhanden = q.schluesselLesen.get(schluessel)?.wert;
    if (vorhanden) return vorhanden;
    const produktSchluessel = `paypal:${z().paypalSandbox ? 'sandbox' : 'live'}:produkt`;
    let produktId = q.schluesselLesen.get(produktSchluessel)?.wert;
    if (!produktId) {
      produktId = (await paypal('POST', '/v1/catalogs/products', { name: `${MARKE.name} Händlerleistungen`, type: 'SERVICE', category: 'SOFTWARE' })).id;
      q.schluesselSchreiben.run(produktSchluessel, produktId);
    }
    const plan = await paypal('POST', '/v1/billing/plans', {
      product_id: produktId,
      name: `${p.name} (inkl. Zahlungsgebühr)`.slice(0, 127),
      status: 'ACTIVE',
      billing_cycles: [{
        frequency: { interval_unit: 'MONTH', interval_count: 1 }, tenure_type: 'REGULAR', sequence: 1, total_cycles: 0,
        pricing_scheme: { fixed_price: { value: betrag, currency_code: 'EUR' } },
      }],
      payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 1 },
    });
    q.schluesselSchreiben.run(schluessel, plan.id);
    return plan.id;
  }

  async function paypalCheckout(b, p, basis) {
    const planId = await paypalPlan(p);
    const abo = await paypal('POST', '/v1/billing/subscriptions', {
      plan_id: planId,
      custom_id: `${b.id}:${p.produkt}:${p.angebote ?? ''}`,
      application_context: {
        brand_name: MARKE.name, locale: 'de-DE', shipping_preference: 'NO_SHIPPING', user_action: 'SUBSCRIBE_NOW',
        return_url: `${basis}/?app=1#/boerse/haendler?zahlung=paypal`,
        cancel_url: `${basis}/?app=1#/boerse/haendler?zahlung=abgebrochen`,
      },
    });
    db.prepare(`INSERT OR IGNORE INTO abos (benutzer_id, anbieter, extern_id, produkt, angebote, netto) VALUES (?, 'paypal', ?, ?, ?, ?)`)
      .run(b.id, abo.id, p.produkt, p.angebote, runde(p.netto + z().paypalGebuehr));
    const link = abo.links?.find((l) => l.rel === 'approve')?.href;
    if (!link) throw new KontoFehler('PayPal hat keinen Link zur Bestätigung geliefert.', 502);
    return link;
  }

  /** Nächster Abrechnungstermin eines PayPal-Abos → „bezahlt bis“ (mit Puffer). */
  function paypalBis(sub) {
    const naechste = Date.parse(sub?.billing_info?.next_billing_time ?? '');
    return plusPuffer(Number.isFinite(naechste) ? naechste : inEinemMonat());
  }

  function paypalAboZuordnen(sub) {
    let abo = q.abo.get('paypal', sub.id);
    if (abo) return abo;
    const [benutzerId, produkt, angebote] = String(sub.custom_id ?? '').split(':');
    if (!Number(benutzerId) || !q.benutzer.get(Number(benutzerId))) return null;
    const p = produktFuer(produkt, angebote);
    db.prepare(`INSERT OR IGNORE INTO abos (benutzer_id, anbieter, extern_id, produkt, angebote, netto) VALUES (?, 'paypal', ?, ?, ?, ?)`)
      .run(Number(benutzerId), sub.id, p.produkt, p.angebote, runde(p.netto + z().paypalGebuehr));
    abo = q.abo.get('paypal', sub.id);
    return abo;
  }

  async function paypalWebhook(kopf, rohText) {
    if (!paypalAktiv()) throw new KontoFehler('PayPal ist nicht eingerichtet.', 404);
    const ereignis = JSON.parse(rohText);
    const pruefung = await paypal('POST', '/v1/notifications/verify-webhook-signature', {
      auth_algo: kopf['paypal-auth-algo'], cert_url: kopf['paypal-cert-url'], transmission_id: kopf['paypal-transmission-id'],
      transmission_sig: kopf['paypal-transmission-sig'], transmission_time: kopf['paypal-transmission-time'],
      webhook_id: z().paypalWebhookId, webhook_event: ereignis,
    });
    if (pruefung.verification_status !== 'SUCCESS') throw new KontoFehler('Ungültige Signatur.', 400);
    const o = ereignis.resource ?? {};
    switch (ereignis.event_type) {
      case 'BILLING.SUBSCRIPTION.ACTIVATED': {
        const abo = paypalAboZuordnen(o);
        if (abo) aktiviere(abo, paypalBis(o));
        break;
      }
      case 'PAYMENT.SALE.COMPLETED': {
        if (!o.billing_agreement_id) break;
        const sub = await paypal('GET', `/v1/billing/subscriptions/${encodeURIComponent(o.billing_agreement_id)}`);
        const abo = paypalAboZuordnen(sub);
        if (!abo) break;
        const bis = paypalBis(sub);
        aktiviere(abo, bis);
        const zeitraumBis = sub?.billing_info?.next_billing_time ? sub.billing_info.next_billing_time.slice(0, 10) : null;
        verbuche(abo, { anbieter: 'paypal', externId: o.id, bruttoBetrag: Number(o.amount?.total ?? o.amount?.value ?? 0), bis: zeitraumBis });
        break;
      }
      case 'BILLING.SUBSCRIPTION.CANCELLED':
        db.prepare("UPDATE abos SET status = 'gekuendigt', geaendert_am = datetime('now') WHERE anbieter = 'paypal' AND extern_id = ? AND status != 'beendet'").run(o.id);
        break;
      case 'BILLING.SUBSCRIPTION.EXPIRED':
      case 'BILLING.SUBSCRIPTION.SUSPENDED':
        db.prepare("UPDATE abos SET status = 'beendet', geaendert_am = datetime('now') WHERE anbieter = 'paypal' AND extern_id = ?").run(o.id);
        break;
      default:
        break;
    }
    return { ok: true };
  }

  /** Nach der Rückkehr von PayPal: Abo sofort prüfen (falls der Webhook noch nicht da ist). */
  async function paypalBestaetigen(benutzer, subscriptionId) {
    if (!paypalAktiv()) throw new KontoFehler('PayPal ist nicht eingerichtet.', 404);
    // Ohne ID (PayPal hängt sie nicht immer an die Rücksprungadresse an): das zuletzt begonnene PayPal-Abo
    const abo = subscriptionId
      ? q.abo.get('paypal', String(subscriptionId))
      : db.prepare("SELECT * FROM abos WHERE benutzer_id = ? AND anbieter = 'paypal' ORDER BY id DESC LIMIT 1").get(benutzer.id);
    if (!abo || abo.benutzer_id !== benutzer.id) throw new KontoFehler('Abo nicht gefunden.', 404);
    const sub = await paypal('GET', `/v1/billing/subscriptions/${encodeURIComponent(abo.extern_id)}`);
    if (sub.status === 'ACTIVE') aktiviere(abo, paypalBis(sub));
    return { status: sub.status };
  }

  // ── Buchen, Kündigen ──────────────────────────────────────────
  async function checkout(benutzerRoh, { produkt, angebote, anbieter }) {
    const b = q.benutzer.get(benutzerRoh.id);
    if (b.haendler_status !== 'verifiziert') throw new KontoFehler('Buchen können verifizierte Händler.', 403);
    const basis = konfiguration.oeffentlicheUrl;
    if (!basis) throw new KontoFehler('Für Zahlungen muss die öffentliche Adresse (PUBLIC_URL) gesetzt sein.', 503);
    const p = produktFuer(produkt, angebote);
    const doppelt = db.prepare(`SELECT 1 FROM abos WHERE benutzer_id = ? AND produkt = ? AND COALESCE(angebote, 0) = ? AND status = 'aktiv'`)
      .get(b.id, p.produkt, p.angebote ?? 0);
    if (doppelt) throw new KontoFehler('Das hast du bereits gebucht.', 409);
    let kennzeichnung = null;
    try { kennzeichnung = JSON.parse(b.haendler_daten || 'null'); } catch { /* ohne */ }
    if (anbieter === 'stripe' && stripeAktiv()) return { url: await stripeCheckout(b, p, kennzeichnung, basis) };
    if (anbieter === 'paypal' && paypalAktiv()) return { url: await paypalCheckout(b, p, basis) };
    throw new ValidierungsFehler({ anbieter: 'Diese Zahlungsart ist nicht verfügbar.' });
  }

  async function beendeExtern(abo, { zumEnde = false } = {}) {
    if (abo.anbieter === 'stripe') {
      if (zumEnde) await stripe('POST', `/v1/subscriptions/${encodeURIComponent(abo.extern_id)}`, { cancel_at_period_end: 'true' });
      else await stripe('DELETE', `/v1/subscriptions/${encodeURIComponent(abo.extern_id)}`);
    } else {
      await paypal('POST', `/v1/billing/subscriptions/${encodeURIComponent(abo.extern_id)}/cancel`, { reason: zumEnde ? 'Kündigung durch den Händler' : 'Wechsel des Pakets' });
    }
  }

  /** Kündigung zum Ende des bezahlten Zeitraums (das Paket bleibt bis dahin aktiv). */
  async function kuendige(benutzer, aboId) {
    const abo = q.aboId.get(Number(aboId));
    if (!abo || abo.benutzer_id !== benutzer.id) throw new KontoFehler('Abo nicht gefunden.', 404);
    if (abo.status !== 'aktiv') throw new KontoFehler('Dieses Abo ist nicht aktiv.', 409);
    await beendeExtern(abo, { zumEnde: true });
    db.prepare("UPDATE abos SET status = 'gekuendigt', geaendert_am = datetime('now') WHERE id = ?").run(abo.id);
    return q.aboId.get(abo.id);
  }

  /** Stripe-Kundenbereich (Zahlungsdaten ändern, Rechnungen des Anbieters). */
  async function portal(benutzer) {
    const b = q.benutzer.get(benutzer.id);
    if (!stripeAktiv() || !b.stripe_kunde) throw new KontoFehler('Kein Stripe-Konto vorhanden.', 404);
    const s = await stripe('POST', '/v1/billing_portal/sessions', { customer: b.stripe_kunde, return_url: `${konfiguration.oeffentlicheUrl}/?app=1#/boerse/haendler` });
    return { url: s.url };
  }

  return {
    stripeAktiv, paypalAktiv, uebersicht, checkout, kuendige, portal, stripeWebhook, paypalWebhook, paypalBestaetigen,
    /** Nur für Tests und Administration */
    aktiviere, verbuche,
  };
}
