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

// ── Entry point (JSONP) — reads from cache, responds instantly ─
function doGet(e) {
  const cb = (e.parameter && e.parameter.callback) || 'callback';
  try {
    const props   = PropertiesService.getScriptProperties();
    const payload = props.getProperty(CACHE_KEY);
    if (!payload) {
      // No cache yet — tell dashboard to use mock data and prompt manual refresh
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
  Logger.log('Hourly trigger created for refreshCache');
}

// ── Main builder ─────────────────────────────────────────────
function buildDashboardData() {
  const today   = new Date();
  const end     = fmtDate(today);
  const start30 = fmtDate(daysAgo(today, 30)); // wide window to find 7 active days
  const opts    = fetchOpts();

  const campaigns = fetchCampaigns(opts);
  if (!campaigns.length) return { generated_at: new Date().toISOString(), campaigns: [] };

  const start7 = fmtDate(daysAgo(today, 7));

  const result = campaigns.map(function(c) {
    // 7-day summary for sends/replies
    const sumUrl = BASE_V2 + '/campaigns/analytics?id=' + c.id + '&start_date=' + start7 + '&end_date=' + end;
    const sumRes = UrlFetchApp.fetch(sumUrl, opts);
    const sumRaw = safeJson(sumRes);
    const s      = Array.isArray(sumRaw) ? (sumRaw[0] || {}) : (sumRaw || {});

    // 30-day daily for sparkline + lastSendDate
    const dayUrl = BASE_V2 + '/campaigns/analytics/daily?campaign_id=' + c.id + '&start_date=' + start30 + '&end_date=' + end;
    const dayRes = UrlFetchApp.fetch(dayUrl, opts);
    const dayRaw = safeJson(dayRes);
    const daily  = Array.isArray(dayRaw) ? dayRaw : (dayRaw.items || dayRaw.data || []);

    const sparkline    = buildSparkline(daily, today, LOOKBACK_SPARKLINE);
    const lastSendDate = getLastSendDate(daily);
    const totalLeads   = num(s.leads_count);
    const contacted    = num(s.contacted_count);

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

  // Find campaign by name substring (case-insensitive)
  const TARGET = 'jobtitle';
  const all = fetchCampaigns(opts);
  const cory = all.filter(c => CLIENT_MAP[c.id] === 'Cory Woodward');
  Logger.log('=== All Cory campaigns ===');
  cory.forEach(c => Logger.log(c.id + ' | ' + c.name + ' | status:' + c.status));

  const target = cory.find(c => c.name.toLowerCase().includes(TARGET));
  if (!target) { Logger.log('Campaign not found — check TARGET string above'); return; }

  Logger.log('\n=== ' + target.name + ' ===');
  Logger.log('ID: ' + target.id);

  // 7-day summary
  const sum7Url = BASE_V2 + '/campaigns/analytics?id=' + target.id + '&start_date=' + start7 + '&end_date=' + end;
  const s7 = safeJson(UrlFetchApp.fetch(sum7Url, opts));
  const r7 = Array.isArray(s7) ? (s7[0] || {}) : (s7 || {});
  Logger.log('\n--- 7-day summary (start=' + start7 + ') ---');
  Logger.log('emails_sent_count:              ' + r7.emails_sent_count);
  Logger.log('contacted_count:                ' + r7.contacted_count);
  Logger.log('new_leads_contacted_count:      ' + r7.new_leads_contacted_count);
  Logger.log('reply_count:                    ' + r7.reply_count);
  Logger.log('reply_count_unique:             ' + r7.reply_count_unique);
  Logger.log('reply_count_automatic:          ' + r7.reply_count_automatic);
  Logger.log('reply_count_automatic_unique:   ' + r7.reply_count_automatic_unique);
  Logger.log('total_opportunities:            ' + r7.total_opportunities);
  Logger.log('leads_count:                    ' + r7.leads_count);
  Logger.log('bounced_count:                  ' + r7.bounced_count);
  Logger.log('open_count:                     ' + r7.open_count);
  Logger.log('click_count:                    ' + r7.click_count);

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

  // 7-day daily — sum key fields
  const dayUrl = BASE_V2 + '/campaigns/analytics/daily?campaign_id=' + target.id + '&start_date=' + start7 + '&end_date=' + end;
  const dayRaw = safeJson(UrlFetchApp.fetch(dayUrl, opts));
  const daily  = Array.isArray(dayRaw) ? dayRaw : (dayRaw.items || []);
  let dSent=0, dContacted=0, dReplies=0, dUniqReplies=0, dAutoUniq=0, dOpps=0, dUniqOpps=0;
  daily.forEach(function(d) {
    dSent        += num(d.sent);
    dContacted   += num(d.contacted);
    dReplies     += num(d.replies);
    dUniqReplies += num(d.unique_replies);
    dAutoUniq    += num(d.unique_replies_automatic);
    dOpps        += num(d.opportunities);
    dUniqOpps    += num(d.unique_opportunities);
  });
  Logger.log('\n--- 7-day daily SUM (per-day rows: ' + daily.length + ') ---');
  Logger.log('sent sum:                       ' + dSent);
  Logger.log('contacted sum:                  ' + dContacted);
  Logger.log('replies sum:                    ' + dReplies);
  Logger.log('unique_replies sum:             ' + dUniqReplies);
  Logger.log('unique_replies_automatic sum:   ' + dAutoUniq);
  Logger.log('opportunities sum:              ' + dOpps);
  Logger.log('unique_opportunities sum:       ' + dUniqOpps);

  // Computed rates — compare with Instantly UI
  const sent  = num(r7.emails_sent_count);
  const cont  = num(r7.contacted_count);
  const repl  = num(r7.reply_count);
  const replU = num(r7.reply_count_unique) + num(r7.reply_count_automatic_unique);
  const opps  = num(r7.total_opportunities);
  Logger.log('\n--- Computed rates (compare with Instantly UI) ---');
  Logger.log('Instantly shows → Emails sent: 968  |  Reply rate: 1.65% (16)  |  Pos reply rate: 6.25% (1)  |  Opps: 1');
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
