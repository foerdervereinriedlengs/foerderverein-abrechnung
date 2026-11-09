/**
 * app.js - UI-Controller & State-Management der PWA
 * Unterstützt 2 Modi:
 *  1. 'kurs': Abrechnung Kursleitung / AG (Honorar + Materialauslagen)
 *  2. 'besorgung': Reine Auslagenerstattung (Schuljahr-Abrechnung ohne Honorar)
 * Lokale Speicherung in localStorage, reaktive Live-Übersicht,
 * Kamera-Upload und native Teilen- / Mail-Funktion.
 */

// Globaler Zustand
const AppState = {
  modus: "kurs", // "kurs" oder "besorgung"
  stamm: {
    leiter: "",
    anschrift: "",
    telefon: "",
    iban: "",
    satz: "21.00"
  },
  kurs: {
    id: "",
    titel: "",
    ag: "",
    datum: "",
    dauer: "2.0",
    ist_mehrtaegig: false,
    termine_anzahl: "1",
    end_datum: "",
    notizen: ""
  },
  besorgung: {
    id: "",
    anlass: "",
    zweck: "",
    datum: "",
    notizen: ""
  },
  belege: [],
  settings: {
    stundensatz: DEFAULT_STUNDENSATZ,
    admin_pin: DEFAULT_ADMIN_PIN
  },
  unterschrift: null, // DataURL string oder null
  aktuelleDatei: null // { name, type, data (Uint8Array) }
};

// --- INDEXEDDB: DAUERHAFTE DATEI-SPEICHERUNG FÜR BELEGE (PDFs & FOTOS) ---
const IDB_NAME = 'fv_abrechnung_belege_db';
const IDB_VERSION = 1;
const IDB_STORE = 'beleg_dateien';

function getIndexedDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB ist in diesem Browser nicht verfügbar."));
      return;
    }
    const req = window.indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      reject(req.error || new Error("IndexedDB konnte nicht geöffnet werden."));
    };
  });
}

async function speichereBelegDateiInDB(id, fileObj) {
  if (!id || !fileObj || !fileObj.data) return;
  try {
    const db = await getIndexedDB();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put({
      id: id,
      name: fileObj.name,
      type: fileObj.type,
      data: fileObj.data
    });
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("IndexedDB konnte den Beleg nicht speichern."));
      tx.onabort = () => reject(tx.error || new Error("Speichern des Belegs wurde abgebrochen."));
    });
  } catch (err) {
    console.warn("Konnte Belegdatei nicht in IndexedDB speichern:", err);
    throw err;
  }
}

async function ladeBelegDateiAusDB(id) {
  if (!id) return null;
  try {
    const db = await getIndexedDB();
    if (!db) return null;
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(id);
    const res = await new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    return res ? { name: res.name, type: res.type, data: res.data } : null;
  } catch (err) {
    console.warn("Konnte Belegdatei nicht aus IndexedDB laden:", err);
    return null;
  }
}

async function loescheBelegDateiAusDB(id) {
  if (!id) return;
  try {
    const db = await getIndexedDB();
    if (!db) return;
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(id);
    await new Promise((resolve) => { tx.oncomplete = resolve; tx.onerror = resolve; });
  } catch (err) {
    console.warn("Konnte Belegdatei nicht aus IndexedDB löschen:", err);
  }
}

async function leereAlleBelegDateienInDB() {
  try {
    const db = await getIndexedDB();
    if (!db) return;
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).clear();
    await new Promise((resolve) => { tx.oncomplete = resolve; tx.onerror = resolve; });
  } catch (err) {
    console.warn("Konnte IndexedDB nicht leeren:", err);
  }
}

// Initialisierung beim Laden
document.addEventListener('DOMContentLoaded', async () => {
  await ladeLokaleDaten();
  initEventListeners();
  renderUI();
  updateLiveUebersicht();
  registriereServiceWorker();
});

// PWA Service Worker registrieren
function registriereServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn("SW Registrierung:", err);
    });
  }
}

// Lokale Daten aus localStorage & IndexedDB laden
async function ladeLokaleDaten() {
  try {
    const sModus = localStorage.getItem('fv_modus');
    if (sModus === 'besorgung' || sModus === 'kurs') {
      AppState.modus = sModus;
    }

    const sSettings = localStorage.getItem('fv_settings');
    if (sSettings) {
      AppState.settings = Object.assign(AppState.settings, JSON.parse(sSettings));
    }

    const sStamm = localStorage.getItem('fv_stammdaten');
    if (sStamm) {
      AppState.stamm = Object.assign(AppState.stamm, JSON.parse(sStamm));
    }
    AppState.stamm.satz = parseFloat(AppState.settings.stundensatz || DEFAULT_STUNDENSATZ).toFixed(2);

    const sKurs = localStorage.getItem('fv_aktueller_kurs');
    if (sKurs) {
      AppState.kurs = Object.assign(AppState.kurs, JSON.parse(sKurs));
    }

    const sBesorgung = localStorage.getItem('fv_aktuelle_besorgung');
    if (sBesorgung) {
      AppState.besorgung = Object.assign(AppState.besorgung, JSON.parse(sBesorgung));
    }

    const sBelege = localStorage.getItem('fv_belege');
    if (sBelege) {
      AppState.belege = JSON.parse(sBelege) || [];
      // Dateien asynchron aus IndexedDB laden
      for (const b of AppState.belege) {
        if (!b.id) {
          b.id = 'bel_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        }
        if (b.dateiName && !b.dateiData) {
          const fileObj = await ladeBelegDateiAusDB(b.id);
          if (fileObj && fileObj.data) {
            b.dateiData = fileObj.data;
            b.dateiType = fileObj.type || b.dateiType;
          }
        }
      }
    }

    const sSig = localStorage.getItem('fv_abrechnung_unterschrift');
    if (sSig) {
      AppState.unterschrift = sSig;
    }
  } catch (e) {
    console.error("Fehler beim Laden von localStorage:", e);
  }
}

// Autosave
function autosave() {
  try {
    localStorage.setItem('fv_modus', AppState.modus);
    localStorage.setItem('fv_settings', JSON.stringify(AppState.settings));
    localStorage.setItem('fv_stammdaten', JSON.stringify(AppState.stamm));
    localStorage.setItem('fv_aktueller_kurs', JSON.stringify(AppState.kurs));
    localStorage.setItem('fv_aktuelle_besorgung', JSON.stringify(AppState.besorgung));

    const belegeMetadaten = AppState.belege.map(b => ({
      id: b.id || ('bel_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
      datum: b.datum,
      zweck: b.zweck,
      betrag: b.betrag,
      dateiName: b.dateiName,
      dateiType: b.dateiType
    }));
    localStorage.setItem('fv_belege', JSON.stringify(belegeMetadaten));
  } catch (e) {
    console.warn("Autosave Quota:", e);
  }
}

// Modus umschalten (Tabs)
function setzeModus(m) {
  AppState.modus = m;
  const tabKurs = document.getElementById('tabModusKurs');
  const tabBesorgung = document.getElementById('tabModusBesorgung');
  const boxKurs = document.getElementById('boxSectionKurs');
  const boxBesorgung = document.getElementById('boxSectionBesorgung');
  const lblPerson = document.getElementById('lblPersonName');
  const sumHonorar = document.getElementById('sumBoxHonorar');

  if (m === 'besorgung') {
    tabBesorgung.className = "py-2.5 px-3 rounded-lg font-bold text-xs md:text-sm flex items-center justify-center gap-1.5 transition border-2 border-teal-700 bg-teal-700 text-white shadow-sm";
    tabKurs.className = "py-2.5 px-3 rounded-lg font-bold text-xs md:text-sm flex items-center justify-center gap-1.5 transition border-2 border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100";
    boxKurs.classList.add('hidden');
    boxBesorgung.classList.remove('hidden');
    lblPerson.textContent = "Name des Antragstellers / Erstatters:";
    sumHonorar.classList.add('hidden');
  } else {
    tabKurs.className = "py-2.5 px-3 rounded-lg font-bold text-xs md:text-sm flex items-center justify-center gap-1.5 transition border-2 border-[#1e3d59] bg-[#1e3d59] text-white shadow-sm";
    tabBesorgung.className = "py-2.5 px-3 rounded-lg font-bold text-xs md:text-sm flex items-center justify-center gap-1.5 transition border-2 border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100";
    boxKurs.classList.remove('hidden');
    boxBesorgung.classList.add('hidden');
    lblPerson.textContent = "Name des Kursleiters / Auftragnehmers:";
    sumHonorar.classList.remove('hidden');
  }

  autosave();
  updateLiveUebersicht();
}

// Formularfelder mit Werten befüllen
function renderUI() {
  // Stammdaten
  document.getElementById('inLeiter').value = AppState.stamm.leiter || "";
  document.getElementById('inAnschrift').value = AppState.stamm.anschrift || "";
  document.getElementById('inTelefon').value = AppState.stamm.telefon || "";
  document.getElementById('inIban').value = AppState.stamm.iban || "";
  document.getElementById('lblStundensatz').textContent = `💰 ${parseFloat(AppState.stamm.satz || 21).toFixed(2)} € / Stunde`;

  // Kursdaten
  document.getElementById('inKursId').value = AppState.kurs.id || "";
  document.getElementById('inKursTitel').value = AppState.kurs.titel || "";
  document.getElementById('inKursAg').value = AppState.kurs.ag || "";
  document.getElementById('checkMehrtaegig').checked = Boolean(AppState.kurs.ist_mehrtaegig);
  toggleMehrtaegigUI(Boolean(AppState.kurs.ist_mehrtaegig));

  document.getElementById('inKursDatum').value = AppState.kurs.datum || "";
  document.getElementById('inTermineAnzahl').value = AppState.kurs.termine_anzahl || "1";
  document.getElementById('inKursEndDatum').value = AppState.kurs.end_datum || "";
  document.getElementById('inKursDauer').value = AppState.kurs.dauer || "2.0";
  document.getElementById('inKursNotizen').value = AppState.kurs.notizen || "";

  // Besorgungsdaten
  document.getElementById('inBesorgungId').value = AppState.besorgung.id || "";
  document.getElementById('inBesorgungAnlass').value = AppState.besorgung.anlass || "";
  document.getElementById('inBesorgungZweck').value = AppState.besorgung.zweck || "";
  document.getElementById('inBesorgungDatum').value = AppState.besorgung.datum || "";
  document.getElementById('inBesorgungNotizen').value = AppState.besorgung.notizen || "";

  // Modus setzen
  setzeModus(AppState.modus || 'kurs');

  renderBelegeListe();
  updateSignatureUI();
}

function toggleMehrtaegigUI(isMehr) {
  const box = document.getElementById('boxMehrtaegig');
  if (isMehr) {
    box.classList.remove('hidden');
  } else {
    box.classList.add('hidden');
  }
}

// Event-Listener verdrahten
function initEventListeners() {
  // Tabs Modus
  document.getElementById('tabModusKurs').addEventListener('click', () => setzeModus('kurs'));
  document.getElementById('tabModusBesorgung').addEventListener('click', () => setzeModus('besorgung'));

  // Stammdaten Input
  ['inLeiter', 'inAnschrift', 'inTelefon', 'inIban'].forEach(id => {
    document.getElementById(id).addEventListener('input', (e) => {
      const prop = id.replace('in', '').toLowerCase();
      AppState.stamm[prop] = e.target.value;
      autosave();
      updateLiveUebersicht();
    });
  });

  // Kursdaten Input
  ['inKursId', 'inKursAg', 'inKursDatum', 'inTermineAnzahl', 'inKursEndDatum', 'inKursDauer', 'inKursNotizen'].forEach(id => {
    document.getElementById(id).addEventListener('input', (e) => {
      let prop = id.replace('inKurs', '').toLowerCase();
      if (id === 'inTermineAnzahl') prop = 'termine_anzahl';
      if (id === 'inKursEndDatum') prop = 'end_datum';
      if (id === 'inKursNotizen') prop = 'notizen';
      AppState.kurs[prop] = e.target.value;
      autosave();
      updateLiveUebersicht();
    });
  });

  // Kurstitel mit Auto-Vorschlag
  document.getElementById('inKursTitel').addEventListener('input', (e) => {
    AppState.kurs.titel = e.target.value;
    if (!AppState.kurs.id && e.target.value.trim().length >= 3) {
      const sugg = generiereKursIdVorschlag(e.target.value, AppState.kurs.datum);
      AppState.kurs.id = sugg;
      document.getElementById('inKursId').value = sugg;
    }
    autosave();
    updateLiveUebersicht();
  });

  // Mehrtägig Checkbox
  document.getElementById('checkMehrtaegig').addEventListener('change', (e) => {
    AppState.kurs.ist_mehrtaegig = e.target.checked;
    toggleMehrtaegigUI(e.target.checked);
    autosave();
    updateLiveUebersicht();
  });

  // ID Neu vorschlagen Button (Kurs)
  document.getElementById('btnSuggestId').addEventListener('click', () => {
    const sugg = generiereKursIdVorschlag(AppState.kurs.titel, AppState.kurs.datum);
    AppState.kurs.id = sugg;
    document.getElementById('inKursId').value = sugg;
    autosave();
    updateLiveUebersicht();
  });

  // Besorgungsdaten Input
  ['inBesorgungId', 'inBesorgungZweck', 'inBesorgungDatum', 'inBesorgungNotizen'].forEach(id => {
    document.getElementById(id).addEventListener('input', (e) => {
      const prop = id.replace('inBesorgung', '').toLowerCase();
      AppState.besorgung[prop] = e.target.value;
      autosave();
      updateLiveUebersicht();
    });
  });

  // Anlass mit Auto-Vorschlag für Besorgungs-ID
  document.getElementById('inBesorgungAnlass').addEventListener('input', (e) => {
    AppState.besorgung.anlass = e.target.value;
    if (!AppState.besorgung.id && e.target.value.trim().length >= 3) {
      const sugg = generiereBesorgungIdVorschlag(e.target.value, AppState.besorgung.datum);
      AppState.besorgung.id = sugg;
      document.getElementById('inBesorgungId').value = sugg;
    }
    autosave();
    updateLiveUebersicht();
  });

  // ID Neu vorschlagen Button (Besorgung)
  document.getElementById('btnSuggestBesorgungId').addEventListener('click', () => {
    const sugg = generiereBesorgungIdVorschlag(AppState.besorgung.anlass, AppState.besorgung.datum);
    AppState.besorgung.id = sugg;
    document.getElementById('inBesorgungId').value = sugg;
    autosave();
    updateLiveUebersicht();
  });

  // Zahnrad / Admin-PIN Dialog
  document.getElementById('btnAdminSettings').addEventListener('click', oeffneAdminPinModal);

  // Beleg Dateiupload / Kamera
  const fileInput = document.getElementById('inBelegDatei');
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const lbl = document.getElementById('lblGewaehlteDatei');
    lbl.textContent = `⏳ Verarbeite ${file.name}...`;

    try {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const arrayBuffer = await file.arrayBuffer();
        AppState.aktuelleDatei = {
          name: file.name,
          type: 'application/pdf',
          data: new Uint8Array(arrayBuffer)
        };
      } else {
        // Foto / Bild (JPG, PNG, WebP, HEIC, etc.):
        // Über HTML5 Canvas in ein standardisiertes, kompaktes JPEG wandeln
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = dataUrl;
        });

        // Auf maximal 1600px skalieren (ideal für Dokumente & Lesbarkeit, verhindert 15MB Riesen-Uploads)
        const maxDim = 1600;
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        const jpegBlob = await new Promise((resolve, reject) => {
          canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Bild konnte nicht konvertiert werden.")), 'image/jpeg', 0.88);
        });
        const jpegBuf = await jpegBlob.arrayBuffer();

        const cleanName = file.name.replace(/\.[^/.]+$/, "") + ".jpg";
        AppState.aktuelleDatei = {
          name: cleanName,
          type: 'image/jpeg',
          data: new Uint8Array(jpegBuf)
        };
      }

      lbl.textContent = `📎 Bereit: ${AppState.aktuelleDatei.name}`;
      lbl.classList.add('text-teal-700', 'font-medium');
    } catch (err) {
      console.error("Fehler bei Belegverarbeitung:", err);
      AppState.aktuelleDatei = null;
      fileInput.value = "";
      lbl.textContent = "Datei konnte nicht verarbeitet werden";
      lbl.classList.remove('text-teal-700', 'font-medium');
      alert("Der Beleg konnte nicht verarbeitet werden. Bitte eine lesbare JPG-, PNG- oder PDF-Datei verwenden.");
    }
  });

  // Beleg Hinzufügen Button
  document.getElementById('btnAddBeleg').addEventListener('click', addBeleg);

  // Neuer Vorgang Button
  document.getElementById('btnNeuerKurs').addEventListener('click', async () => {
    const promptText = (AppState.modus === 'besorgung')
      ? "Möchtest du wirklich eine neue Besorgung / Veranstaltung erfassen?\n\n• Anlass- und Belegdaten werden geleert.\n• Personendaten (Name, IBAN) bleiben erhalten."
      : "Möchtest du wirklich einen neuen Kurs abrechnen?\n\n• Kursdaten und Belege werden geleert.\n• Personendaten (Name, IBAN, Stundensatz) bleiben erhalten.";

    if (confirm(promptText)) {
      if (AppState.modus === 'besorgung') {
        AppState.besorgung = { id: "", anlass: "", zweck: "", datum: "", notizen: "" };
      } else {
        AppState.kurs = { id: "", titel: "", ag: "", datum: "", dauer: "2.0", ist_mehrtaegig: false, termine_anzahl: "1", end_datum: "", notizen: "" };
      }
      await leereAlleBelegDateienInDB();
      AppState.belege = [];
      autosave();
      renderUI();
      updateLiveUebersicht();
    }
  });

  // PDF Export & Senden
  document.getElementById('btnExportPdf').addEventListener('click', starteExportProzess);

  // Digitale Unterschrift
  document.getElementById('btnOpenSignature').addEventListener('click', oeffneUnterschriftsModal);
  document.getElementById('btnSigClear').addEventListener('click', leereUnterschriftCanvas);
  document.getElementById('btnSigUebernehmen').addEventListener('click', uebernehmeUnterschrift);
  document.getElementById('btnSigOhne').addEventListener('click', () => {
    schliesseUnterschriftsModal();
    fahreMitPdfExportFort(false);
  });
}

// Beleg hinzufügen
async function addBeleg() {
  const dStr = document.getElementById('inBelegDatum').value.trim();
  const zweck = document.getElementById('inBelegZweck').value.trim();
  const bStr = document.getElementById('inBelegBetrag').value.trim();

  const dParsed = parseGermanDate(dStr);
  if (!dParsed) {
    alert("Bitte ein gültiges Belegdatum angeben (z. B. 15.10.2026).");
    return;
  }
  if (!zweck) {
    alert("Bitte einen Händler oder Verwendungszweck angeben.");
    return;
  }
  const betrag = parseFloat(bStr.replace(',', '.'));
  if (!Number.isFinite(betrag) || betrag <= 0 || !/^\d+(?:[.,]\d{1,2})?$/.test(bStr)) {
    alert("Bitte einen gültigen Rechnungsbetrag größer als 0 eingeben.");
    return;
  }

  // Plausibilität je nach Modus
  if (AppState.modus === 'besorgung') {
    const bDate = parseGermanDate(AppState.besorgung.datum);
    const plausi = pruefeBesorgungBelegPlausibilitaet(dParsed, bDate);
    if (!plausi.ok) {
      if (!confirm(`⚠️ Plausibilitätshinweis:\n\n${plausi.msg}\n\nMöchtest du den Beleg trotzdem übernehmen?`)) {
        return;
      }
    }
  } else {
    const kdParsed = parseGermanDate(AppState.kurs.datum);
    const plausi = pruefeBelegPlausibilitaet(dParsed, kdParsed);
    if (!plausi.ok) {
      if (!confirm(`⚠️ Plausibilitätshinweis:\n\n${plausi.msg}\n\nMöchtest du den Beleg trotzdem übernehmen?`)) {
        return;
      }
    } else if (plausi.status === 'vorlauf') {
      if (!confirm(`ℹ️ Vorlauf-Einkauf:\n\n${plausi.msg}\n\nTrotzdem übernehmen?`)) {
        return;
      }
    }
  }

  const belegId = 'bel_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const neuerBeleg = {
    id: belegId,
    datum: formatDateGerman(dParsed),
    zweck: zweck,
    betrag: betrag,
    dateiName: AppState.aktuelleDatei ? AppState.aktuelleDatei.name : null,
    dateiType: AppState.aktuelleDatei ? AppState.aktuelleDatei.type : null,
    dateiData: AppState.aktuelleDatei ? AppState.aktuelleDatei.data : null
  };

  // Dauerhaft in IndexedDB ablegen (überlebt jeden Reload)
  if (AppState.aktuelleDatei) {
    try {
      await speichereBelegDateiInDB(belegId, AppState.aktuelleDatei);
    } catch (err) {
      console.error("Belegdatei konnte nicht dauerhaft gespeichert werden:", err);
      alert("Der Beleganhang konnte nicht dauerhaft gespeichert werden. Bitte Speicherplatz freigeben oder ohne Anhang fortfahren.");
      AppState.aktuelleDatei = null;
      document.getElementById('inBelegDatei').value = "";
      const fileLabel = document.getElementById('lblGewaehlteDatei');
      fileLabel.textContent = "Kein Anhang gewählt";
      fileLabel.classList.remove('text-teal-700', 'font-medium');
      return;
    }
  }

  AppState.belege.push(neuerBeleg);

  // Inputs leeren
  document.getElementById('inBelegDatum').value = "";
  document.getElementById('inBelegZweck').value = "";
  document.getElementById('inBelegBetrag').value = "";
  document.getElementById('inBelegDatei').value = "";
  document.getElementById('lblGewaehlteDatei').textContent = "Kein Anhang gewählt";
  document.getElementById('lblGewaehlteDatei').classList.remove('text-teal-700', 'font-medium');
  AppState.aktuelleDatei = null;

  autosave();
  renderBelegeListe();
  updateLiveUebersicht();
}

// Belegliste rendern
function renderBelegeListe() {
  const container = document.getElementById('belegeContainer');
  container.innerHTML = "";

  if (AppState.belege.length === 0) {
    container.innerHTML = '<p class="text-xs text-slate-400 italic">Noch keine Belege erfasst.</p>';
    return;
  }

  AppState.belege.forEach((b, idx) => {
    const row = document.createElement('div');
    row.className = "flex justify-between items-center p-2.5 bg-slate-100 rounded-lg border border-slate-200 text-xs";
    
    let fileBadge = "";
    if (b.dateiName) {
      if (b.dateiData) {
        fileBadge = `<span class="text-teal-700 ml-1 font-semibold" title="Datei dauerhaft gespeichert">📎 ${b.dateiName.slice(0, 16)}</span>`;
      } else {
        fileBadge = `<span class="text-amber-600 ml-1 font-bold" title="Datei fehlt – bitte neu anhängen">⚠️ ${b.dateiName.slice(0, 14)} (Datei fehlt)</span>`;
      }
    }

    row.innerHTML = `
      <div class="truncate mr-2">
        <span class="font-bold text-slate-800">#${idx + 1}</span>
        <span class="text-slate-500 ml-1">${b.datum}:</span>
        <span class="font-medium text-slate-700 ml-1">${b.zweck}</span>
        <span class="font-bold text-slate-900 ml-1">(${parseFloat(b.betrag).toFixed(2)} €)</span>
        ${fileBadge}
      </div>
      <button type="button" class="bg-red-500 hover:bg-red-600 text-white font-bold py-1 px-2 rounded text-xs transition" onclick="loescheBeleg(${idx})">X</button>
    `;
    container.appendChild(row);
  });
}

window.loescheBeleg = async function(idx) {
  const b = AppState.belege[idx];
  if (b && b.id) {
    await loescheBelegDateiAusDB(b.id);
  }
  AppState.belege.splice(idx, 1);
  autosave();
  renderBelegeListe();
  updateLiveUebersicht();
};

// Live-Übersicht berechnen und aktualisieren
function updateLiveUebersicht() {
  const isBesorgung = (AppState.modus === 'besorgung');
  const summen = isBesorgung
    ? {
        unterrichtDauer: 0,
        vorbereitungDauer: 0,
        dauer: 0,
        satz: 0,
        unterrichtHonorar: 0,
        vorbereitungHonorar: 0,
        honorar: 0,
        auslagen: (AppState.belege || []).reduce((acc, b) => acc + (parseFloat(b.betrag) || 0.0), 0.0),
        gesamt: (AppState.belege || []).reduce((acc, b) => acc + (parseFloat(b.betrag) || 0.0), 0.0)
      }
    : berechneSummen(AppState.kurs.dauer, AppState.stamm.satz, AppState.belege);

  const ibanVal = (AppState.stamm.iban || "").trim();
  const ibanCheck = validiereIBAN(ibanVal);
  const leiter = AppState.stamm.leiter || "Kein Name hinterlegt";

  let titel, kid, terminText, periodeText, warns = [], festerName;

  if (isBesorgung) {
    titel = AppState.besorgung.anlass || "Keine Veranstaltung angegeben";
    kid = AppState.besorgung.id || "Noch keine Referenz";
    const bDateParsed = parseGermanDate(AppState.besorgung.datum);
    terminText = bDateParsed ? formatDateGerman(bDateParsed) : "–";

    if (bDateParsed) {
      const bSj = ermittleSchuljahrDetails(bDateParsed);
      periodeText = `${bSj.label || ('Schuljahr ' + bSj.code)} (Laufendes Schuljahr)`;
      warns = pruefeBesorgungDatumPlausibilitaet(bDateParsed);
    } else {
      periodeText = "Laufendes Schuljahr";
    }

    festerName = generiereDateiname(AppState.besorgung.datum, AppState.besorgung.anlass, leiter, AppState.besorgung.id, "besorgung");
  } else {
    // Modus Kurs
    titel = AppState.kurs.titel || "Kein Kurstitel";
    kid = AppState.kurs.id || "Noch keine Kurs-ID";

    const istM = Boolean(AppState.kurs.ist_mehrtaegig);
    const startD = AppState.kurs.datum || "–";
    const endD = AppState.kurs.end_datum || "";
    const anzT = AppState.kurs.termine_anzahl || "1";
    terminText = (istM && endD) ? `${startD} bis ${endD} (${anzT} Termine)` : startD;

    const pruefDStr = (istM && endD) ? endD : AppState.kurs.datum;
    const kdParsed = parseGermanDate(pruefDStr);

    periodeText = "–";
    if (kdParsed) {
      const z = ermittleAbrechnungszeitraum(kdParsed);
      periodeText = z.name;
      warns = pruefeKursdatumPlausibilitaet(kdParsed);
    }

    festerName = generiereDateiname(AppState.kurs.datum, AppState.kurs.titel, leiter, AppState.kurs.id, "kurs");
  }

  // DOM updaten
  document.getElementById('sumTitel').textContent = titel;
  document.getElementById('sumKursId').textContent = isBesorgung ? `Ref: ${kid}` : `ID: ${kid}`;
  document.getElementById('sumLeiter').textContent = leiter;

  const sumIban = document.getElementById('sumIban');
  if (ibanVal) {
    sumIban.textContent = formatiereIBAN(ibanVal);
    sumIban.className = `font-mono text-[11px] ${ibanCheck.ok ? 'text-emerald-600 font-medium' : 'text-amber-600 font-bold'}`;
  } else {
    sumIban.textContent = "Keine IBAN";
    sumIban.className = "text-[11px] text-red-500 italic";
  }

  document.getElementById('sumTermin').textContent = terminText;
  document.getElementById('sumPeriode').textContent = periodeText;

  // Warnungen Box
  const warnContainer = document.getElementById('sumWarnContainer');
  warnContainer.innerHTML = "";
  if (warns.length > 0) {
    warns.forEach(w => {
      const box = document.createElement('div');
      let colorClass = "bg-sky-50 border-sky-200 text-sky-800";
      let icon = "ℹ️";
      if (w.level === "gesperrt") {
        colorClass = "bg-red-50 border-red-200 text-red-700";
        icon = "⛔";
      } else if (w.level === "vorstand") {
        colorClass = "bg-amber-50 border-amber-200 text-amber-800";
        icon = "⚠️";
      }
      box.className = `p-2 rounded border text-xs flex items-center gap-1.5 ${colorClass}`;
      box.innerHTML = `<span>${icon}</span><span class="font-semibold">${w.titel}</span>`;
      warnContainer.appendChild(box);
    });
  } else if ((isBesorgung && AppState.besorgung.datum) || (!isBesorgung && AppState.kurs.datum)) {
    const textOk = isBesorgung ? "✓ Im laufenden Schuljahr zulässig" : "✓ Im regulären Abrechnungszeitraum";
    warnContainer.innerHTML = `<div class="p-1.5 bg-emerald-50 border border-emerald-200 rounded text-xs flex items-center gap-1 text-emerald-700 font-medium"><span>✓</span> ${textOk}</div>`;
  }

  // Zahlen
  if (!isBesorgung) {
    if (summen.vorbereitungDauer > 0) {
      document.getElementById('sumHonorarDetail').textContent = `${summen.unterrichtDauer.toFixed(2)}h Unterricht + ${summen.vorbereitungDauer.toFixed(2)}h Vorbereitung (${summen.dauer.toFixed(2)} Std. × ${summen.satz.toFixed(2)} €/h)`;
    } else {
      document.getElementById('sumHonorarDetail').textContent = `${summen.dauer.toFixed(2)} Std. × ${summen.satz.toFixed(2)} €/h`;
    }
    document.getElementById('sumHonorarBetrag').textContent = `${summen.honorar.toFixed(2)} €`;
  }

  document.getElementById('sumAuslagenDetail').textContent = `Materialauslagen (${AppState.belege.length} Belege)`;
  document.getElementById('sumAuslagenBetrag').textContent = `${summen.auslagen.toFixed(2)} €`;
  document.getElementById('sumGesamtBetrag').textContent = `${summen.gesamt.toFixed(2)} €`;

  document.getElementById('sumRefZweck').textContent = isBesorgung ? leiter : `${kid} ${leiter}`.trim();
  document.getElementById('sumDateiname').textContent = festerName;
}

// Admin-PIN Modal
function oeffneAdminPinModal() {
  const pin = prompt("🔒 Admin-Bereich (Vorstand)\n\nBitte 4-stellige Admin-PIN eingeben:");
  if (pin === null) return;

  const korrekt = String(AppState.settings.admin_pin || DEFAULT_ADMIN_PIN);
  if (pin.trim() === korrekt) {
    oeffneAdminSettingsModal();
  } else {
    alert("Falsche PIN! Zugriff verweigert.");
  }
}

function oeffneAdminSettingsModal() {
  const aktSatz = parseFloat(AppState.settings.stundensatz || DEFAULT_STUNDENSATZ).toFixed(2);
  const neuerSatzStr = prompt("⚙️ Vereinseinstellungen (Vorstand)\n\nFester Standard-Stundensatz für alle Kursleiter (€/h):", aktSatz);
  if (neuerSatzStr === null) return;

  const neuerSatz = parseFloat(neuerSatzStr.replace(',', '.'));
  if (isNaN(neuerSatz) || neuerSatz <= 0 || neuerSatz > 200) {
    alert("Bitte einen realistischen Stundensatz eingeben (1–200 €).");
    return;
  }

  const neuePin = prompt("Admin-PIN ändern (leer lassen für keine Änderung):", "");
  if (neuePin !== null && neuePin.trim().length >= 4) {
    AppState.settings.admin_pin = neuePin.trim();
  }

  AppState.settings.stundensatz = neuerSatz;
  AppState.stamm.satz = neuerSatz.toFixed(2);
  autosave();
  renderUI();
  updateLiveUebersicht();
  alert(`Erfolgreich gespeichert!\nNeuer Stundensatz: ${neuerSatz.toFixed(2)} €/h`);
}

// PDF-Export & Senden
async function starteExportProzess() {
  const isBesorgung = (AppState.modus === 'besorgung');

  if (!AppState.stamm.leiter.trim()) {
    alert(isBesorgung ? "Bitte den Namen des Antragstellers angeben." : "Bitte den Namen des Kursleiters angeben.");
    return;
  }
  if (!AppState.stamm.anschrift.trim()) {
    alert("Bitte die vollständige Anschrift (Straße, PLZ, Ort) angeben.");
    return;
  }
  const iCheck = validiereIBAN(AppState.stamm.iban);
  if (!iCheck.ok) {
    alert(`IBAN-Fehler:\n${iCheck.err}`);
    return;
  }

  let dateiname = "";

  if (isBesorgung) {
    if (!AppState.besorgung.anlass.trim()) {
      alert("Bitte den Anlass / die Veranstaltung angeben.");
      return;
    }
    if (!AppState.besorgung.zweck.trim()) {
      alert("Bitte den Verwendungszweck der Besorgung angeben.");
      return;
    }
    const bDate = parseGermanDate(AppState.besorgung.datum);
    if (!bDate) {
      alert("Bitte ein gültiges Datum der Veranstaltung / Besorgung angeben.");
      return;
    }
    if (AppState.belege.length === 0) {
      alert("Bitte mindestens einen Beleg bzw. eine Quittung erfassen.");
      return;
    }

    const warns = pruefeBesorgungDatumPlausibilitaet(bDate);
    const gesperrt = warns.find(w => w.level === "gesperrt");
    if (gesperrt) {
      alert(`⛔ ${gesperrt.titel}:\n\n${gesperrt.nachricht}\n\nEin Export ist nicht möglich.`);
      return;
    }

    dateiname = generiereDateiname(AppState.besorgung.datum, AppState.besorgung.anlass, AppState.stamm.leiter, AppState.besorgung.id, "besorgung");
  } else {
    // Kurs
    if (!AppState.kurs.id.trim()) {
      alert("Bitte eine Kurs-ID angeben.");
      return;
    }
    if (!AppState.kurs.titel.trim()) {
      alert("Bitte den Kurstitel angeben.");
      return;
    }
    const kdParsed = parseGermanDate(AppState.kurs.datum);
    if (!kdParsed) {
      alert("Bitte ein gültiges Kursdatum angeben.");
      return;
    }

    const dauer = Number(String(AppState.kurs.dauer).trim().replace(',', '.'));
    if (!Number.isFinite(dauer) || dauer <= 0) {
      alert("Bitte eine gültige Unterrichtsdauer größer als 0 Stunden angeben.");
      return;
    }

    let pruefD = kdParsed;
    if (AppState.kurs.ist_mehrtaegig) {
      const endDatum = parseGermanDate(AppState.kurs.end_datum);
      if (!endDatum) {
        alert("Bitte ein gültiges Enddatum für den mehrtägigen Kurs angeben.");
        return;
      }
      if (endDatum < kdParsed) {
        alert("Das Enddatum darf nicht vor dem Startdatum liegen.");
        return;
      }
      const termine = Number(AppState.kurs.termine_anzahl);
      if (!Number.isInteger(termine) || termine < 2) {
        alert("Bitte für einen mehrtägigen Kurs mindestens 2 Termine angeben.");
        return;
      }
      pruefD = endDatum;
    }

    const warns = pruefeKursdatumPlausibilitaet(pruefD);
    const gesperrt = warns.find(w => w.level === "gesperrt");
    if (gesperrt) {
      alert(`⛔ ${gesperrt.titel}:\n\n${gesperrt.nachricht}\n\nEin Export ist nicht möglich.`);
      return;
    }

    const vorstandWarn = warns.find(w => w.level === "vorstand");
    if (vorstandWarn) {
      if (!confirm(`⚠️ ${vorstandWarn.titel}:\n\n${vorstandWarn.nachricht}\n\nMöchtest du die Abrechnung zur Genehmigung beim Vorstand einreichen?`)) {
        return;
      }
    }
  }

  // Prüfung: Sind bei allen Belegen mit Dateinamen auch die Dateien vorhanden?
  for (let i = 0; i < AppState.belege.length; i++) {
    const b = AppState.belege[i];
    if (b.dateiName && !b.dateiData) {
      const nachgeladen = await ladeBelegDateiAusDB(b.id);
      if (nachgeladen && nachgeladen.data) {
        b.dateiData = nachgeladen.data;
      } else {
        alert(`⚠️ Datei-Fehler bei Beleg #${i + 1} (${b.zweck}):\n\nFür diesen Beleg ist ein Anhang ("${b.dateiName}") vermerkt, die Datei befindet sich jedoch nicht im Speicher.\n\nBitte lösche diesen Beleg kurz mit [X] und füge ihn mit Datei neu hinzu, damit er an die PDF angehängt werden kann.`);
        return;
      }
    }
  }

  // Falls noch keine Unterschrift vorhanden ist -> Abfrage per Dialog
  if (!AppState.unterschrift) {
    oeffneUnterschriftsModal();
    return;
  }

  // Ansonsten direkt mit hinterlegter Unterschrift fortfahren
  fahreMitPdfExportFort(true);
}

// Führt den eigentlichen PDF-Export durch
async function fahreMitPdfExportFort(mitUnterschrift = true) {
  const isBesorgung = (AppState.modus === 'besorgung');
  const dateiname = isBesorgung
    ? generiereDateiname(AppState.besorgung.datum, AppState.besorgung.anlass, AppState.stamm.leiter, AppState.besorgung.id, "besorgung")
    : generiereDateiname(AppState.kurs.datum, AppState.kurs.titel, AppState.stamm.leiter, AppState.kurs.id, "kurs");

  const btn = document.getElementById('btnExportPdf');
  btn.disabled = true;
  btn.textContent = "⏳ PDF wird erstellt & Belege eingebettet...";

  try {
    const sigToUse = mitUnterschrift ? AppState.unterschrift : null;
    const pdfBytes = await erzeugeAbrechnungPDF(
      AppState.stamm,
      AppState.kurs,
      AppState.belege,
      AppState.modus,
      AppState.besorgung,
      sigToUse
    );
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });

    btn.disabled = false;
    btn.textContent = "📄 Abrechnung prüfen & PDF exportieren";

    oeffneErfolgsModal(blob, dateiname);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "📄 Abrechnung prüfen & PDF exportieren";
    alert(`Fehler bei der PDF-Erstellung:\n${err.message}`);
    console.error(err);
  }
}

// --- DIGITALE UNTERSCHRIFT (CANVAS & EVENTS) ---
let sigCanvasInited = false;
let sigCtx = null;
let sigDrawing = false;
let sigHasStrokes = false;

function initSignaturePad() {
  const canvas = document.getElementById('sigCanvas');
  if (!canvas) return;
  sigCtx = canvas.getContext('2d');

  if (sigCanvasInited) return;
  sigCanvasInited = true;

  function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
    const clientY = (e.touches && e.touches.length > 0) ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  function startStroke(e) {
    e.preventDefault();
    sigDrawing = true;
    sigHasStrokes = true;
    const placeholder = document.getElementById('sigPlaceholder');
    if (placeholder) placeholder.style.display = 'none';

    const coords = getCanvasCoords(e);
    sigCtx.beginPath();
    sigCtx.moveTo(coords.x, coords.y);
  }

  function moveStroke(e) {
    if (!sigDrawing) return;
    e.preventDefault();
    const coords = getCanvasCoords(e);
    sigCtx.lineTo(coords.x, coords.y);
    sigCtx.stroke();
  }

  function endStroke(e) {
    if (!sigDrawing) return;
    sigDrawing = false;
  }

  // Pointer events (Touch, Stylus & Maus)
  canvas.addEventListener('pointerdown', startStroke);
  canvas.addEventListener('pointermove', moveStroke);
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);

  // Touch fallback
  canvas.addEventListener('touchstart', startStroke, { passive: false });
  canvas.addEventListener('touchmove', moveStroke, { passive: false });
  canvas.addEventListener('touchend', endStroke);
}

function resizeSignatureCanvas() {
  const canvas = document.getElementById('sigCanvas');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);

  if (sigCtx) {
    sigCtx.scale(dpr, dpr);
    sigCtx.lineCap = 'round';
    sigCtx.lineJoin = 'round';
    sigCtx.lineWidth = 2.6;
    sigCtx.strokeStyle = '#0f172a';
  }

  if (AppState.unterschrift) {
    const img = new Image();
    img.onload = () => {
      if (sigCtx) {
        sigCtx.drawImage(img, 0, 0, rect.width, rect.height);
        sigHasStrokes = true;
        const placeholder = document.getElementById('sigPlaceholder');
        if (placeholder) placeholder.style.display = 'none';
      }
    };
    img.src = AppState.unterschrift;
  }
}

function oeffneUnterschriftsModal() {
  const modal = document.getElementById('modalUnterschrift');
  if (!modal) return;
  modal.classList.remove('hidden');

  initSignaturePad();
  setTimeout(() => {
    resizeSignatureCanvas();
    const placeholder = document.getElementById('sigPlaceholder');
    if (AppState.unterschrift) {
      if (placeholder) placeholder.style.display = 'none';
    } else {
      if (placeholder && !sigHasStrokes) placeholder.style.display = 'flex';
    }
  }, 60);
}

window.schliesseUnterschriftsModal = function() {
  const modal = document.getElementById('modalUnterschrift');
  if (modal) modal.classList.add('hidden');
};

function leereUnterschriftCanvas() {
  const canvas = document.getElementById('sigCanvas');
  if (!canvas || !sigCtx) return;
  const rect = canvas.getBoundingClientRect();
  sigCtx.clearRect(0, 0, rect.width, rect.height);
  sigHasStrokes = false;
  AppState.unterschrift = null;
  localStorage.removeItem('fv_abrechnung_unterschrift');
  const placeholder = document.getElementById('sigPlaceholder');
  if (placeholder) placeholder.style.display = 'flex';
  updateSignatureUI();
}

function uebernehmeUnterschrift() {
  const canvas = document.getElementById('sigCanvas');
  if (!canvas) return;

  if (sigHasStrokes) {
    const dataUrl = canvas.toDataURL('image/png');
    AppState.unterschrift = dataUrl;

    const chkMerken = document.getElementById('chkSigMerken');
    if (chkMerken && chkMerken.checked) {
      try {
        localStorage.setItem('fv_abrechnung_unterschrift', dataUrl);
      } catch (e) {
        console.warn("LocalStorage Quota:", e);
      }
    } else {
      localStorage.removeItem('fv_abrechnung_unterschrift');
    }
  }

  updateSignatureUI();
  schliesseUnterschriftsModal();

  fahreMitPdfExportFort(Boolean(AppState.unterschrift));
}

function updateSignatureUI() {
  const lblStatus = document.getElementById('lblSigStatus');
  const btnLabel = document.getElementById('lblBtnOpenSignature');
  if (!lblStatus || !btnLabel) return;

  if (AppState.unterschrift) {
    lblStatus.innerHTML = '<span class="text-emerald-600 font-bold">✓ Unterschrift hinterlegt</span>';
    btnLabel.textContent = "Ändern";
  } else {
    lblStatus.innerHTML = '<span class="text-slate-500 font-medium">✍️ Noch keine Unterschrift</span>';
    btnLabel.textContent = "Unterschreiben";
  }
}

// Erfolgs-Modal mit Download & Sendefunktion
function oeffneErfolgsModal(blob, dateiname) {
  const modal = document.getElementById('modalErfolg');
  const isBesorgung = (AppState.modus === 'besorgung');

  const summen = isBesorgung
    ? {
        unterrichtDauer: 0,
        vorbereitungDauer: 0,
        dauer: 0,
        satz: 0,
        unterrichtHonorar: 0,
        vorbereitungHonorar: 0,
        honorar: 0,
        auslagen: (AppState.belege || []).reduce((acc, b) => acc + (parseFloat(b.betrag) || 0.0), 0.0),
        gesamt: (AppState.belege || []).reduce((acc, b) => acc + (parseFloat(b.betrag) || 0.0), 0.0)
      }
    : berechneSummen(AppState.kurs.dauer, AppState.stamm.satz, AppState.belege);

  document.getElementById('lblModalDateiname').textContent = dateiname;

  const downloadUrl = URL.createObjectURL(blob);
  const btnDownload = document.getElementById('btnModalDownload');
  btnDownload.href = downloadUrl;
  btnDownload.download = dateiname;

  // Sendefunktion konfigurieren
  const btnShare = document.getElementById('btnModalShare');

  let emailBetreff = "";
  let emailBody = "";

  if (isBesorgung) {
    emailBetreff = encodeURIComponent(`Auslagenerstattung ${AppState.besorgung.id} - ${AppState.stamm.leiter}`);
    emailBody = encodeURIComponent(
      `Hallo Vorstand,\n\nanbei sende ich meine Auslagenerstattung für "${AppState.besorgung.anlass}" (${AppState.besorgung.zweck}, Gesamterstattung: ${summen.gesamt.toFixed(2)} €).\n\nReferenz: ${AppState.besorgung.id}\nAntragsteller: ${AppState.stamm.leiter}\n\nViele Grüße,\n${AppState.stamm.leiter}`
    );
  } else {
    emailBetreff = encodeURIComponent(`Abrechnung ${AppState.kurs.id} - ${AppState.stamm.leiter}`);
    emailBody = encodeURIComponent(
      `Hallo Vorstand,\n\nanbei sende ich meine Abrechnung für den Kurs "${AppState.kurs.titel}" (${summen.dauer.toFixed(2)} Stunden inkl. Vorbereitung, Gesamtauszahlung: ${summen.gesamt.toFixed(2)} €).\n\nKurs-ID: ${AppState.kurs.id}\nLeiter: ${AppState.stamm.leiter}\n\nViele Grüße,\n${AppState.stamm.leiter}`
    );
  }

  const mailtoLink = `mailto:${VEREIN_EMAIL}?subject=${emailBetreff}&body=${emailBody}`;

  btnShare.onclick = async () => {
    const file = new File([blob], dateiname, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: isBesorgung ? `Auslagenerstattung ${AppState.besorgung.id}` : `Abrechnung ${AppState.kurs.id}`,
          text: isBesorgung ? `Auslagen für "${AppState.besorgung.anlass}" von ${AppState.stamm.leiter}` : `Abrechnung für Kurs "${AppState.kurs.titel}" von ${AppState.stamm.leiter}`
        });
      } catch (e) {
        if (e.name !== 'AbortError') {
          window.location.href = mailtoLink;
        }
      }
    } else {
      window.location.href = mailtoLink;
    }
  };

  modal.classList.remove('hidden');
}

window.schliesseErfolgsModal = function() {
  document.getElementById('modalErfolg').classList.add('hidden');
};
