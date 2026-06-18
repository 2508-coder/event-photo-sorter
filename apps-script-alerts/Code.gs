/**
 * Tag-me email alerts via Google Apps Script + Gmail (free, no Resend, no Edge Function).
 * Runs on a timer: finds NEW photos since the last run, matches each watcher's
 * face against them (descriptor math), and emails matched guests via Gmail.
 */

// ===== CONFIG — fill these in =====
const SUPABASE_URL    = 'https://nyhjkcrbomolgeraikss.supabase.co';
const SERVICE_ROLE_KEY = 'PASTE_SUPABASE_SERVICE_ROLE_KEY'; // Settings -> API -> service_role
const GUEST_URL       = 'https://YOUR-SITE/guest.html';     // link put in the email
// Face-match cutoff: faceapi engine = 0.5, human engine = 0.9 (must match your app)
const MATCH_THRESHOLD = 0.5;
// ==================================

function sendAlerts() {
  const props = PropertiesService.getScriptProperties();
  const lastRun = props.getProperty('lastRunISO') || '1970-01-01T00:00:00Z';
  const nowISO = new Date().toISOString();
  const headers = { apikey: SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SERVICE_ROLE_KEY };

  // 1) new, processed photos since last run
  const pUrl = SUPABASE_URL + '/rest/v1/photos?select=id,url,faces,created_at,hidden'
    + '&processed=eq.true&created_at=gt.' + encodeURIComponent(lastRun)
    + '&order=created_at.asc';
  const photos = JSON.parse(UrlFetchApp.fetch(pUrl, { headers: headers, muteHttpExceptions: true }).getContentText() || '[]');
  if (!photos.length) { props.setProperty('lastRunISO', nowISO); Logger.log('No new photos.'); return; }

  // 2) watchers (email + stored face descriptor)
  const wUrl = SUPABASE_URL + '/rest/v1/watchers?select=id,email,descriptor';
  const watchers = JSON.parse(UrlFetchApp.fetch(wUrl, { headers: headers, muteHttpExceptions: true }).getContentText() || '[]');
  if (!watchers.length) { props.setProperty('lastRunISO', nowISO); Logger.log('No watchers.'); return; }

  let emailed = 0;
  for (let w = 0; w < watchers.length; w++) {
    const desc = parseVec_(watchers[w].descriptor);
    if (!desc) continue;
    const hits = [];
    for (let i = 0; i < photos.length; i++) {
      const ph = photos[i];
      if (ph.hidden === true) continue;
      const faces = ph.faces || [];
      for (let f = 0; f < faces.length; f++) {
        const v = parseVec_(faces[f] && faces[f].v);
        if (v && euclid_(desc, v) < MATCH_THRESHOLD) { hits.push(ph); break; }
      }
    }
    if (hits.length) { mailWatcher_(watchers[w].email, hits); emailed++; }
  }

  props.setProperty('lastRunISO', nowISO);
  Logger.log('Checked ' + photos.length + ' new photo(s); emailed ' + emailed + ' watcher(s).');
}

function mailWatcher_(email, photos) {
  const n = photos.length;
  let html = '<p>Good news! ' + n + ' new photo' + (n > 1 ? 's' : '') + ' of you ' +
             (n > 1 ? 'were' : 'was') + ' just posted from the event.</p>';
  if (GUEST_URL && GUEST_URL.indexOf('YOUR-SITE') === -1) {
    html += '<p><a href="' + GUEST_URL + '">Open the gallery to view &amp; download &raquo;</a></p>';
  }
  html += '<p>Previews:</p>';
  for (let i = 0; i < Math.min(n, 6); i++) {
    html += '<img src="' + photos[i].url + '" style="width:160px;border-radius:8px;margin:4px"/>';
  }
  MailApp.sendEmail({ to: email, subject: '📸 New photos of you are posted!', htmlBody: html });
}

function parseVec_(x) {
  if (!x) return null;
  if (typeof x === 'string') { try { return JSON.parse(x); } catch (e) { return null; } }
  return Array.isArray(x) ? x : null;
}
function euclid_(a, b) {
  let s = 0; const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}

/** Run ONCE to email every 15 minutes. */
function createAlertsTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendAlerts') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendAlerts').timeBased().everyMinutes(15).create();
  Logger.log('Trigger installed: sendAlerts every 15 minutes.');
}
