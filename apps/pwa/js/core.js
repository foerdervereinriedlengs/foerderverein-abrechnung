/**
 * core.js - Förderverein Grundschule: Abrechnungs-Kernlogik (JavaScript-Portierung)
 * Beinhaltet Ferienlogik Baden-Württemberg, Plausibilitätsprüfungen, IBAN Modulo-97, Summenberechnung.
 */

const DEFAULT_STUNDENSATZ = 21.00;
const DEFAULT_ADMIN_PIN = "4711";
const VEREIN_EMAIL = "foerderverein.riedlen-gs@gmx.de";
const VORBEREITUNG_STUNDEN = 0.50;

// Lückenlose BW-Ferienliste 2024–2028 (offline sofort verfügbar)
const BW_FERIEN = [
  // Schuljahr 2024/2025
  { name: "Herbstferien 2024", start: "2024-10-28", end: "2024-10-31" },
  { name: "Weihnachtsferien 2024/25", start: "2024-12-23", end: "2025-01-04" },
  { name: "Osterferien 2025", start: "2025-04-14", end: "2025-04-26" },
  { name: "Pfingstferien 2025", start: "2025-06-10", end: "2025-06-20" },
  { name: "Sommerferien 2025", start: "2025-07-31", end: "2025-09-13" },
  // Schuljahr 2025/2026
  { name: "Herbstferien 2025", start: "2025-10-27", end: "2025-10-30" },
  { name: "Weihnachtsferien 2025/26", start: "2025-12-22", end: "2026-01-05" },
  { name: "Osterferien 2026", start: "2026-03-30", end: "2026-04-10" },
  { name: "Pfingstferien 2026", start: "2026-05-26", end: "2026-06-05" },
  { name: "Sommerferien 2026", start: "2026-07-30", end: "2026-09-12" },
  // Schuljahr 2026/2027
  { name: "Herbstferien 2026", start: "2026-10-26", end: "2026-10-31" },
  { name: "Weihnachtsferien 2026/27", start: "2026-12-23", end: "2027-01-09" },
  { name: "Osterferien 2027", start: "2027-03-25", end: "2027-04-03" },
  { name: "Pfingstferien 2027", start: "2027-05-18", end: "2027-05-29" },
  { name: "Sommerferien 2027", start: "2027-07-29", end: "2027-09-11" },
  // Schuljahr 2027/2028
  { name: "Herbstferien 2027", start: "2027-11-02", end: "2027-11-06" },
  { name: "Weihnachtsferien 2027/28", start: "2027-12-23", end: "2028-01-08" },
  { name: "Osterferien 2028", start: "2028-04-10", end: "2028-04-21" },
  { name: "Pfingstferien 2028", start: "2028-06-06", end: "2028-06-16" },
  { name: "Sommerferien 2028", start: "2028-07-27", end: "2028-09-09" }
];

function parseISODate(dStr) {
  if (!dStr) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dStr);
  if (!match) return null;
  return createValidDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

function createValidDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function parseGermanDate(dStr) {
  if (!dStr) return null;
  const s = dStr.trim();
  // Formate: TT.MM.JJJJ oder JJJJ-MM-TT
  if (s.includes('.')) {
    const match = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(s);
    if (!match) return null;
    let year = Number(match[3]);
    if (match[3].length === 2) year += 2000;
    return createValidDate(year, Number(match[2]), Number(match[1]));
  } else if (s.includes('-')) {
    return parseISODate(s);
  }
  return null;
}

function formatDateGerman(d) {
  if (!d) return "";
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function formatDateISO(d) {
  if (!d) return "";
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(d, days) {
  const res = new Date(d);
  res.setDate(res.getDate() + days);
  return res;
}

// Ermittelt Schuljahr-Details dynamisch anhand der Sommerferien
function ermittleSchuljahrDetails(datum) {
  const sommerListe = BW_FERIEN.filter(f => f.name.toLowerCase().includes('sommer'));
  sommerListe.sort((a, b) => a.start.localeCompare(b.start));

  for (let i = 0; i < sommerListe.length; i++) {
    const sf = sommerListe[i];
    const sfEnd = parseISODate(sf.end);
    if (datum <= sfEnd) {
      const sfStart = parseISODate(sf.start);
      let sjStart;
      if (i > 0) {
        sjStart = addDays(parseISODate(sommerListe[i - 1].end), 1);
      } else {
        sjStart = new Date(sfStart.getFullYear() - 1, 8, 10);
      }
      const sjEnde = sfEnd;
      const letzterSchultag = addDays(sfStart, -1);
      const startY = (sfStart.getFullYear() - 1) % 100;
      const endY = sfStart.getFullYear() % 100;
      const sjCode = `SJ${String(startY).padStart(2, '0')}${String(endY).padStart(2, '0')}`;
      const sjKurz = `${String(startY).padStart(2, '0')}/${String(endY).padStart(2, '0')}`;
      return { code: sjCode, kurz: sjKurz, label: `Schuljahr ${sjKurz}`, start: sjStart, ende: sjEnde, letzterSchultag };
    }
  }

  // Fallback
  const y = datum.getFullYear();
  let startY, endY, sjStart, sjEnde, letzterTag;
  if (datum.getMonth() >= 7) { // August oder später
    startY = y % 100;
    endY = (y + 1) % 100;
    sjStart = new Date(y, 8, 12);
    sjEnde = new Date(y + 1, 8, 11);
    letzterTag = new Date(y + 1, 6, 28);
  } else {
    startY = (y - 1) % 100;
    endY = y % 100;
    sjStart = new Date(y - 1, 8, 12);
    sjEnde = new Date(y, 8, 11);
    letzterTag = new Date(y, 6, 28);
  }
  const sjKurz = `${String(startY).padStart(2, '0')}/${String(endY).padStart(2, '0')}`;
  return {
    code: `SJ${String(startY).padStart(2, '0')}${String(endY).padStart(2, '0')}`,
    kurz: sjKurz,
    label: `Schuljahr ${sjKurz}`,
    start: sjStart,
    ende: sjEnde,
    letzterSchultag: letzterTag
  };
}

// Abrechnungszeitraum ermitteln
function ermittleAbrechnungszeitraum(kursDatum) {
  let vorFerien = null;
  let folgeFerien = null;

  for (const f of BW_FERIEN) {
    const fEnd = parseISODate(f.end);
    if (fEnd < kursDatum) {
      vorFerien = f;
    } else if (fEnd >= kursDatum && !folgeFerien) {
      folgeFerien = f;
    }
  }

  if (vorFerien && folgeFerien) {
    const pStart = addDays(parseISODate(vorFerien.end), 1);
    const isSommer = folgeFerien.name.toLowerCase().includes('sommer');
    let pEnde, pName;
    if (isSommer) {
      pEnde = addDays(parseISODate(folgeFerien.start), -1);
      pName = `Ende ${vorFerien.name} bis Beginn ${folgeFerien.name} (letzter Schultag)`;
    } else {
      pEnde = parseISODate(folgeFerien.end);
      pName = `Ende ${vorFerien.name} bis Ende ${folgeFerien.name}`;
    }
    return { start: pStart, ende: pEnde, name: pName };
  } else if (folgeFerien) {
    const isSommer = folgeFerien.name.toLowerCase().includes('sommer');
    const fStart = parseISODate(folgeFerien.start);
    const pEnde = isSommer ? addDays(fStart, -1) : parseISODate(folgeFerien.end);
    const pStart = addDays(fStart, -60);
    return { start: pStart, ende: pEnde, name: `Bis ${folgeFerien.name}` };
  } else if (vorFerien) {
    const pStart = addDays(parseISODate(vorFerien.end), 1);
    const pEnde = addDays(parseISODate(vorFerien.end), 70);
    return { start: pStart, ende: pEnde, name: `Ab Ende ${vorFerien.name}` };
  }

  return { start: null, ende: null, name: "Abrechnungszeitraum flexibel" };
}

function pruefeInFerien(datum) {
  for (const f of BW_FERIEN) {
    const start = parseISODate(f.start);
    const end = parseISODate(f.end);
    if (datum >= start && datum <= end) {
      return f.name;
    }
  }
  return null;
}

// Kurs-ID Vorschlag
function generiereKursIdVorschlag(kursTitel, kursDatumStr) {
  const d = parseGermanDate(kursDatumStr) || new Date();
  const sj = ermittleSchuljahrDetails(d).code;
  const clean = (kursTitel || "").toUpperCase().replace(/[^A-Z0-9]/g, '');
  const kuerzel = clean.slice(0, 6) || "KURS";
  return `${sj}-${kuerzel}-01`;
}

// Dateiname nach Kassenwart-Schema (universell für Kurs und Besorgung)
function generiereDateiname(datumStr, titel, leiter, id, modus = "kurs") {
  const d = parseGermanDate(datumStr) || new Date();
  const dStr = formatDateISO(d);
  const fallback = modus === "besorgung" ? "BESORGUNG" : "KURS";
  const cleanKid = (id || (modus === "besorgung" ? titel : fallback) || fallback).toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
  const cleanLeiter = (leiter || "Abrechnung").replace(/[^a-zA-Z0-9äöüÄÖÜß_-]/g, '_').slice(0, 25);
  const praefix = modus === "besorgung" ? "Auslagenerstattung" : "Abrechnung";
  return `${praefix}_${cleanKid}_${dStr}_${cleanLeiter}.pdf`;
}

// IBAN Modulo-97 Prüfung (ISO 7064)
function validiereIBAN(iban) {
  if (!iban || typeof iban !== 'string') return { ok: false, err: "Bitte eine IBAN angeben." };
  const cleaned = iban.replace(/\s+/g, '').toUpperCase();
  if (cleaned.length !== 22) return { ok: false, err: `Eine deutsche IBAN muss genau 22 Zeichen lang sein (aktuell: ${cleaned.length}).` };
  if (!cleaned.startsWith("DE")) return { ok: false, err: "Es werden aktuell nur deutsche IBANs unterstützt (beginnend mit 'DE')." };
  if (!/^\d{20}$/.test(cleaned.slice(2))) return { ok: false, err: "Nach 'DE' dürfen nur 20 Ziffern folgen." };

  const rearranged = cleaned.slice(4) + cleaned.slice(0, 4);
  let numStr = "";
  for (let i = 0; i < rearranged.length; i++) {
    const code = rearranged.charCodeAt(i);
    if (code >= 65 && code <= 90) {
      numStr += String(code - 55);
    } else {
      numStr += rearranged[i];
    }
  }

  // Modulo 97 mit BigInt
  try {
    const mod = BigInt(numStr) % 97n;
    if (mod !== 1n) {
      return { ok: false, err: "Ungültige IBAN-Prüfsumme. Bitte auf Tippfehler prüfen." };
    }
  } catch (e) {
    return { ok: false, err: "IBAN-Prüfung fehlgeschlagen." };
  }

  return { ok: true, err: null };
}

function formatiereIBAN(iban) {
  if (!iban) return "";
  const cleaned = iban.replace(/\s+/g, '').toUpperCase();
  const parts = [];
  for (let i = 0; i < cleaned.length; i += 4) {
    parts.push(cleaned.slice(i, i + 4));
  }
  return parts.join(' ');
}

// Plausibilitätsprüfungen Kursdatum
function pruefeKursdatumPlausibilitaet(kursDatum, heute = new Date()) {
  const warnungen = [];
  const kursSj = ermittleSchuljahrDetails(kursDatum);
  const aktSj = ermittleSchuljahrDetails(heute);

  // 1. Sperre: Kurs lag in vergangenem Schuljahr
  if (kursDatum < heute) {
    if (kursSj.code !== aktSj.code && kursDatum < aktSj.start) {
      warnungen.push({
        level: "gesperrt",
        titel: "Frist endgültig abgelaufen (Schuljahr beendet)",
        nachricht: `Der Kurstermin (${formatDateGerman(kursDatum)}) liegt im abgelaufenen Schuljahr (${kursSj.code}). Die Einreichungsfrist endete vor Beginn der Sommerferien. Erstellung ist gesperrt.`
      });
      return warnungen;
    }

    if (kursSj.code === aktSj.code && heute > kursSj.letzterSchultag) {
      warnungen.push({
        level: "gesperrt",
        titel: "Frist endgültig abgelaufen (Kassenprüfung läuft)",
        nachricht: `Die allerletzte Frist zur Einreichung für das Schuljahr (${kursSj.code}) endete am ${formatDateGerman(kursSj.letzterSchultag)}. Erstellung ist gesperrt.`
      });
      return warnungen;
    }
  }

  // Zukünftiges Schuljahr
  if (kursDatum > aktSj.ende) {
    warnungen.push({
      level: "gesperrt",
      titel: "Kurstermin im zukünftigen Schuljahr",
      nachricht: `Der Kurstermin liegt im zukünftigen Schuljahr (${kursSj.code}). Abrechnungen können erst im jeweiligen Schuljahr eingereicht werden.`
    });
    return warnungen;
  }

  // 2. Vorstandsgenehmigung: Abrechnungszeitraum abgelaufen
  const zeitraum = ermittleAbrechnungszeitraum(kursDatum);
  if (zeitraum.ende && heute > zeitraum.ende && kursSj.code === aktSj.code && heute <= kursSj.letzterSchultag) {
    warnungen.push({
      level: "vorstand",
      titel: "Abrechnungszeitraum überschritten (Vorstandsgenehmigung)",
      nachricht: `Der Kurstermin gehört zur Periode '${zeitraum.name}'. Die Frist endete am ${formatDateGerman(zeitraum.ende)}. Abrechnung erfordert Genehmigung durch den Vorstand.`
    });
  }

  // 3. Kurstag in den Ferien?
  const ferienName = pruefeInFerien(kursDatum);
  if (ferienName) {
    warnungen.push({
      level: "hinweis",
      titel: "Kurstag in den Ferien",
      nachricht: `Der Kurstag (${formatDateGerman(kursDatum)}) liegt in den ${ferienName} (BW). Handelt es sich um ein Ferienprogramm?`
    });
  }

  // 4. Wochenende?
  const tag = kursDatum.getDay();
  if (tag === 0 || tag === 6) {
    warnungen.push({
      level: "hinweis",
      titel: "Kurstag am Wochenende",
      nachricht: `Der Kurstag fällt auf einen ${tag === 6 ? 'Samstag' : 'Sonntag'}.`
    });
  }

  return warnungen;
}

// Beleg Plausibilität
function pruefeBelegPlausibilitaet(belegDatum, kursDatum) {
  if (!kursDatum) return { ok: true, status: "ok", msg: "" };
  const zeitraum = ermittleAbrechnungszeitraum(kursDatum);
  if (!zeitraum.start || !zeitraum.ende) return { ok: true, status: "ok", msg: "" };

  if (belegDatum > zeitraum.ende) {
    return {
      ok: false,
      status: "nachlauf",
      msg: `Belegdatum (${formatDateGerman(belegDatum)}) liegt nach Periodenende (${formatDateGerman(zeitraum.ende)}).`
    };
  }

  const pufferStart = addDays(zeitraum.start, -28);
  if (belegDatum < zeitraum.start) {
    if (belegDatum >= pufferStart) {
      return {
        ok: true,
        status: "vorlauf",
        msg: `Vorlauf-Kauf (${formatDateGerman(belegDatum)}, bis zu 4 Wochen vor Periodenstart). Handelt es sich um haltbaren Sachbedarf?`
      };
    } else {
      return {
        ok: false,
        status: "alt",
        msg: `Der Beleg (${formatDateGerman(belegDatum)}) liegt mehr als 4 Wochen vor Periodenbeginn (${zeitraum.name}).`
      };
    }
  }

  return { ok: true, status: "ok", msg: "" };
}

// Fristenprüfung für Besorgungen/Veranstaltungen: Gesamtes laufendes Schuljahr!
function pruefeBesorgungDatumPlausibilitaet(besorgungsDatum, heute = new Date()) {
  const warnungen = [];
  const bSj = ermittleSchuljahrDetails(besorgungsDatum);
  const aktSj = ermittleSchuljahrDetails(heute);

  // 1. Sperre: Besorgung lag in vergangenem Schuljahr
  if (besorgungsDatum < heute) {
    if (bSj.code !== aktSj.code && besorgungsDatum < aktSj.start) {
      warnungen.push({
        level: "gesperrt",
        titel: "Frist endgültig abgelaufen (Schuljahr beendet)",
        nachricht: `Die Besorgung (${formatDateGerman(besorgungsDatum)}) fand im abgelaufenen Schuljahr (${bSj.code}) statt. Die Einreichungsfrist endete vor Beginn der Sommerferien. Erstattung ist gesperrt.`
      });
      return warnungen;
    }

    if (bSj.code === aktSj.code && heute > bSj.letzterSchultag) {
      warnungen.push({
        level: "gesperrt",
        titel: "Frist endgültig abgelaufen (Kassenprüfung läuft)",
        nachricht: `Die allerletzte Frist zur Einreichung für das Schuljahr (${bSj.code}) endete am ${formatDateGerman(bSj.letzterSchultag)}. Erstattung ist gesperrt.`
      });
      return warnungen;
    }
  }

  // Zukünftiges Schuljahr
  if (besorgungsDatum > aktSj.ende) {
    warnungen.push({
      level: "gesperrt",
      titel: "Datum im zukünftigen Schuljahr",
      nachricht: `Das Datum liegt im zukünftigen Schuljahr (${bSj.code}). Auslagen können erst im jeweiligen Schuljahr eingereicht werden.`
    });
    return warnungen;
  }

  return warnungen;
}

// Belegprüfung für Besorgungen (im gesamten Schuljahr gültig)
function pruefeBesorgungBelegPlausibilitaet(belegDatum, besorgungsDatum) {
  const d = besorgungsDatum || new Date();
  const sj = ermittleSchuljahrDetails(d);
  if (belegDatum > sj.letzterSchultag) {
    return {
      ok: false,
      status: "nachlauf",
      msg: `Belegdatum (${formatDateGerman(belegDatum)}) liegt nach dem Schuljahresende (${formatDateGerman(sj.letzterSchultag)}).`
    };
  }
  const pufferStart = addDays(sj.start, -28);
  if (belegDatum < pufferStart) {
    return {
      ok: false,
      status: "alt",
      msg: `Der Beleg (${formatDateGerman(belegDatum)}) liegt vor dem Beginn des Schuljahres (${sj.code}).`
    };
  }
  return { ok: true, status: "ok", msg: "" };
}

// Summen berechnen
function berechneSummen(dauerVal, satzVal, belege) {
  const unterrichtDauer = parseFloat(String(dauerVal).replace(',', '.')) || 0.0;
  const vorbereitungDauer = unterrichtDauer > 0 ? VORBEREITUNG_STUNDEN : 0.0;
  const dauer = unterrichtDauer + vorbereitungDauer;
  const satz = parseFloat(String(satzVal).replace(',', '.')) || 0.0;
  const unterrichtHonorar = unterrichtDauer * satz;
  const vorbereitungHonorar = vorbereitungDauer * satz;
  const honorar = dauer * satz;
  const auslagen = (belege || []).reduce((acc, b) => acc + (parseFloat(b.betrag) || 0.0), 0.0);
  const gesamt = honorar + auslagen;

  return {
    unterrichtDauer,
    vorbereitungDauer,
    dauer,
    satz,
    unterrichtHonorar,
    vorbereitungHonorar,
    honorar,
    auslagen,
    gesamt
  };
}
