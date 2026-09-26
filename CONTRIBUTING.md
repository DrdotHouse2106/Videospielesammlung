# Mitwirken an ZockDB

Schön, dass du helfen möchtest! Beiträge jeder Art sind willkommen: Fehlerberichte,
Ideen, Übersetzungen, Dokumentation und Code.

> **Bitte vor dem ersten Pull Request lesen:** ZockDB ist *source-available* unter der
> PolyForm-Noncommercial-Lizenz. Der Projektinhaber betreibt ZockDB unter
> [zockdb.de](https://zockdb.de) gewerblich (u. a. mit Affiliate-Links und später einem Shop).
> Code-Beiträge können deshalb nur angenommen werden, wenn du der
> [Beitragslizenz](#beitragslizenz) unten zustimmst.

## Sicherheitslücken

**Bitte nicht als öffentliches Issue melden!** Sicherheit ist mir sehr wichtig – nutze die vertrauliche Meldung über
[GitHub Security Advisories](https://github.com/DrdotHouse2106/ZockDB/security/advisories/new).
Details stehen in der [SECURITY.md](SECURITY.md). Danke!

## Fehler melden & Wünsche äußern

- Suche zuerst in den [Issues](../../issues), ob das Thema schon existiert.
- Beschreibe bei Fehlern: Was hast du gemacht? Was hast du erwartet? Was ist passiert?
  Browser, Gerät und Version (steht unter **Mehr → Status**) helfen enorm.
- **Niemals** API-Schlüssel, Passwörter oder deine `.env`-Datei in Issues posten.

## Entwicklungsumgebung

Voraussetzung: Node.js ≥ 22.

```bash
git clone https://github.com/DrdotHouse2106/ZockDB.git
cd ZockDB
npm install
cp .env.example .env     # optional: IGDB-Zugangsdaten eintragen
npm run dev              # Server (Port 3000) + Oberfläche mit Hot-Reload (Port 5173)
```

Öffne anschließend <http://localhost:5173>.

| Befehl            | Zweck                                             |
| ----------------- | ------------------------------------------------- |
| `npm run dev`     | Server und Vite-Entwicklungsserver gleichzeitig   |
| `npm test`        | Automatische Tests (Node-Testrunner)              |
| `npm run build`   | Oberfläche für den Produktivbetrieb bauen (`dist/`) |
| `npm start`       | Produktivserver starten (liefert `dist/` aus)     |

## Projektaufbau

```
server/            Express-Backend
  routes/          API-Endpunkte (Artikel, Katalog, Moderation, Admin, Export …)
    seo.js         Server-gerenderte öffentliche Seiten, Sitemap, robots.txt
  services/        IGDB, Barcode, Preise, eBay, KI-Vorprüfung, Konten/2FA, Scans,
                   Speicherkontingent, Einstellungen, Cache, Validierung
  middleware/      Anmeldung, CSRF-Schutz
  affiliate-konfiguration.js  Partner-IDs und freigegebene Domains des Betreibers
  rechtliche-vorlagen.js      Vorlagen für Impressum, Datenschutz, Nutzungsbedingungen
  db.js            SQLite-Schema und Migrationen
shared/            Gemeinsamer Code für Server und Client
  konstanten.js    Zustände, Regionen, Plattformen …
  marke.js         Sichtbarer Name und Untertitel (ZockDB)
  seo.js           Adressen der öffentlichen Seiten
client/            React-Oberfläche (Vite + Tailwind CSS)
  src/seiten/      Einzelne Seiten der App
  src/komponenten/ Wiederverwendbare Bausteine (Scanner, Karten, Layout …)
  public/          PWA-Manifest, Service-Worker, Icons
test/              Tests
```

## Richtlinien für Code

- **Sprache:** Alle Texte in der Oberfläche, Fehlermeldungen und Dokumentation sind auf **Deutsch**.
  Bezeichner im Code sind überwiegend deutsch gehalten – bitte dem bestehenden Stil folgen.
- **Datenbank:** Schemaänderungen immer als **neue** Migration in `server/db.js` anhängen,
  bestehende Migrationen nie verändern.
- **Werte-Listen:** Neue Zustände, Regionen usw. in `shared/konstanten.js` ergänzen.
  Gespeicherte Schlüssel (`value`) niemals umbenennen.
- **Sicherheit:** Jede neue Abfrage auf Benutzerdaten muss nach `benutzer_id` filtern.
  Dateien immer über `/api/dateien` mit Berechtigungsprüfung ausliefern.
- **Geheimnisse:** Keine Schlüssel oder Tokens committen. Neue Einstellungen in
  `.env.example` dokumentieren.
- **Tests:** Neue Funktionen im Backend möglichst mit einem Test in `test/` absichern.
  `npm test` und `npm run build` müssen vor dem Pull Request fehlerfrei durchlaufen.
- **Nicht ändern:** Partner-IDs und Domains in `server/affiliate-konfiguration.js`, den Namen in
  `shared/marke.js` und den Präfix der Schlüsselableitung in `server/services/sicherheit.js`
  (eine Änderung macht gespeicherte 2FA-Geheimnisse und API-Schlüssel unlesbar).
- **Fremder Code:** Nur mit einer verträglichen Lizenz (z. B. MIT, BSD, Apache 2.0, ISC) und mit Quellenangabe.
  Kein Code unter GPL/AGPL oder ohne erkennbare Lizenz, keine urheberrechtlich geschützten Cover, Handbücher
  oder Logos Dritter.

## Pull Requests

1. Forke das Repository und erstelle einen Branch (`git checkout -b feature/mein-feature`).
2. Committe mit aussagekräftigen Nachrichten (gerne auf Deutsch) und **mit Sign-off**:
   `git commit -s -m "…"`. Damit steht unter jedem Commit `Signed-off-by: Name <E-Mail>` –
   so bestätigst du die Beitragslizenz unten.
3. Öffne einen Pull Request und beschreibe, was sich ändert und warum.
   Bei Änderungen an der Oberfläche helfen Screenshots.

**Checkliste vor dem Pull Request**

- [ ] `npm test` und `npm run build` laufen fehlerfrei
- [ ] Texte auf Deutsch, neue Einstellungen in `.env.example` und README dokumentiert
- [ ] Keine Geheimnisse, Partner-IDs oder personenbezogenen Daten im Code
- [ ] Alle Commits mit Sign-off (`git commit -s`)

## Beitragslizenz

Mit dem Einreichen eines Beitrags (Code, Dokumentation, Grafiken, Übersetzungen) und dem Sign-off erklärst du:

1. **Eigene Rechte:** Der Beitrag stammt von dir, oder du bist berechtigt, ihn einzureichen – etwa weil er unter einer
   verträglichen Open-Source-Lizenz steht, die du angibst. Wenn du ihn im Rahmen einer Anstellung erstellt hast,
   hat dein Arbeitgeber zugestimmt.
2. **Veröffentlichung:** Der Beitrag darf als Teil von ZockDB unter der
   [PolyForm Noncommercial License 1.0.0](LICENSE) veröffentlicht werden.
3. **Nutzungsrecht für den Projektinhaber:** Du räumst dem Projektinhaber (GitHub-Konto
   [DrdotHouse2106](https://github.com/DrdotHouse2106)) ein **einfaches, zeitlich und räumlich unbeschränktes,
   unwiderrufliches und unentgeltliches** Recht ein, den Beitrag in jeder Form zu nutzen, zu bearbeiten,
   zu vervielfältigen, öffentlich zugänglich zu machen und unterzulizenzieren – **auch kommerziell**, insbesondere für
   den Betrieb von ZockDB unter zockdb.de mit Werbung, Affiliate-Links oder Shop sowie für kommerzielle Lizenzen an Dritte.
4. **Dein Urheberrecht bleibt bestehen:** Du darfst deinen Beitrag weiterhin selbst frei verwenden. Du wirst auf Wunsch
   als Mitwirkender genannt; darüber hinaus besteht kein Anspruch auf Vergütung.

Ohne Zustimmung zu dieser Beitragslizenz kann ein Pull Request leider nicht übernommen werden.
Fehlerberichte, Ideen und Diskussionen in Issues sind davon nicht betroffen.
