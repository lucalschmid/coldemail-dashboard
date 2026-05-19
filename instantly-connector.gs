// ============================================================
// Compound Scaling Dashboard — Instantly Connector (v2 API)
// Google Apps Script  |  deploy as Web App
// ============================================================
//
// SETUP (one-time):
//   1. script.google.com → New project → paste this file
//   2. Project Settings → Script Properties → Add:
//        INSTANTLY_API_KEY  →  your key from app.instantly.ai/app/settings/api-keys
//   3. Deploy → New deployment → Web app
//        Execute as: Me
//        Who has access: Anyone
//   4. Copy the /exec URL → paste into data.js as APPS_SCRIPT_URL
//
// CLIENT MAP:
//   Instantly has no "client" concept. Map campaign IDs here.
//   Run testListCampaigns() first to verify IDs match.
// ============================================================

// ── Client mapping ──────────────────────────────────────────
const CLIENT_MAP = {
  // Cory Woodward (ID Axis by Leative)
  'f7f9fa72-5cc9-4303-88e5-390b5276b79b': 'Cory Woodward',
  'efecb243-a7ba-4968-bd9d-46a2c4ef246a': 'Cory Woodward',
  'b7e396a4-f893-47ed-a2f7-3017457bd705': 'Cory Woodward',
  '9edebe1d-07ee-466b-aed4-4b6c1fa98b38': 'Cory Woodward',
  '7127b8eb-d4b1-4e9b-9e1f-103226692956': 'Cory Woodward',
  '6a280465-f8c1-4070-aff6-b23f7cb81e29': 'Cory Woodward',

  // Lukas Rieger (100% Sauber)
  '83e3de04-36f6-4568-b19a-f97332f05efe': 'Lukas Rieger',

  // Comwrap Reply (Katie Davis)
  '3bb45613-5c30-4dd7-8b5c-7819a967a12a': 'Comwrap Reply',

  // Compound Scaling (Michelle)
  '2963dd5e-9598-4f70-9320-97c31338d960': 'Compound Scaling',
  '294c8e5d-f593-4f37-91b9-85f7606f7bb7': 'Compound Scaling',
  '2623797e-58af-4135-97c5-733272a33723': 'Compound Scaling',
  '08c4e446-3b5f-4c28-bd4e-e2d1c2e6e206': 'Compound Scaling',
  '053df7ff-0900-4d9e-abea-ab3df5f275f6': 'Compound Scaling',
};
const DEFAULT_CLIENT = 'Unassigned';

// ── Config ───────────────────────────────────────────────────
const API_KEY            = () => PropertiesService.getScriptProperties().getProperty('INSTANTLY_API_KEY');
const BASE_V2            = 'https://api.instantly.ai/api/v2';
const LOOKBACK_SPARKLINE = 14;
const LOOKBACK_STATS     = 7;

// ── Auth ─────────────────────────────────────────────────────
function fetchOpts() {
  const key = API_KEY();
  if (!key) throw new Error('INSTANTLY_API_KEY not set in Script Properties');
  return {
    method: 'get',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    muteHttpExceptions: true,
  };
}

// ── Cache key ────────────────────────────────────────────────
const CACHE_KEY = 'csd_dashboard_v1';

// ── Entry point (JSONP) — routes by ?action= parameter ────────
function doGet(e) {
  const cb = (e.parameter && e.parameter.callback) || 'callback';

  // Live proxy: inbox-level daily analytics from /accounts/analytics/daily
  if (e.parameter && e.parameter.action === 'inbox_analytics') {
    return handleInboxAnalytics(e, cb);
  }

  // Default: serve cached campaign dashboard data
  try {
    const props   = PropertiesService.getScriptProperties();
    const payload = props.getProperty(CACHE_KEY);
    if (!payload) {
      return ContentService
        .createTextOutput(cb + '(' + JSON.stringify({ error: 'cache_empty', message: 'Run refreshCache() in Apps Script editor to initialise.' }) + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService
      .createTextOutput(cb + '(' + payload + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  } catch (err) {
    return ContentService
      .createTextOutput(cb + '(' + JSON.stringify({ error: err.message }) + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
}

// ── Analytics cache key ───────────────────────────────────────
var ANALYTICS_CACHE_KEY = 'csd_analytics_v1';
var ACCOUNTS_KEY        = 'csd_accounts_v1';

// ── Inbox analytics — serves pre-aggregated cache ─────────────
// First call builds the cache inline (~30-60s for large workspaces).
// Subsequent calls return instantly from Script Properties.
function handleInboxAnalytics(e, cb) {
  try {
    var props = PropertiesService.getScriptProperties();
    var cache = props.getProperty(ANALYTICS_CACHE_KEY);
    if (!cache) {
      refreshAnalyticsCache();
      cache = props.getProperty(ANALYTICS_CACHE_KEY);
    }
    if (!cache) throw new Error('Analytics cache empty — run refreshAnalyticsCache() in the Apps Script editor.');
    return ContentService
      .createTextOutput(cb + '(' + cache + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  } catch (err) {
    return ContentService
      .createTextOutput(cb + '(' + JSON.stringify({ error: err.toString() }) + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
}

// ── Analytics cache builder ───────────────────────────────────
// 1. Pre-seeds inboxMap from the accounts list (simple paginated
//    GET, no emails[] params) so zero-activity inboxes are included.
// 2. Fills in analytics via 14-day date chunks (no emails filter,
//    no URL length risk).
function refreshAnalyticsCache() {
  var opts     = fetchOpts();
  var today    = new Date();
  var todayStr = fmtDate(today);

  var cutoffs = {
    'today': todayStr,
    '7d':    fmtDate(daysAgo(today, 6)),
    '30d':   fmtDate(daysAgo(today, 29)),
    '3mo':   fmtDate(daysAgo(today, 89)),
  };

  // Step 1: seed from the stored accounts list (zero-activity inboxes included,
  //          old/deleted accounts excluded)
  var inboxMap = {};
  var accountsJson = PropertiesService.getScriptProperties().getProperty(ACCOUNTS_KEY);
  if (!accountsJson) throw new Error('Accounts list not set — run setAccountsList() first.');
  var seedEmails = JSON.parse(accountsJson);
  Logger.log('Accounts in allowlist: ' + seedEmails.length);
  // Short keys to stay under the 500KB per-property limit
  // e=email, t=today, 7=7d, 30=30d, 90=3mo, s=sent, b=bounced, r=uniqueReplies, a=autoReplies
  seedEmails.forEach(function(email) {
    inboxMap[email] = {
      e: email,
      t:    { s: 0, b: 0, r: 0, a: 0 },
      '7':  { s: 0, b: 0, r: 0, a: 0 },
      '30': { s: 0, b: 0, r: 0, a: 0 },
      '90': { s: 0, b: 0, r: 0, a: 0 },
    };
  });

  // Step 2: walk backwards through 3 months in 14-day windows
  var chunkEnd   = new Date(today);
  var rangeStart = new Date(cutoffs['3mo'] + 'T12:00:00Z');

  while (chunkEnd >= rangeStart) {
    var chunkStart = new Date(chunkEnd);
    chunkStart.setDate(chunkEnd.getDate() - 13); // 14-day window
    if (chunkStart < rangeStart) chunkStart = rangeStart;

    var url = BASE_V2 + '/accounts/analytics/daily'
      + '?start_date=' + fmtDate(chunkStart)
      + '&end_date='   + fmtDate(chunkEnd);

    var res  = UrlFetchApp.fetch(url, opts);
    var rows = safeJsonArray(res);
    Logger.log('Chunk ' + fmtDate(chunkStart) + ' → ' + fmtDate(chunkEnd) + ': ' + rows.length + ' rows');

    rows.forEach(function(row) {
      var email = row.email_account;
      if (!email || !row.date) return;
      if (!inboxMap[email]) return; // not in allowlist — skip
      var r  = inboxMap[email];
      var d  = row.date;
      var s  = num(row.sent),            bo = num(row.bounced);
      var ur = num(row.unique_replies),   ar = num(row.unique_replies_automatic);
      if (d >= cutoffs['3mo'])  { r['90'].s += s; r['90'].b += bo; r['90'].r += ur; r['90'].a += ar; }
      if (d >= cutoffs['30d'])  { r['30'].s += s; r['30'].b += bo; r['30'].r += ur; r['30'].a += ar; }
      if (d >= cutoffs['7d'])   { r['7'].s  += s; r['7'].b  += bo; r['7'].r  += ur; r['7'].a  += ar; }
      if (d === todayStr)       { r.t.s     += s; r.t.b     += bo; r.t.r     += ur; r.t.a     += ar; }
    });

    // Move window back
    chunkEnd = new Date(chunkStart);
    chunkEnd.setDate(chunkStart.getDate() - 1);
  }

  var payload = JSON.stringify({
    generated_at: new Date().toISOString(),
    inboxes: Object.values(inboxMap),
  });
  PropertiesService.getScriptProperties().setProperty(ANALYTICS_CACHE_KEY, payload);
  Logger.log('Analytics cache saved. Inboxes: ' + Object.keys(inboxMap).length + ' | Size: ' + payload.length + ' bytes');
}

// ── Parse JSON array response safely ─────────────────────────
function safeJsonArray(res) {
  try { var r = JSON.parse(res.getContentText()); return Array.isArray(r) ? r : []; }
  catch (e) { return []; }
}


// ── Store current accounts allowlist ─────────────────────────
// Re-run this whenever you update your accounts CSV.
function setAccountsList() {
  var emails = ["c-woodward@meettheidaxis.com","c-woodward@theidaxisglobal.com","c-woodward@theidaxishq.com","c-woodward@theidaxislab.com","c-woodward@theidaxisnetwork.com","c-woodward@theidaxispartners.com","c-woodward@theidaxisplatform.com","c-woodward@theidaxisportal.com","c-woodward@theidaxissolutions.com","c-woodward@theidaxissystem.com","c-woodward@theidaxisteam.com","c-woodward@withtheidaxis.com","c.woodward@meettheidaxis.com","c.woodward@theidaxisglobal.com","c.woodward@theidaxishq.com","c.woodward@theidaxislab.com","c.woodward@theidaxisnetwork.com","c.woodward@theidaxispartners.com","c.woodward@theidaxisplatform.com","c.woodward@theidaxisportal.com","c.woodward@theidaxissolutions.com","c.woodward@theidaxissystem.com","c.woodward@theidaxisteam.com","c.woodward@withtheidaxis.com","c_woodward@meettheidaxis.com","c_woodward@theidaxisglobal.com","c_woodward@theidaxishq.com","c_woodward@theidaxislab.com","c_woodward@theidaxisnetwork.com","c_woodward@theidaxispartners.com","c_woodward@theidaxisplatform.com","c_woodward@theidaxisportal.com","c_woodward@theidaxissolutions.com","c_woodward@theidaxissystem.com","c_woodward@theidaxisteam.com","c_woodward@withtheidaxis.com","cory-c@meettheidaxis.com","cory-c@theidaxisglobal.com","cory-c@theidaxishq.com","cory-c@theidaxislab.com","cory-c@theidaxisnetwork.com","cory-c@theidaxispartners.com","cory-c@theidaxisplatform.com","cory-c@theidaxisportal.com","cory-c@theidaxissolutions.com","cory-c@theidaxissystem.com","cory-c@theidaxisteam.com","cory-c@withtheidaxis.com","cory-cw@meettheidaxis.com","cory-cw@theidaxisglobal.com","cory-cw@theidaxishq.com","cory-cw@theidaxislab.com","cory-cw@theidaxisnetwork.com","cory-cw@theidaxispartners.com","cory-cw@theidaxisplatform.com","cory-cw@theidaxisportal.com","cory-cw@theidaxissolutions.com","cory-cw@theidaxissystem.com","cory-cw@theidaxisteam.com","cory-cw@withtheidaxis.com","cory-w@meettheidaxis.com","cory-w@theidaxisglobal.com","cory-w@theidaxishq.com","cory-w@theidaxislab.com","cory-w@theidaxisnetwork.com","cory-w@theidaxispartners.com","cory-w@theidaxisplatform.com","cory-w@theidaxisportal.com","cory-w@theidaxissolutions.com","cory-w@theidaxissystem.com","cory-w@theidaxisteam.com","cory-w@withtheidaxis.com","cory-woodward@meettheidaxis.com","cory-woodward@theidaxisglobal.com","cory-woodward@theidaxishq.com","cory-woodward@theidaxislab.com","cory-woodward@theidaxisnetwork.com","cory-woodward@theidaxispartners.com","cory-woodward@theidaxisplatform.com","cory-woodward@theidaxisportal.com","cory-woodward@theidaxissolutions.com","cory-woodward@theidaxissystem.com","cory-woodward@theidaxisteam.com","cory-woodward@withtheidaxis.com","cory-ww@meettheidaxis.com","cory-ww@theidaxisglobal.com","cory-ww@theidaxishq.com","cory-ww@theidaxislab.com","cory-ww@theidaxisnetwork.com","cory-ww@theidaxispartners.com","cory-ww@theidaxisplatform.com","cory-ww@theidaxisportal.com","cory-ww@theidaxissolutions.com","cory-ww@theidaxissystem.com","cory-ww@theidaxisteam.com","cory-ww@withtheidaxis.com","cory.c@meettheidaxis.com","cory.c@theidaxisglobal.com","cory.c@theidaxishq.com","cory.c@theidaxislab.com","cory.c@theidaxisnetwork.com","cory.c@theidaxispartners.com","cory.c@theidaxisplatform.com","cory.c@theidaxisportal.com","cory.c@theidaxissolutions.com","cory.c@theidaxissystem.com","cory.c@theidaxisteam.com","cory.c@withtheidaxis.com","cory.cw@meettheidaxis.com","cory.cw@theidaxisglobal.com","cory.cw@theidaxishq.com","cory.cw@theidaxislab.com","cory.cw@theidaxisnetwork.com","cory.cw@theidaxispartners.com","cory.cw@theidaxisplatform.com","cory.cw@theidaxisportal.com","cory.cw@theidaxissolutions.com","cory.cw@theidaxissystem.com","cory.cw@theidaxisteam.com","cory.cw@withtheidaxis.com","cory.w@meettheidaxis.com","cory.w@theidaxisglobal.com","cory.w@theidaxishq.com","cory.w@theidaxislab.com","cory.w@theidaxisnetwork.com","cory.w@theidaxispartners.com","cory.w@theidaxisplatform.com","cory.w@theidaxisportal.com","cory.w@theidaxissolutions.com","cory.w@theidaxissystem.com","cory.w@theidaxisteam.com","cory.w@withtheidaxis.com","cory.woodward@discovertheidaxis.com","cory.woodward@exploretheidaxis.com","cory.woodward@gettheidaxis.com","cory.woodward@jointheidaxis.com","cory.woodward@meettheidaxis.com","cory.woodward@theidaxisglobal.com","cory.woodward@theidaxisgroup.com","cory.woodward@theidaxishq.com","cory.woodward@theidaxislab.com","cory.woodward@theidaxisnetwork.com","cory.woodward@theidaxispartners.com","cory.woodward@theidaxisplatform.com","cory.woodward@theidaxisportal.com","cory.woodward@theidaxissolutions.com","cory.woodward@theidaxissystem.com","cory.woodward@theidaxisteam.com","cory.woodward@usetheidaxis.com","cory.woodward@withtheidaxis.com","cory.ww@meettheidaxis.com","cory.ww@theidaxisglobal.com","cory.ww@theidaxishq.com","cory.ww@theidaxislab.com","cory.ww@theidaxisnetwork.com","cory.ww@theidaxispartners.com","cory.ww@theidaxisplatform.com","cory.ww@theidaxisportal.com","cory.ww@theidaxissolutions.com","cory.ww@theidaxissystem.com","cory.ww@theidaxisteam.com","cory.ww@withtheidaxis.com","cory@discovertheidaxis.com","cory@exploretheidaxis.com","cory@gettheidaxis.com","cory@jointheidaxis.com","cory@meettheidaxis.com","cory@theidaxisglobal.com","cory@theidaxisgroup.com","cory@theidaxishq.com","cory@theidaxislab.com","cory@theidaxisnetwork.com","cory@theidaxispartners.com","cory@theidaxisportal.com","cory@theidaxissolutions.com","cory@theidaxissystem.com","cory@theidaxisteam.com","cory@usetheidaxis.com","cory@withtheidaxis.com","cory_c@meettheidaxis.com","cory_c@theidaxisglobal.com","cory_c@theidaxishq.com","cory_c@theidaxislab.com","cory_c@theidaxisnetwork.com","cory_c@theidaxispartners.com","cory_c@theidaxisplatform.com","cory_c@theidaxisportal.com","cory_c@theidaxissolutions.com","cory_c@theidaxissystem.com","cory_c@theidaxisteam.com","cory_cw@meettheidaxis.com","cory_cw@theidaxisglobal.com","cory_cw@theidaxishq.com","cory_cw@theidaxislab.com","cory_cw@theidaxisnetwork.com","cory_cw@theidaxispartners.com","cory_cw@theidaxisplatform.com","cory_cw@theidaxisportal.com","cory_cw@theidaxissolutions.com","cory_cw@theidaxissystem.com","cory_cw@theidaxisteam.com","cory_cw@withtheidaxis.com","cory_w@meettheidaxis.com","cory_w@theidaxisglobal.com","cory_w@theidaxishq.com","cory_w@theidaxislab.com","cory_w@theidaxisnetwork.com","cory_w@theidaxispartners.com","cory_w@theidaxisplatform.com","cory_w@theidaxisportal.com","cory_w@theidaxissolutions.com","cory_w@theidaxissystem.com","cory_w@theidaxisteam.com","cory_w@withtheidaxis.com","cory_woodward@meettheidaxis.com","cory_woodward@theidaxisglobal.com","cory_woodward@theidaxishq.com","cory_woodward@theidaxislab.com","cory_woodward@theidaxisnetwork.com","cory_woodward@theidaxispartners.com","cory_woodward@theidaxisplatform.com","cory_woodward@theidaxisportal.com","cory_woodward@theidaxissolutions.com","cory_woodward@theidaxissystem.com","cory_woodward@theidaxisteam.com","cory_woodward@withtheidaxis.com","cory_ww@meettheidaxis.com","cory_ww@theidaxisglobal.com","cory_ww@theidaxishq.com","cory_ww@theidaxislab.com","cory_ww@theidaxisnetwork.com","cory_ww@theidaxispartners.com","cory_ww@theidaxisplatform.com","cory_ww@theidaxisportal.com","cory_ww@theidaxissolutions.com","cory_ww@theidaxissystem.com","cory_ww@theidaxisteam.com","cory_ww@withtheidaxis.com","coryc-woodward@meettheidaxis.com","coryc-woodward@theidaxisglobal.com","coryc-woodward@theidaxishq.com","coryc-woodward@theidaxislab.com","coryc-woodward@theidaxisnetwork.com","coryc-woodward@theidaxispartners.com","coryc-woodward@theidaxisplatform.com","coryc-woodward@theidaxisportal.com","coryc-woodward@theidaxissolutions.com","coryc-woodward@theidaxissystem.com","coryc-woodward@theidaxisteam.com","coryc-woodward@withtheidaxis.com","coryc.woodward@meettheidaxis.com","coryc.woodward@theidaxisglobal.com","coryc.woodward@theidaxishq.com","coryc.woodward@theidaxislab.com","coryc.woodward@theidaxisnetwork.com","coryc.woodward@theidaxispartners.com","coryc.woodward@theidaxisplatform.com","coryc.woodward@theidaxisportal.com","coryc.woodward@theidaxissolutions.com","coryc.woodward@theidaxissystem.com","coryc.woodward@theidaxisteam.com","coryc.woodward@withtheidaxis.com","coryc@meettheidaxis.com","coryc@theidaxisglobal.com","coryc@theidaxishq.com","coryc@theidaxislab.com","coryc@theidaxisnetwork.com","coryc@theidaxispartners.com","coryc@theidaxisplatform.com","coryc@theidaxisportal.com","coryc@theidaxissolutions.com","coryc@theidaxissystem.com","coryc@theidaxisteam.com","coryc@withtheidaxis.com","coryc_woodward@meettheidaxis.com","coryc_woodward@theidaxisglobal.com","coryc_woodward@theidaxishq.com","coryc_woodward@theidaxislab.com","coryc_woodward@theidaxisnetwork.com","coryc_woodward@theidaxispartners.com","coryc_woodward@theidaxisplatform.com","coryc_woodward@theidaxisportal.com","coryc_woodward@theidaxissolutions.com","coryc_woodward@theidaxissystem.com","coryc_woodward@theidaxisteam.com","coryc_woodward@withtheidaxis.com","corycw@theidaxisglobal.com","corycw@theidaxishq.com","corycw@theidaxislab.com","corycw@theidaxisnetwork.com","corycw@theidaxispartners.com","corycw@theidaxisplatform.com","corycw@theidaxisportal.com","corycw@theidaxissolutions.com","corycw@theidaxissystem.com","corycw@theidaxisteam.com","corycw@withtheidaxis.com","corycwoodward@meettheidaxis.com","corycwoodward@theidaxisglobal.com","corycwoodward@theidaxishq.com","corycwoodward@theidaxislab.com","corycwoodward@theidaxisnetwork.com","corycwoodward@theidaxispartners.com","corycwoodward@theidaxisplatform.com","corycwoodward@theidaxisportal.com","corycwoodward@theidaxissolutions.com","corycwoodward@theidaxissystem.com","corycwoodward@theidaxisteam.com","corycwoodward@withtheidaxis.com","coryw-woodward@meettheidaxis.com","coryw-woodward@theidaxisglobal.com","coryw-woodward@theidaxishq.com","coryw-woodward@theidaxislab.com","coryw-woodward@theidaxisnetwork.com","coryw-woodward@theidaxispartners.com","coryw-woodward@theidaxisplatform.com","coryw-woodward@theidaxisportal.com","coryw-woodward@theidaxissolutions.com","coryw-woodward@theidaxissystem.com","coryw-woodward@withtheidaxis.com","coryw.woodward@meettheidaxis.com","coryw.woodward@theidaxisglobal.com","coryw.woodward@theidaxishq.com","coryw.woodward@theidaxislab.com","coryw.woodward@theidaxisnetwork.com","coryw.woodward@theidaxispartners.com","coryw.woodward@theidaxisplatform.com","coryw.woodward@theidaxisportal.com","coryw.woodward@theidaxissolutions.com","coryw.woodward@theidaxissystem.com","coryw.woodward@theidaxisteam.com","coryw.woodward@withtheidaxis.com","coryw@meettheidaxis.com","coryw@theidaxisglobal.com","coryw@theidaxishq.com","coryw@theidaxislab.com","coryw@theidaxisnetwork.com","coryw@theidaxispartners.com","coryw@theidaxisplatform.com","coryw@theidaxisportal.com","coryw@theidaxissolutions.com","coryw@theidaxissystem.com","coryw@theidaxisteam.com","coryw@withtheidaxis.com","coryw_woodward@meettheidaxis.com","coryw_woodward@theidaxisglobal.com","coryw_woodward@theidaxishq.com","coryw_woodward@theidaxislab.com","coryw_woodward@theidaxisnetwork.com","coryw_woodward@theidaxispartners.com","coryw_woodward@theidaxisplatform.com","coryw_woodward@theidaxisportal.com","coryw_woodward@theidaxissolutions.com","coryw_woodward@theidaxissystem.com","coryw_woodward@theidaxisteam.com","coryw_woodward@withtheidaxis.com","corywoodward-c@meettheidaxis.com","corywoodward-c@theidaxisglobal.com","corywoodward-c@theidaxishq.com","corywoodward-c@theidaxislab.com","corywoodward-c@theidaxisnetwork.com","corywoodward-c@theidaxispartners.com","corywoodward-c@theidaxisplatform.com","corywoodward-c@theidaxisportal.com","corywoodward-c@theidaxissolutions.com","corywoodward-c@theidaxissystem.com","corywoodward-c@theidaxisteam.com","corywoodward-c@withtheidaxis.com","corywoodward-cw@meettheidaxis.com","corywoodward-cw@theidaxishq.com","corywoodward-cw@theidaxislab.com","corywoodward-cw@theidaxisnetwork.com","corywoodward-cw@theidaxisplatform.com","corywoodward-cw@theidaxisportal.com","corywoodward-cw@theidaxissolutions.com","corywoodward-cw@theidaxissystem.com","corywoodward-cw@theidaxisteam.com","corywoodward-cw@withtheidaxis.com","corywoodward-w@meettheidaxis.com","corywoodward-w@theidaxisglobal.com","corywoodward-w@theidaxishq.com","corywoodward-w@theidaxislab.com","corywoodward-w@theidaxisnetwork.com","corywoodward-w@theidaxispartners.com","corywoodward-w@theidaxisplatform.com","corywoodward-w@theidaxisportal.com","corywoodward-w@theidaxissolutions.com","corywoodward-w@theidaxissystem.com","corywoodward-w@theidaxisteam.com","corywoodward-w@withtheidaxis.com","corywoodward.c@meettheidaxis.com","corywoodward.c@theidaxisglobal.com","corywoodward.c@theidaxishq.com","corywoodward.c@theidaxislab.com","corywoodward.c@theidaxisnetwork.com","corywoodward.c@theidaxispartners.com","corywoodward.c@theidaxisplatform.com","corywoodward.c@theidaxisportal.com","corywoodward.c@theidaxissolutions.com","corywoodward.c@theidaxissystem.com","corywoodward.c@theidaxisteam.com","corywoodward.c@withtheidaxis.com","corywoodward.cw@meettheidaxis.com","corywoodward.cw@theidaxisglobal.com","corywoodward.cw@theidaxishq.com","corywoodward.cw@theidaxisnetwork.com","corywoodward.cw@theidaxispartners.com","corywoodward.cw@theidaxisplatform.com","corywoodward.cw@theidaxisportal.com","corywoodward.cw@theidaxissolutions.com","corywoodward.cw@theidaxissystem.com","corywoodward.cw@theidaxisteam.com","corywoodward.cw@withtheidaxis.com","corywoodward.w@meettheidaxis.com","corywoodward.w@theidaxisglobal.com","corywoodward.w@theidaxishq.com","corywoodward.w@theidaxislab.com","corywoodward.w@theidaxisnetwork.com","corywoodward.w@theidaxispartners.com","corywoodward.w@theidaxisplatform.com","corywoodward.w@theidaxisportal.com","corywoodward.w@theidaxissolutions.com","corywoodward.w@theidaxissystem.com","corywoodward.w@theidaxisteam.com","corywoodward.w@withtheidaxis.com","corywoodward.ww@meettheidaxis.com","corywoodward.ww@theidaxisglobal.com","corywoodward.ww@theidaxishq.com","corywoodward.ww@theidaxisnetwork.com","corywoodward.ww@theidaxispartners.com","corywoodward.ww@theidaxisplatform.com","corywoodward.ww@theidaxisportal.com","corywoodward.ww@theidaxissolutions.com","corywoodward.ww@theidaxisteam.com","corywoodward@meettheidaxis.com","corywoodward@theidaxisglobal.com","corywoodward@theidaxishq.com","corywoodward@theidaxislab.com","corywoodward@theidaxisnetwork.com","corywoodward@theidaxispartners.com","corywoodward@theidaxisplatform.com","corywoodward@theidaxisportal.com","corywoodward@theidaxissolutions.com","corywoodward@theidaxissystem.com","corywoodward@theidaxisteam.com","corywoodward@withtheidaxis.com","corywoodward_c@meettheidaxis.com","corywoodward_c@theidaxisglobal.com","corywoodward_c@theidaxishq.com","corywoodward_c@theidaxislab.com","corywoodward_c@theidaxisnetwork.com","corywoodward_c@theidaxispartners.com","corywoodward_c@theidaxisplatform.com","corywoodward_c@theidaxisportal.com","corywoodward_c@theidaxissolutions.com","corywoodward_c@theidaxissystem.com","corywoodward_c@theidaxisteam.com","corywoodward_c@withtheidaxis.com","corywoodward_cw@meettheidaxis.com","corywoodward_cw@theidaxisglobal.com","corywoodward_cw@theidaxishq.com","corywoodward_cw@theidaxislab.com","corywoodward_cw@theidaxisnetwork.com","corywoodward_cw@theidaxispartners.com","corywoodward_cw@theidaxisplatform.com","corywoodward_cw@theidaxisportal.com","corywoodward_cw@theidaxissolutions.com","corywoodward_cw@theidaxissystem.com","corywoodward_cw@theidaxisteam.com","corywoodward_cw@withtheidaxis.com","corywoodward_w@theidaxisglobal.com","corywoodward_w@theidaxishq.com","corywoodward_w@theidaxislab.com","corywoodward_w@theidaxisnetwork.com","corywoodward_w@theidaxispartners.com","corywoodward_w@theidaxisplatform.com","corywoodward_w@theidaxisportal.com","corywoodward_w@theidaxissolutions.com","corywoodward_w@theidaxissystem.com","corywoodward_w@theidaxisteam.com","corywoodward_w@withtheidaxis.com","corywoodwardc@meettheidaxis.com","corywoodwardc@theidaxisglobal.com","corywoodwardc@theidaxishq.com","corywoodwardc@theidaxislab.com","corywoodwardc@theidaxisnetwork.com","corywoodwardc@theidaxispartners.com","corywoodwardc@theidaxisplatform.com","corywoodwardc@theidaxisportal.com","corywoodwardc@theidaxissolutions.com","corywoodwardc@theidaxissystem.com","corywoodwardc@theidaxisteam.com","corywoodwardc@withtheidaxis.com","corywoodwardcw@meettheidaxis.com","corywoodwardcw@theidaxisglobal.com","corywoodwardcw@theidaxishq.com","corywoodwardcw@theidaxislab.com","corywoodwardcw@theidaxisnetwork.com","corywoodwardcw@theidaxispartners.com","corywoodwardcw@theidaxisplatform.com","corywoodwardcw@theidaxisportal.com","corywoodwardcw@theidaxissolutions.com","corywoodwardcw@theidaxissystem.com","corywoodwardcw@theidaxisteam.com","corywoodwardcw@withtheidaxis.com","corywoodwardw@meettheidaxis.com","corywoodwardw@theidaxisglobal.com","corywoodwardw@theidaxishq.com","corywoodwardw@theidaxislab.com","corywoodwardw@theidaxisnetwork.com","corywoodwardw@theidaxispartners.com","corywoodwardw@theidaxisplatform.com","corywoodwardw@theidaxisportal.com","corywoodwardw@theidaxissolutions.com","corywoodwardw@theidaxissystem.com","corywoodwardw@theidaxisteam.com","corywoodwardw@withtheidaxis.com","corywoodwardww@meettheidaxis.com","corywoodwardww@theidaxishq.com","corywoodwardww@theidaxislab.com","corywoodwardww@theidaxisnetwork.com","corywoodwardww@theidaxisplatform.com","corywoodwardww@theidaxissolutions.com","corywoodwardww@theidaxisteam.com","corywoodwardww@withtheidaxis.com","coryww@meettheidaxis.com","coryww@theidaxisglobal.com","coryww@theidaxishq.com","coryww@theidaxislab.com","coryww@theidaxisnetwork.com","coryww@theidaxispartners.com","coryww@theidaxisplatform.com","coryww@theidaxisportal.com","coryww@theidaxissolutions.com","coryww@theidaxissystem.com","coryww@theidaxisteam.com","coryww@withtheidaxis.com","corywwoodward@meettheidaxis.com","corywwoodward@theidaxisglobal.com","corywwoodward@theidaxishq.com","corywwoodward@theidaxislab.com","corywwoodward@theidaxisnetwork.com","corywwoodward@theidaxispartners.com","corywwoodward@theidaxisplatform.com","corywwoodward@theidaxisportal.com","corywwoodward@theidaxissolutions.com","corywwoodward@theidaxissystem.com","corywwoodward@theidaxisteam.com","corywwoodward@withtheidaxis.com","cwoodward@meettheidaxis.com","cwoodward@theidaxisglobal.com","cwoodward@theidaxishq.com","cwoodward@theidaxislab.com","cwoodward@theidaxisnetwork.com","cwoodward@theidaxispartners.com","cwoodward@theidaxisplatform.com","cwoodward@theidaxisportal.com","cwoodward@theidaxissolutions.com","cwoodward@theidaxissystem.com","cwoodward@theidaxisteam.com","cwoodward@withtheidaxis.com","davis-k@buildwithcomwrap.com","davis-k@growwithcomwrap.com","davis.k@buildwithcomwrap.com","davis.k@growwithcomwrap.com","davis@buildwithcomwrap.com","davis@growwithcomwrap.com","davis_k@buildwithcomwrap.com","davis_k@growwithcomwrap.com","davisk@buildwithcomwrap.com","davisk@growwithcomwrap.com","k-davis@buildwithcomwrap.com","k-davis@growwithcomwrap.com","k.davis@buildwithcomwrap.com","k.davis@growwithcomwrap.com","k_davis@buildwithcomwrap.com","k_davis@growwithcomwrap.com","katie-d@buildwithcomwrap.com","katie-d@growwithcomwrap.com","katie-davis@buildwithcomwrap.com","katie-davis@growwithcomwrap.com","katie-dd@buildwithcomwrap.com","katie-dd@growwithcomwrap.com","katie-k@buildwithcomwrap.com","katie-k@growwithcomwrap.com","katie-kd@buildwithcomwrap.com","katie-kd@growwithcomwrap.com","katie.d@buildwithcomwrap.com","katie.d@growwithcomwrap.com","katie.davis@buildwithcomwrap.com","katie.davis@growwithcomwrap.com","katie.dd@buildwithcomwrap.com","katie.dd@growwithcomwrap.com","katie.k@buildwithcomwrap.com","katie.k@growwithcomwrap.com","katie.kd@buildwithcomwrap.com","katie.kd@growwithcomwrap.com","katie@buildwithcomwrap.com","katie@growwithcomwrap.com","katie_d@buildwithcomwrap.com","katie_d@growwithcomwrap.com","katie_davis@growwithcomwrap.com","katie_dd@buildwithcomwrap.com","katie_dd@growwithcomwrap.com","katie_k@buildwithcomwrap.com","katie_k@growwithcomwrap.com","katie_kd@buildwithcomwrap.com","katie_kd@growwithcomwrap.com","katied-davis@buildwithcomwrap.com","katied-davis@growwithcomwrap.com","katied.davis@buildwithcomwrap.com","katied.davis@growwithcomwrap.com","katied@buildwithcomwrap.com","katied@growwithcomwrap.com","katied_davis@buildwithcomwrap.com","katied_davis@growwithcomwrap.com","katiedavis-d@buildwithcomwrap.com","katiedavis-k@buildwithcomwrap.com","katiedavis-k@growwithcomwrap.com","katiedavis-kd@buildwithcomwrap.com","katiedavis-kd@growwithcomwrap.com","katiedavis.d@buildwithcomwrap.com","katiedavis.d@growwithcomwrap.com","katiedavis.dd@buildwithcomwrap.com","katiedavis.dd@growwithcomwrap.com","katiedavis.k@buildwithcomwrap.com","katiedavis.k@growwithcomwrap.com","katiedavis.kd@buildwithcomwrap.com","katiedavis.kd@growwithcomwrap.com","katiedavis@buildwithcomwrap.com","katiedavis@growwithcomwrap.com","katiedavis_d@buildwithcomwrap.com","katiedavis_d@growwithcomwrap.com","katiedavis_k@buildwithcomwrap.com","katiedavis_k@growwithcomwrap.com","katiedavis_kd@buildwithcomwrap.com","katiedavis_kd@growwithcomwrap.com","katiedavisd@buildwithcomwrap.com","katiedavisd@growwithcomwrap.com","katiedavisdd@buildwithcomwrap.com","katiedavisdd@growwithcomwrap.com","katiedavisk@buildwithcomwrap.com","katiedavisk@growwithcomwrap.com","katiedaviskd@buildwithcomwrap.com","katiedaviskd@growwithcomwrap.com","katiedd@buildwithcomwrap.com","katiedd@growwithcomwrap.com","katieddavis@buildwithcomwrap.com","katieddavis@growwithcomwrap.com","katiek-davis@buildwithcomwrap.com","katiek-davis@growwithcomwrap.com","katiek.davis@buildwithcomwrap.com","katiek.davis@growwithcomwrap.com","katiek@buildwithcomwrap.com","katiek@growwithcomwrap.com","katiek_davis@buildwithcomwrap.com","katiek_davis@growwithcomwrap.com","katiekd@buildwithcomwrap.com","katiekd@growwithcomwrap.com","katiekdavis@buildwithcomwrap.com","katiekdavis@growwithcomwrap.com","kdavis@buildwithcomwrap.com","kdavis@growwithcomwrap.com","l.rieger@pvpflege.de","l.rieger@saubermodul.de","lukas.rieger@pvpflege.de","lukas.rieger@saubermodul.de","lukas@pvpflege.de","lukas@saubermodul.de","m-thomas@activatecompoundscaling.com","m-thomas@compoundprospect.com","m-thomas@compoundscalingcapital.com","m-thomas@compoundscalingelite.com","m-thomas@compoundscalingglobal.com","m-thomas@compoundscalinghq.com","m-thomas@compoundscalinglabs.com","m-thomas@compoundscalingnetwork.com","m-thomas@compoundscalingteam.com","m-thomas@compoundscalingtoday.com","m-thomas@compoundscalingventures.com","m-thomas@getcompoundscaling.com","m-thomas@gocompoundscaling.com","m-thomas@launchcompoundscaling.com","m-thomas@runcompoundscaling.com","m-thomas@scalewithcompoundscaling.com","m-thomas@scalingoutbound.com","m-thomas@scalingprecision.com","m-thomas@startcompoundscaling.com","m-thomas@trycompoundscaling.com","m.thomas@compoundprospect.com","m.thomas@compoundscalingcapital.com","m.thomas@compoundscalingelite.com","m.thomas@compoundscalingglobal.com","m.thomas@compoundscalinghq.com","m.thomas@compoundscalinglabs.com","m.thomas@compoundscalingnetwork.com","m.thomas@compoundscalingteam.com","m.thomas@compoundscalingtoday.com","m.thomas@compoundscalingventures.com","m.thomas@getcompoundscaling.com","m.thomas@gocompoundscaling.com","m.thomas@launchcompoundscaling.com","m.thomas@runcompoundscaling.com","m.thomas@scalewithcompoundscaling.com","m.thomas@scalingoutbound.com","m.thomas@scalingprecision.com","m.thomas@startcompoundscaling.com","m.thomas@trycompoundscaling.com","m_thomas@activatecompoundscaling.com","m_thomas@compoundprospect.com","m_thomas@compoundscalingcapital.com","m_thomas@compoundscalingelite.com","m_thomas@compoundscalingglobal.com","m_thomas@compoundscalinghq.com","m_thomas@compoundscalinglabs.com","m_thomas@compoundscalingnetwork.com","m_thomas@compoundscalingteam.com","m_thomas@compoundscalingtoday.com","m_thomas@compoundscalingventures.com","m_thomas@getcompoundscaling.com","m_thomas@gocompoundscaling.com","m_thomas@launchcompoundscaling.com","m_thomas@runcompoundscaling.com","m_thomas@scalewithcompoundscaling.com","m_thomas@scalingoutbound.com","m_thomas@scalingprecision.com","m_thomas@startcompoundscaling.com","m_thomas@trycompoundscaling.com","michelle-m@activatecompoundscaling.com","michelle-m@compoundprospect.com","michelle-m@compoundscalingcapital.com","michelle-m@compoundscalingelite.com","michelle-m@compoundscalingglobal.com","michelle-m@compoundscalinghq.com","michelle-m@compoundscalinglabs.com","michelle-m@compoundscalingnetwork.com","michelle-m@compoundscalingteam.com","michelle-m@compoundscalingtoday.com","michelle-m@compoundscalingventures.com","michelle-m@getcompoundscaling.com","michelle-m@gocompoundscaling.com","michelle-m@launchcompoundscaling.com","michelle-m@runcompoundscaling.com","michelle-m@scalewithcompoundscaling.com","michelle-m@scalingoutbound.com","michelle-m@scalingprecision.com","michelle-m@startcompoundscaling.com","michelle-m@trycompoundscaling.com","michelle-mt@activatecompoundscaling.com","michelle-mt@compoundprospect.com","michelle-mt@compoundscalingcapital.com","michelle-mt@compoundscalingelite.com","michelle-mt@compoundscalingglobal.com","michelle-mt@compoundscalinghq.com","michelle-mt@compoundscalinglabs.com","michelle-mt@compoundscalingnetwork.com","michelle-mt@compoundscalingteam.com","michelle-mt@compoundscalingtoday.com","michelle-mt@compoundscalingventures.com","michelle-mt@getcompoundscaling.com","michelle-mt@gocompoundscaling.com","michelle-mt@launchcompoundscaling.com","michelle-mt@runcompoundscaling.com","michelle-mt@scalewithcompoundscaling.com","michelle-mt@scalingoutbound.com","michelle-mt@scalingprecision.com","michelle-mt@startcompoundscaling.com","michelle-mt@trycompoundscaling.com","michelle-t@activatecompoundscaling.com","michelle-t@compoundprospect.com","michelle-t@compoundscalingcapital.com","michelle-t@compoundscalingelite.com","michelle-t@compoundscalingglobal.com","michelle-t@compoundscalinghq.com","michelle-t@compoundscalinglabs.com","michelle-t@compoundscalingnetwork.com","michelle-t@compoundscalingteam.com","michelle-t@compoundscalingtoday.com","michelle-t@compoundscalingventures.com","michelle-t@getcompoundscaling.com","michelle-t@gocompoundscaling.com","michelle-t@launchcompoundscaling.com","michelle-t@runcompoundscaling.com","michelle-t@scalewithcompoundscaling.com","michelle-t@scalingoutbound.com","michelle-t@scalingprecision.com","michelle-t@startcompoundscaling.com","michelle-t@trycompoundscaling.com","michelle-thomas@activatecompoundscaling.com","michelle-thomas@compoundprospect.com","michelle-thomas@compoundscalingcapital.com","michelle-thomas@compoundscalingglobal.com","michelle-thomas@compoundscalinghq.com","michelle-thomas@compoundscalinglabs.com","michelle-thomas@compoundscalingnetwork.com","michelle-thomas@compoundscalingteam.com","michelle-thomas@compoundscalingventures.com","michelle-thomas@getcompoundscaling.com","michelle-thomas@gocompoundscaling.com","michelle-thomas@launchcompoundscaling.com","michelle-thomas@runcompoundscaling.com","michelle-thomas@scalewithcompoundscaling.com","michelle-thomas@scalingoutbound.com","michelle-thomas@scalingprecision.com","michelle-thomas@startcompoundscaling.com","michelle-thomas@trycompoundscaling.com","michelle-tt@activatecompoundscaling.com","michelle-tt@compoundprospect.com","michelle-tt@compoundscalingcapital.com","michelle-tt@compoundscalingelite.com","michelle-tt@compoundscalingglobal.com","michelle-tt@compoundscalinghq.com","michelle-tt@compoundscalinglabs.com","michelle-tt@compoundscalingnetwork.com","michelle-tt@compoundscalingteam.com","michelle-tt@compoundscalingtoday.com","michelle-tt@compoundscalingventures.com","michelle-tt@getcompoundscaling.com","michelle-tt@gocompoundscaling.com","michelle-tt@launchcompoundscaling.com","michelle-tt@runcompoundscaling.com","michelle-tt@scalewithcompoundscaling.com","michelle-tt@scalingoutbound.com","michelle-tt@scalingprecision.com","michelle-tt@startcompoundscaling.com","michelle-tt@trycompoundscaling.com","michelle.m@activatecompoundscaling.com","michelle.m@compoundprospect.com","michelle.m@compoundscalingcapital.com","michelle.m@compoundscalingelite.com","michelle.m@compoundscalingglobal.com","michelle.m@compoundscalinghq.com","michelle.m@compoundscalinglabs.com","michelle.m@compoundscalingnetwork.com","michelle.m@compoundscalingteam.com","michelle.m@compoundscalingtoday.com","michelle.m@compoundscalingventures.com","michelle.m@getcompoundscaling.com","michelle.m@gocompoundscaling.com","michelle.m@launchcompoundscaling.com","michelle.m@runcompoundscaling.com","michelle.m@scalewithcompoundscaling.com","michelle.m@scalingoutbound.com","michelle.m@scalingprecision.com","michelle.m@startcompoundscaling.com","michelle.m@trycompoundscaling.com","michelle.mt@activatecompoundscaling.com","michelle.mt@compoundprospect.com","michelle.mt@compoundscalingcapital.com","michelle.mt@compoundscalingelite.com","michelle.mt@compoundscalingglobal.com","michelle.mt@compoundscalinghq.com","michelle.mt@compoundscalinglabs.com","michelle.mt@compoundscalingnetwork.com","michelle.mt@compoundscalingteam.com","michelle.mt@compoundscalingtoday.com","michelle.mt@compoundscalingventures.com","michelle.mt@getcompoundscaling.com","michelle.mt@gocompoundscaling.com","michelle.mt@launchcompoundscaling.com","michelle.mt@runcompoundscaling.com","michelle.mt@scalewithcompoundscaling.com","michelle.mt@scalingoutbound.com","michelle.mt@scalingprecision.com","michelle.mt@startcompoundscaling.com","michelle.mt@trycompoundscaling.com","michelle.t@activatecompoundscaling.com","michelle.t@compoundprospect.com","michelle.t@compoundscalingcapital.com","michelle.t@compoundscalingelite.com","michelle.t@compoundscalingglobal.com","michelle.t@compoundscalinghq.com","michelle.t@compoundscalinglabs.com","michelle.t@compoundscalingnetwork.com","michelle.t@compoundscalingteam.com","michelle.t@compoundscalingtoday.com","michelle.t@compoundscalingventures.com","michelle.t@getcompoundscaling.com","michelle.t@gocompoundscaling.com","michelle.t@launchcompoundscaling.com","michelle.t@runcompoundscaling.com","michelle.t@scalewithcompoundscaling.com","michelle.t@scalingoutbound.com","michelle.t@scalingprecision.com","michelle.t@startcompoundscaling.com","michelle.t@trycompoundscaling.com","michelle.thomas@bookcompoundscaling.com","michelle.thomas@bycompoundscaling.com","michelle.thomas@compounddemand.com","michelle.thomas@compoundoutreach.com","michelle.thomas@compoundpipeline.com","michelle.thomas@compoundprospect.com","michelle.thomas@compoundscalingagency.com","michelle.thomas@compoundscalingcapital.com","michelle.thomas@compoundscalingelite.com","michelle.thomas@compoundscalingglobal.com","michelle.thomas@compoundscalinggroup.com","michelle.thomas@compoundscalinghq.com","michelle.thomas@compoundscalinghub.com","michelle.thomas@compoundscalinglabs.com","michelle.thomas@compoundscalingnetwork.com","michelle.thomas@compoundscalingpartners.com","michelle.thomas@compoundscalingpro.com","michelle.thomas@compoundscalingsolutions.com","michelle.thomas@compoundscalingteam.com","michelle.thomas@compoundscalingtoday.com","michelle.thomas@compoundscalingventures.com","michelle.thomas@compoundscalingworks.com","michelle.thomas@getcompoundscaling.com","michelle.thomas@gocompoundscaling.com","michelle.thomas@hirecompoundscaling.com","michelle.thomas@joincompoundscaling.com","michelle.thomas@launchcompoundscaling.com","michelle.thomas@meetcompoundscaling.com","michelle.thomas@runcompoundscaling.com","michelle.thomas@scalewithcompoundscaling.com","michelle.thomas@scalingcompound.com","michelle.thomas@scalingoutbound.com","michelle.thomas@scalingprecision.com","michelle.thomas@startcompoundscaling.com","michelle.thomas@thecompoundscaling.com","michelle.thomas@thecompoundscalinghub.com","michelle.thomas@trycompoundscaling.com","michelle.thomas@usecompoundscaling.com","michelle.thomas@withcompoundscaling.com","michelle.tt@activatecompoundscaling.com","michelle.tt@compoundprospect.com","michelle.tt@compoundscalingcapital.com","michelle.tt@compoundscalingelite.com","michelle.tt@compoundscalingglobal.com","michelle.tt@compoundscalinghq.com","michelle.tt@compoundscalinglabs.com","michelle.tt@compoundscalingnetwork.com","michelle.tt@compoundscalingteam.com","michelle.tt@compoundscalingtoday.com","michelle.tt@compoundscalingventures.com","michelle.tt@getcompoundscaling.com","michelle.tt@gocompoundscaling.com","michelle.tt@launchcompoundscaling.com","michelle.tt@runcompoundscaling.com","michelle.tt@scalewithcompoundscaling.com","michelle.tt@scalingoutbound.com","michelle.tt@scalingprecision.com","michelle.tt@startcompoundscaling.com","michelle.tt@trycompoundscaling.com","michelle@activatecompoundscaling.com","michelle@bookcompoundscaling.com","michelle@bycompoundscaling.com","michelle@compounddemand.com","michelle@compoundoutreach.com","michelle@compoundpipeline.com","michelle@compoundprospect.com","michelle@compoundscalingagency.com","michelle@compoundscalingcapital.com","michelle@compoundscalingelite.com","michelle@compoundscalingglobal.com","michelle@compoundscalinggroup.com","michelle@compoundscalinghq.com","michelle@compoundscalinghub.com","michelle@compoundscalinglabs.com","michelle@compoundscalingnetwork.com","michelle@compoundscalingpartners.com","michelle@compoundscalingpro.com","michelle@compoundscalingsolutions.com","michelle@compoundscalingteam.com","michelle@compoundscalingtoday.com","michelle@compoundscalingventures.com","michelle@compoundscalingworks.com","michelle@getcompoundscaling.com","michelle@gocompoundscaling.com","michelle@hirecompoundscaling.com","michelle@joincompoundscaling.com","michelle@launchcompoundscaling.com","michelle@meetcompoundscaling.com","michelle@runcompoundscaling.com","michelle@scalewithcompoundscaling.com","michelle@scalingcompound.com","michelle@scalingoutbound.com","michelle@scalingprecision.com","michelle@startcompoundscaling.com","michelle@thecompoundscaling.com","michelle@thecompoundscalinghub.com","michelle@trycompoundscaling.com","michelle@usecompoundscaling.com","michelle@withcompoundscaling.com","michelle_m@activatecompoundscaling.com","michelle_m@compoundprospect.com","michelle_m@compoundscalingcapital.com","michelle_m@compoundscalingelite.com","michelle_m@compoundscalingglobal.com","michelle_m@compoundscalinghq.com","michelle_m@compoundscalinglabs.com","michelle_m@compoundscalingnetwork.com","michelle_m@compoundscalingteam.com","michelle_m@compoundscalingtoday.com","michelle_m@compoundscalingventures.com","michelle_m@getcompoundscaling.com","michelle_m@gocompoundscaling.com","michelle_m@launchcompoundscaling.com","michelle_m@runcompoundscaling.com","michelle_m@scalewithcompoundscaling.com","michelle_m@scalingoutbound.com","michelle_m@scalingprecision.com","michelle_m@startcompoundscaling.com","michelle_m@trycompoundscaling.com","michelle_mt@activatecompoundscaling.com","michelle_mt@compoundprospect.com","michelle_mt@compoundscalingcapital.com","michelle_mt@compoundscalingelite.com","michelle_mt@compoundscalingglobal.com","michelle_mt@compoundscalinghq.com","michelle_mt@compoundscalinglabs.com","michelle_mt@compoundscalingnetwork.com","michelle_mt@compoundscalingteam.com","michelle_mt@compoundscalingtoday.com","michelle_mt@compoundscalingventures.com","michelle_mt@getcompoundscaling.com","michelle_mt@gocompoundscaling.com","michelle_mt@launchcompoundscaling.com","michelle_mt@runcompoundscaling.com","michelle_mt@scalewithcompoundscaling.com","michelle_mt@scalingoutbound.com","michelle_mt@scalingprecision.com","michelle_mt@startcompoundscaling.com","michelle_mt@trycompoundscaling.com","michelle_t@activatecompoundscaling.com","michelle_t@compoundprospect.com","michelle_t@compoundscalingcapital.com","michelle_t@compoundscalingelite.com","michelle_t@compoundscalingglobal.com","michelle_t@compoundscalinghq.com","michelle_t@compoundscalinglabs.com","michelle_t@compoundscalingnetwork.com","michelle_t@compoundscalingteam.com","michelle_t@compoundscalingtoday.com","michelle_t@compoundscalingventures.com","michelle_t@getcompoundscaling.com","michelle_t@gocompoundscaling.com","michelle_t@launchcompoundscaling.com","michelle_t@runcompoundscaling.com","michelle_t@scalewithcompoundscaling.com","michelle_t@scalingoutbound.com","michelle_t@scalingprecision.com","michelle_t@startcompoundscaling.com","michelle_t@trycompoundscaling.com","michelle_thomas@activatecompoundscaling.com","michelle_thomas@compoundprospect.com","michelle_thomas@compoundscalingelite.com","michelle_thomas@compoundscalingglobal.com","michelle_thomas@compoundscalinghq.com","michelle_thomas@compoundscalinglabs.com","michelle_thomas@compoundscalingnetwork.com","michelle_thomas@compoundscalingteam.com","michelle_thomas@compoundscalingtoday.com","michelle_thomas@compoundscalingventures.com","michelle_thomas@getcompoundscaling.com","michelle_thomas@gocompoundscaling.com","michelle_thomas@launchcompoundscaling.com","michelle_thomas@runcompoundscaling.com","michelle_thomas@scalewithcompoundscaling.com","michelle_thomas@scalingoutbound.com","michelle_thomas@scalingprecision.com","michelle_thomas@startcompoundscaling.com","michelle_thomas@trycompoundscaling.com","michelle_tt@activatecompoundscaling.com","michelle_tt@compoundprospect.com","michelle_tt@compoundscalingcapital.com","michelle_tt@compoundscalingelite.com","michelle_tt@compoundscalingglobal.com","michelle_tt@compoundscalinghq.com","michelle_tt@compoundscalinglabs.com","michelle_tt@compoundscalingnetwork.com","michelle_tt@compoundscalingteam.com","michelle_tt@compoundscalingtoday.com","michelle_tt@compoundscalingventures.com","michelle_tt@getcompoundscaling.com","michelle_tt@gocompoundscaling.com","michelle_tt@launchcompoundscaling.com","michelle_tt@runcompoundscaling.com","michelle_tt@scalewithcompoundscaling.com","michelle_tt@scalingoutbound.com","michelle_tt@scalingprecision.com","michelle_tt@startcompoundscaling.com","michelle_tt@trycompoundscaling.com","michellem-thomas@activatecompoundscaling.com","michellem-thomas@compoundprospect.com","michellem-thomas@compoundscalingcapital.com","michellem-thomas@compoundscalingelite.com","michellem-thomas@compoundscalingglobal.com","michellem-thomas@compoundscalinghq.com","michellem-thomas@compoundscalinglabs.com","michellem-thomas@compoundscalingnetwork.com","michellem-thomas@compoundscalingteam.com","michellem-thomas@compoundscalingtoday.com","michellem-thomas@compoundscalingventures.com","michellem-thomas@getcompoundscaling.com","michellem-thomas@gocompoundscaling.com","michellem-thomas@launchcompoundscaling.com","michellem-thomas@runcompoundscaling.com","michellem-thomas@scalewithcompoundscaling.com","michellem-thomas@scalingoutbound.com","michellem-thomas@scalingprecision.com","michellem-thomas@startcompoundscaling.com","michellem-thomas@trycompoundscaling.com","michellem.thomas@activatecompoundscaling.com","michellem.thomas@compoundprospect.com","michellem.thomas@compoundscalingcapital.com","michellem.thomas@compoundscalingelite.com","michellem.thomas@compoundscalingglobal.com","michellem.thomas@compoundscalinghq.com","michellem.thomas@compoundscalinglabs.com","michellem.thomas@compoundscalingnetwork.com","michellem.thomas@compoundscalingteam.com","michellem.thomas@compoundscalingtoday.com","michellem.thomas@compoundscalingventures.com","michellem.thomas@getcompoundscaling.com","michellem.thomas@gocompoundscaling.com","michellem.thomas@launchcompoundscaling.com","michellem.thomas@runcompoundscaling.com","michellem.thomas@scalewithcompoundscaling.com","michellem.thomas@scalingoutbound.com","michellem.thomas@scalingprecision.com","michellem.thomas@startcompoundscaling.com","michellem.thomas@trycompoundscaling.com","michellem@activatecompoundscaling.com","michellem@compoundprospect.com","michellem@compoundscalingcapital.com","michellem@compoundscalingelite.com","michellem@compoundscalingglobal.com","michellem@compoundscalinghq.com","michellem@compoundscalinglabs.com","michellem@compoundscalingnetwork.com","michellem@compoundscalingteam.com","michellem@compoundscalingtoday.com","michellem@compoundscalingventures.com","michellem@getcompoundscaling.com","michellem@gocompoundscaling.com","michellem@launchcompoundscaling.com","michellem@runcompoundscaling.com","michellem@scalewithcompoundscaling.com","michellem@scalingoutbound.com","michellem@scalingprecision.com","michellem@startcompoundscaling.com","michellem@trycompoundscaling.com","michellem_thomas@activatecompoundscaling.com","michellem_thomas@compoundprospect.com","michellem_thomas@compoundscalingcapital.com","michellem_thomas@compoundscalingelite.com","michellem_thomas@compoundscalingglobal.com","michellem_thomas@compoundscalinghq.com","michellem_thomas@compoundscalinglabs.com","michellem_thomas@compoundscalingnetwork.com","michellem_thomas@compoundscalingteam.com","michellem_thomas@compoundscalingtoday.com","michellem_thomas@compoundscalingventures.com","michellem_thomas@gocompoundscaling.com","michellem_thomas@launchcompoundscaling.com","michellem_thomas@runcompoundscaling.com","michellem_thomas@scalewithcompoundscaling.com","michellem_thomas@scalingoutbound.com","michellem_thomas@scalingprecision.com","michellem_thomas@startcompoundscaling.com","michellem_thomas@trycompoundscaling.com","michellemt@activatecompoundscaling.com","michellemt@compoundprospect.com","michellemt@compoundscalingcapital.com","michellemt@compoundscalingelite.com","michellemt@compoundscalingglobal.com","michellemt@compoundscalinghq.com","michellemt@compoundscalinglabs.com","michellemt@compoundscalingnetwork.com","michellemt@compoundscalingteam.com","michellemt@compoundscalingtoday.com","michellemt@compoundscalingventures.com","michellemt@getcompoundscaling.com","michellemt@gocompoundscaling.com","michellemt@launchcompoundscaling.com","michellemt@runcompoundscaling.com","michellemt@scalewithcompoundscaling.com","michellemt@scalingoutbound.com","michellemt@scalingprecision.com","michellemt@startcompoundscaling.com","michellemt@trycompoundscaling.com","michellemthomas@activatecompoundscaling.com","michellemthomas@compoundprospect.com","michellemthomas@compoundscalingcapital.com","michellemthomas@compoundscalingelite.com","michellemthomas@compoundscalingglobal.com","michellemthomas@compoundscalinghq.com","michellemthomas@compoundscalinglabs.com","michellemthomas@compoundscalingnetwork.com","michellemthomas@compoundscalingteam.com","michellemthomas@compoundscalingtoday.com","michellemthomas@compoundscalingventures.com","michellemthomas@getcompoundscaling.com","michellemthomas@gocompoundscaling.com","michellemthomas@launchcompoundscaling.com","michellemthomas@runcompoundscaling.com","michellemthomas@scalewithcompoundscaling.com","michellemthomas@scalingoutbound.com","michellemthomas@scalingprecision.com","michellemthomas@startcompoundscaling.com","michellemthomas@trycompoundscaling.com","michellet-thomas@activatecompoundscaling.com","michellet-thomas@compoundprospect.com","michellet-thomas@compoundscalingcapital.com","michellet-thomas@compoundscalingelite.com","michellet-thomas@compoundscalingglobal.com","michellet-thomas@compoundscalinghq.com","michellet-thomas@compoundscalinglabs.com","michellet-thomas@compoundscalingnetwork.com","michellet-thomas@compoundscalingteam.com","michellet-thomas@compoundscalingtoday.com","michellet-thomas@compoundscalingventures.com","michellet-thomas@getcompoundscaling.com","michellet-thomas@gocompoundscaling.com","michellet-thomas@launchcompoundscaling.com","michellet-thomas@runcompoundscaling.com","michellet-thomas@scalewithcompoundscaling.com","michellet-thomas@scalingoutbound.com","michellet-thomas@scalingprecision.com","michellet-thomas@startcompoundscaling.com","michellet-thomas@trycompoundscaling.com","michellet.thomas@activatecompoundscaling.com","michellet.thomas@compoundprospect.com","michellet.thomas@compoundscalingcapital.com","michellet.thomas@compoundscalingelite.com","michellet.thomas@compoundscalingglobal.com","michellet.thomas@compoundscalinghq.com","michellet.thomas@compoundscalinglabs.com","michellet.thomas@compoundscalingnetwork.com","michellet.thomas@compoundscalingteam.com","michellet.thomas@compoundscalingtoday.com","michellet.thomas@compoundscalingventures.com","michellet.thomas@getcompoundscaling.com","michellet.thomas@gocompoundscaling.com","michellet.thomas@launchcompoundscaling.com","michellet.thomas@runcompoundscaling.com","michellet.thomas@scalewithcompoundscaling.com","michellet.thomas@scalingoutbound.com","michellet.thomas@scalingprecision.com","michellet.thomas@startcompoundscaling.com","michellet.thomas@trycompoundscaling.com","michellet@activatecompoundscaling.com","michellet@compoundprospect.com","michellet@compoundscalingcapital.com","michellet@compoundscalingelite.com","michellet@compoundscalingglobal.com","michellet@compoundscalinghq.com","michellet@compoundscalinglabs.com","michellet@compoundscalingnetwork.com","michellet@compoundscalingteam.com","michellet@compoundscalingtoday.com","michellet@compoundscalingventures.com","michellet@getcompoundscaling.com","michellet@gocompoundscaling.com","michellet@launchcompoundscaling.com","michellet@runcompoundscaling.com","michellet@scalewithcompoundscaling.com","michellet@scalingoutbound.com","michellet@scalingprecision.com","michellet@startcompoundscaling.com","michellet@trycompoundscaling.com","michellet_thomas@activatecompoundscaling.com","michellet_thomas@compoundprospect.com","michellet_thomas@compoundscalingcapital.com","michellet_thomas@compoundscalingelite.com","michellet_thomas@compoundscalingglobal.com","michellet_thomas@compoundscalinghq.com","michellet_thomas@compoundscalinglabs.com","michellet_thomas@compoundscalingnetwork.com","michellet_thomas@compoundscalingteam.com","michellet_thomas@compoundscalingtoday.com","michellet_thomas@compoundscalingventures.com","michellet_thomas@getcompoundscaling.com","michellet_thomas@gocompoundscaling.com","michellet_thomas@launchcompoundscaling.com","michellet_thomas@runcompoundscaling.com","michellet_thomas@scalewithcompoundscaling.com","michellet_thomas@scalingoutbound.com","michellet_thomas@scalingprecision.com","michellet_thomas@startcompoundscaling.com","michellet_thomas@trycompoundscaling.com","michellethomas-m@activatecompoundscaling.com","michellethomas-m@compoundprospect.com","michellethomas-m@compoundscalingcapital.com","michellethomas-m@compoundscalingelite.com","michellethomas-m@compoundscalingglobal.com","michellethomas-m@compoundscalinghq.com","michellethomas-m@compoundscalinglabs.com","michellethomas-m@compoundscalingnetwork.com","michellethomas-m@compoundscalingteam.com","michellethomas-m@compoundscalingtoday.com","michellethomas-m@compoundscalingventures.com","michellethomas-m@getcompoundscaling.com","michellethomas-m@gocompoundscaling.com","michellethomas-m@launchcompoundscaling.com","michellethomas-m@runcompoundscaling.com","michellethomas-m@scalewithcompoundscaling.com","michellethomas-m@scalingoutbound.com","michellethomas-m@scalingprecision.com","michellethomas-m@startcompoundscaling.com","michellethomas-m@trycompoundscaling.com","michellethomas-mt@activatecompoundscaling.com","michellethomas-mt@compoundprospect.com","michellethomas-mt@compoundscalingcapital.com","michellethomas-mt@compoundscalingelite.com","michellethomas-mt@compoundscalingglobal.com","michellethomas-mt@compoundscalinghq.com","michellethomas-mt@compoundscalinglabs.com","michellethomas-mt@compoundscalingnetwork.com","michellethomas-mt@compoundscalingteam.com","michellethomas-mt@compoundscalingtoday.com","michellethomas-mt@compoundscalingventures.com","michellethomas-mt@getcompoundscaling.com","michellethomas-mt@gocompoundscaling.com","michellethomas-mt@launchcompoundscaling.com","michellethomas-mt@runcompoundscaling.com","michellethomas-mt@scalewithcompoundscaling.com","michellethomas-mt@scalingoutbound.com","michellethomas-mt@scalingprecision.com","michellethomas-mt@startcompoundscaling.com","michellethomas-mt@trycompoundscaling.com","michellethomas-t@activatecompoundscaling.com","michellethomas-t@compoundprospect.com","michellethomas-t@compoundscalingcapital.com","michellethomas-t@compoundscalingelite.com","michellethomas-t@compoundscalingglobal.com","michellethomas-t@compoundscalinghq.com","michellethomas-t@compoundscalinglabs.com","michellethomas-t@compoundscalingnetwork.com","michellethomas-t@compoundscalingteam.com","michellethomas-t@compoundscalingtoday.com","michellethomas-t@compoundscalingventures.com","michellethomas-t@getcompoundscaling.com","michellethomas-t@gocompoundscaling.com","michellethomas-t@launchcompoundscaling.com","michellethomas-t@runcompoundscaling.com","michellethomas-t@scalewithcompoundscaling.com","michellethomas-t@scalingoutbound.com","michellethomas-t@scalingprecision.com","michellethomas-t@startcompoundscaling.com","michellethomas-t@trycompoundscaling.com","michellethomas.m@activatecompoundscaling.com","michellethomas.m@compoundprospect.com","michellethomas.m@compoundscalingcapital.com","michellethomas.m@compoundscalingelite.com","michellethomas.m@compoundscalingglobal.com","michellethomas.m@compoundscalinghq.com","michellethomas.m@compoundscalinglabs.com","michellethomas.m@compoundscalingnetwork.com","michellethomas.m@compoundscalingteam.com","michellethomas.m@compoundscalingtoday.com","michellethomas.m@compoundscalingventures.com","michellethomas.m@getcompoundscaling.com","michellethomas.m@gocompoundscaling.com","michellethomas.m@launchcompoundscaling.com","michellethomas.m@runcompoundscaling.com","michellethomas.m@scalewithcompoundscaling.com","michellethomas.m@scalingoutbound.com","michellethomas.m@scalingprecision.com","michellethomas.m@startcompoundscaling.com","michellethomas.m@trycompoundscaling.com","michellethomas.mt@activatecompoundscaling.com","michellethomas.mt@compoundprospect.com","michellethomas.mt@compoundscalingcapital.com","michellethomas.mt@compoundscalingelite.com","michellethomas.mt@compoundscalingglobal.com","michellethomas.mt@compoundscalinghq.com","michellethomas.mt@compoundscalinglabs.com","michellethomas.mt@compoundscalingnetwork.com","michellethomas.mt@compoundscalingteam.com","michellethomas.mt@compoundscalingtoday.com","michellethomas.mt@compoundscalingventures.com","michellethomas.mt@getcompoundscaling.com","michellethomas.mt@gocompoundscaling.com","michellethomas.mt@launchcompoundscaling.com","michellethomas.mt@runcompoundscaling.com","michellethomas.mt@scalewithcompoundscaling.com","michellethomas.mt@scalingoutbound.com","michellethomas.mt@scalingprecision.com","michellethomas.mt@startcompoundscaling.com","michellethomas.mt@trycompoundscaling.com","michellethomas.t@activatecompoundscaling.com","michellethomas.t@compoundprospect.com","michellethomas.t@compoundscalingcapital.com","michellethomas.t@compoundscalingelite.com","michellethomas.t@compoundscalingglobal.com","michellethomas.t@compoundscalinghq.com","michellethomas.t@compoundscalinglabs.com","michellethomas.t@compoundscalingnetwork.com","michellethomas.t@compoundscalingteam.com","michellethomas.t@compoundscalingtoday.com","michellethomas.t@compoundscalingventures.com","michellethomas.t@getcompoundscaling.com","michellethomas.t@gocompoundscaling.com","michellethomas.t@launchcompoundscaling.com","michellethomas.t@runcompoundscaling.com","michellethomas.t@scalewithcompoundscaling.com","michellethomas.t@scalingoutbound.com","michellethomas.t@scalingprecision.com","michellethomas.t@startcompoundscaling.com","michellethomas.t@trycompoundscaling.com","michellethomas.tt@activatecompoundscaling.com","michellethomas.tt@compoundprospect.com","michellethomas.tt@compoundscalingcapital.com","michellethomas.tt@compoundscalingelite.com","michellethomas.tt@compoundscalingglobal.com","michellethomas.tt@compoundscalinghq.com","michellethomas.tt@compoundscalinglabs.com","michellethomas.tt@compoundscalingnetwork.com","michellethomas.tt@compoundscalingteam.com","michellethomas.tt@compoundscalingtoday.com","michellethomas.tt@compoundscalingventures.com","michellethomas.tt@getcompoundscaling.com","michellethomas.tt@gocompoundscaling.com","michellethomas.tt@launchcompoundscaling.com","michellethomas.tt@runcompoundscaling.com","michellethomas.tt@scalewithcompoundscaling.com","michellethomas.tt@scalingoutbound.com","michellethomas.tt@scalingprecision.com","michellethomas.tt@startcompoundscaling.com","michellethomas.tt@trycompoundscaling.com","michellethomas@activatecompoundscaling.com","michellethomas@compoundprospect.com","michellethomas@compoundscalingcapital.com","michellethomas@compoundscalingelite.com","michellethomas@compoundscalingglobal.com","michellethomas@compoundscalinghq.com","michellethomas@compoundscalinglabs.com","michellethomas@compoundscalingnetwork.com","michellethomas@compoundscalingteam.com","michellethomas@compoundscalingtoday.com","michellethomas@compoundscalingventures.com","michellethomas@getcompoundscaling.com","michellethomas@gocompoundscaling.com","michellethomas@launchcompoundscaling.com","michellethomas@runcompoundscaling.com","michellethomas@scalewithcompoundscaling.com","michellethomas@scalingoutbound.com","michellethomas@scalingprecision.com","michellethomas@startcompoundscaling.com","michellethomas@trycompoundscaling.com","michellethomas_m@activatecompoundscaling.com","michellethomas_m@compoundprospect.com","michellethomas_m@compoundscalingcapital.com","michellethomas_m@compoundscalingelite.com","michellethomas_m@compoundscalingglobal.com","michellethomas_m@compoundscalinghq.com","michellethomas_m@compoundscalinglabs.com","michellethomas_m@compoundscalingnetwork.com","michellethomas_m@compoundscalingteam.com","michellethomas_m@compoundscalingtoday.com","michellethomas_m@compoundscalingventures.com","michellethomas_m@getcompoundscaling.com","michellethomas_m@gocompoundscaling.com","michellethomas_m@launchcompoundscaling.com","michellethomas_m@runcompoundscaling.com","michellethomas_m@scalewithcompoundscaling.com","michellethomas_m@scalingoutbound.com","michellethomas_m@scalingprecision.com","michellethomas_m@startcompoundscaling.com","michellethomas_m@trycompoundscaling.com","michellethomas_mt@activatecompoundscaling.com","michellethomas_mt@compoundprospect.com","michellethomas_mt@compoundscalingcapital.com","michellethomas_mt@compoundscalingelite.com","michellethomas_mt@compoundscalingglobal.com","michellethomas_mt@compoundscalinghq.com","michellethomas_mt@compoundscalinglabs.com","michellethomas_mt@compoundscalingnetwork.com","michellethomas_mt@compoundscalingteam.com","michellethomas_mt@compoundscalingtoday.com","michellethomas_mt@compoundscalingventures.com","michellethomas_mt@getcompoundscaling.com","michellethomas_mt@gocompoundscaling.com","michellethomas_mt@launchcompoundscaling.com","michellethomas_mt@runcompoundscaling.com","michellethomas_mt@scalewithcompoundscaling.com","michellethomas_mt@scalingoutbound.com","michellethomas_mt@scalingprecision.com","michellethomas_mt@startcompoundscaling.com","michellethomas_mt@trycompoundscaling.com","michellethomas_t@activatecompoundscaling.com","michellethomas_t@compoundprospect.com","michellethomas_t@compoundscalingcapital.com","michellethomas_t@compoundscalingelite.com","michellethomas_t@compoundscalingglobal.com","michellethomas_t@compoundscalinghq.com","michellethomas_t@compoundscalinglabs.com","michellethomas_t@compoundscalingnetwork.com","michellethomas_t@compoundscalingteam.com","michellethomas_t@compoundscalingtoday.com","michellethomas_t@compoundscalingventures.com","michellethomas_t@getcompoundscaling.com","michellethomas_t@gocompoundscaling.com","michellethomas_t@launchcompoundscaling.com","michellethomas_t@runcompoundscaling.com","michellethomas_t@scalewithcompoundscaling.com","michellethomas_t@scalingoutbound.com","michellethomas_t@scalingprecision.com","michellethomas_t@startcompoundscaling.com","michellethomas_t@trycompoundscaling.com","michellethomasm@activatecompoundscaling.com","michellethomasm@compoundprospect.com","michellethomasm@compoundscalingcapital.com","michellethomasm@compoundscalingelite.com","michellethomasm@compoundscalingglobal.com","michellethomasm@compoundscalinghq.com","michellethomasm@compoundscalinglabs.com","michellethomasm@compoundscalingnetwork.com","michellethomasm@compoundscalingteam.com","michellethomasm@compoundscalingtoday.com","michellethomasm@compoundscalingventures.com","michellethomasm@getcompoundscaling.com","michellethomasm@gocompoundscaling.com","michellethomasm@launchcompoundscaling.com","michellethomasm@runcompoundscaling.com","michellethomasm@scalewithcompoundscaling.com","michellethomasm@scalingoutbound.com","michellethomasm@scalingprecision.com","michellethomasm@startcompoundscaling.com","michellethomasm@trycompoundscaling.com","michellethomasmt@activatecompoundscaling.com","michellethomasmt@compoundprospect.com","michellethomasmt@compoundscalingcapital.com","michellethomasmt@compoundscalingelite.com","michellethomasmt@compoundscalingglobal.com","michellethomasmt@compoundscalinghq.com","michellethomasmt@compoundscalinglabs.com","michellethomasmt@compoundscalingnetwork.com","michellethomasmt@compoundscalingteam.com","michellethomasmt@compoundscalingtoday.com","michellethomasmt@compoundscalingventures.com","michellethomasmt@getcompoundscaling.com","michellethomasmt@gocompoundscaling.com","michellethomasmt@launchcompoundscaling.com","michellethomasmt@runcompoundscaling.com","michellethomasmt@scalewithcompoundscaling.com","michellethomasmt@scalingoutbound.com","michellethomasmt@scalingprecision.com","michellethomasmt@startcompoundscaling.com","michellethomasmt@trycompoundscaling.com","michellethomast@activatecompoundscaling.com","michellethomast@compoundprospect.com","michellethomast@compoundscalingcapital.com","michellethomast@compoundscalingelite.com","michellethomast@compoundscalingglobal.com","michellethomast@compoundscalinghq.com","michellethomast@compoundscalinglabs.com","michellethomast@compoundscalingnetwork.com","michellethomast@compoundscalingteam.com","michellethomast@compoundscalingventures.com","michellethomast@getcompoundscaling.com","michellethomast@gocompoundscaling.com","michellethomast@launchcompoundscaling.com","michellethomast@runcompoundscaling.com","michellethomast@scalewithcompoundscaling.com","michellethomast@scalingoutbound.com","michellethomast@scalingprecision.com","michellethomast@startcompoundscaling.com","michellethomast@trycompoundscaling.com","michellethomastt@activatecompoundscaling.com","michellethomastt@compoundprospect.com","michellethomastt@compoundscalingcapital.com","michellethomastt@compoundscalingelite.com","michellethomastt@compoundscalingglobal.com","michellethomastt@compoundscalinghq.com","michellethomastt@compoundscalinglabs.com","michellethomastt@compoundscalingnetwork.com","michellethomastt@compoundscalingteam.com","michellethomastt@compoundscalingtoday.com","michellethomastt@compoundscalingventures.com","michellethomastt@getcompoundscaling.com","michellethomastt@gocompoundscaling.com","michellethomastt@launchcompoundscaling.com","michellethomastt@runcompoundscaling.com","michellethomastt@scalewithcompoundscaling.com","michellethomastt@scalingoutbound.com","michellethomastt@scalingprecision.com","michellethomastt@startcompoundscaling.com","michellethomastt@trycompoundscaling.com","michellett@activatecompoundscaling.com","michellett@compoundprospect.com","michellett@compoundscalingcapital.com","michellett@compoundscalingelite.com","michellett@compoundscalingglobal.com","michellett@compoundscalinghq.com","michellett@compoundscalinglabs.com","michellett@compoundscalingnetwork.com","michellett@compoundscalingteam.com","michellett@compoundscalingtoday.com","michellett@compoundscalingventures.com","michellett@getcompoundscaling.com","michellett@gocompoundscaling.com","michellett@launchcompoundscaling.com","michellett@runcompoundscaling.com","michellett@scalewithcompoundscaling.com","michellett@scalingoutbound.com","michellett@scalingprecision.com","michellett@startcompoundscaling.com","michellett@trycompoundscaling.com","michelletthomas@activatecompoundscaling.com","michelletthomas@compoundprospect.com","michelletthomas@compoundscalingcapital.com","michelletthomas@compoundscalingelite.com","michelletthomas@compoundscalingglobal.com","michelletthomas@compoundscalinghq.com","michelletthomas@compoundscalinglabs.com","michelletthomas@compoundscalingnetwork.com","michelletthomas@compoundscalingteam.com","michelletthomas@compoundscalingtoday.com","michelletthomas@compoundscalingventures.com","michelletthomas@getcompoundscaling.com","michelletthomas@gocompoundscaling.com","michelletthomas@launchcompoundscaling.com","michelletthomas@runcompoundscaling.com","michelletthomas@scalewithcompoundscaling.com","michelletthomas@scalingoutbound.com","michelletthomas@scalingprecision.com","michelletthomas@startcompoundscaling.com","michelletthomas@trycompoundscaling.com","mthomas@activatecompoundscaling.com","mthomas@compoundprospect.com","mthomas@compoundscalingcapital.com","mthomas@compoundscalingelite.com","mthomas@compoundscalingglobal.com","mthomas@compoundscalinghq.com","mthomas@compoundscalinglabs.com","mthomas@compoundscalingnetwork.com","mthomas@compoundscalingteam.com","mthomas@compoundscalingtoday.com","mthomas@compoundscalingventures.com","mthomas@getcompoundscaling.com","mthomas@gocompoundscaling.com","mthomas@launchcompoundscaling.com","mthomas@runcompoundscaling.com","mthomas@scalingoutbound.com","mthomas@scalingprecision.com","mthomas@startcompoundscaling.com","mthomas@trycompoundscaling.com","thomas-m@activatecompoundscaling.com","thomas-m@compoundprospect.com","thomas-m@compoundscalingcapital.com","thomas-m@compoundscalingelite.com","thomas-m@compoundscalingglobal.com","thomas-m@compoundscalinghq.com","thomas-m@compoundscalinglabs.com","thomas-m@compoundscalingnetwork.com","thomas-m@compoundscalingteam.com","thomas-m@compoundscalingtoday.com","thomas-m@compoundscalingventures.com","thomas-m@getcompoundscaling.com","thomas-m@gocompoundscaling.com","thomas-m@launchcompoundscaling.com","thomas-m@runcompoundscaling.com","thomas-m@scalewithcompoundscaling.com","thomas-m@scalingoutbound.com","thomas-m@scalingprecision.com","thomas-m@startcompoundscaling.com","thomas-m@trycompoundscaling.com","thomas.m@activatecompoundscaling.com","thomas.m@compoundprospect.com","thomas.m@compoundscalingcapital.com","thomas.m@compoundscalingelite.com","thomas.m@compoundscalingglobal.com","thomas.m@compoundscalinghq.com","thomas.m@compoundscalinglabs.com","thomas.m@compoundscalingnetwork.com","thomas.m@compoundscalingteam.com","thomas.m@compoundscalingtoday.com","thomas.m@compoundscalingventures.com","thomas.m@getcompoundscaling.com","thomas.m@gocompoundscaling.com","thomas.m@launchcompoundscaling.com","thomas.m@runcompoundscaling.com","thomas.m@scalewithcompoundscaling.com","thomas.m@scalingoutbound.com","thomas.m@scalingprecision.com","thomas.m@startcompoundscaling.com","thomas.m@trycompoundscaling.com","thomas@activatecompoundscaling.com","thomas@compoundprospect.com","thomas@compoundscalingcapital.com","thomas@compoundscalingelite.com","thomas@compoundscalingglobal.com","thomas@compoundscalinghq.com","thomas@compoundscalinglabs.com","thomas@compoundscalingnetwork.com","thomas@compoundscalingteam.com","thomas@compoundscalingtoday.com","thomas@compoundscalingventures.com","thomas@getcompoundscaling.com","thomas@gocompoundscaling.com","thomas@launchcompoundscaling.com","thomas@runcompoundscaling.com","thomas@scalewithcompoundscaling.com","thomas@scalingoutbound.com","thomas@scalingprecision.com","thomas@startcompoundscaling.com","thomas@trycompoundscaling.com","thomas_m@activatecompoundscaling.com","thomas_m@compoundprospect.com","thomas_m@compoundscalingcapital.com","thomas_m@compoundscalingelite.com","thomas_m@compoundscalingglobal.com","thomas_m@compoundscalinghq.com","thomas_m@compoundscalinglabs.com","thomas_m@compoundscalingnetwork.com","thomas_m@compoundscalingteam.com","thomas_m@compoundscalingtoday.com","thomas_m@compoundscalingventures.com","thomas_m@getcompoundscaling.com","thomas_m@gocompoundscaling.com","thomas_m@launchcompoundscaling.com","thomas_m@runcompoundscaling.com","thomas_m@scalingoutbound.com","thomas_m@scalingprecision.com","thomas_m@startcompoundscaling.com","thomas_m@trycompoundscaling.com","thomasm@activatecompoundscaling.com","thomasm@compoundprospect.com","thomasm@compoundscalingcapital.com","thomasm@compoundscalingelite.com","thomasm@compoundscalingglobal.com","thomasm@compoundscalinghq.com","thomasm@compoundscalinglabs.com","thomasm@compoundscalingnetwork.com","thomasm@compoundscalingteam.com","thomasm@compoundscalingtoday.com","thomasm@compoundscalingventures.com","thomasm@getcompoundscaling.com","thomasm@gocompoundscaling.com","thomasm@launchcompoundscaling.com","thomasm@runcompoundscaling.com","thomasm@scalewithcompoundscaling.com","thomasm@scalingoutbound.com","thomasm@scalingprecision.com","thomasm@startcompoundscaling.com","thomasm@trycompoundscaling.com","woodward-c@meettheidaxis.com","woodward-c@theidaxisglobal.com","woodward-c@theidaxishq.com","woodward-c@theidaxislab.com","woodward-c@theidaxisnetwork.com","woodward-c@theidaxispartners.com","woodward-c@theidaxisplatform.com","woodward-c@theidaxisportal.com","woodward-c@theidaxissolutions.com","woodward-c@theidaxissystem.com","woodward-c@theidaxisteam.com","woodward-c@withtheidaxis.com","woodward.c@meettheidaxis.com","woodward.c@theidaxisglobal.com","woodward.c@theidaxishq.com","woodward.c@theidaxislab.com","woodward.c@theidaxisnetwork.com","woodward.c@theidaxispartners.com","woodward.c@theidaxisplatform.com","woodward.c@theidaxisportal.com","woodward.c@theidaxissolutions.com","woodward.c@theidaxissystem.com","woodward.c@theidaxisteam.com","woodward.c@withtheidaxis.com","woodward@meettheidaxis.com","woodward@theidaxisglobal.com","woodward@theidaxishq.com","woodward@theidaxislab.com","woodward@theidaxisnetwork.com","woodward@theidaxispartners.com","woodward@theidaxisplatform.com","woodward@theidaxisportal.com","woodward@theidaxissolutions.com","woodward@theidaxissystem.com","woodward@theidaxisteam.com","woodward@withtheidaxis.com","woodward_c@meettheidaxis.com","woodward_c@theidaxisglobal.com","woodward_c@theidaxishq.com","woodward_c@theidaxislab.com","woodward_c@theidaxisnetwork.com","woodward_c@theidaxispartners.com","woodward_c@theidaxisplatform.com","woodward_c@theidaxisportal.com","woodward_c@theidaxissolutions.com","woodward_c@theidaxissystem.com","woodward_c@theidaxisteam.com","woodward_c@withtheidaxis.com","woodwardc@meettheidaxis.com","woodwardc@theidaxisglobal.com","woodwardc@theidaxishq.com","woodwardc@theidaxislab.com","woodwardc@theidaxisnetwork.com","woodwardc@theidaxispartners.com","woodwardc@theidaxisplatform.com","woodwardc@theidaxisportal.com","woodwardc@theidaxissolutions.com","woodwardc@theidaxissystem.com","woodwardc@theidaxisteam.com","woodwardc@withtheidaxis.com"];
  PropertiesService.getScriptProperties().setProperty(ACCOUNTS_KEY, JSON.stringify(emails));
  Logger.log('Accounts list stored: ' + emails.length + ' inboxes');
}
// ── Cache refresh — run manually once, then via hourly trigger ─
function refreshCache() {
  const data    = buildDashboardData();
  const payload = JSON.stringify(data);
  PropertiesService.getScriptProperties().setProperty(CACHE_KEY, payload);
  Logger.log('Cache refreshed. Campaigns: ' + data.campaigns.length + ' | Size: ' + payload.length + ' bytes');
}

// ── One-time trigger setup ────────────────────────────────────
function setupHourlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('refreshCache').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('refreshAnalyticsCache').timeBased().everyHours(1).create();
  Logger.log('Hourly triggers created for refreshCache and refreshAnalyticsCache');
}

// ── Main builder ─────────────────────────────────────────────
function buildDashboardData() {
  const today   = new Date();
  const end     = fmtDate(today);
  const start30 = fmtDate(daysAgo(today, 30)); // wide window to find 7 active days
  const opts    = fetchOpts();

  const campaigns = fetchCampaigns(opts);
  if (!campaigns.length) return { generated_at: new Date().toISOString(), campaigns: [] };

  const result = campaigns.map(function(c) {
    // Fetch 30-day daily first — needed to determine lastSendDate for window anchoring
    const dayUrl = BASE_V2 + '/campaigns/analytics/daily?campaign_id=' + c.id + '&start_date=' + start30 + '&end_date=' + end;
    const dayRes = UrlFetchApp.fetch(dayUrl, opts);
    const dayRaw = safeJson(dayRes);
    const daily  = Array.isArray(dayRaw) ? dayRaw : (dayRaw.items || dayRaw.data || []);

    const sparkline    = buildSparkline(daily, today, LOOKBACK_SPARKLINE);
    const lastSendDate = getLastSendDate(daily);

    // Anchor 7-day stats window to last active send date.
    // Instantly "last 7 days" ends at the last day the campaign actively sent —
    // so paused/completed campaigns show stats for their last active period, not today.
    const anchor   = lastSendDate ? new Date(lastSendDate + 'T12:00:00') : today;
    const sumEnd   = fmtDate(daysAgo(anchor, -1)); // exclusive end = day after last send
    const sumStart = fmtDate(daysAgo(anchor, 6));  // 7-day window: 6 days before last send

    const sumUrl = BASE_V2 + '/campaigns/analytics?id=' + c.id + '&start_date=' + sumStart + '&end_date=' + sumEnd;
    const sumRes = UrlFetchApp.fetch(sumUrl, opts);
    const sumRaw = safeJson(sumRes);
    const s      = Array.isArray(sumRaw) ? (sumRaw[0] || {}) : (sumRaw || {});

    const totalLeads = num(s.leads_count);
    const contacted  = num(s.contacted_count);

    return {
      id:           c.id,
      client:       CLIENT_MAP[c.id] || DEFAULT_CLIENT,
      campaign:     c.name,
      status:       statusLabel(c.status),
      sends7d:      num(s.contacted_count),
      replies7d:    num(s.reply_count_unique) + num(s.reply_count_automatic_unique),
      posReplies7d: num(s.total_opportunities),
      bookings7d:   0,
      totalLeads,
      contacted,
      leadsLeft:    Math.max(0, totalLeads - contacted),
      bounced:      num(s.bounced_count),
      lastSendDate,
      sparkline,
    };
  });

  return { generated_at: new Date().toISOString(), campaigns: result };
}

// ── Campaign list ─────────────────────────────────────────────
function fetchCampaigns(opts) {
  const all = [];
  let startingAfter = null;

  for (let page = 0; page < 10; page++) {
    const url = BASE_V2 + '/campaigns?limit=100' + (startingAfter ? '&starting_after=' + startingAfter : '');
    const res  = UrlFetchApp.fetch(url, opts);
    const code = res.getResponseCode();
    if (code !== 200) {
      Logger.log('fetchCampaigns error ' + code + ': ' + res.getContentText());
      break;
    }
    const json = safeJson(res);
    const items = json.items || json.data || (Array.isArray(json) ? json : []);
    all.push.apply(all, items);
    startingAfter = json.next_starting_after || null;
    if (!startingAfter || items.length < 100) break;
  }
  return all;
}

// ── Status label ──────────────────────────────────────────────
function statusLabel(status) {
  if (status === 1 || status === 4) return 'Active';
  if (status === 2) return 'Paused';
  if (status === 3) return 'Completed';
  return 'Draft';
}

// ── Sparkline + last send ─────────────────────────────────────
function buildSparkline(daily, today, days) {
  const map = {};
  daily.forEach(function(d) {
    // new_leads_contacted = unique contacts per day (matches contacted_count in summary)
    // d.contacted = total emails sent per day (inflated by follow-ups)
    if (d.date) map[d.date] = num(d.new_leads_contacted || d.contacted);
  });
  const out = [];
  for (let i = days - 1; i >= 0; i--) out.push(map[fmtDate(daysAgo(today, i))] || 0);
  return out;
}

function getLastSendDate(daily) {
  for (let i = daily.length - 1; i >= 0; i--) {
    if (num(daily[i].new_leads_contacted || daily[i].contacted) > 0) return daily[i].date || null;
  }
  return null;
}

// ── Utilities ─────────────────────────────────────────────────
function safeJson(response) {
  try { return JSON.parse(response.getContentText()); } catch (e) { return {}; }
}
function num(v) { return Number(v) || 0; }
function fmtDate(d) { return d.toISOString().slice(0, 10); }
function daysAgo(base, n) { return new Date(base.getTime() - n * 86400000); }

// ── Test helpers ──────────────────────────────────────────────
function testListCampaigns() {
  const opts = fetchOpts();
  const res  = UrlFetchApp.fetch(BASE_V2 + '/campaigns?limit=5', opts); // limit 5 to keep log small
  Logger.log('HTTP ' + res.getResponseCode());
  // Log just ids + names to keep output readable
  const json = safeJson(res);
  const items = json.items || [];
  items.forEach(c => Logger.log(c.id + ' | ' + c.name + ' | status:' + c.status));
}

function testAnalytics() {
  const TEST_ID = 'efecb243-a7ba-4968-bd9d-46a2c4ef246a';
  const opts    = fetchOpts();
  const today   = fmtDate(new Date());
  const start7  = fmtDate(daysAgo(new Date(), 7));
  const start14 = fmtDate(daysAgo(new Date(), 14));

  const resSum = UrlFetchApp.fetch(BASE_V2 + '/campaigns/analytics?id=' + TEST_ID + '&start_date=' + start7 + '&end_date=' + today, opts);
  Logger.log('SUMMARY HTTP ' + resSum.getResponseCode() + ': ' + resSum.getContentText());

  const resDay = UrlFetchApp.fetch(BASE_V2 + '/campaigns/analytics/daily?campaign_id=' + TEST_ID + '&start_date=' + start14 + '&end_date=' + today, opts);
  Logger.log('DAILY HTTP ' + resDay.getResponseCode() + ' | ' + resDay.getContentText().length + ' bytes: ' + resDay.getContentText().substring(0, 600));
}

function testFullBuild() {
  Logger.log(JSON.stringify(buildDashboardData(), null, 2));
}

// ── Deep debug: compare raw API fields vs Instantly UI ────────
// Run this, then compare logged values with what you see in Instantly.
// Target: Cory "Job Specific Leads" campaign (update ID if needed).
function testDebugCampaign() {
  const opts  = fetchOpts();
  const today = new Date();
  const end   = fmtDate(today);
  const start7 = fmtDate(daysAgo(today, 7));
  const startAll = '2020-01-01'; // all-time window

  // Find campaign by name substring (case-insensitive) — searches ALL campaigns
  const TARGET = 'inboxes';
  const all = fetchCampaigns(opts);
  Logger.log('=== All campaigns ===');
  all.forEach(c => Logger.log(c.id + ' | ' + c.name + ' | status:' + c.status));

  const target = all.find(c => c.name.toLowerCase().includes(TARGET));
  if (!target) { Logger.log('Campaign not found — check TARGET string above'); return; }

  Logger.log('\n=== ' + target.name + ' ===');
  Logger.log('ID: ' + target.id);

  // 7-day summary
  const sum7Url = BASE_V2 + '/campaigns/analytics?id=' + target.id + '&start_date=' + start7 + '&end_date=' + end;
  const s7 = safeJson(UrlFetchApp.fetch(sum7Url, opts));
  const r7 = Array.isArray(s7) ? (s7[0] || {}) : (s7 || {});
  Logger.log('\n--- 7-day summary RAW JSON (start=' + start7 + ') ---');
  Logger.log(JSON.stringify(r7, null, 2));

  // Test end_date variants: is end_date exclusive (missing today)?
  var tomorrow = fmtDate(daysAgo(today, -1));
  Logger.log('\n--- end_date test (start=7 days ago, vary end) ---');
  var endVariants = [fmtDate(daysAgo(today, 1)), end, tomorrow];
  var endLabels   = ['yesterday (' + fmtDate(daysAgo(today,1)) + ')', 'today (' + end + ')', 'tomorrow (' + tomorrow + ')'];
  for (var i = 0; i < endVariants.length; i++) {
    var eUrl = BASE_V2 + '/campaigns/analytics?id=' + target.id + '&start_date=' + start7 + '&end_date=' + endVariants[i];
    var eRaw = safeJson(UrlFetchApp.fetch(eUrl, opts));
    var e = Array.isArray(eRaw) ? (eRaw[0] || {}) : (eRaw || {});
    var eSum = num(e.reply_count_unique) + num(e.reply_count_automatic_unique);
    Logger.log('end=' + endLabels[i] + ': contacted=' + e.contacted_count + '  reply_unique=' + e.reply_count_unique + '  auto_unique=' + e.reply_count_automatic_unique + '  SUM=' + eSum);
  }

  // all-time summary
  const sumAllUrl = BASE_V2 + '/campaigns/analytics?id=' + target.id + '&start_date=' + startAll + '&end_date=' + end;
  const sAll = safeJson(UrlFetchApp.fetch(sumAllUrl, opts));
  const rAll = Array.isArray(sAll) ? (sAll[0] || {}) : (sAll || {});
  Logger.log('\n--- All-time summary (start=2020-01-01) ---');
  Logger.log('emails_sent_count:              ' + rAll.emails_sent_count);
  Logger.log('contacted_count:                ' + rAll.contacted_count);
  Logger.log('new_leads_contacted_count:      ' + rAll.new_leads_contacted_count);
  Logger.log('reply_count:                    ' + rAll.reply_count);
  Logger.log('reply_count_unique:             ' + rAll.reply_count_unique);
  Logger.log('total_opportunities:            ' + rAll.total_opportunities);
  Logger.log('leads_count:                    ' + rAll.leads_count);
  Logger.log('bounced_count:                  ' + rAll.bounced_count);

  // 30-day daily — show each day so we can see active days vs inactive
  const start30 = fmtDate(daysAgo(today, 30));
  const dayUrl = BASE_V2 + '/campaigns/analytics/daily?campaign_id=' + target.id + '&start_date=' + start30 + '&end_date=' + end;
  const dayRaw = safeJson(UrlFetchApp.fetch(dayUrl, opts));
  const daily  = Array.isArray(dayRaw) ? dayRaw : (dayRaw.items || []);
  Logger.log('\n--- 30-day daily (one row per day, active days only) ---');
  daily.forEach(function(d) {
    var newC = num(d.new_leads_contacted);
    var cont = num(d.contacted);
    if (newC > 0 || cont > 0) {
      Logger.log(d.date + '  new_contacted=' + newC + '  contacted=' + cont + '  uniq_replies=' + num(d.unique_replies) + '  auto_uniq=' + num(d.unique_replies_automatic));
    }
  });

  // Last 7 active days sum
  var activeDays = daily.filter(function(d) { return num(d.new_leads_contacted || d.contacted) > 0; });
  var last7Active = activeDays.slice(-7);
  var a7Contacted=0, a7NewContacted=0, a7Replies=0, a7AutoUniq=0;
  last7Active.forEach(function(d) {
    a7Contacted    += num(d.contacted);
    a7NewContacted += num(d.new_leads_contacted);
    a7Replies      += num(d.unique_replies);
    a7AutoUniq     += num(d.unique_replies_automatic);
  });
  Logger.log('\n--- Last 7 ACTIVE days sum (dates: ' + (last7Active[0]||{}).date + ' to ' + (last7Active[last7Active.length-1]||{}).date + ') ---');
  Logger.log('contacted sum:          ' + a7Contacted + '  (= emails_sent equiv)');
  Logger.log('new_contacted sum:      ' + a7NewContacted + '  ← does this = 1920?');
  Logger.log('unique_replies sum:     ' + a7Replies);
  Logger.log('auto_uniq sum:          ' + a7AutoUniq);
  Logger.log('replies total:          ' + (a7Replies + a7AutoUniq) + '  ← does this = 38?');

  // Computed rates — compare with Instantly UI
  const sent  = num(r7.emails_sent_count);
  const cont  = num(r7.contacted_count);
  const repl  = num(r7.reply_count);
  const replU = num(r7.reply_count_unique) + num(r7.reply_count_automatic_unique);
  const opps  = num(r7.total_opportunities);
  Logger.log('\n--- Computed rates (compare with Instantly UI) ---');
  Logger.log('Instantly shows → Sequence started: 1920  |  Reply rate: 1.98% (38)  |  Pos reply rate: 2.63% (1)  |  Opps: 1');
  Logger.log('reply / emails_sent:            ' + pct(repl,  sent)  + ' (' + repl  + '/' + sent  + ')');
  Logger.log('uniq_reply / emails_sent:       ' + pct(replU, sent)  + ' (' + replU + '/' + sent  + ')');
  Logger.log('reply / contacted:              ' + pct(repl,  cont)  + ' (' + repl  + '/' + cont  + ')');
  Logger.log('uniq_reply / contacted:         ' + pct(replU, cont)  + ' (' + replU + '/' + cont  + ')');
  Logger.log('opps(sum7) / reply:             ' + pct(dOpps, dReplies) + ' (' + dOpps + '/' + dReplies + ')');
  Logger.log('opps(sum7) / uniq_reply:        ' + pct(dOpps, dUniqReplies+dAutoUniq) + ' (' + dOpps + '/' + (dUniqReplies+dAutoUniq) + ')');
  Logger.log('total_opps(alltime) / reply:    ' + pct(opps,  repl)  + ' (' + opps  + '/' + repl  + ')');
}

function pct(a, b) {
  if (!b) return '—';
  return (a / b * 100).toFixed(2) + '%';
}
