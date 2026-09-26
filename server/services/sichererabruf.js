// HTTPS-Abruf, der die Ziel-IP beim Verbindungsaufbau prüft – Schutz vor SSRF auch bei DNS-Rebinding
// (erst öffentliche, beim eigentlichen Abruf dann interne Adresse). Weiterleitungen werden nicht verfolgt.
import https from 'node:https';
import dns from 'node:dns';

export class ZielGesperrt extends Error {}

/**
 * Liefert eine Response wie fetch(). `istGesperrt(ip)` entscheidet über erlaubte Ziele; die Prüfung passiert in der
 * DNS-Auflösung des Sockets selbst, also für genau die Adresse, zu der verbunden wird.
 */
export function geprueftesHttps(url, { method = 'GET', headers = {}, body, signal, maxBytes = 25 * 1024 * 1024 } = {}, istGesperrt) {
  const ziel = new URL(url);
  if (ziel.protocol !== 'https:') return Promise.reject(new ZielGesperrt('Nur https-Adressen sind erlaubt.'));
  const lookup = (hostname, optionen, rueckruf) => {
    dns.lookup(hostname, { ...optionen, all: true }, (fehler, adressen) => {
      if (fehler) return rueckruf(fehler);
      if (!adressen.length || adressen.some((a) => istGesperrt(a.address))) {
        return rueckruf(new ZielGesperrt('Adressen im lokalen oder internen Netz sind nicht erlaubt.'));
      }
      return optionen?.all ? rueckruf(null, adressen) : rueckruf(null, adressen[0].address, adressen[0].family);
    });
  };
  return new Promise((erfuellt, abgelehnt) => {
    const anfrage = https.request(ziel, { method, headers, lookup, signal }, (antwort) => {
      const teile = [];
      let groesse = 0;
      antwort.on('data', (teil) => {
        groesse += teil.length;
        if (groesse > maxBytes) { antwort.destroy(); abgelehnt(new Error('Die Antwort ist zu groß.')); return; }
        teile.push(teil);
      });
      antwort.on('end', () => {
        const kopf = new Headers();
        for (const [k, v] of Object.entries(antwort.headers)) if (v !== undefined) kopf.set(k, Array.isArray(v) ? v.join(', ') : String(v));
        const status = antwort.statusCode ?? 502;
        erfuellt(new Response([101, 204, 205, 304].includes(status) ? null : Buffer.concat(teile), { status, headers: kopf }));
      });
      antwort.on('error', abgelehnt);
    });
    anfrage.on('error', abgelehnt);
    if (body) anfrage.write(body);
    anfrage.end();
  });
}
