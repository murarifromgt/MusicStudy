/** @OnlyCurrentDoc */
/* Music Listening Study — Google Sheets backend (Apps Script).
   Paste this into Extensions → Apps Script of a Google Sheet, then
   Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
   Put the /exec URL into backendUrl in config.js. See backend/SETUP.md.

   Security: anyone with the URL can POST here, so every field is validated,
   text is length-limited, and text starting with = + - @ is stored as plain
   text so it can never run as a spreadsheet formula. Nothing returns sheet data. */

var QUESTION_IDS = ['age', 'music_training', 'ai_music_is_real']; // must match additionalQuestions ids in config.js

var SESSION_COLS = ['participant_id', 'session_id', 'started_at', 'trials_completed', 'total_trials', 'status',
  'completed_at', 'last_activity_at', 'device', 'trial_order'].concat(QUESTION_IDS);

var RESPONSE_COLS = ['response_id', 'participant_id', 'session_id', 'trial_number', 'pair_id',
  'clip_a_version', 'clip_b_version', 'preferred_clip', 'preference_label', 'slider_raw', 'score_original_vs_ai',
  'plays_a', 'plays_b', 'completed_listens_a', 'completed_listens_b',
  'trial_start', 'trial_submit', 'audio_issues', 'server_received_at'];

var MAX_BODY = 20000;   // bytes; real requests are well under 10 KB
var MAX_TRIALS = 500;
var MAX_PLAYS = 1000;   // replays are unlimited on the site; this only blocks absurd values
var FIRST_PARTICIPANT_ID = 33; // participant IDs start here (never goes backwards if the counter is already higher)
var SLIDER_LIMIT = 100; // the site uses -3..3; kept loose in case the scale is changed in config.js

function doGet() {
  return json({ ok: true, message: 'Music study backend is running.' });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) throw new Error('Empty request');
    if (e.postData.contents.length > MAX_BODY) throw new Error('Request too large');
    var p = JSON.parse(e.postData.contents);
    if (!p || typeof p !== 'object') throw new Error('Bad request');
    if (p.action === 'start') return json(withLock(function () { return start(p); }));
    if (p.action === 'submit') return json(withLock(function () { return submit(p); }));
    return json({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function start(p) {
  var sid = sessionId(p.sessionId);
  var total = int(p.totalTrials, 1, MAX_TRIALS, 'totalTrials');

  var sh = sheet('Sessions', SESSION_COLS);
  var row = findRow(sh, 2, sid);
  if (row) return { ok: true, nickname: String(sh.getRange(row, 1).getValue()), resumed: true };

  var props = PropertiesService.getScriptProperties();
  var id = Math.max(Number(props.getProperty('nextId')) || 1, FIRST_PARTICIPANT_ID);
  props.setProperty('nextId', String(id + 1));

  var now = new Date().toISOString();
  var answers = (p.answers && typeof p.answers === 'object') ? p.answers : {};
  sh.appendRow(clean([id, sid, now, 0, total, 'in_progress', '', now, str(p.device, 20), str(p.trialOrder, 5000)]
    .concat(QUESTION_IDS.map(function (q) { return str(answers[q], 100); }))));
  return { ok: true, nickname: String(id) };
}

function submit(p) {
  var sid = sessionId(p.sessionId);
  var ss = sheet('Sessions', SESSION_COLS);
  var srow = findRow(ss, 2, sid);
  if (!srow) throw new Error('Unknown session');

  var total = Number(ss.getRange(srow, 5).getValue());
  var trial = int(p.trial, 1, total, 'trial');
  var pairId = str(p.pairId, 64);
  if (!pairId) throw new Error('Missing pairId');
  var a = version(p.clipA), b = version(p.clipB);
  if (a === b) throw new Error('Clip A and Clip B must be different versions');
  var playsA = int(p.totalPlaysA != null ? p.totalPlaysA : p.playsA, 0, MAX_PLAYS, 'playsA');
  var playsB = int(p.totalPlaysB != null ? p.totalPlaysB : p.playsB, 0, MAX_PLAYS, 'playsB');
  var compA = int(p.completesA, 0, playsA, 'completesA');
  var compB = int(p.completesB, 0, playsB, 'completesB');
  var raw = int(p.slider, -SLIDER_LIMIT, SLIDER_LIMIT, 'slider');
  var preferred = raw < 0 ? 'A' : raw > 0 ? 'B' : 'Neutral'; // derived here, not trusted from the browser

  var rs = sheet('Responses', RESPONSE_COLS);
  var rid = sid + ':' + trial;
  if (findRow(rs, 1, rid)) return { ok: true, duplicate: true }; // resent after a network hiccup

  var now = new Date().toISOString();
  var pid = ss.getRange(srow, 1).getValue();
  var score = a === 'original' ? -raw : raw; // positive = preferred the original
  rs.appendRow(clean([rid, pid, sid, trial, pairId, a, b,
    preferred, str(p.preferenceLabel, 60), raw, score === 0 ? 0 : score,
    playsA, playsB, compA, compB,
    str(p.trialStart, 40), str(p.trialSubmit, 40), str(p.audioIssues, 300), now]));

  var done = Number(ss.getRange(srow, 4).getValue()) + 1;
  ss.getRange(srow, 4).setValue(done);
  ss.getRange(srow, 8).setValue(now);
  if (done >= total) {
    ss.getRange(srow, 6).setValue('complete');
    if (!ss.getRange(srow, 7).getValue()) ss.getRange(srow, 7).setValue(now);
  }
  return { ok: true, trialsCompleted: done };
}

/* ---------------- Validation ---------------- */

function sessionId(v) {
  v = String(v || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(v)) throw new Error('Invalid session id');
  return v;
}

function int(v, min, max, name) {
  var n = Number(v);
  if (v === null || v === '' || typeof v === 'boolean' || !isFinite(n) || Math.floor(n) !== n || n < min || n > max) {
    throw new Error('Invalid ' + name);
  }
  return n;
}

function version(v) {
  if (v !== 'original' && v !== 'ai') throw new Error('Invalid clip version');
  return v;
}

function str(v, maxLen) {
  return v == null ? '' : String(v).slice(0, maxLen);
}

// Text starting with = + - @ (after any leading spaces/control chars) gets a leading
// apostrophe so Sheets stores it as plain text instead of running it as a formula.
function clean(row) {
  return row.map(function (v) {
    return (typeof v === 'string' && /^[\s\u0000-\u001f]*[=+\-@]/.test(v)) ? "'" + v : v;
  });
}

/* ---------------- Sheet helpers ---------------- */

function sheet(name, cols) {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sh = book.getSheetByName(name) || book.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(cols);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, cols.length).setFontWeight('bold');
  }
  return sh;
}

function findRow(sh, col, value) {
  var n = sh.getLastRow() - 1;
  if (n < 1) return 0;
  var vals = sh.getRange(2, col, n, 1).getValues();
  for (var i = 0; i < vals.length; i++) if (String(vals[i][0]) === String(value)) return i + 2;
  return 0;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
