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

// ── Entry point (JSONP) ──────────────────────────────────────
function doGet(e) {
  const cb = (e.parameter && e.parameter.callback) || 'callback';
  try {
    const payload = JSON.stringify(buildDashboardData());
    return ContentService
      .createTextOutput(cb + '(' + payload + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  } catch (err) {
    return ContentService
      .createTextOutput(cb + '(' + JSON.stringify({ error: err.message }) + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
}

// ── Main builder ─────────────────────────────────────────────
function buildDashboardData() {
  const today   = new Date();
  const end     = fmtDate(today);
  const start7  = fmtDate(daysAgo(today, LOOKBACK_STATS));
  const start14 = fmtDate(daysAgo(today, LOOKBACK_SPARKLINE));
  const opts    = fetchOpts();

  const campaigns = fetchCampaigns(opts);
  if (!campaigns.length) return { generated_at: new Date().toISOString(), campaigns: [] };

  // Sequential fetching — avoids bandwidth quota from parallel fetchAll
  const result = campaigns.map(function(c) {
    // Summary: confirmed working, 688 bytes per campaign
    const sumUrl  = BASE_V2 + '/campaigns/analytics?id=' + c.id + '&start_date=' + start7 + '&end_date=' + end;
    const sumRes  = UrlFetchApp.fetch(sumUrl, opts);
    const sumRaw  = safeJson(sumRes);
    const s       = Array.isArray(sumRaw) ? (sumRaw[0] || {}) : (sumRaw || {});

    // Daily: fetch 14d for sparkline — small delay to be safe
    const dayUrl  = BASE_V2 + '/campaigns/analytics/daily?campaign_id=' + c.id + '&start_date=' + start14 + '&end_date=' + end;
    const dayRes  = UrlFetchApp.fetch(dayUrl, opts);
    const dayRaw  = safeJson(dayRes);
    const daily   = Array.isArray(dayRaw) ? dayRaw : (dayRaw.items || dayRaw.data || []);

    const sparkline    = buildSparkline(daily, today, LOOKBACK_SPARKLINE);
    const lastSendDate = getLastSendDate(daily);
    const totalLeads   = num(s.leads_count);
    const contacted    = num(s.contacted_count);

    return {
      id:           c.id,
      client:       CLIENT_MAP[c.id] || DEFAULT_CLIENT,
      campaign:     c.name,
      status:       statusLabel(c.status),
      sends7d:      num(s.emails_sent_count),
      replies7d:    num(s.reply_count_unique),
      posReplies7d: 0,
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
    const date  = d.date || d.day || '';
    const count = num(d.sent || d.emails_sent || d.count);
    if (date) map[date] = (map[date] || 0) + count;
  });
  const out = [];
  for (let i = days - 1; i >= 0; i--) out.push(map[fmtDate(daysAgo(today, i))] || 0);
  return out;
}

function getLastSendDate(daily) {
  for (let i = daily.length - 1; i >= 0; i--) {
    if (num(daily[i].sent || daily[i].emails_sent || daily[i].count) > 0) return daily[i].date || daily[i].day || null;
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
