// Vorlagen für die rechtlichen Seiten. Sie werden beim ersten Start in die Datenbank
// übernommen und können danach von Administratoren in der App bearbeitet werden.
// Die Texte sind Vorlagen und KEINE Rechtsberatung – bitte vor der Veröffentlichung
// prüfen (lassen) und alle Angaben in [ECKIGEN KLAMMERN] ersetzen.

export const RECHTLICHE_VORLAGEN = [
  {
    slug: 'impressum',
    titel: 'Impressum',
    inhalt: `# Impressum

**Hinweis für Betreiber:** Dies ist eine Vorlage. Bitte alle Angaben in eckigen Klammern ersetzen und prüfen, welche Angaben für dein Angebot nötig sind.

## Angaben gemäß § 5 DDG

[Vorname Nachname]
[Straße Hausnummer]
[PLZ Ort]
[Land]

## Kontakt

E-Mail: [kontakt@example.de]

## Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV

[Vorname Nachname, Anschrift wie oben]

## Hinweis zu Nutzerinhalten

Katalogeinträge, Preis-Meldungen und hochgeladene Dateien stammen teilweise von Nutzern. Rechtswidrige Inhalte können über die Funktion „Melden“ oder per E-Mail gemeldet werden; wir prüfen Meldungen unverzüglich.

## Affiliate-Links

Diese Website enthält Partnerlinks (z. B. zu Amazon und eBay). Beim Kauf über einen solchen Link erhalten wir ggf. eine Provision; für dich ändert sich der Preis nicht. [Als Amazon-Partner verdiene ich an qualifizierten Verkäufen.]
`,
  },
  {
    slug: 'datenschutz',
    titel: 'Datenschutzerklärung',
    inhalt: `# Datenschutzerklärung

**Hinweis für Betreiber:** Dies ist eine Vorlage für den Betrieb dieser Software. Bitte an deine tatsächliche Umgebung (Hosting, Reverse-Proxy, Protokollierung) anpassen und alle Angaben in eckigen Klammern ersetzen.

## 1. Verantwortlicher

[Vorname Nachname]
[Anschrift]
E-Mail: [kontakt@example.de]

## 2. Überblick

Diese Anwendung dient der Verwaltung von Videospiel-, Konsolen- und Zubehörsammlungen. Wir verarbeiten nur die Daten, die für den Betrieb nötig sind. Es gibt **kein Tracking, keine Analyse-Tools und keine Werbe-Cookies**.

## 3. Aufruf der Website und Hosting

Beim Aufruf verarbeitet der Server technisch notwendige Daten (u. a. IP-Adresse, Zeitpunkt, aufgerufene Adresse, Browser-Kennung). Die Anwendung selbst speichert keine Zugriffsprotokolle; IP-Adressen werden nur kurzzeitig im Arbeitsspeicher gehalten, um Missbrauch (z. B. massenhafte Anmeldeversuche) zu begrenzen. [Angaben zum Hoster und ggf. zu Protokollen des Reverse-Proxys ergänzen, z. B. Speicherdauer.]

Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (sicherer und stabiler Betrieb).

## 4. Benutzerkonto

Bei der Registrierung speichern wir Benutzername, optional einen Anzeigenamen sowie dein Passwort ausschließlich als sicheren Hash (scrypt). Nutzt du die Zwei-Faktor-Anmeldung, wird das dazugehörige Geheimnis verschlüsselt gespeichert, Wiederherstellungscodes nur als Hash. Außerdem speichern wir Zeitpunkte der Registrierung, der letzten Anmeldung und der Zustimmung zu den Nutzungsbedingungen.

Hinterlegst du freiwillig eine **E-Mail-Adresse**, nutzen wir sie ausschließlich zur Bestätigung der Adresse, für „Passwort vergessen“, für Sicherheitshinweise zu deinem Konto und – nur wenn du es einschaltest – für Benachrichtigungen. Keine Werbung, keine Weitergabe; andere Benutzer sehen die Adresse nie. Für den Versand nutzen wir den E-Mail-Dienst [Name des E-Mail-Anbieters] als Auftragsverarbeiter.

Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO (Nutzungsvertrag).

## 5. Sammlungsdaten, Kommentare und Uploads

Deine Sammlung (Artikel, Zustand, Kaufpreis, Notizen, Kommentare, Fotos und Scans) ist **privat** und nur für dich sichtbar. Du kannst deine Sammlung freiwillig für andere angemeldete Benutzer freigeben; Kaufpreise, Kaufdaten, Seriennummern, Barcodes und Notizen bleiben auch dann privat. Scans, die du zur Freigabe einreichst, sind nach Prüfung für angemeldete Benutzer sichtbar und mit deinem Benutzernamen gekennzeichnet. Preis-Meldungen werden anderen ohne Namen angezeigt.

Für Statistiken (z. B. „12 Sammler besitzen dieses Spiel“, Median-Preise) werden Daten aller Benutzer zusammengefasst und nur anonym angezeigt, Preise erst ab drei Angaben. Diese anonymen Kennzahlen erscheinen auch auf den öffentlichen, für Suchmaschinen lesbaren Katalogseiten – ohne Rückschluss auf einzelne Benutzer.

Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.

### Tauschbörse

Wenn du ein Angebot einstellst, sehen angemeldete Benutzer deinen Anzeigenamen, die Angaben zum Angebot und – falls angegeben – die ersten zwei Ziffern deiner Postleitzahl. Einträge auf deiner Wunschliste sind privat; andere sehen nur anonyme Summen („12 Sammler suchen das“). Nachrichten zu Angeboten können nur die beiden Beteiligten lesen; deine E-Mail-Adresse wird dabei nicht weitergegeben. Bewertungen nach einem Kontakt sind mit dem Namen des Bewertenden für angemeldete Benutzer sichtbar. Gewerbliche Anbieter veröffentlichen ihre Anbieterkennzeichnung (Name, Anschrift, Kontakt) bei ihren Angeboten. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO. Angebote, Nachrichten und Bewertungen werden mit dem Konto gelöscht; Nachrichten bleiben für den Gesprächspartner ohne Zuordnung zu deinem Konto erhalten.

Markiert ein Anbieter ein Angebot als verkauft, kann er den tatsächlichen Preis und – falls der Kontakt über ZockDB lief – den Käufer angeben. Der Käufer wird dann gebeten, den Kauf zu bestätigen oder den Preis zu korrigieren. Diese Angaben sehen nur die beiden Beteiligten; in Preisentwicklungen und Marktdaten fließt ausschließlich der Preis ohne Namen ein. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (verlässliche Preisangaben für alle Sammler).

Für die Anbieter-Statistik zählen wir Aufrufe von Angebotsseiten, neue Anfragen und Wunschlisten-Treffer als reine Tageszahlen je Angebot. Damit dieselbe Person an einem Tag nur einmal gezählt wird, bilden wir kurzzeitig einen Hashwert mit einem täglich wechselnden Zufallswert, der nur im Arbeitsspeicher liegt; gespeichert werden weder Namen noch IP-Adressen. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse der Anbieter an der Reichweite ihrer Angebote). Die Zahlen bleiben für Langzeitvergleiche gespeichert, solange das Konto besteht, und werden mit dem Konto gelöscht.

### Anonymisierte Marktdaten

Aus der Tauschbörse erstellen wir ein **anonymes Marktarchiv**: je Anzeige Spiel, Plattform, Zustand, Vollständigkeit, Region, Preise (Start, Ende, Spanne), Laufzeit (nur Datum), Ergebnis (z. B. verkauft) sowie die Summe der Aufrufe und Anfragen, außerdem tägliche Summen der Nachfrage (Anzahl Suchender, durchschnittliche Preisvorstellung). Name, Konto, Postleitzahl, Beschreibungstexte, Fotos und Nachrichten sind darin nicht enthalten; nach dem Löschen eines Angebots oder Kontos besteht keine Verbindung mehr zu dir. Wir nutzen diese Daten für Preisentwicklungen und Marktauswertungen und können sie in zusammengefasster Form auch an Dritte weitergeben oder verkaufen (z. B. Marktberichte, Preisindizes). Rechtsgrundlage für die Anonymisierung: Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an Marktauswertungen); anonyme Daten unterliegen danach nicht mehr der DSGVO.

### Zahlungen für Händlerleistungen

Buchen Händler kostenpflichtige Leistungen, erfolgt die Zahlung über **Stripe** (Stripe Payments Europe Ltd., Irland) bzw. **PayPal** (PayPal (Europe) S.à r.l. et Cie, S.C.A., Luxemburg). Zahlungsdaten (z. B. Karten- oder Kontodaten) gibst du direkt beim Zahlungsanbieter ein; wir erhalten nur Angaben zum Abo und zur Zahlung. Für die Rechnungsstellung verarbeiten wir die Anbieterkennzeichnung (Firma, Anschrift, E-Mail, USt-IdNr.) in unserer Buchhaltung [ERPNext – Hosting/Anbieter ergänzen]. Rechtsgrundlagen: Art. 6 Abs. 1 lit. b und c DSGVO (Vertrag, gesetzliche Aufbewahrungspflichten).

### Besucherstatistik

Um zu sehen, welche Seiten genutzt werden, zählen wir Seitenaufrufe **ohne Cookies und ohne Speicherung deiner IP-Adresse**. Zur Unterscheidung von Besuchern innerhalb eines Tages wird aus IP-Adresse und Browserkennung zusammen mit einem täglich neu erzeugten Zufallswert ein Hash gebildet, der nur im Arbeitsspeicher liegt und nicht gespeichert wird; gespeichert werden ausschließlich Summen je Tag (Aufrufe je Seite, Anzahl Besucher, verweisende Domains und anonyme Suchbegriffe der öffentlichen Suche). Rückschlüsse auf einzelne Personen sind nicht möglich. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an einer bedarfsgerechten Gestaltung). Da die Tageswerte keinen Personenbezug haben, bewahren wir sie für Langzeitvergleiche auf.

## 6. Cookies und lokale Speicherung

Wir setzen ausschließlich ein **technisch notwendiges Sitzungs-Cookie** für die Anmeldung. Zusätzlich speichert die App (Service Worker) Seiten und zuletzt geladene Daten auf deinem Gerät, damit sie offline funktioniert; beim Abmelden werden diese Daten gelöscht.

Rechtsgrundlage: § 25 Abs. 2 Nr. 2 TDDDG, Art. 6 Abs. 1 lit. b DSGVO.

## 7. Externe Inhalte und Dienste

- **Spam-Schutz (ALTCHA):** Bei der Registrierung und bei „Passwort vergessen“ löst dein Browser eine kleine Rechenaufgabe. Dabei werden keine Cookies gesetzt und keine Daten an Dritte übertragen.
- **[Nur falls genutzt] Google reCAPTCHA v3:** Nur wenn du im Formular ausdrücklich einwilligst, laden wir reCAPTCHA der Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irland. Dabei werden u. a. IP-Adresse, Browser- und Nutzungsdaten an Google übertragen (auch in die USA; Google ist nach dem EU-US Data Privacy Framework zertifiziert) und Cookies gesetzt, um automatisierte Registrierungen zu erkennen. Rechtsgrundlage ist deine Einwilligung (Art. 6 Abs. 1 lit. a DSGVO, § 25 Abs. 1 TDDDG), die du jederzeit mit Wirkung für die Zukunft widerrufen kannst. Ohne Einwilligung ist eine Registrierung leider nicht möglich – wende dich in diesem Fall an uns. Weitere Informationen: https://policies.google.com/privacy

- **Coverbilder von IGDB:** Coverbilder werden direkt von images.igdb.com (Twitch Interactive, Inc., USA) geladen. Dabei wird deine IP-Adresse an diesen Anbieter übertragen. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (ansprechende Darstellung). [Hinweis auf Data Privacy Framework / Garantien des Anbieters prüfen und ergänzen.]
- **Spiel- und Preisdaten** (IGDB, Barcode-Datenbanken, PriceCharting, eBay, Europäische Zentralbank) werden **vom Server** abgefragt – dabei werden keine personenbezogenen Daten von dir übermittelt.
- **Affiliate-Links (Amazon, eBay u. a.):** Erst wenn du auf einen solchen Link klickst, wirst du zum jeweiligen Anbieter weitergeleitet, der dann eigene Cookies setzen und Daten verarbeiten kann. Es gelten die Datenschutzhinweise des Anbieters.
- **Kamera (Barcode-Scanner):** Das Kamerabild wird ausschließlich lokal in deinem Browser ausgewertet und nicht übertragen.
- **KI-Vorprüfung (falls aktiviert):** Eingereichte Katalogeinträge und Varianten (Titel, Plattform, Jahr, Beschreibung, Modellnummer u. ä.) werden zur Vorprüfung an [Anbieter, z. B. Anthropic PBC / Google / lokal] übermittelt – ohne Benutzernamen oder Kontodaten. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (effiziente Moderation). Mit dem Anbieter besteht ein Auftragsverarbeitungsvertrag. [Bei Übermittlung in Drittländer: Garantien ergänzen. Abschnitt löschen, wenn keine KI genutzt wird.]

## 8. Speicherdauer

Kontodaten und Sammlungsdaten speichern wir, bis du dein Konto löschst. Die Löschung ist jederzeit selbst unter „Konto & Sicherheit“ möglich; dabei werden alle Artikel, Fotos und Scans entfernt. Meldungen von Inhalten bewahren wir auf, solange dies zur Nachweisführung erforderlich ist. [Datensicherungen: Speicherdauer ergänzen.]

## 9. Deine Rechte

Du hast das Recht auf Auskunft (Art. 15 DSGVO – jederzeit selbst unter „Konto → Datenauskunft herunterladen“), Berichtigung (Art. 16), Löschung (Art. 17 – selbst unter „Konto löschen“; Rechnungsdaten bewahren wir wegen gesetzlicher Pflichten ohne Bezug zu deinem Konto auf), Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20 – z. B. über den JSON-Export) und Widerspruch (Art. 21). Außerdem kannst du dich bei einer Datenschutz-Aufsichtsbehörde beschweren, z. B. [zuständige Landesbehörde].

## 10. Sicherheit

Die Übertragung erfolgt verschlüsselt (HTTPS). Hinweise auf Sicherheitslücken nehmen wir gern entgegen – siehe Seite „Sicherheit“.

Stand: [Datum]
`,
  },
  {
    slug: 'nutzungsbedingungen',
    titel: 'Nutzungsbedingungen',
    inhalt: `# Nutzungsbedingungen

**Hinweis für Betreiber:** Dies ist eine Vorlage. Bitte anpassen und prüfen (lassen).

## 1. Leistung

[Name des Angebots] ermöglicht die Verwaltung einer Videospielsammlung. Die Nutzung ist kostenlos. Es besteht kein Anspruch auf ständige Verfügbarkeit.

## 2. Benutzerkonto

Du bist für die Geheimhaltung deiner Zugangsdaten verantwortlich. Wir empfehlen die Zwei-Faktor-Anmeldung.

## 3. Inhalte von Nutzern

Du bist für die Inhalte verantwortlich, die du einstellst (Katalogeinträge, Preis-Meldungen, Fotos, Scans, Dokumente).

Wenn du einen Scan oder ein Dokument **zur Freigabe für andere einreichst**, versicherst du, dass du dazu berechtigt bist und damit keine Rechte Dritter (insbesondere Urheberrechte) verletzt. Cover, Artwork und Handbücher sind in der Regel urheberrechtlich geschützt. Du räumst uns das einfache, unentgeltliche Recht ein, eingereichte Inhalte im Rahmen dieses Dienstes angemeldeten Benutzern anzuzeigen.

Nicht erlaubt sind rechtswidrige, beleidigende oder irreführende Inhalte sowie Spam.

Du kannst Links zu anderen Webseiten vorschlagen, die Cover, Handbücher o. Ä. anbieten. Schlage nur Seiten vor, die diese Inhalte rechtmäßig anbieten (z. B. Hersteller oder offizielle Archive). Für die Inhalte verlinkter Seiten sind deren Betreiber verantwortlich.

## 4. Moderation und Meldungen

Eingereichte Inhalte können vom Moderationsteam geprüft, bearbeitet, abgelehnt oder entfernt werden. Rechtswidrige Inhalte können jederzeit über „Melden“ gemeldet werden; wir prüfen Meldungen zeitnah und entfernen Inhalte, wenn sie rechtswidrig sind.

## 5. Automatisierte Vorprüfung

[Abschnitt löschen, wenn keine KI-Vorprüfung aktiviert ist.] Eingereichte Katalogeinträge und Varianten können automatisiert durch ein KI-System vorgeprüft werden. Bei ausreichender Sicherheit werden sie automatisch freigegeben oder abgelehnt; unklare Fälle prüft das Moderationsteam. Automatische Entscheidungen werden mit Begründung als solche gekennzeichnet. Gegen eine automatische Ablehnung kannst du jederzeit eine Überprüfung durch einen Menschen anfordern. Scans und Dokumente werden nie automatisch freigegeben.

## 6. Preise und Angaben ohne Gewähr

Wert- und Preisangaben (Marktpreise, Community-Werte, Meldungen) sind unverbindliche Schätzungen ohne Gewähr.

## 7. Tauschbörse

In der Tauschbörse können Benutzer Spiele, Konsolen und Zubehör zum Verkauf oder Tausch anbieten und Wunschlisten führen. **Wir sind nicht Vertragspartei.** Kauf, Tausch, Bezahlung und Versand vereinbaren die Beteiligten ausschließlich untereinander; wir wickeln keine Zahlungen ab und übernehmen keine Gewähr für Angebote, Angaben oder die Erfüllung von Verträgen.

- Angebote müssen wahrheitsgemäß sein und den tatsächlichen Zustand beschreiben. Verboten sind insbesondere Raubkopien, Reproduktionen und Nachdrucke ohne klare Kennzeichnung, Flash- und Kopiermodule, gestohlene Ware sowie Angebote ohne Bezug zu Videospielen.
- **Gewerbliche Anbieter** müssen sich als solche kennzeichnen und die gesetzlich vorgeschriebenen Angaben (Anbieterkennzeichnung) hinterlegen. Sie sind für die Einhaltung der Verbraucherrechte (u. a. Widerrufsrecht, Gewährleistung, Preisangaben) selbst verantwortlich. Private Anbieter dürfen nicht gewerblich handeln.
- Nachrichten dienen ausschließlich der Abwicklung von Angeboten. Werbung, Belästigung und das Abwerben auf andere Plattformen zu Betrugszwecken sind untersagt. Bewertungen müssen sich auf einen tatsächlichen Kontakt beziehen und sachlich sein.
- Kostenpflichtige Zusatzleistungen für Händler (Händler-Pakete mit mehr Angeboten, Zusatzpaket API-Anbindung an Shop oder Warenwirtschaft) richten sich ausschließlich an Unternehmer. Sie werden monatlich im Voraus abgerechnet (auf Rechnung zahlbar innerhalb von 7 Tagen – bei Zahlungsverzug kann der Zugang bis zum Zahlungseingang pausiert werden; Stripe: Karte oder SEPA-Lastschrift; PayPal zzgl. Zahlungsgebühr), verlängern sich jeweils um einen Monat und sind jederzeit zum Ende des bezahlten Monats kündbar. Beim Wechsel des Pakets wird der nicht genutzte Teil des laufenden Monats tagesgenau gutgeschrieben und mit der neuen Buchung bzw. den folgenden Rechnungen verrechnet. Die Rechnung wird elektronisch bereitgestellt. Individuelle Anbindungen und größere Kontingente werden gesondert vereinbart. [Preise, Leistungsumfang und ggf. Verfügbarkeit ergänzen.]
- Wir können Angebote, die gegen diese Bedingungen oder geltendes Recht verstoßen, entfernen und Konten sperren. Angebote können über „Melden“ gemeldet werden.
- Aus Angeboten und Wunschlisten entstehen **anonymisierte Marktdaten** (z. B. Preisentwicklungen, Angebots- und Nachfragemengen, Verkaufsquoten) ohne Bezug zu einzelnen Benutzern. Diese dürfen wir unbefristet speichern, auswerten, veröffentlichen und – auch kommerziell – an Dritte weitergeben. Einzelheiten stehen in der Datenschutzerklärung.

## 8. Affiliate-Links

Links unter „Hier zum Kauf verfügbar“ sind Werbung (Partnerlinks). Kaufverträge kommen ausschließlich mit dem jeweiligen Anbieter zustande.

## 9. Kündigung

Du kannst dein Konto jederzeit selbst löschen. Wir können Konten bei Verstößen gegen diese Bedingungen sperren.

## 10. Haftung

Wir haften unbeschränkt bei Vorsatz und grober Fahrlässigkeit sowie nach dem Produkthaftungsgesetz. Im Übrigen haften wir nur bei Verletzung wesentlicher Pflichten, begrenzt auf den vorhersehbaren Schaden.

Stand: [Datum]
`,
  },
  {
    slug: 'sicherheit',
    titel: 'Sicherheit',
    inhalt: `# Sicherheit

Sicherheit hat für dieses Projekt einen sehr hohen Stellenwert. Passwörter werden nur als sicherer Hash gespeichert, die Zwei-Faktor-Anmeldung wird unterstützt, und jede Sammlung ist standardmäßig privat.

## Sicherheitslücke gefunden?

**Wir freuen uns sehr über jeden Hinweis auf ein Sicherheitsproblem!** Bitte melde Schwachstellen vertraulich und nicht öffentlich:

- **Für die Software (Open Source):** über die vertrauliche Meldefunktion auf GitHub: [Sicherheitslücke melden](https://github.com/DrdotHouse2106/ZockDB/security/advisories/new)
- **Für diese Installation:** [E-Mail-Adresse des Betreibers]

Bitte beschreibe, wie sich das Problem nachvollziehen lässt. Wir melden uns so schnell wie möglich, beheben das Problem und nennen dich – wenn du möchtest – gern als Entdecker.

Bitte greife bei der Suche nicht auf fremde Daten zu, verändere oder lösche keine Daten und beeinträchtige den Betrieb nicht.
`,
  },
];
