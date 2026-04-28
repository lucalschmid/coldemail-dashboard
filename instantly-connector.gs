// ============================================================
// Compound Scaling Dashboard — Instantly Connector
// Google Apps Script  |  deploy as Web App
// ============================================================
//
// SETUP (one-time):
//   1. script.google.com → New project → paste this file
//   2. Project Settings → Script Properties → Add:
//        INSTANTLY_API_KEY  →  your key from app.instantly.ai/api-keys
//   3. Deploy → New deployment → Web app
//        Execute as: Me
//        Who has access: Anyone
//   4. Copy the /exec URL → paste into data.js as APPS_SCRIPT_URL
//
// CLIENT MAP:
//   Instantly has no "client" concept. Map campaign IDs here.
//   Run testListCampaigns() first to get your real campaign IDs.
// ============================================================

// ── Client mapping ──────────────────────────────────────────
// Key   = Instantly campaign ID (UUID)
// Value = Client name shown in the dashboard
const CLIENT_MAP = {
  // Paste your campaign IDs after running testListCampaigns()
  // 'fa221bcc-9e4b-4d29-93dd-1aa6628a8c99': 'Compound Scaling',
  // 'b7e396a4-f893-47ed-a2f7-3017457bd705': 'Cory ID Axis',
};
const DEFAULT_CLIENT = 'Unassigned';

// ── Config ───────────────────────────────────────────────────
const API_KEY  = () => PropertiesService.getScriptProperties().getProperty('INSTANTLY_API_KEY');
const BASE_URL = 'https://api.instantly.ai/api/v1';
const LOOKBACK_SPARKLINE = 14; // days of daily data for trend chart
const LOOKBACK_STATS     = 7;  // days for sends/replies totals

// ── Entry point (JSONP) ──────────────────────────────────────
function doGet(e) {
  const cb = (e.parameter && e.parameter.callback) || 'callback';
  try {
    const payload = JSON.stringify(buildDashboardData());
    return ContentService
      .createTextOutput(cb + '(' + payload + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  } catch (err) {
    const errPayload = JSON.stringify({ error: err.message, stack: err.stack });
    return ContentService
      .createTextOutput(cb + '(' + errPayload + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
}

// ── Main builder ─────────────────────────────────────────────
function buildDashboardData() {
  const key = API_KEY();
  if (!key) throw new Error('INSTANTLY_API_KEY not set in Script Properties');

  const today   = new Date();
  const end     = fmtDate(today);
  const start7  = fmtDate(daysAgo(today, LOOKBACK_STATS));
  const start14 = fmtDate(daysAgo(today, LOOKBACK_SPARKLINE));

  // 1 – campaign list
  const campaigns = fetchCampaigns(key);
  if (!campaigns.length) return { generated_at: new Date().toISOString(), campaigns: [] };

  // 2 – parallel fetches: 7d summary + 14d daily + lead counts
  const summaryReqs = campaigns.map(c => ({
    url: `${BASE_URL}/analytics/campaign/summary?api_key=${key}&campaign_id=${c.id}&start_date=${start7}&end_date=${end}`,
    muteHttpExceptions: true,
  }));
  const dailyReqs = campaigns.map(c => ({
    url: `${BASE_URL}/analytics/campaign/count?api_key=${key}&campaign_id=${c.id}&start_date=${start14}&end_date=${end}`,
    muteHttpExceptions: true,
  }));
  const summaryRes = UrlFetchApp.fetchAll(summaryReqs);
  const dailyRes   = UrlFetchApp.fetchAll(dailyReqs);

  const result = campaigns.map((c, i) => {
    // Summary is an array — take first element
    const summaryArr = safeJson(summaryRes[i]);
    const s          = (Array.isArray(summaryArr) ? summaryArr[0] : summaryArr) || {};
    // Daily is also a plain array
    const dailyArr   = safeJson(dailyRes[i]);
    const daily      = Array.isArray(dailyArr) ? dailyArr : (dailyArr.data || []);

    const sparkline    = buildSparkline(daily, today, LOOKBACK_SPARKLINE);
    const lastSendDate = getLastSendDate(daily);

    // Lead counts come from the summary (all-time, not date-filtered)
    const totalLeads = s.leads_count     || 0;
    const contacted  = s.contacted_count || 0;

    return {
      id:           c.id,
      client:       CLIENT_MAP[c.id] || DEFAULT_CLIENT,
      campaign:     c.name || s.campaign_name || '',
      status:       (c.status === 1 || s.campaign_status === 1) ? 'Active' : 'Paused',
      sends7d:      s.emails_sent_count || 0,
      replies7d:    s.reply_count_unique || 0,
      posReplies7d: 0,  // will come from tracking sheet
      bookings7d:   0,  // will come from tracking sheet
      totalLeads,
      contacted,
      leadsLeft:    Math.max(0, totalLeads - contacted),
      bounced:      s.bounced_count || 0,
      lastSendDate,
      sparkline,
    };
  });

  return { generated_at: new Date().toISOString(), campaigns: result };
}

// ── Instantly helpers ─────────────────────────────────────────
function fetchCampaigns(key) {
  const res  = UrlFetchApp.fetch(`${BASE_URL}/campaign/list?api_key=${key}&limit=100&skip=0`, { muteHttpExceptions: true });
  const json = safeJson(res);
  // API returns either { campaigns: [...] } or an array directly
  return Array.isArray(json) ? json : (json.campaigns || []);
}

function buildSparkline(daily, today, days) {
  // daily is a plain array: [{ date, sent, ... }, ...]
  const map = {};
  daily.forEach(function(d) { if (d.date) map[d.date] = d.sent || 0; });
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push(map[fmtDate(daysAgo(today, i))] || 0);
  }
  return out;
}

function getLastSendDate(daily) {
  // daily is a plain array, newest last — scan backwards
  for (let i = daily.length - 1; i >= 0; i--) {
    if ((daily[i].sent || 0) > 0) return daily[i].date || null;
  }
  return null;
}

// ── Utilities ─────────────────────────────────────────────────
function safeJson(response) {
  try { return JSON.parse(response.getContentText()); } catch (e) { return {}; }
}
function fmtDate(d) { return d.toISOString().slice(0, 10); }
function daysAgo(base, n) { return new Date(base.getTime() - n * 86400000); }

// ── Test helpers (run these manually in the Apps Script editor) ──
function testListCampaigns() {
  const key = API_KEY();
  const res = UrlFetchApp.fetch(`${BASE_URL}/campaign/list?api_key=${key}&limit=100`);
  Logger.log(res.getContentText());
}

function testAnalytics() {
  // Replace with a real campaign ID from testListCampaigns()
  const TEST_CAMPAIGN_ID = 'PASTE_CAMPAIGN_ID_HERE';
  const key = API_KEY();
  const today  = fmtDate(new Date());
  const start  = fmtDate(daysAgo(new Date(), 7));
  const resSum = UrlFetchApp.fetch(`${BASE_URL}/analytics/campaign/summary?api_key=${key}&campaign_id=${TEST_CAMPAIGN_ID}&start_date=${start}&end_date=${today}`);
  Logger.log('SUMMARY: ' + resSum.getContentText());
  const resDay = UrlFetchApp.fetch(`${BASE_URL}/analytics/campaign/count?api_key=${key}&campaign_id=${TEST_CAMPAIGN_ID}&start_date=${fmtDate(daysAgo(new Date(), 14))}&end_date=${today}`);
  Logger.log('DAILY: ' + resDay.getContentText());
  const resLead = UrlFetchApp.fetch(`${BASE_URL}/lead/get/count?api_key=${key}&campaign_id=${TEST_CAMPAIGN_ID}`);
  Logger.log('LEADS: ' + resLead.getContentText());
}

function testFullBuild() {
  Logger.log(JSON.stringify(buildDashboardData(), null, 2));
}
