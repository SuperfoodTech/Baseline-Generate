const CONFIG = {
    // Google Sheet ID containing your Data
    SPREADSHEET_ID: "1mErow2VJwdvW_sJ1qkvV5Fy7Xx55Fdods-HEKy03B2I",

    // Sheet Names (Change if yours are different)
    SHEET_NAME_MASTER: "Master SPK",
    SHEET_NAME_LAMPIRAN: "Lampiran",

    // Google Doc Template ID (Word files converting to GDoc works best)
    TEMPLATE_ID: "1dAx1pgcpSf35VQ3EtqiEPs5v4o_jhpNFvP5y7saNhpI",

    // Folder ID to save generated PDFs (Optional: leave empty to save in root)
    // If you want a specific "Output" folder, create it and paste ID here
    OUTPUT_FOLDER_ID: "168-EBA80lkKWjY3lkeSXEYioCPUIZzT1"
};

// --- API HANDLERS ---

function doGet(e) {
    return handleRequest(e);
}

function doPost(e) {
    return handleRequest(e);
}

function handleRequest(e) {
    const lock = LockService.getScriptLock();
    lock.tryLock(10000); // Prevent concurrent edits messing up

    try {
        const action = e.parameter.action;

        if (action === "get_months") {
            return getMonths();
        }

        if (action === "get_mitra") {
            const month = e.parameter.month;
            return getMitraList(month);
        }

        // For POST/Generation
        if (action === "generate") {
            // Handle payload from POST body or parameters
            let params = e.parameter;
            if (e.postData && e.postData.contents) {
                try {
                    const body = JSON.parse(e.postData.contents);
                    params = { ...params, ...body };
                } catch (err) {
                    // ignore if not json
                }
            }
            return generatePDF(params.month, params.name);
        }

        // Download PDF as Base64 (for ZIP download feature)
        if (action === "download_pdf") {
            const pdfUrl = e.parameter.url;
            const mitraName = e.parameter.name;
            return downloadPdfAsBase64(pdfUrl, mitraName);
        }

        return responseJSON({ error: "Invalid Action" });

    } catch (error) {
        return responseJSON({ error: error.toString() });
    } finally {
        lock.releaseLock();
    }
}

// --- CORE FUNCTIONS ---

function getMonths() {
    const sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.SHEET_NAME_MASTER);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const bulanIdx = headers.findIndex(h => h.toString().toLowerCase() === "bulan");

    if (bulanIdx === -1) return responseJSON({ error: "Column 'BULAN' not found" });

    const months = new Set();
    // Start from 1 to skip header
    for (let i = 1; i < data.length; i++) {
        if (data[i][bulanIdx]) months.add(data[i][bulanIdx].toString());
    }

    return responseJSON({ months: Array.from(months) });
}

function getMitraList(month) {
    const sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.SHEET_NAME_MASTER);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    const nameIdx = headers.findIndex(h => h.toLowerCase().trim() === "nama");
    const bulanIdx = headers.findIndex(h => h.toLowerCase().trim() === "bulan");

    const result = [];

    // Find Output Folder
    let outputFolder = DriveApp.getRootFolder();
    if (CONFIG.OUTPUT_FOLDER_ID) {
        try { outputFolder = DriveApp.getFolderById(CONFIG.OUTPUT_FOLDER_ID); } catch (e) { }
    }

    // --- SUBFOLDER CHECK ---
    // User wants files inside a subfolder named by Month (e.g. "January")
    // We need to check if that subfolder exists
    const monthFolderName = month.toString().toUpperCase(); // e.g. "JANUARI"
    let monthFolder = null;

    // Efficiently check if folder exists
    const folders = outputFolder.getFoldersByName(monthFolderName);
    if (folders.hasNext()) {
        monthFolder = folders.next();
    }

    // If month subfolder doesn't exist, files won't be there.
    // However, if the user hasn't generated anything yet, it's fine.
    // If it *does* exist, we search inside it.
    // If it doesn't, we search inside parent? 
    // Safest strategy: Search inside the Month Folder if it exists.

    let filesIterator;
    if (monthFolder) {
        filesIterator = monthFolder.searchFiles(`title contains 'SPK_' and mimeType = 'application/pdf'`);
    } else {
        // Fallback or empty
        // filesIterator = outputFolder.searchFiles(...); // Only look in parent?
        // Actually, if folder doesn't exist, no files exist.
        // Return empty.
        filesIterator = { hasNext: () => false };
    }

    const fileMap = {};
    if (filesIterator.hasNext) { // Check if real iterator
        while (filesIterator.hasNext()) {
            const file = filesIterator.next();
            fileMap[file.getName()] = { url: file.getUrl(), id: file.getId() };
        }
    }

    for (let i = 1; i < data.length; i++) {
        const rowMonth = data[i][bulanIdx].toString();
        if (rowMonth.toLowerCase() === month.toString().toLowerCase()) {
            const name = data[i][nameIdx];
            const filename = `SPK_${name}.pdf`;
            const fileData = fileMap[filename];

            result.push({
                Nama: name,
                has_pdf: !!fileData,
                pdf_url: fileData ? fileData.url : null
            });
        }
    }

    return responseJSON({ mitra: result });
}

function generatePDF(month, name) {
    if (!month || !name) return responseJSON({ error: "Missing month or name" });

    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const masterSheet = ss.getSheetByName(CONFIG.SHEET_NAME_MASTER);
    const lampiranSheet = ss.getSheetByName(CONFIG.SHEET_NAME_LAMPIRAN);

    // 1. Get Master Data
    const masterData = getRowData(masterSheet, "Nama", name, "BULAN", month);
    if (!masterData) return responseJSON({ error: "Mitra not found in Master" });

    // 2. Get Lampiran Items
    const items = getAllRowsData(lampiranSheet, "Nama", name, "BULAN", month);

    // 3. Prepare Replacements
    const totalHonor = items.reduce((sum, item) => {
        const clean = item['Honor'].toString().replace(/[^0-9]/g, '');
        return sum + (parseInt(clean) || 0);
    }, 0);

    const terbilangStr = angkaTerbilang(totalHonor).toUpperCase() + " RUPIAH";

    const replacements = {
        '<<Nama>>': masterData['Nama'],
        '<<Alamat>>': masterData['Alamat'],
        '<<BULAN>>': month.toString().toUpperCase(),
        '<<NOMOR SPK>>': masterData['NOMOR SPK'],
        '<<NOMOR BAST>>': masterData['NOMOR BAST'],
        '<<HARI MULAI>>': formatDate(masterData['HARI MULAI']),
        '<<TANGGAL MULAI>>': formatDate(masterData['TANGGAL MULAI']),
        '<<TANGGAL SELESAI>>': formatDate(masterData['TANGGAL SELESAI']),
        '<<Honor_jmlh>>': "Rp " + formatMoney(totalHonor),
        '<<Honor_jmlh_txt>>': terbilangStr
    };

    // 4. Create Temp Doc
    const templateFile = DriveApp.getFileById(CONFIG.TEMPLATE_ID);

    // Output Folder Logic
    let parentFolder = DriveApp.getRootFolder();
    if (CONFIG.OUTPUT_FOLDER_ID) {
        try { parentFolder = DriveApp.getFolderById(CONFIG.OUTPUT_FOLDER_ID); } catch (e) { }
    }

    // Ensure Month Subfolder Exists
    const monthFolderName = month.toString().toUpperCase();
    let targetFolder;
    const folders = parentFolder.getFoldersByName(monthFolderName);
    if (folders.hasNext()) {
        targetFolder = folders.next();
    } else {
        targetFolder = parentFolder.createFolder(monthFolderName);
    }

    const newFilename = `SPK_${name}`;

    // Create Temp File in Target Folder (Cleaner)
    const tempFile = templateFile.makeCopy(newFilename + "_TEMP", targetFolder);
    const tempDoc = DocumentApp.openById(tempFile.getId());
    const body = tempDoc.getBody();

    // 5. Replace Text
    for (const [key, val] of Object.entries(replacements)) {
        body.replaceText(key, val || "");
    }

    // 6. Fill Table (Assuming "Uraian Pekerjaan" table exists)
    const tables = body.getTables();

    for (const table of tables) {
        // Check header
        const headerRow = table.getRow(0);
        if (headerRow.getText().includes("Uraian Pekerjaan")) {

            const itemMapping = {
                '<<item>>': 'Item',
                '<<Target>>': 'Target',
                '<<Periode>>': 'Periode',
                '<<Honor>>': 'Honor',
                '<<RO>>': 'RO'
            };

            // Capture the template row (Row 1)
            const templateRow = table.getRow(1).copy();
            const startIndex = 1; // Data starts at row 1 (0 is header)

            if (items.length > 0) {
                items.forEach((item, idx) => {
                    const targetRowIndex = startIndex + idx;
                    let row;

                    // Reuse - or - Append
                    if (targetRowIndex < table.getNumRows()) {
                        row = table.getRow(targetRowIndex); // Use existing placeholder row
                    } else {
                        // Insert at the specific index to maintain order
                        row = table.insertRow(targetRowIndex, templateRow.copy());
                    }

                    // Fill data
                    for (const [ph, key] of Object.entries(itemMapping)) {
                        let val = item[key];
                        if (key === 'Honor' && val) {
                            // Ensure it's treated as a number
                            let num = parseInt(val.toString().replace(/[^0-9]/g, '')) || 0;
                            val = formatMoney(num);
                        }
                        row.replaceText(ph, val || "-");
                    }
                });
            } else {
                // No items, clear the first row
                const row = table.getRow(startIndex);
                for (const ph of Object.keys(itemMapping)) {
                    row.replaceText(ph, "-");
                }
            }

            // CLEANUP: CLEAR placeholders in REMAINING rows (Keep the rows, just empty them)
            // Start checking from the row AFTER what we just filled
            const cleanupStartIndex = (items.length > 0) ? (startIndex + items.length) : (startIndex + 1);

            // Iterate through remaining rows
            for (let r = cleanupStartIndex; r < table.getNumRows(); r++) {
                const row = table.getRow(r);
                const text = row.getText();

                // Only clear if it looks like a template row (contains placeholders)
                // We check for one common placeholder like <<item>>
                if (text.includes('<<item>>')) {
                    for (const ph of Object.keys(itemMapping)) {
                        row.replaceText(ph, ""); // Replace with empty string
                    }
                }
            }
        }
    }

    tempDoc.saveAndClose();

    // 7. Convert to PDF
    // CHECK FOR EXISTING PDF AND DELETE IT (REPLACE)
    const targetPdfName = newFilename + ".pdf";
    const existingFiles = targetFolder.getFilesByName(targetPdfName);
    while (existingFiles.hasNext()) {
        existingFiles.next().setTrashed(true);
    }

    const pdfBlob = tempFile.getAs(MimeType.PDF);
    const pdfFile = targetFolder.createFile(pdfBlob).setName(targetPdfName);

    // 8. Cleanup
    tempFile.setTrashed(true);

    return responseJSON({
        success: true,
        message: "PDF Created",
        pdf_url: pdfFile.getUrl()
    });
}

// --- HELPER UTILS ---

function responseJSON(data) {
    return ContentService.createTextOutput(JSON.stringify(data))
        .setMimeType(ContentService.MimeType.JSON);
}

function getRowData(sheet, keyColName, keyVal, filterColName, filterVal) {
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const keyIdx = headers.findIndex(h => h.toLowerCase().trim() === keyColName.toLowerCase());
    const filterIdx = headers.findIndex(h => h.toLowerCase().trim() === filterColName.toLowerCase());

    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (row[keyIdx] == keyVal && row[filterIdx].toString().toLowerCase() == filterVal.toString().toLowerCase()) {
            const obj = {};
            headers.forEach((h, idx) => obj[h.trim()] = row[idx]);
            return obj;
        }
    }
    return null;
}

function getAllRowsData(sheet, keyColName, keyVal, filterColName, filterVal) {
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const keyIdx = headers.findIndex(h => h.toLowerCase().trim() === keyColName.toLowerCase());
    const filterIdx = headers.findIndex(h => h.toLowerCase().trim() === filterColName.toLowerCase());

    const results = [];
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (row[keyIdx] == keyVal && row[filterIdx].toString().toLowerCase() == filterVal.toString().toLowerCase()) {
            const obj = {};
            headers.forEach((h, idx) => obj[h.trim()] = row[idx]);
            results.push(obj);
        }
    }
    return results;
}

function angkaTerbilang(nilai) {
    var bilangan = Number(nilai);
    var kalimat = "";
    var angka = ["", "Satu", "Dua", "Tiga", "Empat", "Lima", "Enam", "Tujuh", "Delapan", "Sembilan", "Sepuluh", "Sebelas"];

    if (bilangan < 12) {
        kalimat = angka[bilangan];
    } else if (bilangan < 20) {
        kalimat = angka[bilangan - 10] + " Belas";
    } else if (bilangan < 100) {
        kalimat = angka[Math.floor(bilangan / 10)] + " Puluh " + angka[bilangan % 10];
    } else if (bilangan < 200) {
        kalimat = "Seratus " + angkaTerbilang(bilangan - 100);
    } else if (bilangan < 1000) {
        kalimat = angka[Math.floor(bilangan / 100)] + " Ratus " + angkaTerbilang(bilangan % 100);
    } else if (bilangan < 2000) {
        kalimat = "Seribu " + angkaTerbilang(bilangan - 1000);
    } else if (bilangan < 1000000) {
        kalimat = angkaTerbilang(Math.floor(bilangan / 1000)) + " Ribu " + angkaTerbilang(bilangan % 1000);
    } else if (bilangan < 1000000000) {
        kalimat = angkaTerbilang(Math.floor(bilangan / 1000000)) + " Juta " + angkaTerbilang(bilangan % 1000000);
    }
    return kalimat.trim();
}

function formatMoney(n) {
    return n.toFixed(0).replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1.');
}

function formatDate(date) {
    if (!date) return "";
    if (date instanceof Date) {
        return Utilities.formatDate(date, "GMT+7", "dd MMMM yyyy");
    }
    return date.toString();
}

/**
 * Download PDF from Google Drive and return as Base64
 * Used by the Download All as ZIP feature
 */
function downloadPdfAsBase64(pdfUrl, mitraName) {
    try {
        if (!pdfUrl) {
            return responseJSON({ success: false, error: "URL tidak valid" });
        }

        // Extract File ID from Google Drive URL
        // Formats: /d/FILEID/, /file/d/FILEID/, open?id=FILEID
        let fileId = null;

        const patterns = [
            /\/d\/([a-zA-Z0-9_-]+)/,
            /\/file\/d\/([a-zA-Z0-9_-]+)/,
            /[?&]id=([a-zA-Z0-9_-]+)/
        ];

        for (const pattern of patterns) {
            const match = pdfUrl.match(pattern);
            if (match) {
                fileId = match[1];
                break;
            }
        }

        if (!fileId) {
            return responseJSON({ success: false, error: "Tidak dapat mengekstrak File ID dari URL" });
        }

        // Get the file from Google Drive
        const file = DriveApp.getFileById(fileId);

        // Get the PDF blob
        const blob = file.getBlob();

        // Convert to Base64
        const base64Content = Utilities.base64Encode(blob.getBytes());

        return responseJSON({
            success: true,
            content: base64Content,
            filename: file.getName(),
            mitra: mitraName
        });

    } catch (error) {
        return responseJSON({
            success: false,
            error: error.toString(),
            mitra: mitraName
        });
    }
}