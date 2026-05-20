// Ganti dengan ID Google Spreadsheet Anda yang nyata.
var SPREADSHEET_ID = "1zR-utnh-drA4eVUWuASOboc7U1wfwnUxgbXDQk0jmMs"; 

function getSpreadsheet() {
  if (SPREADSHEET_ID && SPREADSHEET_ID !== "") {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSheetByGid(ss, gid) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId().toString() === gid.toString()) {
      return sheets[i];
    }
  }
  return null;
}

function doGet(e) {
  var action = e.parameter.action;
  
  if (action === "getOtpEmail" || action === "getOtp") {
    var label = e.parameter.label || "OTP-GO";
    var otp = ambilOtpDariGmail(label);
    
    // Fallback: Jika tidak ada OTP baru di Gmail, ambil dari sheet OTP-GO
    if (!otp) {
      otp = ambilOtpDariSheetOTPGo();
    }
    
    return ContentService.createTextOutput(otp)
      .setMimeType(ContentService.MimeType.TEXT);
  }
  
  return ContentService.createTextOutput("Gojek OTP Service Active. Use action=getOtpEmail");
}

function ambilOtpDariSheetOTPGo() {
  try {
    var ss = getSpreadsheet();
    var sheet = getSheetByGid(ss, "1789375209");
    if (!sheet) {
      sheet = ss.getSheetByName("OTP-GO");
    }
    if (!sheet) return "";
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return "";
    
    // Di sheet OTP-GO, kolom OTP adalah kolom ke-3 (Received At, Sender, OTP, Email Body, Written At)
    var otpValue = sheet.getRange(lastRow, 3).getValue();
    var otpStr = otpValue.toString();
    return otpStr.trim ? otpStr.trim() : otpStr;
  } catch (err) {
    return "";
  }
}

function ambilOtpDariGmail(labelName) {
  try {
    var threads = [];
    var label = GmailApp.getUserLabelByName(labelName);
    if (label) {
      threads = label.getThreads(0, 5); // Ambil hingga 5 thread terbaru
    } else {
      threads = GmailApp.search("label:" + labelName + " OR subject:OTP", 0, 5);
    }
    
    var allMessages = [];
    for (var i = 0; i < threads.length; i++) {
      var msgs = threads[i].getMessages();
      for (var j = 0; j < msgs.length; j++) {
        allMessages.push(msgs[j]);
      }
    }
    
    if (allMessages.length > 0) {
      // Urutkan pesan berdasarkan tanggal dari yang paling baru ke terlama
      allMessages.sort(function(a, b) {
        return b.getDate().getTime() - a.getDate().getTime();
      });
      
      var latestMessage = allMessages[0];
      var date = latestMessage.getDate();
      
      // Validasi usia email: jika lebih tua dari 3 menit, anggap usang/kedaluwarsa
      var ageMinutes = (new Date().getTime() - date.getTime()) / (1000 * 60);
      if (ageMinutes > 3.0) {
        return "";
      }
      
      var body = latestMessage.getPlainBody();
      var subject = latestMessage.getSubject();
      var sender = latestMessage.getFrom();
      
      // Ekstrak OTP dengan regex khusus untuk menghindari tahun 2025/2026/2027
      var otp = "";
      var patterns = [
        /kode verifikasi \(OTP\)[^\d]*(\d{4,6})/i,
        /verification code[^\d]*(\d{4,6})/i,
        /kode OTP[^\d]*(\d{4,6})/i,
        /OTP[^\d]*(\d{4,6})/i,
        /kode[^\d]*(\d{4,6})/i,
        /code[^\d]*(\d{4,6})/i
      ];
      
      for (var p = 0; p < patterns.length; p++) {
        var match = body.match(patterns[p]);
        if (match) {
          var val = match[1];
          if (val !== "2025" && val !== "2026" && val !== "2027") {
            otp = val;
            break;
          }
        }
      }
      
      if (!otp) {
        // Fallback: cari angka 4-6 digit apa saja di body yang bukan tahun
        var matches = body.match(/\b\d{4,6}\b/g);
        if (matches) {
          for (var m = 0; m < matches.length; m++) {
            var val = matches[m];
            if (val !== "2025" && val !== "2026" && val !== "2027" && val !== "2028") {
              otp = val;
              break;
            }
          }
        }
      }
      
      if (!otp && subject) {
        // Fallback ke subjek
        var subMatch = subject.match(/\b\d{4,6}\b/);
        if (subMatch) {
          otp = subMatch[0];
        }
      }
      
      if (otp) {
        // Simpan log ke sheet OTP-GO
        var ss = getSpreadsheet();
        var logSheet = getSheetByGid(ss, "1789375209"); // GID dari spreadsheet Anda
        
        if (!logSheet) {
          logSheet = ss.getSheetByName("OTP-GO");
        }
        if (!logSheet) {
          logSheet = ss.insertSheet("OTP-GO");
          logSheet.appendRow(["Received At", "Sender", "OTP", "Email Body", "Written At"]);
          logSheet.getRange("A1:E1").setFontWeight("bold").setBackground("#f3f3f3");
        }
        
        var formattedDate = Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
        var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
        
        // Cek baris terakhir untuk menghindari log duplikat
        var lastRow = logSheet.getLastRow();
        var duplicate = false;
        if (lastRow >= 2) {
          var lastOtpVal = logSheet.getRange(lastRow, 3).getValue().toString();
          if (lastOtpVal === otp) {
            duplicate = true;
          }
        }
        
        if (!duplicate) {
          logSheet.appendRow([
            formattedDate,
            sender,
            otp,
            body.substring(0, 1000),
            now
          ]);
        }
        
        return otp;
      }
    }
    return "";
  } catch (err) {
    return "";
  }
}

// Untuk menerima data POST
function doPost(e) {
  try {
    const ss = getSpreadsheet();
    var sheet = getSheetByGid(ss, "1789375209");
    if (!sheet) {
      sheet = ss.getSheetByName("OTP-GO");
    }
    if (!sheet) {
      sheet = ss.insertSheet("OTP-GO");
      sheet.appendRow(["Received At", "Sender", "OTP", "Email Body", "Written At"]);
      sheet.getRange("A1:E1").setFontWeight("bold").setBackground("#f3f3f3");
    }
    
    const data = JSON.parse(e.postData.contents);
    const receivedAt = data.received_at || "";
    const sender = data.sender || "";
    const otp = data.otp || "";
    const body = data.body || "";
    const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    
    sheet.appendRow([
      receivedAt,
      sender,
      otp,
      body.substring(0, 1000),
      now
    ]);
    
    return ContentService.createTextOutput(JSON.stringify({"status": "success"})).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({"status": "error", "message": error.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}
