/**
 * pdf_engine.js - Browser-basierte PDF-Generierung mit pdf-lib
 * Unterstützt 2 Modi:
 *  1. 'kurs': Abrechnung Kursleitung / AG (Honorar inkl. Vorbereitungspauschale + Auslagen)
 *  2. 'besorgung': Reine Auslagenerstattung für Veranstaltungen & Sachbedarf
 * Rendert das identische Deckblatt inkl. 3 Unterschriftenkästen, AcroForms-Formularfeldern
 * und bettet Belege (Bilder/PDFs) sowie die maschinenlesbare abrechnungsdaten.json ein.
 */

// Filtert Texte auf WinAnsi (Standard-PDF Helvetica Zeichensatz), verhindert Encoding-Crashes
function sanitizeForPdf(str) {
  if (str === null || str === undefined) return "";
  let s = String(str);
  // Entferne Emojis & Variations-Selektoren
  s = s.replace(/[\u{1F000}-\u{1FAFF}]/gu, '');
  s = s.replace(/[\u{2600}-\u{27BF}]/gu, '');
  s = s.replace(/[\u{FE00}-\u{FE0F}]/gu, '');

  return s.split('').map(c => {
    const code = c.charCodeAt(0);
    // ASCII druckbar + Latin-1 (ä, ö, ü, Ä, Ö, Ü, ß, §, usw.)
    if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255)) {
      return c;
    }
    // Erlaubte WinAnsi Sonderzeichen (Euro, typografische Anführungszeichen, Gedankenstrich)
    if ([0x20AC, 0x2013, 0x2014, 0x2018, 0x2019, 0x201A, 0x201C, 0x201D, 0x201E, 0x2020, 0x2021, 0x2022, 0x2026, 0x2030, 0x0152, 0x0153, 0x0160, 0x0161, 0x0178, 0x017D, 0x017E].includes(code)) {
      return c;
    }
    if (c === '–' || c === '—') return '-';
    return '';
  }).join('');
}

// Bricht Text zeilenweise sauber an Wortgrenzen um, damit nichts aus Kästen herausragt
function wrapTextToWidth(text, maxWidth, font, size) {
  if (!text) return [];
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';
  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = font.widthOfTextAtSize(sanitizeForPdf(testLine), size);
    if (testWidth <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

async function erzeugeAbrechnungPDF(stamm, kurs, belege, modus = "kurs", besorgung = null, unterschriftDataUrl = null) {
  const { PDFDocument, rgb, StandardFonts } = PDFLib;

  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  // A4 Maße in Punkten: 595.28 x 841.89
  let page = pdfDoc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();

  // Sichere drawText Funktion
  const drawSafe = (txt, opts) => {
    page.drawText(sanitizeForPdf(txt), opts);
  };

  // Farbdefinitionen
  const cPrim = rgb(0.118, 0.239, 0.349); // #1e3d59
  const cSek = rgb(0.851, 0.467, 0.024);  // #d97706
  const cBorder = rgb(0.796, 0.835, 0.882); // #cbd5e1
  const cBgHell = rgb(0.973, 0.980, 0.988); // #f8fafc
  const cDark = rgb(0.059, 0.090, 0.165); // #0f172a
  const cGray = rgb(0.278, 0.333, 0.412); // #475569

  let y = height - 34;
  const leftX = 36;
  const rightX = width - 36;
  const contentWidth = rightX - leftX;

  // --- KOPFZEILE ---
  drawSafe("Förderverein der Riedlen-Grundschule e.V.", {
    x: leftX,
    y: y - 14,
    size: 15,
    font: fontBold,
    color: cPrim,
  });

  const heuteStr = formatDateGerman(new Date());
  drawSafe(`Datum: ${heuteStr}`, {
    x: rightX - 110,
    y: y - 10,
    size: 8.5,
    font: fontBold,
    color: cDark,
  });
  drawSafe("v1.3.3 (Web/Mobile)", {
    x: rightX - 110,
    y: y - 22,
    size: 7,
    font: fontRegular,
    color: rgb(0.58, 0.64, 0.72),
  });

  y -= 28;
  const subTitel = (modus === "besorgung")
    ? "Auslagenerstattung für Fördervereins-Veranstaltungen & Sachbedarf"
    : "Abrechnung über Aufwandsentschädigung & Materialauslagen für Schul-AGs";

  drawSafe(subTitel, {
    x: leftX,
    y: y,
    size: 9.5,
    font: fontItalic,
    color: cGray,
  });

  y -= 8;
  page.drawLine({
    start: { x: leftX, y },
    end: { x: rightX, y },
    thickness: 2,
    color: (modus === "besorgung") ? rgb(0.051, 0.580, 0.541) : cSek,
  });

  // --- STAMMDATEN-KASTEN ---
  y -= 12;
  let stammFields = [];
  let kastenHeight = 104; // Vergrößert für sauberen 2-zeiligen Abrechnungszeitraum

  if (modus === "besorgung") {
    const b = besorgung || {};
    const bDatumParsed = parseGermanDate(b.datum) || new Date();
    const bSj = ermittleSchuljahrDetails(bDatumParsed);
    kastenHeight = 84;

    stammFields = [
      { label1: "Antragsteller / Person:", val1: stamm.leiter || "–", label2: "Anlass / Veranstaltung:", val2: b.anlass || "–", bold: true },
      { label1: "Anschrift:", val1: stamm.anschrift || "–", label2: "Verwendungszweck:", val2: b.zweck || "–" },
      { label1: "Telefon / E-Mail:", val1: stamm.telefon || "–", label2: "IBAN:", val2: formatiereIBAN(stamm.iban) || "–" },
      { label1: "Abrechnungszeitraum:", val1: bSj.label || `Schuljahr ${bSj.code}`, label2: "", val2: "" }
    ];
  } else {
    // Modus Kurs
    const istMehrtaegig = Boolean(kurs.ist_mehrtaegig);
    const startD = kurs.datum ? formatDateGerman(parseGermanDate(kurs.datum)) : "–";
    const endD = kurs.end_datum ? formatDateGerman(parseGermanDate(kurs.end_datum)) : "";
    const termineAnz = kurs.termine_anzahl || "1";
    const terminText = (istMehrtaegig && endD) ? `${startD} – ${endD} (${termineAnz} Termine)` : startD;

    const kdParsed = parseGermanDate(istMehrtaegig && endD ? kurs.end_datum : kurs.datum);
    const zeitraum = kdParsed ? ermittleAbrechnungszeitraum(kdParsed) : { name: "–" };

    stammFields = [
      { label1: "Kursleiter / Person:", val1: stamm.leiter || "–", label2: "Kurs-ID / Referenz:", val2: kurs.id || "–", bold: true },
      { label1: "Anschrift:", val1: stamm.anschrift || "–", label2: "Kurstitel:", val2: kurs.titel || "–" },
      { label1: "Telefon / E-Mail:", val1: stamm.telefon || "–", label2: "Gruppe / Klasse:", val2: kurs.ag || "–" },
      { label1: "IBAN:", val1: formatiereIBAN(stamm.iban) || "–", label2: istMehrtaegig ? "Kurszeitraum:" : "Kurstermin:", val2: terminText },
      { label1: "Stundensatz:", val1: `${parseFloat(stamm.satz || 21).toFixed(2)} €/h`, label2: "Abrechnungszeitraum:", val2: zeitraum.name }
    ];
  }

  const boxTop = y;
  page.drawRectangle({
    x: leftX,
    y: boxTop - kastenHeight,
    width: contentWidth,
    height: kastenHeight,
    borderColor: cBorder,
    borderWidth: 0.5,
    color: cBgHell,
  });

  let rowY = boxTop - 15;
  for (const row of stammFields) {
    drawSafe(row.label1, { x: leftX + 8, y: rowY, size: 7.5, font: fontBold, color: cGray });
    drawSafe(String(row.val1).slice(0, 32), { x: leftX + 110, y: rowY, size: 8, font: row.bold ? fontBold : fontRegular, color: cDark });

    drawSafe(row.label2, { x: leftX + 265, y: rowY, size: 7.5, font: fontBold, color: cGray });

    // Wenn der Wert zu lang ist (z. B. Abrechnungszeitraum), sauber an Wortgrenzen in nächste Zeile umbrechen
    const maxVal2W = rightX - (leftX + 375) - 6; // ca. 142 pt
    const val2Lines = wrapTextToWidth(String(row.val2), maxVal2W, fontRegular, 8);
    if (val2Lines.length > 1) {
      let subY = rowY;
      for (let li = 0; li < Math.min(val2Lines.length, 2); li++) {
        drawSafe(val2Lines[li], {
          x: leftX + 375,
          y: subY,
          size: (li === 0 ? 8 : 7.5),
          font: row.bold ? fontBold : fontRegular,
          color: cDark
        });
        subY -= 9.5;
      }
    } else {
      drawSafe(String(row.val2), {
        x: leftX + 375,
        y: rowY,
        size: 8,
        font: row.bold ? fontBold : fontRegular,
        color: cDark
      });
    }

    rowY -= 16;
  }

  y = boxTop - kastenHeight - 14;

  // Summen berechnen
  const summen = (modus === "besorgung")
    ? {
        unterrichtDauer: 0,
        vorbereitungDauer: 0,
        dauer: 0,
        satz: 0,
        unterrichtHonorar: 0,
        vorbereitungHonorar: 0,
        honorar: 0,
        auslagen: (belege || []).reduce((acc, b) => acc + (parseFloat(b.betrag) || 0.0), 0.0),
        gesamt: (belege || []).reduce((acc, b) => acc + (parseFloat(b.betrag) || 0.0), 0.0)
      }
    : berechneSummen(kurs.dauer, stamm.satz, belege);

  const tblW = contentWidth;

  // --- WENN KURS: 1. ERBRACHTE KURSLEISTUNG ---
  if (modus === "kurs") {
    drawSafe("1. Erbrachte Kursleistung", { x: leftX, y, size: 10, font: fontBold, color: cPrim });
    y -= 6;

    page.drawRectangle({ x: leftX, y: y - 17, width: tblW, height: 17, color: rgb(0.886, 0.910, 0.941), borderColor: cBorder, borderWidth: 0.5 });
    drawSafe("Datum", { x: leftX + 6, y: y - 12, size: 8, font: fontBold, color: cDark });
    drawSafe("Kursbezeichnung / Inhalt", { x: leftX + 85, y: y - 12, size: 8, font: fontBold, color: cDark });
    drawSafe("Dauer", { x: leftX + 355, y: y - 12, size: 8, font: fontBold, color: cDark });
    drawSafe("Honoraranspruch", { x: rightX - 85, y: y - 12, size: 8, font: fontBold, color: cDark });

    const istMehrtaegig = Boolean(kurs.ist_mehrtaegig);
    const startD = kurs.datum ? formatDateGerman(parseGermanDate(kurs.datum)) : "–";

    y -= 17;
    if (summen.vorbereitungDauer > 0) {
      // Zeile 1: Unterricht
      page.drawRectangle({ x: leftX, y: y - 17, width: tblW, height: 17, color: rgb(1, 1, 1), borderColor: cBorder, borderWidth: 0.5 });
      drawSafe(startD, { x: leftX + 6, y: y - 12, size: 7.5, font: fontRegular, color: cDark });
      drawSafe(`${kurs.titel || '–'} (${kurs.ag || '–'}) [Durchführung]`.slice(0, 48), { x: leftX + 85, y: y - 12, size: 7.5, font: fontRegular, color: cDark });
      drawSafe(`${summen.unterrichtDauer.toFixed(2)} Std.`, { x: leftX + 355, y: y - 12, size: 7.5, font: fontRegular, color: cDark });
      drawSafe(`${summen.unterrichtHonorar.toFixed(2)} €`, { x: rightX - 65, y: y - 12, size: 7.5, font: fontBold, color: cDark });
      y -= 17;

      // Zeile 2: Vorbereitungspauschale
      page.drawRectangle({ x: leftX, y: y - 17, width: tblW, height: 17, color: rgb(0.973, 0.980, 0.988), borderColor: cBorder, borderWidth: 0.5 });
      drawSafe("–", { x: leftX + 6, y: y - 12, size: 7.5, font: fontRegular, color: cDark });
      drawSafe("Vorbereitungs- & Rüstzeitpauschale (Vereinsbeschluss)", { x: leftX + 85, y: y - 12, size: 7.5, font: fontItalic, color: cDark });
      drawSafe(`${summen.vorbereitungDauer.toFixed(2)} Std.`, { x: leftX + 355, y: y - 12, size: 7.5, font: fontRegular, color: cDark });
      drawSafe(`${summen.vorbereitungHonorar.toFixed(2)} €`, { x: rightX - 65, y: y - 12, size: 7.5, font: fontBold, color: cDark });
      y -= 17;

      // Zeile 3: Summe Honorar
      page.drawRectangle({ x: leftX, y: y - 17, width: tblW, height: 17, color: cBgHell, borderColor: cBorder, borderWidth: 0.5 });
      drawSafe("Honoraranspruch Gesamt (inkl. Vorbereitung):", { x: leftX + 6, y: y - 12, size: 7.5, font: fontBold, color: cDark });
      drawSafe(`${summen.dauer.toFixed(2)} Std.`, { x: leftX + 355, y: y - 12, size: 7.5, font: fontBold, color: cDark });
      drawSafe(`${summen.honorar.toFixed(2)} €`, { x: rightX - 65, y: y - 12, size: 8, font: fontBold, color: cDark });
      y -= 22;
    } else {
      page.drawRectangle({ x: leftX, y: y - 18, width: tblW, height: 18, color: rgb(1, 1, 1), borderColor: cBorder, borderWidth: 0.5 });
      drawSafe(startD, { x: leftX + 6, y: y - 12, size: 8, font: fontRegular, color: cDark });
      drawSafe(`${kurs.titel || '–'} (${kurs.ag || '–'})`.slice(0, 50), { x: leftX + 85, y: y - 12, size: 8, font: fontRegular, color: cDark });
      drawSafe(`${summen.dauer.toFixed(2)} Std.`, { x: leftX + 355, y: y - 12, size: 8, font: fontRegular, color: cDark });
      drawSafe(`${summen.honorar.toFixed(2)} €`, { x: rightX - 65, y: y - 12, size: 8, font: fontBold, color: cDark });
      y -= 24;
    }
  }

  // --- MATERIALAUSLAGEN & BELEGE ---
  const auslagenTitle = (modus === "besorgung")
    ? "Geltend gemachte Auslagen & Quittungen"
    : "2. Auslagen für Kursmaterialien";

  drawSafe(auslagenTitle, { x: leftX, y, size: 10, font: fontBold, color: (modus === "besorgung") ? rgb(0.051, 0.580, 0.541) : cPrim });
  y -= 6;

  const drawBelegTableHeader = () => {
    page.drawRectangle({ x: leftX, y: y - 17, width: tblW, height: 17, color: rgb(0.886, 0.910, 0.941), borderColor: cBorder, borderWidth: 0.5 });
    drawSafe("Datum", { x: leftX + 6, y: y - 12, size: 8, font: fontBold, color: cDark });
    drawSafe("Händler / Verwendungszweck", { x: leftX + 85, y: y - 12, size: 8, font: fontBold, color: cDark });
    drawSafe("Belegnachweis", { x: leftX + 345, y: y - 12, size: 8, font: fontBold, color: cDark });
    drawSafe("Betrag", { x: rightX - 60, y: y - 12, size: 8, font: fontBold, color: cDark });
    y -= 17;
  };
  drawBelegTableHeader();

  const belList = belege && belege.length > 0 ? belege : [{ datum: "–", zweck: "Keine Materialauslagen geltend gemacht", betrag: 0, datei: null }];
  const minYForApprovalBlocks = 400;
  let bIdx = 1;
  for (const b of belList) {
    if (y < minYForApprovalBlocks) {
      drawSafe("Weitere Auslagen folgen auf der nächsten Seite.", { x: leftX, y: y - 9, size: 7.5, font: fontItalic, color: cGray });
      page = pdfDoc.addPage([width, height]);
      y = height - 34;
      drawSafe(`${auslagenTitle} (Fortsetzung)`, { x: leftX, y, size: 10, font: fontBold, color: (modus === "besorgung") ? rgb(0.051, 0.580, 0.541) : cPrim });
      y -= 6;
      drawBelegTableHeader();
    }

    page.drawRectangle({ x: leftX, y: y - 17, width: tblW, height: 17, color: rgb(1, 1, 1), borderColor: cBorder, borderWidth: 0.5 });
    drawSafe(String(b.datum || '–'), { x: leftX + 6, y: y - 12, size: 7.5, font: fontRegular, color: cDark });
    drawSafe(String(b.zweck || '').slice(0, 48), { x: leftX + 85, y: y - 12, size: 7.5, font: fontRegular, color: cDark });
    const nachweis = b.dateiName ? `Anhang #${bIdx}` : (b.datum === '–' ? '–' : 'Eigenbeleg');
    drawSafe(nachweis, { x: leftX + 345, y: y - 12, size: 7.5, font: fontRegular, color: cDark });
    drawSafe(`${parseFloat(b.betrag || 0).toFixed(2)} €`, { x: rightX - 60, y: y - 12, size: 7.5, font: fontRegular, color: cDark });
    y -= 17;
    if (b.dateiName) bIdx++;
  }

  // Summenzeile Auslagen
  page.drawRectangle({ x: leftX, y: y - 17, width: tblW, height: 17, color: cBgHell, borderColor: cBorder, borderWidth: 0.5 });
  drawSafe("Gesamtsumme Auslagen:", { x: leftX + 6, y: y - 12, size: 8, font: fontBold, color: cDark });
  drawSafe(`${summen.auslagen.toFixed(2)} €`, { x: rightX - 60, y: y - 12, size: 8, font: fontBold, color: cDark });
  y -= 22;

  // --- GESAMTAUSZAHLUNG & VERWENDUNGSZWECK ---
  page.drawRectangle({
    x: leftX,
    y: y - 28,
    width: contentWidth,
    height: 28,
    color: rgb(0.863, 0.988, 0.906), // #dcfce7
    borderColor: rgb(0.086, 0.639, 0.290), // #16a34a
    borderWidth: 1,
  });
  const labelGesamt = (modus === "besorgung") ? "Zur Erstattung fälliger Gesamtbetrag:" : "Zur Auszahlung fälliger Gesamtbetrag:";
  drawSafe(labelGesamt, { x: leftX + 10, y: y - 18, size: 10.5, font: fontBold, color: rgb(0.078, 0.325, 0.176) });
  drawSafe(`${summen.gesamt.toFixed(2)} €`, { x: rightX - 85, y: y - 18, size: 12, font: fontBold, color: rgb(0.078, 0.325, 0.176) });
  y -= 34;

  // Referenz / Verwendungszweck Kasten
  const refCode = (modus === "besorgung") ? (besorgung?.anlass || "Auslagenerstattung") : (kurs?.id || "KURS");
  const refText = (modus === "besorgung")
    ? (stamm.leiter || '')
    : `${refCode} ${stamm.leiter || ''}`.trim();
  page.drawRectangle({ x: leftX, y: y - 19, width: contentWidth, height: 19, color: rgb(0.945, 0.961, 0.976), borderColor: rgb(0.58, 0.64, 0.72), borderWidth: 0.5 });
  drawSafe("Empfohlener Verwendungszweck für Überweisung:", { x: leftX + 8, y: y - 13, size: 8, font: fontRegular, color: cDark });
  drawSafe(refText, { x: leftX + 235, y: y - 13, size: 8.5, font: fontBold, color: cPrim });
  y -= 24;

  // --- RECHTLICHE HINWEISE & AUSSCHLUSSFRIST (SAUBER UMBROCHEN) ---
  const rechtstext = (modus === "besorgung")
    ? "Wichtige Hinweise zur Auslagenerstattung: Auslagen für Vereinsveranstaltungen und Sachbedarf sind im jeweiligen laufenden Schuljahr einzureichen. Die Ausschlussfrist endet mit Beginn der Kassenprüfung vor den Sommerferien. Alle Belege müssen im Original oder als eindeutiger digitaler Belegnachweis vorliegen."
    : "Wichtige Hinweise & Ausschlussfrist: Die Abrechnung für geleistete Stunden hat jeweils blockweise zu erfolgen. Der Abrechnungszeitraum läuft vom Tag nach Ferienende bis zum letzten Tag der kommenden Schulferien bzw. den letzten Schultag vor den Sommerferien. Später eingehende Honorar- oder Aufwandsansprüche verfallen aus gemeinnützigkeitsrechtlichen Gründen endgültig nach Beginn der Kassenprüfung vor den Sommerferien.";

  const rechtsLines = wrapTextToWidth(rechtstext, contentWidth - 14, fontRegular, 6.5);
  const rH = Math.max(34, 12 + rechtsLines.length * 8.5);

  page.drawRectangle({ x: leftX, y: y - rH, width: contentWidth, height: rH, color: cBgHell, borderColor: cBorder, borderWidth: 0.5 });
  let rY = y - 10;
  for (const line of rechtsLines) {
    drawSafe(line, { x: leftX + 7, y: rY, size: 6.5, font: fontRegular, color: cGray });
    rY -= 8.5;
  }
  y -= (rH + 10);

  // Formular (AcroForms) initialisieren
  const form = pdfDoc.getForm();

  // --- KASTEN 1: ANTRAGSTELLER / KURSLEITER ---
  const notizText = (modus === "besorgung") ? (besorgung?.notizen || "") : (kurs?.notizen || "");
  const hatNotiz = Boolean(notizText && notizText.trim());

  const steuerText = (modus === "besorgung")
    ? "Ich versichere die Richtigkeit der vorstehenden Angaben und dass die Auslagen ausschließlich für satzungsgemäße Zwecke des Fördervereins der Grundschule getätigt wurden und nicht anderweitig erstattet werden."
    : "Ich versichere, dass die Leistungen ordnungsgemäß erbracht wurden und im Rahmen des Ehrenamts- bzw. Übungsleiterfreibetrags (§ 3 Nr. 26/26a EStG) erfolgen. Freibeträge werden nicht überschritten.";

  // Textbreite auf maximal 505 pt beschränken, damit er NIEMALS rechts herausragt
  const steuerLines = wrapTextToWidth(steuerText, contentWidth - 16, fontRegular, 6.8);
  const k1H = hatNotiz ? 90 : 80;

  page.drawRectangle({ x: leftX, y: y - k1H, width: contentWidth, height: k1H, color: cBgHell, borderColor: rgb(0.58, 0.64, 0.72), borderWidth: 0.65 });
  const k1Title = (modus === "besorgung")
    ? "1. Antragsteller (Eigenerklärung & Unterschrift)"
    : "1. Kursleiter / Auftragnehmer (Eigenerklärung & Unterschrift)";
  drawSafe(k1Title, { x: leftX + 8, y: y - 12, size: 8.5, font: fontBold, color: cDark });

  // Mehrzeiliger Eigenerklärungstext
  let stY = y - 22;
  for (const sLine of steuerLines) {
    drawSafe(sLine, { x: leftX + 8, y: stY, size: 6.8, font: fontRegular, color: cGray });
    stY -= 8.5;
  }

  // Optionale Notiz des Kursleiters / Antragstellers
  if (hatNotiz) {
    const lblBem = (modus === "besorgung") ? "Bemerkung des Antragstellers: " : "Bemerkung des Kursleiters: ";
    const bemLines = wrapTextToWidth(`${lblBem}${notizText.trim()}`, contentWidth - 16, fontItalic, 7.0);
    drawSafe(bemLines[0] || "", { x: leftX + 8, y: stY - 2, size: 7.0, font: fontItalic, color: cPrim });
  }

  // Ort, Datum & Unterschriftszeile (unten im Kasten sauber platziert mit viel Platz)
  drawSafe(`Ort & Datum: Ulm, den ${heuteStr}`, { x: leftX + 8, y: y - k1H + 14, size: 8, font: fontRegular, color: cDark });
  page.drawLine({ start: { x: rightX - 190, y: y - k1H + 20 }, end: { x: rightX - 10, y: y - k1H + 20 }, thickness: 0.5, color: cGray });
  const sigLabel = (modus === "besorgung") ? "Unterschrift des Antragstellers" : "Unterschrift des Kursleiters";
  drawSafe(sigLabel, { x: rightX - 160, y: y - k1H + 9, size: 6.5, font: fontRegular, color: cGray });

  // Digitale Unterschrift einbetten falls übergeben
  if (unterschriftDataUrl) {
    try {
      let sigBytes;
      if (typeof unterschriftDataUrl === 'string' && unterschriftDataUrl.startsWith('data:')) {
        const base64Data = unterschriftDataUrl.split(',')[1];
        const binaryString = atob(base64Data);
        const len = binaryString.length;
        sigBytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          sigBytes[i] = binaryString.charCodeAt(i);
        }
      } else {
        sigBytes = unterschriftDataUrl;
      }
      const sigImg = await pdfDoc.embedPng(sigBytes);
      const maxSigW = 160;
      const maxSigH = 34;
      const sigDims = sigImg.scaleToFit(maxSigW, maxSigH);
      page.drawImage(sigImg, {
        x: rightX - 180 + (maxSigW - sigDims.width) / 2,
        y: y - k1H + 22,
        width: sigDims.width,
        height: sigDims.height,
      });
    } catch (e) {
      throw new Error(`Die digitale Unterschrift konnte nicht in die PDF eingebettet werden: ${e.message || e}`);
    }
  }

  y -= (k1H + 8);

  // --- KASTEN 2: VORSTAND (AcroForms) ---
  const k2H = 72; // Vergrößert für mehr Platz
  page.drawRectangle({ x: leftX, y: y - k2H, width: contentWidth, height: k2H, color: cBgHell, borderColor: rgb(0.58, 0.64, 0.72), borderWidth: 0.65 });
  const k2Title = (modus === "besorgung")
    ? "2. Sachlich & rechnerisch geprüft / Erstattung genehmigt (Vorstand)"
    : "2. Sachlich & rechnerisch geprüft / Auszahlung genehmigt (Vorstand)";
  drawSafe(k2Title, { x: leftX + 8, y: y - 13, size: 8.5, font: fontBold, color: cDark });

  // Einheitliche Ausrichtungs-Parameter für Kasten 2 & 3:
  // Alle Eingabe-Zeilen starten bündig bei xStart = leftX + 115 und enden bündig bei xEnd = leftX + 515 (Breite 400 pt)
  const xStart = leftX + 115;
  const xEnd = leftX + 515;
  const fieldH = 19; // Angenehme Höhe für interaktives und handschriftliches Ausfüllen

  // Zeile 1: Datum & Visum
  drawSafe("Geprüft & genehmigt am:", { x: leftX + 8, y: y - 31, size: 7.5, font: fontRegular, color: cDark });
  const tfVorstandDatum = form.createTextField('vorstand_datum');
  tfVorstandDatum.setText('');
  tfVorstandDatum.addToPage(page, { x: xStart, y: y - 36, width: 95, height: fieldH });

  drawSafe("Vorstand / Visum:", { x: leftX + 225, y: y - 31, size: 7.5, font: fontBold, color: cGray });
  const tfVorstandSignatur = form.createTextField('vorstand_signatur');
  tfVorstandSignatur.setText('');
  tfVorstandSignatur.addToPage(page, { x: leftX + 310, y: y - 36, width: (xEnd - (leftX + 310)), height: fieldH });

  // Zeile 2: Notizen
  drawSafe("Notizen / Prüfvermerk:", { x: leftX + 8, y: y - 56, size: 7.5, font: fontBold, color: cGray });
  const tfVorstandNotizen = form.createTextField('vorstand_notizen');
  tfVorstandNotizen.setText('');
  tfVorstandNotizen.addToPage(page, { x: xStart, y: y - 61, width: (xEnd - xStart), height: fieldH });
  y -= (k2H + 8);

  // --- KASTEN 3: KASSENWART (AcroForms) ---
  const k3H = 74; // Vergrößert für mehr Platz
  page.drawRectangle({ x: leftX, y: y - k3H, width: contentWidth, height: k3H, color: rgb(0.941, 0.992, 0.957), borderColor: rgb(0.086, 0.639, 0.290), borderWidth: 0.75 });
  drawSafe("3. Zahlungsanweisung & Ausführungsvermerk des Kassenwarts", { x: leftX + 8, y: y - 13, size: 8.5, font: fontBold, color: cDark });

  // Zeile 1: Betrag, Überwiesen am, Visum
  drawSafe("Angewiesener Betrag:", { x: leftX + 8, y: y - 31, size: 7.5, font: fontRegular, color: cDark });
  const tfKwBetrag = form.createTextField('kassenwart_betrag');
  tfKwBetrag.setText('');
  tfKwBetrag.addToPage(page, { x: xStart, y: y - 36, width: 55, height: fieldH });
  drawSafe("€", { x: leftX + 174, y: y - 31, size: 8, font: fontRegular, color: cDark });

  drawSafe("Überwiesen am:", { x: leftX + 192, y: y - 31, size: 7.5, font: fontRegular, color: cDark });
  const tfKwDatum = form.createTextField('kassenwart_datum');
  tfKwDatum.setText('');
  tfKwDatum.addToPage(page, { x: leftX + 265, y: y - 36, width: 80, height: fieldH });

  drawSafe("Kassenwart / Visum:", { x: leftX + 355, y: y - 31, size: 7, font: fontBold, color: cGray });
  const tfKwSignatur = form.createTextField('kassenwart_signatur');
  tfKwSignatur.setText('');
  tfKwSignatur.addToPage(page, { x: leftX + 445, y: y - 36, width: (xEnd - (leftX + 445)), height: fieldH });

  // Zeile 2: Notizen
  drawSafe("Notizen / Buchungsvermerk:", { x: leftX + 8, y: y - 56, size: 7.5, font: fontBold, color: cGray });
  const tfKwNotizen = form.createTextField('kassenwart_notizen');
  tfKwNotizen.setText('');
  tfKwNotizen.addToPage(page, { x: xStart, y: y - 61, width: (xEnd - xStart), height: fieldH });

  // --- BELEGE ANHÄNGEN (BILDER & PDFS) ---
  let belegNr = 1;
  for (const b of (belege || [])) {
    if (!b.dateiData) continue;

    try {
      if (b.dateiType === 'application/pdf' || b.dateiName?.toLowerCase().endsWith('.pdf')) {
        const belegDoc = await PDFDocument.load(b.dateiData);
        const copiedPages = await pdfDoc.copyPages(belegDoc, belegDoc.getPageIndices());
        for (const p of copiedPages) {
          pdfDoc.addPage(p);
        }
      } else {
        let img;
        if (b.dateiType === 'image/png' || b.dateiName?.toLowerCase().endsWith('.png')) {
          img = await pdfDoc.embedPng(b.dateiData);
        } else {
          img = await pdfDoc.embedJpg(b.dateiData);
        }

        const imgPage = pdfDoc.addPage([595.28, 841.89]);
        const imgDims = img.scaleToFit(520, 720);

        imgPage.drawText(sanitizeForPdf(`Beleg #${belegNr}: ${b.zweck || ''} (${parseFloat(b.betrag || 0).toFixed(2)} €)`), {
          x: 36,
          y: 841.89 - 36,
          size: 11,
          font: fontBold,
          color: cPrim,
        });

        imgPage.drawImage(img, {
          x: (595.28 - imgDims.width) / 2,
          y: (841.89 - 60 - imgDims.height),
          width: imgDims.width,
          height: imgDims.height,
        });
      }
      belegNr++;
    } catch (err) {
      throw new Error(`Der Beleg "${b.dateiName || b.zweck}" konnte nicht in die PDF eingebettet werden: ${err.message || err}`);
    }
  }

  // --- METADATEN & ATTACHMENT ---
  const docTitle = (modus === "besorgung")
    ? `Auslagenerstattung - ${besorgung?.anlass || ''}`
    : `Abrechnung ${kurs?.id || ''} - ${kurs?.titel || ''}`;

  pdfDoc.setTitle(sanitizeForPdf(docTitle));
  pdfDoc.setAuthor(sanitizeForPdf(stamm.leiter || ''));
  const vorgangLabel = modus === "besorgung" ? "Anlass" : "Referenz";
  pdfDoc.setSubject(sanitizeForPdf(`Förderverein ${vorgangLabel}: ${refCode}`));
  pdfDoc.setKeywords([
    sanitizeForPdf(`${vorgangLabel}=${refCode}`),
    sanitizeForPdf(`Betrag=${summen.gesamt.toFixed(2)}`),
    sanitizeForPdf(`IBAN=${stamm.iban || ''}`),
    sanitizeForPdf(`Modus=${modus}`)
  ]);
  pdfDoc.setCreator("Förderverein der Riedlen-Grundschule e.V. – Abrechnungs-Manager v1.3.3 (PWA)");

  // Maschinenlesbares JSON-Attachment einbetten
  const metaPayload = {
    schema_version: "1.1",
    app_version: "1.3.3",
    modus: modus,
    erstellt_am: new Date().toISOString(),
    stammdaten: stamm,
    kurs: (modus === "kurs") ? kurs : null,
    besorgung: (modus === "besorgung") ? {
      anlass: besorgung?.anlass || "",
      zweck: besorgung?.zweck || "",
      datum: besorgung?.datum || "",
      notizen: besorgung?.notizen || ""
    } : null,
    summen: summen,
    belege: (belege || []).map(b => ({
      datum: b.datum,
      zweck: b.zweck,
      betrag: b.betrag,
      hat_datei: Boolean(b.dateiName)
    }))
  };

  const jsonStr = JSON.stringify(metaPayload, null, 2);
  const jsonBytes = new TextEncoder().encode(jsonStr);
  await pdfDoc.attach(jsonBytes, 'abrechnungsdaten.json', {
    mimeType: 'application/json',
    description: 'Maschinenlesbare Abrechnungsdaten für Kassenwart-App',
    creationDate: new Date(),
    modificationDate: new Date(),
  });

  return await pdfDoc.save();
}
