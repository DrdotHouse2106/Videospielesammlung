// Automatische Zahlungsabwicklung für Händler-Pakete und das Zusatzpaket API-Anbindung.
//
//  - Stripe (Karte, SEPA-Lastschrift) über Stripe Checkout im Abo-Modus
//  - PayPal über PayPal-Abonnements, zzgl. Zahlungsgebühr (PAYMENT_PAYPAL_FEE)
//  - Rechnung: ERPNext legt die Rechnung mit Zahlungsziel an und verschickt sie per E-Mail. Die Leistung beginnt sofort;
//    ist die Rechnung drei Tage nach Fälligkeit nicht bezahlt, wird der Zugang pausiert, bis der Zahlungseingang in
//    ERPNext gebucht ist. Folgerechnungen werden sieben Tage vor Ende des Zeitraums gestellt.
//
// Ablauf: Händler wählt ein Paket → Bezahlseite des Anbieters → Webhook meldet die Zahlung → Paket wird bis zum Ende
// des bezahlten Zeitraums (plus drei Tage Puffer) freigeschaltet, eine Rechnung in ERPNext angelegt. Verlängerungen
// laufen genauso; nach Kündigung oder fehlgeschlagener Zahlung läuft das Paket einfach aus.
//
// Verrechnung beim Wechsel: Der nicht genutzte Rest des bisherigen Abos wird tagesgenau gutgeschrieben (netto) und mit
// der neuen Zahlung verrechnet – bei Rechnung als Abzug auf der ERPNext-Rechnung, bei Stripe als Rabatt auf die erste
// Rechnung (ein Rest als Kundenguthaben für die Verlängerungen), bei PayPal als günstigerer erster Monat. Was übrig bleibt
// (z. B. beim Wechsel auf ein kleineres Paket), bleibt als Guthaben stehen und wird mit späteren Rechnungen verrechnet.
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
const heute = () => datum(Date.now());
const tagDavor = (ms) => datum(ms - TAG_MS);
/** Leistungszeitraum von einem Tag (JJJJ-MM-TT) an für einen Monat: 26.09. → 25.10. */
function monatAb(von) {
  const d = new Date(`${von}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return datum(d.getTime() - TAG_MS);
}
const plusTage = (iso, n) => datum(Date.parse(`${iso}T12:00:00Z`) + n * TAG_MS);

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
  const rechnungAktiv = () => Boolean(z().rechnung && erpnext.aktiv());
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
      anbieter: { stripe: stripeAktiv(), paypal: paypalAktiv(), rechnung: rechnungAktiv() },
      zahlungsziel: z().zahlungszielTage,
      steuersatz: z().steuersatz,
      paypal_gebuehr: z().paypalGebuehr,
      guthaben: q.benutzer.get(benutzerId)?.guthaben ?? 0,
      // Was bei einer neuen Buchung verrechnet würde (Rest des laufenden Abos + Guthaben), netto
      verrechenbar: { paket: verfuegbar(q.benutzer.get(benutzerId), 'paket'), api: verfuegbar(q.benutzer.get(benutzerId), 'api') },
      abos: db.prepare(`SELECT id, anbieter, produkt, angebote, netto, status, laeuft_bis, erstellt_am FROM abos
        WHERE benutzer_id = ? AND status != 'offen' ORDER BY id DESC`).all(benutzerId),
      gutschriften: db.prepare(`SELECT id, grund, brutto, erstellt_am, erpnext_gutschrift IS NOT NULL AS beleg FROM gutschriften WHERE benutzer_id = ?
        ORDER BY id DESC LIMIT 100`).all(benutzerId).map((g) => ({ ...g, beleg: Boolean(g.beleg) })),
      zahlungen: db.prepare(`SELECT id, anbieter, beschreibung, netto, verrechnet, brutto, erstellt_am, zeitraum_von, zeitraum_bis, bezahlt_am, faellig_am,
          erpnext_rechnung IS NOT NULL AS rechnung
        FROM zahlungen WHERE benutzer_id = ? ORDER BY id DESC LIMIT 100`).all(benutzerId).map((r) => ({ ...r, rechnung: Boolean(r.rechnung) })),
    };
  }

  // ── Verrechnung ───────────────────────────────────────────────
  /**
   * Nicht genutzter Wert (netto) eines laufenden Abos: bezahlter bzw. in Rechnung gestellter Betrag des aktuellen
   * Zeitraums, anteilig für die Tage ab morgen bis zum Ende des Zeitraums.
   */
  function restwert(abo) {
    // Alle noch nicht abgelaufenen Zeiträume zählen – auch eine vorab gestellte Folgerechnung
    const zeitraeume = db.prepare('SELECT * FROM zahlungen WHERE abo_id = ? AND zeitraum_von IS NOT NULL AND zeitraum_bis >= ?').all(abo.id, heute());
    const tage = (von, bis) => Math.round((Date.parse(`${bis}T12:00:00Z`) - Date.parse(`${von}T12:00:00Z`)) / TAG_MS) + 1;
    const morgen = plusTage(heute(), 1);
    let summe = 0;
    for (const z0 of zeitraeume) {
      const gesamt = tage(z0.zeitraum_von, z0.zeitraum_bis);
      const rest = Math.min(gesamt, Math.max(0, tage(spaeter(morgen, z0.zeitraum_von), z0.zeitraum_bis)));
      const bezahlt = Math.max(0, z0.netto - (z0.verrechnet ?? 0));
      if (gesamt > 0) summe += (bezahlt * rest) / gesamt;
    }
    return runde(summe);
  }

  /** Abos derselben Art, die ein neues Abo ersetzen würde. */
  const ersetzbare = (benutzerId, produkt, ausserId = -1) => db.prepare(`SELECT * FROM abos WHERE benutzer_id = ? AND produkt = ? AND id != ?
    AND status IN ('aktiv', 'gekuendigt', 'pausiert')`).all(benutzerId, produkt, ausserId);

  /** Verfügbares Guthaben (netto) für eine neue Buchung: Rest des bisherigen Abos plus vorhandenes Guthaben. */
  function verfuegbar(b, produkt) {
    return runde(ersetzbare(b.id, produkt).reduce((s, a) => s + restwert(a), 0) + (b.guthaben ?? 0));
  }

  // ── Freischalten und Verbuchen ────────────────────────────────
  /** Abo aktiv setzen und das Paket bzw. die API-Anbindung bis `bis` (JJJJ-MM-TT) freischalten. Idempotent. */
  function aktiviere(abo, bis) {
    const vorher = q.aboId.get(abo.id);
    const neuBis = spaeter(vorher.laeuft_bis, bis);
    const status = vorher.status === 'gekuendigt' ? 'gekuendigt' : 'aktiv';
    db.prepare("UPDATE abos SET status = ?, laeuft_bis = ?, geaendert_am = datetime('now') WHERE id = ?").run(status, neuBis, abo.id);
    const b = q.benutzer.get(abo.benutzer_id);
    // Erstes Freischalten eines neuen Abos (auch beim Wechsel) setzt den Zeitraum neu; Verlängerungen schieben ihn nur nach hinten
    const neu = vorher.status === 'offen' || b.haendler_test_bis;
    if (abo.produkt === 'paket') {
      db.prepare('UPDATE benutzer SET haendler_paket = ?, haendler_paket_bis = ?, haendler_test_bis = NULL WHERE id = ?')
        .run(abo.angebote, neu ? neuBis : spaeter(b.haendler_paket_bis, neuBis), b.id);
    } else {
      db.prepare('UPDATE benutzer SET haendler_api_bis = ?, haendler_test_bis = NULL WHERE id = ?').run(neu ? neuBis : spaeter(b.haendler_api_bis, neuBis), b.id);
    }
    if (vorher.status === 'offen') {
      benachrichtigungen.sende(b.id, {
        art: 'boerse',
        titel: abo.produkt === 'paket' ? `Händler-Paket ${abo.angebote.toLocaleString('de-DE')} ist gebucht` : 'Zusatzpaket API-Anbindung ist gebucht',
        text: 'Vielen Dank! Das Abo verlängert sich monatlich und ist jederzeit zum Ende des Zeitraums kündbar.',
        link: '#/boerse/haendler',
      });
      // Ein neues Paket ersetzt ein bisheriges Abo derselben Art (z. B. Wechsel von 500 auf 1.000). Der nicht genutzte
      // Rest wird gutgeschrieben; die bei der Buchung bereits eingeplante Verrechnung ist davon abgezogen.
      let gutschrift = 0;
      for (const alt of ersetzbare(b.id, abo.produkt, abo.id)) {
        gutschrift += restwert(alt);
        beendeExtern(alt).catch((e) => console.warn('[zahlung] altes Abo beenden:', e.message));
        db.prepare("UPDATE abos SET status = 'beendet', geaendert_am = datetime('now') WHERE id = ?").run(alt.id);
      }
      const eingeplant = q.aboId.get(abo.id).verrechnung_netto ?? 0;
      db.prepare('UPDATE benutzer SET guthaben = MAX(0, ROUND(guthaben + ? - ?, 2)) WHERE id = ?').run(runde(gutschrift), eingeplant, b.id);
    }
  }

  /** Zahlung einmalig erfassen und Rechnung in ERPNext anstoßen. */
  const beschreibungFuer = (abo) => (abo.produkt === 'paket'
    ? `${MARKE.name} Händler-Paket ${abo.angebote.toLocaleString('de-DE')} Angebote`
    : `${MARKE.name} Zusatzpaket API-Anbindung`);

  /** Bezahlte Zahlung (Stripe/PayPal) mit Leistungszeitraum `von`–`bis` erfassen. */
  function verbuche(abo, { anbieter, externId, bruttoBetrag, bruttoVoll = bruttoBetrag, von, bis }) {
    if (!(bruttoVoll > 0)) return null;
    const faktor = 1 + z().steuersatz / 100;
    const netto = runde(bruttoVoll / faktor);
    const verrechnet = runde(Math.max(0, netto - bruttoBetrag / faktor));
    const r = db.prepare(`INSERT OR IGNORE INTO zahlungen (abo_id, benutzer_id, anbieter, extern_id, produkt, beschreibung, netto, verrechnet, steuersatz,
        brutto, zeitraum_von, zeitraum_bis, bezahlt_am)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
      .run(abo.id, abo.benutzer_id, anbieter, externId, abo.produkt, beschreibungFuer(abo), netto, verrechnet, z().steuersatz, runde(bruttoBetrag), von, bis);
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
    if (!benutzerId || !q.benutzer.get(benutzerId)) {
      // z. B. gelöschtes Konto: Meldung bestätigen, damit Stripe sie nicht endlos wiederholt
      console.warn(`[zahlung] Stripe-Abo ${subscriptionId} ohne gültigen Benutzer – ignoriert`);
      return null;
    }
    const p = produktFuer(m.produkt, m.angebote);
    db.prepare(`INSERT OR IGNORE INTO abos (benutzer_id, anbieter, extern_id, produkt, angebote, netto, verrechnung_netto) VALUES (?, 'stripe', ?, ?, ?, ?, ?)`)
      .run(benutzerId, subscriptionId, p.produkt, p.angebote, p.netto, Number(m.verrechnung) || 0);
    if (s.customer) db.prepare('UPDATE benutzer SET stripe_kunde = ? WHERE id = ?').run(String(s.customer), benutzerId);
    abo = q.abo.get('stripe', subscriptionId);
    return abo;
  }

  /** Übriges Guthaben als Kundenguthaben an Stripe übergeben – Stripe verrechnet es mit den nächsten Abbuchungen. */
  async function guthabenAnStripe(benutzerId, kunde) {
    const b = q.benutzer.get(benutzerId);
    const kundeId = kunde || b?.stripe_kunde;
    if (!b || !(b.guthaben > 0) || !kundeId) return;
    await stripe('POST', `/v1/customers/${encodeURIComponent(kundeId)}/balance_transactions`, {
      amount: -Math.round(brutto(b.guthaben) * 100), currency: 'eur', description: 'Guthaben aus Abowechsel',
    });
    db.prepare('UPDATE benutzer SET guthaben = 0 WHERE id = ?').run(b.id);
  }

  async function stripeCheckout(b, p, kennzeichnung, basis) {
    const testBis = b.haendler_test_bis ? Date.parse(`${b.haendler_test_bis}T23:00:00Z`) : 0;
    const test = testBis > Date.now() + 2 * TAG_MS; // Stripe verlangt mindestens 48 Stunden
    const metadaten = { benutzer_id: String(b.id), produkt: p.produkt, angebote: p.angebote ? String(p.angebote) : '' };
    // Verrechnung als einmaliger Rabatt auf die erste Rechnung
    const verrechnung = runde(Math.min(verfuegbar(b, p.produkt), p.netto));
    let rabatt = null;
    if (verrechnung > 0 && !test) {
      rabatt = (await stripe('POST', '/v1/coupons', {
        amount_off: Math.round(brutto(verrechnung) * 100), currency: 'eur', duration: 'once', name: 'Verrechnung bisheriges Abo', max_redemptions: 1,
        redeem_by: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // nur für diese Buchung
      })).id;
    }
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
      ...(rabatt ? { discounts: [{ coupon: rabatt }] } : {}),
      metadata: { ...metadaten, verrechnung: rabatt ? String(verrechnung) : '0' },
      subscription_data: { metadata: { ...metadaten, verrechnung: rabatt ? String(verrechnung) : '0' }, ...(test ? { trial_end: Math.floor(testBis / 1000) } : {}) },
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
        if (!abo) break;
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
        if (!abo) break;
        const zeile = o.lines?.data?.[0]?.period ?? {};
        const ende = zeile.end ?? o.period_end;
        const start = zeile.start ?? o.period_start ?? Math.floor(Date.now() / 1000);
        // subtotal = voller Preis; Rabatt (Verrechnung) und Kundenguthaben mindern den gezahlten Betrag
        const voll = (o.subtotal ?? o.total ?? o.amount_paid) / 100;
        if (voll > 0) {
          aktiviere(abo, plusPuffer(ende * 1000));
          verbuche(abo, { anbieter: 'stripe', externId: o.id, bruttoBetrag: o.amount_paid / 100, bruttoVoll: voll, von: datum(start * 1000), bis: tagDavor(ende * 1000) });
          await guthabenAnStripe(abo.benutzer_id, o.customer);
        }
        break;
      }
      case 'charge.refunded': {
        // Erstattung (auch direkt im Stripe-Dashboard): Differenz zu bereits erfassten Gutschriften nachtragen
        const rechnungId = o.invoice;
        const zahlung = rechnungId ? db.prepare("SELECT * FROM zahlungen WHERE anbieter = 'stripe' AND extern_id = ?").get(rechnungId) : null;
        if (!zahlung) break;
        const differenz = runde(o.amount_refunded / 100 - erstattet(zahlung.id));
        if (differenz > 0.005) {
          erfasseGutschrift({ zahlung, anbieter: 'stripe', externId: `stripe:charge:${o.id}:${o.amount_refunded}`, grund: 'Erstattung (Stripe)', bruttoBetrag: differenz });
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

  /** Einmaliger Plan mit günstigerem ersten Monat (Verrechnung), danach regulärer Preis. */
  async function paypalPlanMitVerrechnung(p, verrechnung) {
    await paypalPlan(p); // legt bei Bedarf das Produkt an
    const produktId = q.schluesselLesen.get(`paypal:${z().paypalSandbox ? 'sandbox' : 'live'}:produkt`).wert;
    const voll = brutto(p.netto + z().paypalGebuehr);
    const erster = Math.max(0, runde(voll - brutto(verrechnung)));
    const plan = await paypal('POST', '/v1/billing/plans', {
      product_id: produktId,
      name: `${p.name} (Wechsel mit Verrechnung)`.slice(0, 127),
      status: 'ACTIVE',
      billing_cycles: [
        {
          frequency: { interval_unit: 'MONTH', interval_count: 1 }, tenure_type: 'TRIAL', sequence: 1, total_cycles: 1,
          ...(erster > 0 ? { pricing_scheme: { fixed_price: { value: erster.toFixed(2), currency_code: 'EUR' } } } : {}),
        },
        {
          frequency: { interval_unit: 'MONTH', interval_count: 1 }, tenure_type: 'REGULAR', sequence: 2, total_cycles: 0,
          pricing_scheme: { fixed_price: { value: voll.toFixed(2), currency_code: 'EUR' } },
        },
      ],
      payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 1 },
    });
    return plan.id;
  }

  async function paypalCheckout(b, p, basis) {
    const verrechnung = runde(Math.min(verfuegbar(b, p.produkt), p.netto + z().paypalGebuehr));
    const planId = verrechnung > 0 ? await paypalPlanMitVerrechnung(p, verrechnung) : await paypalPlan(p);
    const abo = await paypal('POST', '/v1/billing/subscriptions', {
      plan_id: planId,
      custom_id: `${b.id}:${p.produkt}:${p.angebote ?? ''}`,
      application_context: {
        brand_name: MARKE.name, locale: 'de-DE', shipping_preference: 'NO_SHIPPING', user_action: 'SUBSCRIBE_NOW',
        return_url: `${basis}/?app=1#/boerse/haendler?zahlung=paypal`,
        cancel_url: `${basis}/?app=1#/boerse/haendler?zahlung=abgebrochen`,
      },
    });
    db.prepare(`INSERT OR IGNORE INTO abos (benutzer_id, anbieter, extern_id, produkt, angebote, netto, verrechnung_netto) VALUES (?, 'paypal', ?, ?, ?, ?, ?)`)
      .run(b.id, abo.id, p.produkt, p.angebote, runde(p.netto + z().paypalGebuehr), verrechnung);
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
        if (!abo) break;
        aktiviere(abo, paypalBis(o));
        // Vollständig verrechneter erster Monat: keine Abbuchung, trotzdem Rechnung mit vollem Abzug
        if (abo.verrechnung_netto >= abo.netto) {
          const naechste = Date.parse(o?.billing_info?.next_billing_time ?? '');
          verbuche(abo, { anbieter: 'paypal', externId: `${o.id}-verrechnet`, bruttoBetrag: 0, bruttoVoll: brutto(abo.netto),
            von: heute(), bis: Number.isFinite(naechste) ? tagDavor(naechste) : monatAb(heute()) });
        }
        break;
      }
      case 'PAYMENT.SALE.COMPLETED': {
        if (!o.billing_agreement_id) break;
        const sub = await paypal('GET', `/v1/billing/subscriptions/${encodeURIComponent(o.billing_agreement_id)}`);
        const abo = paypalAboZuordnen(sub);
        if (!abo) break;
        const bis = paypalBis(sub);
        aktiviere(abo, bis);
        const von = String(o.create_time ?? '').slice(0, 10) || heute();
        const naechste = Date.parse(sub?.billing_info?.next_billing_time ?? '');
        const bezahlt = Number(o.amount?.total ?? o.amount?.value ?? 0);
        // Erster Monat nach einem Wechsel ist um die Verrechnung günstiger – die Rechnung zeigt vollen Preis und Abzug
        const ersteZahlung = !db.prepare('SELECT 1 FROM zahlungen WHERE abo_id = ?').get(abo.id);
        verbuche(abo, {
          anbieter: 'paypal', externId: o.id, bruttoBetrag: bezahlt,
          bruttoVoll: ersteZahlung && abo.verrechnung_netto > 0 ? brutto(abo.netto) : bezahlt,
          von, bis: Number.isFinite(naechste) ? tagDavor(naechste) : monatAb(von),
        });
        break;
      }
      case 'PAYMENT.SALE.REFUNDED': {
        const zahlung = db.prepare("SELECT * FROM zahlungen WHERE anbieter = 'paypal' AND extern_id = ?").get(o.sale_id);
        if (!zahlung) break;
        const betrag = Number(o.amount?.total ?? o.amount?.value ?? 0);
        if (betrag > 0) erfasseGutschrift({ zahlung, anbieter: 'paypal', externId: `paypal:${o.id}`, grund: 'Erstattung (PayPal)', bruttoBetrag: betrag });
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

  // ── Zahlung per Rechnung (über ERPNext) ───────────────────────
  /** Rechnung für den Zeitraum `von`–`bis` stellen (ERPNext legt sie an und verschickt sie). */
  async function stelleRechnung(abo, von, bis, verrechnet = 0) {
    const faellig = plusTage(heute(), z().zahlungszielTage);
    const zuZahlen = runde(abo.netto - verrechnet);
    const { lastInsertRowid } = db.prepare(`INSERT INTO zahlungen (abo_id, benutzer_id, anbieter, extern_id, produkt, beschreibung, netto, verrechnet, steuersatz,
        brutto, zeitraum_von, zeitraum_bis, faellig_am, bezahlt_am) VALUES (?, ?, 'rechnung', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(abo.id, abo.benutzer_id, `R-${crypto.randomUUID()}`, abo.produkt, beschreibungFuer(abo), abo.netto, verrechnet, z().steuersatz, brutto(zuZahlen),
        von, bis, faellig, zuZahlen <= 0 ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null);
    const id = Number(lastInsertRowid);
    const name = await erpnext.rechnungFuer(id);
    return { id, name };
  }

  async function rechnungCheckout(b, p) {
    if (!rechnungAktiv()) throw new ValidierungsFehler({ anbieter: 'Zahlung per Rechnung ist nicht verfügbar.' });
    // Im Testzugang beginnt der bezahlte Zeitraum nach dem Test
    const von = b.haendler_test_bis && b.haendler_test_bis >= heute() ? plusTage(b.haendler_test_bis, 1) : heute();
    const bis = monatAb(von);
    // Rest des bisherigen Abos und vorhandenes Guthaben werden direkt auf der ersten Rechnung verrechnet
    const verrechnung = runde(Math.min(verfuegbar(b, p.produkt), p.netto));
    const { lastInsertRowid } = db.prepare(`INSERT INTO abos (benutzer_id, anbieter, extern_id, produkt, angebote, netto, verrechnung_netto) VALUES (?, 'rechnung', ?, ?, ?, ?, ?)`)
      .run(b.id, `R-${crypto.randomUUID()}`, p.produkt, p.angebote, p.netto, verrechnung);
    const abo = q.aboId.get(Number(lastInsertRowid));
    const { id, name } = await stelleRechnung(abo, von, bis, verrechnung);
    if (!name) {
      const fehler = db.prepare('SELECT erpnext_fehler FROM zahlungen WHERE id = ?').get(id)?.erpnext_fehler;
      db.prepare('DELETE FROM zahlungen WHERE id = ?').run(id);
      db.prepare('DELETE FROM abos WHERE id = ?').run(abo.id);
      console.warn('[zahlung] Rechnung konnte nicht erstellt werden:', fehler);
      throw new KontoFehler('Die Rechnung konnte gerade nicht erstellt werden. Bitte später erneut versuchen oder eine andere Zahlungsart wählen.', 502);
    }
    // Die Leistung beginnt sofort – bezahlt wird innerhalb des Zahlungsziels
    aktiviere(abo, bis);
    return { rechnung: name, faellig_am: plusTage(heute(), z().zahlungszielTage) };
  }

  /**
   * Zeitgesteuert (alle 15 Minuten): Zahlungseingänge in ERPNext erkennen, überfällige Rechnungen pausieren
   * und Folgerechnungen sieben Tage vor Ende des Zeitraums stellen.
   */
  async function pruefeRechnungen() {
    if (!erpnext.aktiv()) return { bezahlt: 0, pausiert: 0, gestellt: 0 };
    const ergebnis = { bezahlt: 0, pausiert: 0, gestellt: 0 };
    const offene = db.prepare(`SELECT z.*, a.status AS abo_status FROM zahlungen z JOIN abos a ON a.id = z.abo_id
      WHERE z.anbieter = 'rechnung' AND z.bezahlt_am IS NULL AND z.erpnext_rechnung IS NOT NULL AND z.erpnext_fehler IS NOT 'In ERPNext storniert'`).all();
    for (const r of offene) {
      let status;
      try { status = await erpnext.rechnungsStatus(r.erpnext_rechnung); } catch (e) { console.warn('[zahlung]', e.message); continue; }
      const abo = q.aboId.get(r.abo_id);
      if (status === 'bezahlt') {
        db.prepare("UPDATE zahlungen SET bezahlt_am = datetime('now') WHERE id = ?").run(r.id);
        if (abo.status === 'pausiert') db.prepare("UPDATE abos SET status = 'aktiv' WHERE id = ?").run(abo.id);
        if (r.zeitraum_bis >= heute()) aktiviere(q.aboId.get(abo.id), r.zeitraum_bis);
        ergebnis.bezahlt++;
      } else if (status === 'storniert') {
        db.prepare("UPDATE zahlungen SET erpnext_fehler = 'In ERPNext storniert' WHERE id = ?").run(r.id);
      } else if (plusTage(r.faellig_am, PUFFER_TAGE) < heute() && abo.status !== 'pausiert') {
        // Überfällig: Zugang pausieren, bis die Zahlung gebucht ist
        db.prepare("UPDATE abos SET status = 'pausiert', geaendert_am = datetime('now') WHERE id = ?").run(abo.id);
        const gestern = tagDavor(Date.now());
        if (abo.produkt === 'paket') db.prepare('UPDATE benutzer SET haendler_paket_bis = ? WHERE id = ? AND haendler_paket = ?').run(gestern, abo.benutzer_id, abo.angebote);
        else db.prepare('UPDATE benutzer SET haendler_api_bis = ? WHERE id = ?').run(gestern, abo.benutzer_id);
        benachrichtigungen.sende(abo.benutzer_id, {
          art: 'boerse', titel: `Rechnung ${r.erpnext_rechnung} ist überfällig`,
          text: 'Dein Paket ist pausiert, bis der Zahlungseingang gebucht ist. Danach wird es automatisch wieder freigeschaltet.',
          link: '#/boerse/haendler',
        });
        ergebnis.pausiert++;
      }
    }
    // Folgerechnungen für laufende Abos
    const laufende = db.prepare("SELECT * FROM abos WHERE anbieter = 'rechnung' AND status = 'aktiv'").all();
    for (const abo of laufende) {
      const letzte = db.prepare('SELECT MAX(zeitraum_bis) AS bis FROM zahlungen WHERE abo_id = ?').get(abo.id).bis;
      if (!letzte || plusTage(letzte, -7) > heute()) continue;
      const von = plusTage(letzte, 1);
      const bis = monatAb(von);
      const guthaben = q.benutzer.get(abo.benutzer_id)?.guthaben ?? 0;
      const verrechnet = runde(Math.min(guthaben, abo.netto));
      if (verrechnet > 0) db.prepare('UPDATE benutzer SET guthaben = ROUND(guthaben - ?, 2) WHERE id = ?').run(verrechnet, abo.benutzer_id);
      const { name } = await stelleRechnung(abo, von, bis, verrechnet);
      if (name) { aktiviere(abo, bis); ergebnis.gestellt++; } else if (verrechnet > 0) {
        db.prepare('UPDATE benutzer SET guthaben = ROUND(guthaben + ?, 2) WHERE id = ?').run(verrechnet, abo.benutzer_id);
      }
    }
    // Gekündigte Rechnungs-Abos nach Ablauf beenden
    db.prepare("UPDATE abos SET status = 'beendet' WHERE anbieter = 'rechnung' AND status = 'gekuendigt' AND laeuft_bis < ?").run(heute());
    return ergebnis;
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
    if (anbieter === 'rechnung') return rechnungCheckout(b, p);
    throw new ValidierungsFehler({ anbieter: 'Diese Zahlungsart ist nicht verfügbar.' });
  }

  async function beendeExtern(abo, { zumEnde = false } = {}) {
    if (abo.anbieter === 'rechnung') return; // es werden einfach keine Folgerechnungen mehr gestellt
    if (abo.anbieter === 'stripe') {
      if (zumEnde) await stripe('POST', `/v1/subscriptions/${encodeURIComponent(abo.extern_id)}`, { cancel_at_period_end: 'true' });
      else await stripe('DELETE', `/v1/subscriptions/${encodeURIComponent(abo.extern_id)}`);
    } else {
      await paypal('POST', `/v1/billing/subscriptions/${encodeURIComponent(abo.extern_id)}/cancel`, { reason: zumEnde ? 'Kündigung durch den Händler' : 'Wechsel des Pakets' });
    }
  }

  /** Vor dem Löschen eines Kontos: alle laufenden Abos sofort beim Zahlungsanbieter beenden (keine weiteren Abbuchungen). */
  async function beendeAlleAbos(benutzerId) {
    const offen = db.prepare("SELECT * FROM abos WHERE benutzer_id = ? AND status IN ('offen', 'aktiv', 'gekuendigt', 'pausiert')").all(benutzerId);
    const fehler = [];
    for (const abo of offen) {
      try {
        if ((abo.anbieter === 'stripe' && stripeAktiv()) || (abo.anbieter === 'paypal' && paypalAktiv()) || abo.anbieter === 'rechnung') await beendeExtern(abo);
      } catch (e) {
        fehler.push(`${abo.anbieter} ${abo.extern_id}: ${e.message}`);
      }
      db.prepare("UPDATE abos SET status = 'beendet', geaendert_am = datetime('now') WHERE id = ?").run(abo.id);
    }
    if (fehler.length) console.warn('[zahlung] Abos beim Löschen nicht beendet – bitte beim Anbieter prüfen:', fehler.join('; '));
    return { beendet: offen.length, fehler };
  }

  // ── Erstattungen und Gutschriften ─────────────────────────────
  /** Schon erstatteter Bruttobetrag einer Zahlung. */
  const erstattet = (zahlungId) => db.prepare('SELECT COALESCE(SUM(brutto), 0) AS s FROM gutschriften WHERE zahlung_id = ?').get(zahlungId).s;

  /** Gutschrift erfassen (einmalig je `externId`) und in ERPNext anlegen. */
  function erfasseGutschrift({ zahlung, benutzerId, anbieter, externId, grund, bruttoBetrag, netto = null, steuersatz = null }) {
    const satz = steuersatz ?? zahlung?.steuersatz ?? z().steuersatz;
    const n = netto ?? runde(bruttoBetrag / (1 + satz / 100));
    const r = db.prepare(`INSERT OR IGNORE INTO gutschriften (zahlung_id, benutzer_id, anbieter, extern_id, grund, netto, steuersatz, brutto)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(zahlung?.id ?? null, benutzerId ?? zahlung?.benutzer_id ?? null, anbieter, externId, grund, n, satz, runde(bruttoBetrag));
    if (!r.changes) return null;
    const id = Number(r.lastInsertRowid);
    erpnext.gutschriftFuer(id).catch((e) => console.warn('[erpnext]', e.message));
    return id;
  }

  /**
   * Administration: Zahlung ganz oder teilweise erstatten. Stripe und PayPal zahlen automatisch zurück; bei Rechnung
   * entsteht die Gutschrift, die Überweisung macht der Betreiber. Optional wird das Abo sofort beendet.
   */
  async function erstatte(zahlungId, { betrag, grund, aboBeenden = false } = {}) {
    const zahlung = db.prepare('SELECT * FROM zahlungen WHERE id = ?').get(Number(zahlungId));
    if (!zahlung) throw new KontoFehler('Zahlung nicht gefunden.', 404);
    const offen = runde(zahlung.brutto - erstattet(zahlung.id));
    const brutto = betrag === undefined || betrag === null || betrag === '' ? offen : runde(Number(String(betrag).replace(',', '.')));
    if (!(brutto > 0) || brutto > offen + 0.001) throw new ValidierungsFehler({ betrag: `Bitte einen Betrag bis ${offen.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })} angeben.` });
    const text = String(grund ?? '').trim().slice(0, 300) || 'Erstattung';
    let externId;
    if (zahlung.anbieter === 'stripe') {
      if (!stripeAktiv()) throw new KontoFehler('Stripe ist nicht eingerichtet.', 409);
      const rechnung = await stripe('GET', `/v1/invoices/${encodeURIComponent(zahlung.extern_id)}`);
      if (!rechnung.payment_intent) throw new KontoFehler('Zu dieser Stripe-Rechnung gibt es keine Zahlung zum Erstatten.', 409);
      const erstattung = await stripe('POST', '/v1/refunds', {
        payment_intent: rechnung.payment_intent, amount: Math.round(brutto * 100), metadata: { zahlung_id: String(zahlung.id) },
      });
      externId = `stripe:${erstattung.id}`;
    } else if (zahlung.anbieter === 'paypal') {
      if (!paypalAktiv()) throw new KontoFehler('PayPal ist nicht eingerichtet.', 409);
      const erstattung = await paypal('POST', `/v1/payments/sale/${encodeURIComponent(zahlung.extern_id)}/refund`, {
        amount: { total: brutto.toFixed(2), currency: 'EUR' }, description: text.slice(0, 255),
      });
      externId = `paypal:${erstattung.id}`;
    } else {
      externId = `rechnung:${crypto.randomUUID()}`;
    }
    const id = erfasseGutschrift({ zahlung, anbieter: zahlung.anbieter, externId, grund: text, bruttoBetrag: brutto });
    if (aboBeenden && zahlung.abo_id) {
      const abo = q.aboId.get(zahlung.abo_id);
      if (abo && abo.status !== 'beendet') {
        await beendeExtern(abo).catch((e) => console.warn('[zahlung] Abo beenden:', e.message));
        db.prepare("UPDATE abos SET status = 'beendet', geaendert_am = datetime('now') WHERE id = ?").run(abo.id);
        const gestern = tagDavor(Date.now());
        if (abo.produkt === 'paket') db.prepare('UPDATE benutzer SET haendler_paket_bis = ? WHERE id = ? AND haendler_paket = ?').run(gestern, abo.benutzer_id, abo.angebote);
        else db.prepare('UPDATE benutzer SET haendler_api_bis = ? WHERE id = ?').run(gestern, abo.benutzer_id);
      }
    }
    if (zahlung.benutzer_id) {
      benachrichtigungen.sende(zahlung.benutzer_id, {
        art: 'boerse', titel: `Erstattung über ${brutto.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}`,
        text: zahlung.anbieter === 'rechnung' ? `${text} – der Betrag wird dir überwiesen bzw. verrechnet.` : `${text} – der Betrag geht auf dein Zahlungsmittel zurück.`,
        link: '#/boerse/haendler',
      });
    }
    return db.prepare('SELECT * FROM gutschriften WHERE id = ?').get(id);
  }

  /** Administration: Guthaben eines Händlers auszahlen (Gutschrift in ERPNext, Überweisung durch den Betreiber). */
  function zahleGuthabenAus(benutzerId, grund) {
    const b = q.benutzer.get(Number(benutzerId));
    if (!b) throw new KontoFehler('Benutzer nicht gefunden.', 404);
    if (!(b.guthaben > 0)) throw new KontoFehler('Kein Guthaben vorhanden.', 409);
    const letzte = db.prepare('SELECT * FROM zahlungen WHERE benutzer_id = ? AND erpnext_rechnung IS NOT NULL ORDER BY id DESC LIMIT 1').get(b.id);
    const netto = runde(b.guthaben);
    db.prepare('UPDATE benutzer SET guthaben = 0 WHERE id = ?').run(b.id);
    const id = erfasseGutschrift({
      zahlung: letzte, benutzerId: b.id, anbieter: 'guthaben', externId: `guthaben:${crypto.randomUUID()}`,
      grund: String(grund ?? '').trim().slice(0, 300) || 'Auszahlung Guthaben aus Abowechsel', bruttoBetrag: brutto(netto), netto, steuersatz: z().steuersatz,
    });
    benachrichtigungen.sende(b.id, {
      art: 'boerse', titel: `Dein Guthaben von ${brutto(netto).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })} wird ausgezahlt`,
      text: 'Die Gutschrift findest du unter „Abos & Rechnungen“.', link: '#/boerse/haendler',
    });
    return db.prepare('SELECT * FROM gutschriften WHERE id = ?').get(id);
  }

  /** Kündigung zum Ende des bezahlten Zeitraums (das Paket bleibt bis dahin aktiv). */
  async function kuendige(benutzer, aboId) {
    const abo = q.aboId.get(Number(aboId));
    if (!abo || abo.benutzer_id !== benutzer.id) throw new KontoFehler('Abo nicht gefunden.', 404);
    if (!['aktiv', 'pausiert'].includes(abo.status)) throw new KontoFehler('Dieses Abo ist nicht aktiv.', 409);
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
    stripeAktiv, paypalAktiv, rechnungAktiv, pruefeRechnungen, uebersicht, restwert, beendeAlleAbos, erstatte, zahleGuthabenAus, checkout, kuendige, portal, stripeWebhook, paypalWebhook, paypalBestaetigen,
    /** Nur für Tests und Administration */
    aktiviere, verbuche,
  };
}
