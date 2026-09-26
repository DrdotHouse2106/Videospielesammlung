// Rechnungen in ERPNext: Für jede erfolgreiche Zahlung (Erstzahlung und jede Verlängerung) wird eine gebuchte
// Ausgangsrechnung mit Leistungszeitraum angelegt und – falls ein Zahlungskonto eingestellt ist – gleich als bezahlt
// verbucht. Bei „Zahlung per Rechnung“ wird sie stattdessen mit Zahlungsziel angelegt und von ERPNext per E-Mail
// verschickt; den Zahlungseingang bucht der Betreiber in ERPNext.
//
// Voraussetzungen in ERPNext:
//  - ein Benutzer mit API-Schlüssel/-Geheimnis und Rechten für Kunden, Ausgangsrechnungen und Zahlungen
//  - ein Dienstleistungsartikel (Standard-Code „ZOCKDB-ABO“, ohne Lagerhaltung)
//  - optional eine Vorlage für Umsatzsteuer (z. B. „Germany VAT 19%“) und je Zahlungsanbieter ein Konto
//
// Fehler (z. B. ERPNext nicht erreichbar) brechen die Zahlung nicht ab: Die Rechnung wird später erneut versucht.

export class ErpFehler extends Error {}

const deDatum = (iso) => (iso ? iso.split('-').reverse().join('.') : '');
const betrag = (n) => Number(n).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

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
    const perRechnung = z.anbieter === 'rechnung';
    try {
      const kundenname = await kunde(benutzer, kennzeichnung);
      const heute = new Date().toISOString().slice(0, 10);
      // Leistungszeitraum (§ 14 UStG): in den Feldern „Von/Bis“ der Rechnung und im Positionstext
      const zeitraum = z.zeitraum_von && z.zeitraum_bis ? `Leistungszeitraum: ${deDatum(z.zeitraum_von)} – ${deDatum(z.zeitraum_bis)}` : '';
      const verrechnet = Number(z.verrechnet) > 0 ? Number(z.verrechnet) : 0;
      const verrechnungText = verrechnet ? `Verrechnung Guthaben aus Abowechsel (nicht genutzter Zeitraum): ${betrag(verrechnet)} netto` : '';
      const zahlweg = perRechnung ? (z.brutto > 0 ? `Zahlbar bis ${deDatum(z.faellig_am)} ohne Abzug.` : 'Vollständig mit Guthaben verrechnet – kein Zahlbetrag.')
        : `Bezahlt über ${z.anbieter === 'paypal' ? 'PayPal' : 'Stripe'} (${z.extern_id}).`;
      const rechnung = await anfrage('POST', ressource('Sales Invoice'), {
        customer: kundenname,
        company: k().firma,
        posting_date: heute,
        set_posting_time: 1,
        due_date: perRechnung ? z.faellig_am : heute,
        from_date: z.zeitraum_von || undefined,
        to_date: z.zeitraum_bis || undefined,
        currency: 'EUR',
        address_display: kennzeichnung ? [kennzeichnung.firma, kennzeichnung.anschrift].filter(Boolean).join('\n') : undefined,
        remarks: [z.beschreibung, zeitraum, verrechnungText, zahlweg].filter(Boolean).join('\n'),
        // Verrechnung als ausgewiesener Abzug vom Nettobetrag (vor Steuer)
        ...(verrechnet ? { apply_discount_on: 'Net Total', discount_amount: verrechnet } : {}),
        items: [{
          item_code: k().artikel, item_name: z.beschreibung.slice(0, 140), description: [z.beschreibung, zeitraum].filter(Boolean).join('<br>'),
          qty: 1, rate: z.netto, uom: 'Nos',
        }],
        ...(await steuerzeilen()),
        docstatus: 1,
      });
      db.prepare('UPDATE zahlungen SET erpnext_rechnung = ?, erpnext_fehler = NULL, versuche = versuche + 1 WHERE id = ?').run(rechnung.name, z.id);

      if (perRechnung) {
        await versende(rechnung, z, kennzeichnung?.email || benutzer.email, zeitraum);
        return rechnung.name;
      }

      // Zahlung gleich verbuchen, wenn ein Konto für den Anbieter eingestellt ist
      const konto = z.anbieter === 'paypal' ? k().kontoPaypal : k().kontoStripe;
      if (konto && (rechnung.grand_total ?? z.brutto) > 0) {
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

  /** Rechnung per E-Mail aus ERPNext verschicken (mit PDF im eingestellten Druckformat). */
  async function versende(rechnung, z, empfaenger, zeitraum) {
    if (!empfaenger) throw new ErpFehler('Keine E-Mail-Adresse für den Rechnungsversand hinterlegt.');
    await anfrage('POST', '/api/method/frappe.core.doctype.communication.email.make', {
      doctype: 'Sales Invoice',
      name: rechnung.name,
      recipients: empfaenger,
      subject: `Rechnung ${rechnung.name} – ${z.beschreibung}`,
      content: [
        'Guten Tag,',
        `anbei erhalten Sie die Rechnung ${rechnung.name} über ${betrag(rechnung.grand_total ?? z.brutto)} für ${z.beschreibung}.`,
        zeitraum,
        Number(z.verrechnet) > 0 ? `Darin verrechnet: Guthaben aus Ihrem bisherigen Abo über ${betrag(z.verrechnet)} netto.` : '',
        (rechnung.grand_total ?? z.brutto) > 0
          ? `Bitte überweisen Sie den Betrag bis zum ${deDatum(z.faellig_am)} unter Angabe der Rechnungsnummer.`
          : 'Der Betrag ist vollständig mit Ihrem Guthaben verrechnet – es ist keine Zahlung nötig.',
        'Vielen Dank!',
      ].filter(Boolean).map((zeile) => `<p>${zeile}</p>`).join(''),
      send_email: 1,
      print_format: k().druckformat || 'Standard',
      print_letterhead: 1,
    });
  }

  /** Stand einer Rechnung in ERPNext: bezahlt, offen oder storniert. */
  async function rechnungsStatus(name) {
    const r = await anfrage('GET', ressource('Sales Invoice', name));
    if (r.docstatus === 2 || r.status === 'Cancelled') return 'storniert';
    return Number(r.outstanding_amount ?? 0) <= 0.005 || r.status === 'Paid' ? 'bezahlt' : 'offen';
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

  return { aktiv, rechnungFuer, nachholen, teste, pdf, rechnungsStatus };
}
