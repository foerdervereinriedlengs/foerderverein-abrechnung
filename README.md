# Förderverein Grundschule – Abrechnungs-Manager (v1.3.4)

Plattformunabhängige Abrechnungssoftware für AG- und Kursleiter an Grundschulen mit integrierter Baden-Württemberg-Ferienprüfung, Plausibilitätskontrollen, mobiler Beleg-Erfassung, E-Mail-Einreichung und Kassenwart-AcroForms.

---

## 🎯 Überblick & Frontends

Das System bietet für jeden Einsatzzweck das passende Frontend:

1. **🌐 Universelle Offline-App (PWA) – `apps/pwa/` (NEU & EMPFOHLEN):**
   - **Läuft 100 % lokal ohne Server** im Browser jedes Geräts (iPhone, Android, Windows, Mac, iPad).
   - Ist unter [foerdervereinriedlengs.github.io/foerderverein-abrechnung](https://foerdervereinriedlengs.github.io/foerderverein-abrechnung/) auf GitHub Pages verfügbar und kann als PWA auf dem Smartphone-Homescreen installiert werden.
   - **Kamera-Upload:** Belege direkt mit der Handykamera fotografieren oder als PDF hochladen.
   - **Einreichen per E-Mail:** Die PWA erstellt die PDF lokal und bietet den nativen Teilen-Dialog bzw. eine vorbereitete E-Mail an. Je nach Gerät muss die heruntergeladene PDF noch manuell angehängt werden.
   - **Client-Side & Datenschutz:** Die Abrechnung wird lokal verarbeitet. Daten verlassen das Gerät erst, wenn sie aktiv geteilt oder versendet werden.

2. **💻 Native Windows-Desktop-Anwendung – `apps/windows/`:**
   - Klassisches Windows-Programm auf Basis von CustomTkinter. Kann über PyInstaller als eigenständige `.exe` gepackt werden.

3. **🐍 Lokaler Python-Webserver – `apps/web/`:**
   - NiceGUI-Server für lokale Netzwerke/WLAN mit QR-Code-Freigabe.

---

### Hauptfunktionen
- **Feste Vergütung mit Schutz:** Standard-Stundensatz von **21,00 €/h**, schreibgeschützt. PIN-Bereich (Standard: **`4711`**) für den Vorstand.
- **Auslagenerstattung ohne Kurs:** Ohne Referenz-ID-Eingabefeld; der Überweisungszweck enthält nur den Namen der erstattungsberechtigten Person.
- **BW-Ferien- & Schuljahreslogik:** Dynamische Abrechnungszeiträume nach BW-Sommerferien (2024–2028 offline hinterlegt).
- **Fristen- & Plausibilitätsprüfung:** Harte Sperren bei Einreichungen nach Kassenprüfungsbeginn (Sommerferien) oder Vorjahresterminen; Vorstandsvermerk bei Periodenüberschreitung; 4-Wochen-Belegpuffer; ISO 7064 Modulo-97 IBAN-Validierung.
- **PDF-Engine & AcroForms:** Generiert nach Kassenwart-Standard (`Abrechnung_[KursID]_[Datum]_[Leiter].pdf`) mit 3 Unterschriftenblöcken und digital ausfüllbaren Feldern für Vorstand & Kassenwart sowie eingebetteter `abrechnungsdaten.json`.

---

## 📂 Projektstruktur

```text
foerderverein-abrechnung/
│
├── 📂 apps/
│   ├── 📂 pwa/                      # 🌟 Universelle Offline-Webapp (HTML/JS/PWA, ohne Server!)
│   │   ├── index.html               # Anwendungs-Frontend (Tailwind CSS)
│   │   ├── manifest.json            # PWA-Konfiguration (App-Icon, Standalone)
│   │   ├── sw.js                    # Service Worker für 100% Offline-Betrieb
│   │   ├── icon.svg                 # App-Icon
│   │   └── js/
│   │       ├── core.js              # Ferienlogik, IBAN Modulo-97, Plausibilitäten
│   │       ├── pdf_engine.js        # PDF-Generierung im Browser (pdf-lib) mit AcroForms
│   │       └── app.js               # UI-Controller, Kamera & Mail-Teilen
│   │
│   ├── 📂 windows/                  # Native Desktop-Anwendung (CustomTkinter)
│   │   └── app_windows.py
│   ├── 📂 web/                      # Python Web-Server (NiceGUI / FastAPI)
│   │   └── app_web.py
│   └── 📂 kassenwart/               # [Vorbereitet] Prüf- und Freigabe-App
│
├── 📂 data/                         # Lokale Daten (auf GitHub ignoriert)
│   ├── 📂 cache/                    # Entwürfe & Uploads
│   └── 📂 export/                   # Exportierte PDFs
│
├── 📂 build_tools/                  # PyInstaller Specs & Build-Skripte
│
├── 🚀 Start_Offline_PWA.bat         # 1-Klick-Starter für die serverlose Offline-PWA
├── 🚀 Start_Web_App.bat             # 1-Klick-Starter für den Python-Webserver
├── 🚀 Start_Windows_App.bat         # 1-Klick-Starter für Windows-Desktop
└── README.md
```

---

## 🚀 Schnellstart

### 1. Universelle Offline-App (PWA) starten (Empfohlen):
- Doppelklick auf [`Start_Offline_PWA.bat`](file:///c:/#Coding/Github/foerderverein-abrechnung/Start_Offline_PWA.bat) (oder in VS Code auf den grünen Button *Offline-App (PWA)*).
- Öffnet sich sofort in jedem Browser – **ohne Server, ohne Python, ohne Wartezeit**.
- **Auf Handys:** Öffne die [GitHub-Pages-App](https://foerdervereinriedlengs.github.io/foerderverein-abrechnung/) in Safari/Chrome und installiere sie bei Bedarf über „Zum Home-Bildschirm“ bzw. „App installieren“. Offline-Funktionen sind verfügbar, sobald die benötigten Dateien geladen und zwischengespeichert wurden.

### 2. PDF per E-Mail einreichen:
- Nach dem Klick auf *„Abrechnung prüfen & PDF exportieren“* zuerst die PDF speichern und danach *„E-Mail an Förderverein vorbereiten“* wählen.
- Der Mail-Entwurf enthält Empfänger, Betreff und Nachrichtentext. Die gespeicherte PDF muss anschließend als Anhang hinzugefügt werden.
