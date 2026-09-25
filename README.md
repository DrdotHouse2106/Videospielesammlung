# 🎮 Videospielesammlung

**Deine Retro- und Videospielsammlung – selbst gehostet, mobil, auf Deutsch.**

Videospielesammlung ist eine quelloffene Progressive Web App (PWA) zur Verwaltung von
**Spielen, Konsolen und Zubehör** – für dich allein oder als öffentlich gehostete Plattform
mit vielen Benutzerkonten. Sie ist für Sammlerinnen und Sammler im deutschsprachigen
Raum gemacht: PAL-/USK-Regionen, CIB-Status, Sonderfarben, Editionen und Modellrevisionen
lassen sich sauber erfassen – per Titelsuche, **Barcode-Scan mit der Handykamera** oder als
eigener Eintrag für Raritäten, die in keiner Datenbank stehen.

> 🇬🇧 An English version of this document is available in [README.en.md](README.en.md).

<p align="center">
  <img src="docs/bilder/sammlung-mobil.png" alt="Sammlungsansicht auf dem Smartphone" width="200" />
  &nbsp;
  <img src="docs/bilder/wert-mobil.png" alt="Wert der Sammlung" width="200" />
  &nbsp;
  <img src="docs/bilder/scans-mobil.png" alt="Scans und Dokumente zu einem Spiel" width="200" />
  &nbsp;
  <img src="docs/bilder/druck-mobil.png" alt="Cover-Scan in Originalgröße drucken" width="200" />
</p>

<sub>Screenshots der echten App mit Beispieldaten (das Cover „Retro Racer“ ist ein selbst gestaltetes Beispielbild).</sub>

---

## Inhalt

- [Funktionen](#funktionen)
- [Schnellstart mit Docker](#schnellstart-mit-docker)
- [Konfiguration (.env)](#konfiguration-env)
- [Benutzerkonten & Zwei-Faktor-Anmeldung](#benutzerkonten--zwei-faktor-anmeldung)
- [Wert & Marktpreise](#wert--marktpreise)
- [Scans, Handbücher & Cover nachdrucken](#scans-handbücher--cover-nachdrucken)
- [Öffentlich hosten – Checkliste](#öffentlich-hosten--checkliste)
- [IGDB-Zugang einrichten](#igdb-zugang-einrichten)
- [Barcode-Scanner & HTTPS](#barcode-scanner--https)
- [Betrieb im Internet (Reverse-Proxy)](#betrieb-im-internet-reverse-proxy)
- [Installation ohne Docker](#installation-ohne-docker)
- [Datensicherung & Updates](#datensicherung--updates)
- [Datenfelder](#datenfelder)
- [API-Überblick](#api-überblick)
- [Mitwirken](#mitwirken)
- [Lizenz](#lizenz)

---

## Funktionen

- **Benutzerkonten** mit Registrierung, sicherer Passwortspeicherung (scrypt) und
  **Zwei-Faktor-Anmeldung** per Authenticator-App (TOTP) inkl. Wiederherstellungscodes
- **Wert der Sammlung:** Schätzwert je Artikel und gesamt, Gewinn/Verlust gegenüber dem Kaufpreis,
  Marktpreise (optional über PriceCharting) und anonyme Community-Werte („12 Sammler besitzen das“)
- **Öffentliche Sammlungen:** Wer möchte, macht seine Sammlung für alle angemeldeten Benutzer sichtbar –
  Preise, Seriennummern und Notizen bleiben immer privat
- **Scans & Dokumente je Spiel:** hochauflösende Cover-Scans (auch TIFF), Handbücher als PDF, Modul-Labels –
  privat oder mit anderen Benutzern geteilt
- **Cover nachdrucken:** Druckansicht in Originalgröße (anhand der Scan-Auflösung) oder in fester Größe
  (z. B. DVD-Einleger), mit Schnittmarken
- **Drei Artikeltypen:** Spiele, Konsolen/Systeme und Zubehör (Controller, Kabel, Memory Cards …)
- **Varianten:** Farbe/Sonderfarbe (z. B. „Clear Red“, „Atomic Purple“), Edition (z. B. „Zelda 25th Anniversary“),
  Modellnummer/Revision (z. B. „SCPH-1002“, „OLED“) und Seriennummer
- **Barcode-Scanner im Browser** (EAN-13, EAN-8, UPC-A, UPC-E) über die Kamera – ganz ohne App-Store
- **Online-Suche über IGDB** (Twitch-API) für Spiele und Konsolen, inkl. Cover, Erscheinungsjahr und Publisher
- **Eigene Katalogeinträge** für Hardware, Zubehör und seltene deutsche Exoten
- **Lernender Barcode-Cache:** Einmal zugeordnete Barcodes werden beim nächsten Scan sofort erkannt
- **Lokaler Cache** in SQLite – wiederholte Suchen sind blitzschnell und schonen API-Limits
- **Eigene Fotos** pro Artikel (z. B. vom Modul oder der OVP)
- **Filter & Suche** nach Typ, Plattform, Region, Zustand und Vollständigkeit
- **Statistik:** Anzahl, Kaufwert, Verteilung nach Plattform, Region, Zustand
- **Export/Import:** JSON (vollständige Sicherung) und CSV im deutschen Excel-Format
- **PWA:** Installierbar auf Android, iOS und Desktop; zuletzt geladene Daten auch offline sichtbar
- **Hell & dunkel:** folgt automatisch dem Farbschema des Geräts
- **Administration:** Benutzer sperren, Rollen vergeben, 2FA zurücksetzen, Registrierung schließen
- **Komplett auf Deutsch** – Oberfläche, Formulare, Meldungen und Dokumentation

**Technik:** Node.js 22 · Express 5 · SQLite (better-sqlite3) · sharp · React 19 · Vite · Tailwind CSS 4 · html5-qrcode

---

## Schnellstart mit Docker

Voraussetzung: [Docker](https://docs.docker.com/get-docker/) mit Docker Compose.

```bash
git clone https://github.com/DrdotHouse2106/Videospielesammlung.git
cd Videospielesammlung
cp .env.example .env          # Konfiguration anlegen und bei Bedarf anpassen
docker compose up -d --build  # Image bauen und im Hintergrund starten
```

Die App ist anschließend unter **<http://localhost:3000>** erreichbar. **Das erste Konto, das du
registrierst, wird Administrator.**

Nützliche Befehle:

```bash
docker compose logs -f        # Protokoll ansehen
docker compose down           # Anhalten (Daten bleiben erhalten)
git pull && docker compose up -d --build            # Aktualisieren
```

Alle Daten (SQLite-Datenbank und hochgeladene Fotos) liegen im Docker-Volume
`sammlung-daten` und bleiben bei Updates und Neustarts erhalten.

> **Tipp:** Möchtest du die Daten lieber in einem Ordner auf dem Host sehen, ersetze in
> `docker-compose.yml` die Zeile `- sammlung-daten:/app/data` durch `- ./data:/app/data`
> und führe einmalig `mkdir -p data && sudo chown 1000:1000 data` aus.

---

## Konfiguration (.env)

Die gesamte Konfiguration erfolgt über Umgebungsvariablen. Vorlage ist die Datei
[`.env.example`](.env.example) – kopiere sie nach `.env`. **Die `.env`-Datei enthält
Geheimnisse und wird durch `.gitignore` nie ins Repository übernommen.**

| Variable               | Standard                  | Beschreibung |
| ---------------------- | ------------------------- | ------------ |
| `PORT`                 | `3000`                    | Port des Servers (bei Docker: Port auf dem Host) |
| `DATABASE_PATH`        | `data/sammlung.db`        | Pfad zur SQLite-Datenbank (bei Docker fest `/app/data/sammlung.db`) |
| `UPLOAD_DIR`           | `data/uploads`            | Ordner für hochgeladene Fotos (bei Docker fest `/app/data/uploads`) |
| `MAX_UPLOAD_MB`        | `8`                       | Maximale Dateigröße für Artikelfotos |
| `MEDIA_MAX_MB`         | `200`                     | Maximale Dateigröße für Scans und PDF-Handbücher |
| `MEDIA_SHARING`        | `true`                    | Dürfen Scans mit anderen Benutzern geteilt werden? |
| `CACHE_TTL_HOURS`      | `168`                     | Gültigkeit zwischengespeicherter Online-Suchen (Stunden) |
| `TWITCH_CLIENT_ID`     | –                         | Client-ID für IGDB (siehe unten) |
| `TWITCH_CLIENT_SECRET` | –                         | Client-Secret für IGDB |
| `BARCODE_PROVIDERS`    | `opengtindb,upcitemdb`    | Reihenfolge der Barcode-Datenbanken; leer = nur lokal gelernte Barcodes |
| `OPENGTINDB_QUERYID`   | –                         | Zugangsnummer für [opengtindb.org](https://opengtindb.org) (deutsche EAN-Datenbank) |
| `REGISTRATION_OPEN`    | `true`                    | Dürfen sich neue Benutzer selbst registrieren? |
| `REGISTRATIONS_PER_HOUR` | `5`                     | Max. Registrierungen pro IP-Adresse und Stunde |
| `REQUIRE_2FA`          | `false`                   | Zwei-Faktor-Anmeldung für alle Benutzer verpflichtend |
| `SESSION_DAYS`         | `30`                      | Gültigkeit einer Anmeldung in Tagen (verlängert sich bei Nutzung) |
| `COOKIE_SECURE`        | `auto`                    | Sitzungs-Cookie nur über HTTPS (`auto`, `true`, `false`) |
| `APP_SECRET`           | automatisch               | Schlüssel zum Verschlüsseln der 2FA-Geheimnisse; leer = wird erzeugt und in `data/geheimnis.key` gespeichert |
| `PRICECHARTING_TOKEN`  | –                         | API-Token für Marktpreise von [PriceCharting](https://www.pricecharting.com) |
| `USD_EUR_RATE`         | EZB-Tageskurs             | Fester Umrechnungskurs USD → EUR |
| `PRICE_CACHE_HOURS`    | `72`                      | Gültigkeit abgerufener Marktpreise |
| `TRUST_PROXY`          | –                         | Hinter einem Reverse-Proxy `1` setzen (für HTTPS-Cookies und IP-basierte Sperren) |

Ohne IGDB-Zugangsdaten funktioniert die App vollständig – die Online-Suche entfällt dann,
und du legst Artikel als eigene Einträge an.

---

## Benutzerkonten & Zwei-Faktor-Anmeldung

- **Registrierung:** Jeder kann sich selbst ein Konto anlegen (abschaltbar mit `REGISTRATION_OPEN=false`).
  Das **erste** Konto wird Administrator – auch bei geschlossener Registrierung.
- **Passwörter** werden mit scrypt gehasht gespeichert (mindestens 10 Zeichen).
- **Zwei-Faktor-Anmeldung (2FA):** Unter *Mehr → Konto & Sicherheit → 2FA einrichten* den QR-Code mit
  einer Authenticator-App scannen (z. B. Aegis, 2FAS, Google/Microsoft Authenticator, Bitwarden, 1Password).
  Danach werden **10 Wiederherstellungscodes** angezeigt – sicher aufbewahren! Jeder Code funktioniert einmal,
  falls das Handy verloren geht.
- **2FA-Pflicht:** Mit `REQUIRE_2FA=true` müssen alle Benutzer die 2FA einrichten, bevor sie die App nutzen können.
- **Schutzmaßnahmen:** Begrenzung von Fehlversuchen (Anmeldung, 2FA-Codes, Registrierung), HttpOnly-/SameSite-Cookies,
  Prüfung der Herkunft bei ändernden Anfragen (CSRF-Schutz), Content-Security-Policy, verschlüsselt gespeicherte 2FA-Geheimnisse.
- **Administration** (*Mehr → Benutzerverwaltung*): Konten sperren, Admin-Rechte vergeben, Passwort neu setzen,
  2FA zurücksetzen (z. B. wenn jemand Handy und Wiederherstellungscodes verloren hat) und Konten löschen.
- **Passwort vergessen?** Es gibt bewusst keinen E-Mail-Versand. Ein Administrator kann ein neues Passwort setzen.

> **Upgrade von Version 1:** Bestehende Artikel werden beim ersten Registrieren automatisch dem ersten
> (Administrator-)Konto zugeordnet. Die alten Variablen `AUTH_USER`/`AUTH_PASSWORD` entfallen.

---

## Wert & Marktpreise

Die Seite **Wert** zeigt den geschätzten Wert deiner Sammlung, die Summe der Kaufpreise und die
Wertentwicklung. Jeder Artikel bekommt seinen Schätzwert aus der ersten verfügbaren Quelle:

1. **Eigene Schätzung** – Feld „Marktwert“ am Artikel (hat immer Vorrang).
2. **PriceCharting** (optional, `PRICECHARTING_TOKEN`) – Marktpreise passend zu Region (PAL/NTSC/JP) und
   Vollständigkeit (lose, CIB, neu, nur OVP). Die Preise kommen in US-Dollar und werden mit dem Tageskurs
   der Europäischen Zentralbank in Euro umgerechnet. PriceCharting erfordert ein kostenpflichtiges Abo mit API-Zugang.
3. **Community** – Median der Schätzwerte aller Sammler auf deinem Server.

Auf der Detailseite jedes Spiels siehst du außerdem, **wie viele Sammler es besitzen**, wie viele Exemplare es
insgesamt gibt und – ab drei Angaben, damit niemand einzeln zurückverfolgt werden kann – den Median von Kauf- und
Schätzpreisen.

> Hinweis: Es gibt keine kostenlose, offizielle Preisdatenbank für den deutschen Markt. Alle Werte sind Schätzungen
> ohne Gewähr.

---

## Scans, Handbücher & Cover nachdrucken

Auf der Detailseite eines Artikels kannst du unter **Scans & Dokumente** Dateien hochladen:

| Art | Formate |
| --- | --- |
| Cover vorne, Cover hinten, Cover komplett (Inlay), Modul-/Disc-Label | JPG, PNG, WebP, **TIFF** |
| Handbuch/Anleitung, Sonstiges | zusätzlich **PDF** |

- Das **Original bleibt unverändert** gespeichert und kann jederzeit heruntergeladen werden.
  TIFF-Scans werden zusätzlich in eine browsertaugliche JPG-Version in voller Auflösung umgewandelt.
- Die **Scan-Auflösung (dpi)** wird aus der Datei gelesen (oder beim Hochladen angegeben).
- Scans hängen am **Spiel** (Katalogeintrag), nicht an deinem Exemplar: Hast du sie geteilt, sehen alle Besitzer
  dieses Spiels sie ebenfalls.
- **Sichtbarkeit:** *Nur für mich* (Standard) oder *für alle angemeldeten Benutzer* (abschaltbar mit `MEDIA_SHARING=false`).

**Drucken:** Über das Drucker-Symbol öffnet sich die Druckansicht:

- **Originalgröße** – ein mit 600 dpi gescanntes Cover wird exakt so groß gedruckt wie das Original.
- **Feste Größe** – z. B. DVD-Einleger 273 × 183 mm; Seitenverhältnis wahlweise beibehalten.
- **Seitenfüllend**, Papier A4/A3/Letter hoch oder quer, optionale **Schnittmarken**.
- Die Ansicht zeigt die effektive Druckauflösung und warnt, wenn sie unter 200 dpi fällt.
- Im Druckdialog **„Tatsächliche Größe“ bzw. 100 %** wählen, sonst skaliert der Browser.

**Tipp zum Scannen:** Mindestens 600 dpi, Farbmodus 24 Bit, als TIFF oder PNG speichern (verlustfrei).
Für ein DVD-Inlay reicht ein A4-Scanner; größere Einleger in zwei Teilen scannen.

> ⚖️ **Urheberrecht:** Cover, Artwork und Handbücher sind urheberrechtlich geschützt. Private Sicherungskopien
> deiner eigenen Originale sind in Deutschland in engen Grenzen erlaubt (§ 53 UrhG). Das **Teilen** mit anderen
> Benutzern auf einem öffentlichen Server kann darüber hinausgehen – als Betreiber solltest du prüfen, ob du
> `MEDIA_SHARING` aktivierst.

---

## Öffentlich hosten – Checkliste

1. Reverse-Proxy mit **HTTPS** einrichten (siehe unten) und `TRUST_PROXY=1` setzen.
2. Zuerst selbst registrieren → du wirst Administrator.
3. Entscheiden: `REGISTRATION_OPEN` (offen für alle) und `REQUIRE_2FA` (2FA-Pflicht, empfohlen).
4. Optional `APP_SECRET` setzen (`openssl rand -base64 32`) – sonst unbedingt `data/geheimnis.key` mitsichern.
5. `MEDIA_SHARING` bewusst wählen (siehe Urheberrecht oben).
6. **Regelmäßige Backups** des Datenverzeichnisses einrichten.
7. Impressum/Datenschutzerklärung: Bei einem öffentlich erreichbaren Angebot in Deutschland in der Regel Pflicht –
   z. B. als eigene Seite über den Reverse-Proxy bereitstellen.

---

## IGDB-Zugang einrichten

[IGDB](https://www.igdb.com) ist eine umfangreiche, kostenlose Spieldatenbank von Twitch.

1. Melde dich unter <https://dev.twitch.tv/console> mit einem Twitch-Konto an
   (Zwei-Faktor-Authentifizierung muss aktiviert sein).
2. **Anwendungen → Deine Anwendung registrieren**
   - Name: frei wählbar, z. B. `Meine Videospielesammlung`
   - OAuth-Redirect-URL: `http://localhost`
   - Kategorie: `Application Integration`
   - Client-Typ: `Vertraulich`
3. Öffne die Anwendung, kopiere die **Client-ID** und erzeuge ein **neues Geheimnis** (Client-Secret).
4. Trage beide Werte in die `.env` ein und starte neu:

   ```env
   TWITCH_CLIENT_ID=abc123...
   TWITCH_CLIENT_SECRET=xyz789...
   ```

Unter **Mehr → Status** siehst du, ob die Online-Suche aktiv ist.

### Wie funktioniert die Barcode-Suche?

IGDB kennt keine Barcodes. Die App geht deshalb in Stufen vor:

1. **Lokal:** Wurde der Barcode schon einmal einem Artikel zugeordnet, wird er sofort erkannt.
2. **Barcode-Datenbank:** Über [opengtindb.org](https://opengtindb.org) (deutsch, Zugangsnummer nötig)
   bzw. [upcitemdb.com](https://www.upcitemdb.com) (Testzugang, max. 100 Abfragen/Tag) wird der Produktname ermittelt.
3. **IGDB:** Der Produktname wird bereinigt (z. B. „Super Mario Odyssey - [Nintendo Switch] USK 6“ → „Super Mario Odyssey“)
   und bei IGDB gesucht.
4. **Nichts gefunden?** Dann suchst du manuell oder legst einen eigenen Eintrag an – der Barcode wird gespeichert
   und beim nächsten Scan erkannt.

---

## Barcode-Scanner & HTTPS

Browser geben die Kamera **nur über HTTPS** (oder auf `localhost`) frei. Für den Scanner auf dem
Smartphone im Heimnetz brauchst du daher eine HTTPS-Adresse – siehe nächster Abschnitt.
Ohne HTTPS kannst du Barcodes weiterhin manuell eingeben.

---

## Betrieb im Internet (Reverse-Proxy)

Empfohlen ist ein Reverse-Proxy, der automatisch HTTPS-Zertifikate besorgt, z. B. [Caddy](https://caddyserver.com).
Beispiel mit Docker Compose – ergänze die `docker-compose.yml` um:

```yaml
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-daten:/data
```

(und unter `volumes:` zusätzlich `caddy-daten:`) sowie eine Datei `Caddyfile`:

```caddyfile
sammlung.example.de {
    reverse_proxy sammlung:3000
}
```

Setze außerdem in der `.env`:

```env
TRUST_PROXY=1
REQUIRE_2FA=true        # empfohlen für öffentliche Server
```

Für den Zugriff nur im Heimnetz eignen sich auch [Tailscale](https://tailscale.com) (mit `tailscale serve`)
oder ein vorhandener Proxy auf dem NAS (Synology, Unraid, Nginx Proxy Manager).

---

## Installation ohne Docker

Voraussetzung: **Node.js 22** oder neuer.

```bash
git clone https://github.com/DrdotHouse2106/Videospielesammlung.git
cd Videospielesammlung
npm ci
cp .env.example .env
npm run build     # Oberfläche bauen
npm start         # Server starten → http://localhost:3000
```

Für die Entwicklung mit Hot-Reload: `npm run dev` (Oberfläche unter <http://localhost:5173>).

---

## Datensicherung & Updates

**Sicherung über die Oberfläche (je Benutzer):** *Mehr → Datensicherung → JSON-Export*. Die Datei kann jederzeit
wieder importiert werden. Der CSV-Export ist für Excel/LibreOffice gedacht (Semikolon, Dezimalkomma).

**Sicherung der Datenbank (Docker):**

```bash
docker compose exec sammlung node -e "require('better-sqlite3')('/app/data/sammlung.db').backup('/app/data/sicherung.db')"
docker compose cp sammlung:/app/data/sicherung.db ./sicherung.db
```

Hochgeladene Fotos und Scans liegen im Volume unter `/app/data/uploads`. **Sichere immer das komplette
Datenverzeichnis** (`/app/data`) – inklusive `geheimnis.key`, sonst funktionieren eingerichtete
2FA-Zugänge nach einer Wiederherstellung nicht mehr (außer du hast `APP_SECRET` gesetzt).

Ein komplettes Backup des Volumes:

```bash
docker run --rm -v videospielesammlung_sammlung-daten:/daten -v "$PWD":/ziel alpine \
  tar czf /ziel/sammlung-backup.tar.gz -C /daten .
```

**Update auf eine neue Version:**

```bash
git pull
docker compose up -d --build
```

Datenbank-Migrationen laufen beim Start automatisch.

---

## Datenfelder

| Feld              | Werte / Beispiel |
| ----------------- | ---------------- |
| Artikeltyp        | Spiel, Konsole, Zubehör |
| Zustand           | Neu/OVP, Wie neu, Sehr gut, Gut, Akzeptabel, Defekt |
| Vollständigkeit   | CIB (Komplett in OVP), Nur Gerät/Disc/Modul, Nur OVP, Fehlt Anleitung |
| Region            | PAL (DE / USK), PAL (EU), NTSC-U, NTSC-J |
| Farbe             | z. B. Atomic Purple, Clear Red |
| Edition/Variante  | z. B. Zelda 25th Anniversary, Collector's Edition |
| Modellnummer      | z. B. SCPH-1002, NUS-001(EUR), HEG-001 |
| Seriennummer      | frei |
| Barcode           | EAN-8, UPC-A, EAN-13, GTIN-14 |
| Kaufpreis         | in Euro, z. B. `49,99` |
| Kaufdatum         | Datum |
| Marktwert         | eigene Schätzung in Euro (optional) |
| Anzahl            | ganze Zahl ≥ 1 |
| Eigene Notizen    | freier Text |
| Foto              | JPG, PNG, WebP oder GIF |
| Scans/Dokumente   | Cover vorne/hinten/komplett, Handbuch, Label – JPG, PNG, WebP, TIFF, PDF |

---

## API-Überblick

Die Oberfläche nutzt eine JSON-API, die du auch für eigene Skripte verwenden kannst. Alle Endpunkte
außer `/api/health` und `/api/auth/*` erfordern eine Anmeldung (Sitzungs-Cookie).

| Methode | Pfad                              | Beschreibung |
| ------- | --------------------------------- | ------------ |
| GET     | `/api/health`                     | Gesundheitsprüfung (ohne Anmeldung) |
| GET     | `/api/auth/status`                | Anmeldestatus |
| POST    | `/api/auth/registrieren` · `anmelden` · `2fa` · `abmelden` | Registrierung und Anmeldung (ggf. mit zweitem Faktor) |
| GET/PUT/DELETE | `/api/konto`               | Eigenes Konto; 2FA unter `/api/konto/2fa/*` |
| GET     | `/api/status`                     | Konfigurationsstatus |
| GET     | `/api/meta`                       | Wertelisten (Zustände, Regionen …) |
| GET     | `/api/artikel`                    | Sammlung; Filter: `typ`, `q`, `plattform`, `region`, `zustand`, `vollstaendigkeit`, `sortierung` |
| POST    | `/api/artikel`                    | Artikel anlegen |
| GET/PUT/DELETE | `/api/artikel/:id`         | Artikel lesen, ändern, löschen |
| POST/DELETE | `/api/artikel/:id/bild`       | Foto hochladen (Feld `bild`) bzw. entfernen |
| GET     | `/api/katalog/suche?q=&typ=`      | Suche im lokalen Katalog und bei IGDB |
| GET     | `/api/katalog/barcode/:code`      | Barcode auflösen |
| POST    | `/api/katalog`                    | Eigenen Katalogeintrag anlegen |
| GET     | `/api/statistik`                  | Auswertungen |
| GET     | `/api/werte`                      | Wert der eigenen Sammlung |
| POST    | `/api/werte/aktualisieren`        | Marktpreise abrufen (in Etappen) |
| GET     | `/api/katalog/:id/wert`           | Marktpreise & Community-Werte eines Spiels |
| GET     | `/api/katalog/:id/medien`         | Sichtbare Scans eines Spiels |
| POST    | `/api/artikel/:id/medien`         | Scan hochladen (Felder `datei`, `art`, `sichtbarkeit`, `titel`, `dpi`) |
| GET/PUT/DELETE | `/api/medien/:id`          | Scan lesen, ändern, löschen |
| GET     | `/api/dateien/:datei`             | Datei mit Berechtigungsprüfung (`?download=1` für das Original) |
| GET     | `/api/community`                  | Öffentliche Sammlungen |
| GET     | `/api/community/:name`            | Eine öffentliche Sammlung |
| GET/PUT/DELETE | `/api/admin/benutzer/…`    | Benutzerverwaltung (nur Admins) |
| GET     | `/api/export.json` / `export.csv` | Export |
| POST    | `/api/import`                     | JSON-Import |

Fehlermeldungen kommen immer auf Deutsch im Feld `fehler`, bei Validierungsfehlern zusätzlich je Feld in `felder`.

---

## Mitwirken

Beiträge sind herzlich willkommen! Lies dazu bitte die [Beitragsrichtlinien (CONTRIBUTING.md)](CONTRIBUTING.md).
Kurz gesagt: Forken, Branch anlegen, `npm test` und `npm run build` grün halten, Pull Request öffnen.

---

## Lizenz

Veröffentlicht unter der [MIT-Lizenz](LICENSE).

Spieldaten und Coverbilder stammen von [IGDB.com](https://www.igdb.com) und unterliegen deren
Nutzungsbedingungen. Marktpreise optional von [PriceCharting](https://www.pricecharting.com),
Wechselkurse von der [Europäischen Zentralbank](https://www.ecb.europa.eu). Diese App steht in keiner Verbindung zu Nintendo, Sony, Microsoft, Sega
oder anderen genannten Marken.
