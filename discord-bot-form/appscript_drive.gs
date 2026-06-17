function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var rootFolderId = data.folderId;
    var platform = data.platform;
    var dateRange = data.dateRange;
    var filename = data.filename;
    var content = data.content; // Base64 encoded string
    
    if (!rootFolderId) {
      return ContentService.createTextOutput(JSON.stringify({
        status: "error",
        message: "Missing root folderId"
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    var rootFolder = DriveApp.getFolderById(rootFolderId);
    
    // 1. Get or create platform folder (Aplikator)
    var platformFolder = getOrCreateSubFolder(rootFolder, platform);
    
    // 2. Get or create dateRange folder (Tanggal)
    var targetFolder = getOrCreateSubFolder(platformFolder, dateRange);
    
    // 3. Remove existing file with the same name to avoid duplicates
    var existingFiles = targetFolder.getFilesByName(filename);
    while (existingFiles.hasNext()) {
      var existingFile = existingFiles.next();
      existingFile.setTrashed(true);
    }
    
    // 4. Create new file from base64 data
    var bytes = Utilities.base64Decode(content);
    var blob = Utilities.newBlob(bytes, "application/octet-stream", filename);
    var newFile = targetFolder.createFile(blob);
    
    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      url: newFile.getUrl(),
      fileId: newFile.getId(),
      path: platform + "/" + dateRange + "/" + filename
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function getOrCreateSubFolder(parentFolder, folderName) {
  var folders = parentFolder.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  } else {
    return parentFolder.createFolder(folderName);
  }
}
