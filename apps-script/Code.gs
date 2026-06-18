/**
 * Drive -> Supabase importer (Google Apps Script).
 * Runs every minute inside YOUR Google account, scans a Drive folder
 * (and its subfolders) for new images, and pushes each new one to your
 * AI Photo Sorter (Supabase Storage + a photos row) so it shows on the site.
 *
 * No OAuth tokens / scopes / consent-screen setup needed — Apps Script reads
 * your Drive natively. Duplicates are prevented by the unique drive_file_id
 * index you already created.
 */

// ===== CONFIG — fill these three in =====
const SUPABASE_URL    = 'https://nyhjkcrbomolgeraikss.supabase.co';
const SERVICE_ROLE_KEY = 'PASTE_SUPABASE_SERVICE_ROLE_KEY'; // Supabase -> Settings -> API -> service_role
const FOLDER_ID       = 'PASTE_DRIVE_FOLDER_ID';            // the "Event Photos" folder id (from its URL)
// ========================================

const BUCKET = 'photos';

/** Main job — runs every minute via the trigger. */
function importNewPhotos() {
  const owner = getOwnerUid_();
  if (!owner) { Logger.log('No owner uid in profiles — create/login an account first.'); return; }

  const props = PropertiesService.getScriptProperties();
  const root = DriveApp.getFolderById(FOLDER_ID);

  // root folder + all its subfolders (the date folders)
  const folders = [root];
  const subs = root.getFolders();
  while (subs.hasNext()) folders.push(subs.next());

  let imported = 0;
  for (let i = 0; i < folders.length; i++) {
    const files = folders[i].getFiles();
    while (files.hasNext()) {
      const file = files.next();
      if (file.getMimeType().indexOf('image/') !== 0) continue;
      const id = file.getId();
      if (props.getProperty('done_' + id)) continue;     // already synced
      try {
        importOne_(file, id, owner);
        props.setProperty('done_' + id, '1');
        imported++;
      } catch (e) {
        Logger.log('Failed ' + file.getName() + ': ' + e);
      }
    }
  }
  Logger.log('Imported ' + imported + ' new photo(s).');
}

function importOne_(file, id, owner) {
  const blob = file.getBlob();
  const mime = blob.getContentType() || 'image/jpeg';
  const name = file.getName();
  const ext  = name.indexOf('.') >= 0 ? name.split('.').pop() : 'jpg';
  const path = 'drive-import/' + id + '.' + ext;

  // 1) upload the bytes to Supabase Storage (upsert so re-runs don't 409)
  const up = UrlFetchApp.fetch(SUPABASE_URL + '/storage/v1/object/' + BUCKET + '/' + path, {
    method: 'post',
    contentType: mime,
    payload: blob.getBytes(),
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SERVICE_ROLE_KEY, 'x-upsert': 'true' },
    muteHttpExceptions: true
  });
  const uc = up.getResponseCode();
  if (uc !== 200 && uc !== 201 && up.getContentText().indexOf('Duplicate') < 0) {
    throw new Error('storage ' + uc + ': ' + up.getContentText());
  }

  const url = SUPABASE_URL + '/storage/v1/object/public/' + BUCKET + '/' + path;

  // 2) insert the photo row (ignore duplicates by drive_file_id)
  const ins = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/photos?on_conflict=drive_file_id', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      uid: owner, url: url, storage_path: path,
      source: 'drive', uploader: 'Google Drive',
      processed: false, drive_file_id: id
    }),
    headers: {
      apikey: SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SERVICE_ROLE_KEY,
      Prefer: 'return=minimal,resolution=ignore-duplicates'
    },
    muteHttpExceptions: true
  });
  if (ins.getResponseCode() >= 300) throw new Error('insert ' + ins.getResponseCode() + ': ' + ins.getContentText());
}

/** Find a real owner account (admin first) so the photos.uid foreign key is satisfied. */
function getOwnerUid_() {
  const headers = { apikey: SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SERVICE_ROLE_KEY };
  let rows = JSON.parse(UrlFetchApp.fetch(
    SUPABASE_URL + '/rest/v1/profiles?select=uid&role=eq.admin&limit=1',
    { headers: headers, muteHttpExceptions: true }).getContentText() || '[]');
  if (rows.length && rows[0].uid) return rows[0].uid;
  rows = JSON.parse(UrlFetchApp.fetch(
    SUPABASE_URL + '/rest/v1/profiles?select=uid&limit=1',
    { headers: headers, muteHttpExceptions: true }).getContentText() || '[]');
  return rows.length ? rows[0].uid : null;
}

/** Run this ONCE to install the every-minute trigger. */
function createTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'importNewPhotos') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('importNewPhotos').timeBased().everyMinutes(1).create();
  Logger.log('Trigger installed: importNewPhotos runs every 1 minute.');
}
