# Mitwirken an der Videospielesammlung

Schön, dass du helfen möchtest! Beiträge jeder Art sind willkommen: Fehlerberichte,
Ideen, Übersetzungen, Dokumentation und Code.

## Fehler melden & Wünsche äußern

- Suche zuerst in den [Issues](../../issues), ob das Thema schon existiert.
- Beschreibe bei Fehlern: Was hast du gemacht? Was hast du erwartet? Was ist passiert?
  Browser, Gerät und Version (steht unter **Mehr → Status**) helfen enorm.
- **Niemals** API-Schlüssel, Passwörter oder deine `.env`-Datei in Issues posten.

## Entwicklungsumgebung

Voraussetzung: Node.js ≥ 22.

```bash
git clone https://github.com/DrdotHouse2106/Videospielesammlung.git
cd Videospielesammlung
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
  routes/          API-Endpunkte (Artikel, Katalog, Statistik, Export)
  services/        IGDB, Barcode, Preise, Konten/2FA, Scans, Cache, Validierung
  middleware/      Anmeldung, CSRF-Schutz
  db.js            SQLite-Schema und Migrationen
shared/            Gemeinsame Konstanten (Zustände, Regionen …) für Server und Client
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

## Pull Requests

1. Forke das Repository und erstelle einen Branch (`git checkout -b feature/mein-feature`).
2. Committe mit aussagekräftigen Nachrichten (gerne auf Deutsch).
3. Öffne einen Pull Request und beschreibe, was sich ändert und warum.
   Bei Änderungen an der Oberfläche helfen Screenshots.

Mit deinem Beitrag erklärst du dich einverstanden, dass er unter der [MIT-Lizenz](LICENSE) veröffentlicht wird.
