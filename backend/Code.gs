/* Music Listening Study — Google Sheets backend (Apps Script).
   Paste this into Extensions → Apps Script of a Google Sheet, then
   Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
   Put the /exec URL into backendUrl in config.js. See backend/SETUP.md. */

var QUESTION_IDS = ['age', 'music_training', 'ai_music_is_real']; // must match additionalQuestions ids in config.js

var SESSION_COLS = ['participant_id', 'session_id', 'started_at', 'trials_completed', 'total_trials', 'status',
  'completed_at', 'last_activity_at', 'device', 'trial_order'].concat(QUESTION_IDS);

var RESPONSE_COLS = ['response_id', 'participant_id', 'session_id', 'trial_number', 'pair_id',
  'clip_a_version', 'clip_b_version', 'preferred_clip', 'preference_label', 'slider_raw', 'score_original_vs_ai',
  'plays_a', 'plays_b', 'completed_listens_a', 'completed_listens_b',
  'trial_start', 'trial_submit', 'audio_issues', 'server_received_at'];

function doGet() {
  return json({ ok: true, message: 'Music study backend is running.' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var p = JSON.parse(e.postData.contents);
    if (p.action === 'start') return json(start(p));
    if (p.action === 'submit') return json(submit(p));
    return json({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function start(p) {
  var sh = sheet('Sessions', SESSION_COLS);
  var row = findRow(sh, 2, p.sessionId);
  if (row) return { ok: true, nickname: String(sh.getRange(row, 1).getValue()), resumed: true };

  var props = PropertiesService.getScriptProperties();
  var id = Number(props.getProperty('nextId') || 1);
  props.setProperty('nextId', String(id + 1));

  var now = new Date().toISOString();
  var answers = p.answers || {};
  sh.appendRow([id, p.sessionId, now, 0, p.totalTrials, 'in_progress', '', now, p.device || '', p.trialOrder || '']
    .concat(QUESTION_IDS.map(function (q) { return answers[q] != null ? answers[q] : ''; })));
  return { ok: true, nickname: String(id) };
}

function submit(p) {
  var ss = sheet('Sessions', SESSION_COLS);
  var srow = findRow(ss, 2, p.sessionId);
  if (!srow) throw new Error('Unknown session');

  var rs = sheet('Responses', RESPONSE_COLS);
  var rid = p.sessionId + ':' + p.trial;
  if (findRow(rs, 1, rid)) return { ok: true, duplicate: true }; // resent after a network hiccup

  var now = new Date().toISOString();
  var pid = ss.getRange(srow, 1).getValue();
  var raw = Number(p.slider);
  var score = p.clipA === 'original' ? -raw : raw; // positive = preferred the original
  rs.appendRow([rid, pid, p.sessionId, p.trial, p.pairId, p.clipA, p.clipB,
    p.preferredClip || '', p.preferenceLabel || '', raw, score === 0 ? 0 : score,
    p.totalPlaysA != null ? p.totalPlaysA : p.playsA, p.totalPlaysB != null ? p.totalPlaysB : p.playsB,
    p.completesA, p.completesB,
    p.trialStart, p.trialSubmit, p.audioIssues || '', now]);

  var done = Number(ss.getRange(srow, 4).getValue()) + 1;
  var total = Number(ss.getRange(srow, 5).getValue());
  ss.getRange(srow, 4).setValue(done);
  ss.getRange(srow, 8).setValue(now);
  if (done >= total) {
    ss.getRange(srow, 6).setValue('complete');
    if (!ss.getRange(srow, 7).getValue()) ss.getRange(srow, 7).setValue(now);
  }
  return { ok: true, trialsCompleted: done };
}

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
