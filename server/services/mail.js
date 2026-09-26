// E-Mail-Versand über SMTP (z. B. Postfach deines Hosters, Mailcow, Brevo, Mailjet).
// Wird für „Passwort vergessen“, die Bestätigung der E-Mail-Adresse und Benachrichtigungen genutzt.
import nodemailer from 'nodemailer';
import { MARKE } from '../../shared/marke.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (z) => ESC[z]);

/** Einfache, gut lesbare HTML-Mail mit optionalem Knopf. */
export function mailHtml({ titel, absaetze = [], knopf, fuss }) {
  return `<!doctype html><html lang="de"><body style="margin:0;background:#f6f4fb;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1d1830">
<div style="max-width:560px;margin:0 auto;padding:24px">
<p style="font-size:20px;font-weight:700;margin:0 0 16px">${esc(MARKE.name)}</p>
<div style="background:#fff;border:1px solid #e2ddef;border-radius:16px;padding:24px">
<h1 style="font-size:20px;margin:0 0 12px">${esc(titel)}</h1>
${absaetze.map((a) => `<p style="line-height:1.55;margin:0 0 12px">${esc(a)}</p>`).join('')}
${knopf ? `<p style="margin:20px 0"><a href="${esc(knopf.url)}" style="background:#7c3aed;color:#fff;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:600;display:inline-block">${esc(knopf.text)}</a></p>
<p style="font-size:13px;color:#5f5873;word-break:break-all">Falls der Knopf nicht funktioniert: ${esc(knopf.url)}</p>` : ''}
</div>
<p style="font-size:12px;color:#5f5873;margin-top:16px">${esc(fuss ?? `Diese E-Mail wurde automatisch von ${MARKE.name} versendet.`)}</p>
</div></body></html>`;
}

export function erstelleMailDienst(konfiguration, { transportFn } = {}) {
  const m = konfiguration ?? {};
  const aktiv = Boolean(transportFn || (m.host && m.absender));
  let transport = null;
  if (!transportFn && aktiv) {
    const port = m.port || 587;
    transport = nodemailer.createTransport({
      host: m.host,
      port,
      secure: m.sicher === 'true' || (m.sicher !== 'false' && port === 465),
      auth: m.benutzer ? { user: m.benutzer, pass: m.passwort } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
  }

  /** Sendet eine E-Mail. `text` ist Pflicht, `html` optional. */
  async function sende({ an, betreff, text, html }) {
    if (!aktiv) throw new Error('Der E-Mail-Versand ist nicht eingerichtet (SMTP_HOST/SMTP_FROM).');
    const nachricht = { from: m.absender || `${MARKE.name} <noreply@localhost>`, to: an, subject: betreff, text, html };
    if (transportFn) return transportFn(nachricht);
    return transport.sendMail(nachricht);
  }

  return { aktiv, sende };
}
