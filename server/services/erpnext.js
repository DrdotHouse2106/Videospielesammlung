// Rechnungen in ERPNext: Für jede erfolgreiche Zahlung (Erstzahlung und jede Verlängerung) wird eine gebuchte
// Ausgangsrechnung angelegt und – falls ein Zahlungskonto eingestellt ist – gleich als bezahlt verbucht.
//
// Voraussetzungen in ERPNext:
//  - ein Benutzer mit API-Schlüssel/-Geheimnis und Rechten für Kunden, Ausgangsrechnungen und Zahlungen
//  - ein Dienstleistungsartikel (Standard-Code „ZOCKDB-ABO“, ohne Lagerhaltung)
//  - optional eine Vorlage für Umsatzsteuer (z. B. „Germany VAT 19%“) und je Zahlungsanbieter ein Konto
//
// Fehler (z. B. ERPNext nicht erreichbar) brechen die Zahlung nicht ab: Die Rechnung wird später erneut versucht.

export class ErpFehler extends Error {}

export function erstelleErpNextDienst(db, { konfiguration, fetchFn = globalThis.fetch }) {
  const k = () => konfiguration.erpnext;
  const aktiv = () => Boolean(k().url && k().schluessel && k().geheimnis && k().firma);

  async function anfrage(methode, pfad, daten) {
    const antwort = await fetchFn(`${k().url}${pfad}`, {
      method: methode,
      headers: {
        Authorization: `token ${k().schluessel}:${k().geheimnis}`,
        Accept: 'application/json',
        ...(daten ? { 'Content-Type': 'application/json' } : {}),
      },
      body: daten ? JSON.stringify(daten) : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
    const text = await antwort.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* keine JSON-Antwort */ }
    if (!antwort.ok) {
      const meldung = json?._server_messages ? (() => { try { return JSON.parse(JSON.parse(json._server_messages)[0]).message; } catch { return null; } })() : null;
      throw new ErpFehler(`ERPNext antwortet mit HTTP ${antwort.status}${meldung || json?.exception ? `: ${String(meldung || json.exception).replace(/<[^>]+>/g, '').slice(0, 300)}` : ''}`);
    }
    return json?.data ?? json;
  }

  const ressource = (doctype, name = '') => `/api/resource/${encodeURIComponent(doctype)}${name ? `/${encodeURIComponent(name)}` : ''}`;

  /** Kunde anhand des Händlers finden oder anlegen; der Name wird am Benutzer gemerkt. */
  async function kunde(benutzer, kennzeichnung) {
    if (benutzer.erpnext_kunde) return benutzer.erpnext_kunde;
    const name = (kennzeichnung?.firma || benutzer.anzeigename || benutzer.benutzername).slice(0, 140);
    const filter = encodeURIComponent(JSON.stringify([['customer_name', '=', name]]));
    const gefunden = await anfrage('GET', `${ressource('Customer')}?filters=${filter}&fields=${encodeURIComponent('["name"]')}&limit_page_length=1`);
    let kundenname = Array.isArray(gefunden) && gefunden[0]?.name;
    if (!kundenname) {
      const neu = await anfrage('POST', ressource('Customer'), {
        customer_name: name,
        customer_type: 'Company',
        email_id: kennzeichnung?.email || undefined,
        tax_id: kennzeichnung?.ustid || undefined,
      });
      kundenname = neu.name;
    }
    db.prepare('UPDATE benutzer SET erpnext_kunde = ? WHERE id = ?').run(kundenname, benutzer.id);
    return kundenname;
  }

  /** Steuerzeilen aus der eingestellten Vorlage übernehmen (über die REST-API werden sie nicht automatisch ergänzt). */
  async function steuerzeilen() {
    if (!k().steuervorlage) return {};
    const vorlage = await anfrage('GET', ressource('Sales Taxes and Charges Template', k().steuervorlage));
    return {
      taxes_and_charges: k().steuervorlage,
      taxes: (vorlage.taxes ?? []).map(({ charge_type: art, account_head: konto, description, rate, included_in_print_rate: inklusive }) => ({
        charge_type: art, account_head: konto, description, rate, included_in_print_rate: inklusive ?? 0,
      })),
    };
  }

  /** Legt Rechnung (und ggf. Zahlung) für einen Eintrag der Tabelle „zahlungen“ an. */
  async function rechnungFuer(zahlungId) {
    if (!aktiv()) return null;
    const z = db.prepare('SELECT * FROM zahlungen WHERE id = ?').get(zahlungId);
    if (!z || z.erpnext_rechnung) return z?.erpnext_rechnung ?? null;
    const benutzer = db.prepare('SELECT * FROM benutzer WHERE id = ?').get(z.benutzer_id);
    if (!benutzer) return null;
    let kennzeichnung = null;
    try { kennzeichnung = JSON.parse(benutzer.haendler_daten || 'null'); } catch { /* ohne Kennzeichnung */ }
    try {
      const kundenname = await kunde(benutzer, kennzeichnung);
      const heute = new Date().toISOString().slice(0, 10);
      const rechnung = await anfrage('POST', ressource('Sales Invoice'), {
        customer: kundenname,
        company: k().firma,
        posting_date: heute,
        set_posting_time: 1,
        due_date: heute,
        currency: 'EUR',
        address_display: kennzeichnung ? [kennzeichnung.firma, kennzeichnung.anschrift].filter(Boolean).join('\n') : undefined,
        remarks: `${z.beschreibung} – bezahlt über ${z.anbieter === 'paypal' ? 'PayPal' : 'Stripe'} (${z.extern_id})`,
        items: [{ item_code: k().artikel, item_name: z.beschreibung.slice(0, 140), description: z.beschreibung, qty: 1, rate: z.netto, uom: 'Nos' }],
        ...(await steuerzeilen()),
        docstatus: 1,
      });
      db.prepare('UPDATE zahlungen SET erpnext_rechnung = ?, erpnext_fehler = NULL, versuche = versuche + 1 WHERE id = ?').run(rechnung.name, z.id);

      // Zahlung gleich verbuchen, wenn ein Konto für den Anbieter eingestellt ist
      const konto = z.anbieter === 'paypal' ? k().kontoPaypal : k().kontoStripe;
      if (konto) {
        const betrag = rechnung.grand_total ?? z.brutto;
        const zahlung = await anfrage('POST', ressource('Payment Entry'), {
          payment_type: 'Receive', company: k().firma, posting_date: heute,
          party_type: 'Customer', party: kundenname,
          paid_to: konto, paid_amount: betrag, received_amount: betrag, source_exchange_rate: 1, target_exchange_rate: 1,
          reference_no: z.extern_id, reference_date: heute,
          references: [{ reference_doctype: 'Sales Invoice', reference_name: rechnung.name, allocated_amount: betrag }],
          docstatus: 1,
        });
        db.prepare('UPDATE zahlungen SET erpnext_zahlung = ? WHERE id = ?').run(zahlung.name, z.id);
      }
      return rechnung.name;
    } catch (e) {
      db.prepare('UPDATE zahlungen SET erpnext_fehler = ?, versuche = versuche + 1 WHERE id = ?').run(String(e.message).slice(0, 500), z.id);
      if (!(e instanceof ErpFehler)) console.warn('[erpnext]', e.message);
      return null;
    }
  }

  /** Noch nicht übertragene Zahlungen erneut versuchen (höchstens 20 Versuche je Zahlung). */
  async function nachholen() {
    if (!aktiv()) return 0;
    let erledigt = 0;
    for (const { id } of db.prepare('SELECT id FROM zahlungen WHERE erpnext_rechnung IS NULL AND versuche < 20 ORDER BY id LIMIT 50').all()) {
      if (await rechnungFuer(id)) erledigt++;
    }
    return erledigt;
  }

  /** Verbindung prüfen (für die Administration). */
  async function teste() {
    if (!aktiv()) throw new ErpFehler('ERPNext ist nicht vollständig eingerichtet (Adresse, API-Schlüssel, Geheimnis, Firma).');
    await anfrage('GET', ressource('Company', k().firma));
    await anfrage('GET', ressource('Item', k().artikel));
    if (k().steuervorlage) await anfrage('GET', ressource('Sales Taxes and Charges Template', k().steuervorlage));
    return { ok: true };
  }

  /** Rechnung als PDF aus ERPNext (Standard-Druckformat). */
  async function pdf(rechnungName) {
    const pfad = `/api/method/frappe.utils.print_format.download_pdf?doctype=${encodeURIComponent('Sales Invoice')}&name=${encodeURIComponent(rechnungName)}&format=Standard&no_letterhead=0`;
    const antwort = await fetchFn(`${k().url}${pfad}`, {
      headers: { Authorization: `token ${k().schluessel}:${k().geheimnis}` }, redirect: 'manual', signal: AbortSignal.timeout(30_000),
    });
    if (!antwort.ok) throw new ErpFehler(`ERPNext antwortet mit HTTP ${antwort.status}`);
    return Buffer.from(await antwort.arrayBuffer());
  }

  return { aktiv, rechnungFuer, nachholen, teste, pdf };
}
