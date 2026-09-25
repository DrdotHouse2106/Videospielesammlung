# Sicherheitsrichtlinie

**Sicherheit hat in diesem Projekt einen sehr hohen Stellenwert.** Die Anwendung verwaltet private Sammlungen,
Benutzerkonten und hochgeladene Dateien – deshalb freue ich mich über **jeden Hinweis auf ein Sicherheitsproblem**,
egal wie klein er erscheint.

## Sicherheitslücke melden

Bitte melde Schwachstellen **vertraulich** und **nicht** als öffentliches Issue:

👉 **[Sicherheitslücke vertraulich melden](https://github.com/DrdotHouse2106/Videospielesammlung/security/advisories/new)**
(GitHub „Private vulnerability reporting“)

Hilfreich sind:

- eine kurze Beschreibung der Schwachstelle und ihrer Auswirkungen,
- Schritte zum Nachvollziehen (ggf. mit Beispielanfragen),
- betroffene Version bzw. Commit,
- falls vorhanden: ein Vorschlag zur Behebung.

## Was dich erwartet

- Eine erste Rückmeldung innerhalb weniger Tage.
- Laufende Information über den Stand der Behebung.
- Nach der Veröffentlichung des Fixes nenne ich dich – wenn du möchtest – gern als Entdecker in den Release-Hinweisen.

## Spielregeln

- Teste nur mit eigenen Konten und eigenen Installationen.
- Greife nicht auf fremde Daten zu, verändere oder lösche keine Daten und beeinträchtige den Betrieb nicht (kein DoS, kein Spam).
- Gib Details erst frei, nachdem ein Fix veröffentlicht wurde.

Wer sich an diese Regeln hält, handelt aus meiner Sicht in gutem Glauben – danke für deine Hilfe!

## Unterstützte Versionen

Sicherheitskorrekturen erfolgen für den aktuellen Stand des `main`-Branches. Bitte halte deine Installation aktuell
(`git pull && docker compose up -d --build`).

## Betreiber einer eigenen Installation

Wenn du die Software selbst betreibst, trage auf der Seite **„Sicherheit“** (Administration → Rechtliches) zusätzlich
eine Kontaktadresse für deine Installation ein und passe `client/public/.well-known/security.txt` an.

---

<sub>🇬🇧 Security is taken very seriously. Please report vulnerabilities privately via
[GitHub Security Advisories](https://github.com/DrdotHouse2106/Videospielesammlung/security/advisories/new). Thank you!</sub>
