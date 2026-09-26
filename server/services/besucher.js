// Besucherstatistik ohne Cookies und ohne gespeicherte IP-Adressen.
//
// - Gezählt werden Aufrufe von HTML-Seiten (öffentliche Seiten und App-Starts), je Tag und Adresse.
// - Eindeutige Besucher: Hash aus IP + Browserkennung + einem täglich neu erzeugten Zufallswert, der nur im
//   Arbeitsspeicher liegt. Nach Mitternacht (oder einem Neustart) ist keine Zuordnung mehr möglich; in der
//   Datenbank landet nur die Anzahl.
// - Suchmaschinen-Bots werden getrennt gezählt (hilfreich für SEO), Verweise nur als Domain gespeichert.
// - Nach 400 Tagen werden die Tageswerte gelöscht.
import crypto from 'node:crypto';

const BOT = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|preview|monitor|curl|wget|python|headless/i;
const heute = () => new Date().toISOString().slice(0, 10);

export function erstelleBesucherDienst(db) {
  const q = {
    seite: db.prepare(`INSERT INTO statistik_seiten (tag, pfad, aufrufe, bots) VALUES (?, ?, ?, ?)
      ON CONFLICT (tag, pfad) DO UPDATE SET aufrufe = aufrufe + excluded.aufrufe, bots = bots + excluded.bots`),
    tag: db.prepare(`INSERT INTO statistik_tage (tag, besucher) VALUES (?, ?)
      ON CONFLICT (tag) DO UPDATE SET besucher = MAX(besucher, excluded.besucher)`),
    verweis: db.prepare(`INSERT INTO statistik_verweise (tag, domain, aufrufe) VALUES (?, ?, ?)
      ON CONFLICT (tag, domain) DO UPDATE SET aufrufe = aufrufe + excluded.aufrufe`),
    suche: db.prepare(`INSERT INTO statistik_suchen (tag, begriff, anzahl, treffer) VALUES (?, ?, ?, ?)
      ON CONFLICT (tag, begriff) DO UPDATE SET anzahl = anzahl + excluded.anzahl, treffer = excluded.treffer`),
    aufraeumen: ['statistik_seiten', 'statistik_tage', 'statistik_verweise', 'statistik_suchen']
      .map((t) => db.prepare(`DELETE FROM ${t} WHERE tag < date('now', '-400 days')`)),
  };

  let puffer = { seiten: new Map(), verweise: new Map(), suchen: new Map() };
  let salzTag = null;
  let salz = null;
  const besucherHeute = new Set();

  function eindeutig(ip, ua) {
    const tag = heute();
    if (salzTag !== tag) {
      salzTag = tag;
      salz = crypto.randomBytes(16);
      besucherHeute.clear();
    }
    besucherHeute.add(crypto.createHash('sha256').update(salz).update(`${ip}|${ua}`).digest('base64').slice(0, 16));
  }

  const erhoehe = (map, schluessel, feld = 'n', um = 1) => {
    const e = map.get(schluessel) ?? {};
    e[feld] = (e[feld] ?? 0) + um;
    map.set(schluessel, e);
    return e;
  };

  /** Seitenaufruf erfassen (nur HTML-Seiten). */
  function erfasse({ pfad, ip, ua = '', referer = '', host = '' }) {
    const tag = heute();
    const bot = BOT.test(ua);
    erhoehe(puffer.seiten, `${tag}|${String(pfad).slice(0, 200)}`, bot ? 'bots' : 'aufrufe');
    if (bot) return;
    eindeutig(ip, ua);
    try {
      const domain = referer ? new URL(referer).hostname.replace(/^www\./, '') : '';
      if (domain && domain !== host.replace(/:\d+$/, '').replace(/^www\./, '')) erhoehe(puffer.verweise, `${tag}|${domain.slice(0, 100)}`);
    } catch { /* ungültiger Referer */ }
  }

  /** Suchbegriff der öffentlichen Suche (anonym) – zeigt, was Besucher suchen und nicht finden. */
  function erfasseSuche(begriff, treffer) {
    const b = String(begriff ?? '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60);
    if (b.length < 2) return;
    const e = erhoehe(puffer.suchen, `${heute()}|${b}`);
    e.treffer = treffer;
  }

  /** Puffer in die Datenbank schreiben (minütlich und vor jeder Auswertung). */
  function schreibe() {
    const p = puffer;
    puffer = { seiten: new Map(), verweise: new Map(), suchen: new Map() };
    db.transaction(() => {
      for (const [k, e] of p.seiten) { const [tag, pfad] = k.split('|'); q.seite.run(tag, pfad, e.aufrufe ?? 0, e.bots ?? 0); }
      for (const [k, e] of p.verweise) { const [tag, domain] = k.split('|'); q.verweis.run(tag, domain, e.n); }
      for (const [k, e] of p.suchen) { const i = k.indexOf('|'); q.suche.run(k.slice(0, i), k.slice(i + 1), e.n, e.treffer ?? 0); }
      if (salzTag) q.tag.run(salzTag, besucherHeute.size);
    })();
  }
  const timer = setInterval(() => { try { schreibe(); } catch (e) { console.warn('[besucher]', e.message); } }, 60_000);
  timer.unref();

  /** Middleware: HTML-Antworten (GET, Status 200) zählen. */
  function middleware(req, res, next) {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/assets')) return next();
    res.on('finish', () => {
      if (res.statusCode !== 200 || !String(res.getHeader('content-type') ?? '').includes('text/html')) return;
      const pfad = req.path === '/' && (req.query.app !== undefined || /(^|;\s*)vss_sitzung=/.test(req.headers.cookie ?? '')) ? '/ (App)'
        : req.path.startsWith('/sammlung/') ? '/sammlung/…' : req.path;
      erfasse({ pfad, ip: req.ip, ua: req.headers['user-agent'] ?? '', referer: req.headers.referer ?? '', host: req.headers.host ?? '' });
    });
    next();
  }

  /** Auswertung für die Administration. */
  function auswertung(tage = 30) {
    schreibe();
    q.aufraeumen.forEach((s) => s.run());
    const ab = `-${Math.max(1, Math.min(400, tage)) - 1} days`;
    const verlauf = db.prepare(`
      WITH RECURSIVE t(tag) AS (SELECT date('now', @ab) UNION ALL SELECT date(tag, '+1 day') FROM t WHERE tag < date('now'))
      SELECT t.tag,
        COALESCE((SELECT SUM(aufrufe) FROM statistik_seiten s WHERE s.tag = t.tag), 0) AS aufrufe,
        COALESCE((SELECT SUM(bots) FROM statistik_seiten s WHERE s.tag = t.tag), 0) AS bots,
        COALESCE((SELECT besucher FROM statistik_tage d WHERE d.tag = t.tag), 0) AS besucher,
        (SELECT COUNT(*) FROM benutzer b WHERE date(b.erstellt_am) = t.tag) AS registrierungen
      FROM t ORDER BY t.tag`).all({ ab });
    const oben = (sql) => db.prepare(sql).all({ ab });
    return {
      verlauf,
      summe: verlauf.reduce((s, t) => ({ aufrufe: s.aufrufe + t.aufrufe, besucher: s.besucher + t.besucher, bots: s.bots + t.bots, registrierungen: s.registrierungen + t.registrierungen }),
        { aufrufe: 0, besucher: 0, bots: 0, registrierungen: 0 }),
      seiten: oben(`SELECT pfad, SUM(aufrufe) AS aufrufe, SUM(bots) AS bots FROM statistik_seiten WHERE tag >= date('now', @ab)
        GROUP BY pfad ORDER BY aufrufe DESC LIMIT 25`),
      verweise: oben(`SELECT domain, SUM(aufrufe) AS aufrufe FROM statistik_verweise WHERE tag >= date('now', @ab)
        GROUP BY domain ORDER BY aufrufe DESC LIMIT 15`),
      suchen: oben(`SELECT begriff, SUM(anzahl) AS anzahl, MIN(treffer) AS treffer FROM statistik_suchen WHERE tag >= date('now', @ab)
        GROUP BY begriff ORDER BY anzahl DESC LIMIT 25`),
    };
  }

  return { middleware, erfasse, erfasseSuche, schreibe, auswertung };
}
