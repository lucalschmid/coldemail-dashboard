/* ============================================================
   Cold Email Dashboard — derivations & flags
   ------------------------------------------------------------
   Pure functions. Given thresholds + a campaign, return
   computed metrics and severity flags.
   ============================================================ */

window.CSD = window.CSD || {};

window.CSD.format = {
  pct(n, digits = 2) {
    if (!isFinite(n) || n === null) return '—';
    return (n * 100).toFixed(digits) + '%';
  },
  num(n) {
    if (n == null || !isFinite(n)) return '—';
    return n.toLocaleString('en-US');
  },
  numCompact(n) {
    if (n == null || !isFinite(n)) return '—';
    if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return n.toString();
  },
  days(n) {
    if (n == null || !isFinite(n)) return '∞';
    if (n >= 999) return '∞';
    if (n < 1) return '<1d';
    return Math.round(n) + 'd';
  },
  timeAgo(iso) {
    if (!iso) return '—';
    const t = new Date(iso).getTime();
    const now = Date.now();
    const m = Math.floor((now - t) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    const d = Math.floor(h / 24);
    return d + 'd ago';
  },
};

window.CSD.derive = function derive(campaign, thresholds) {
  const sends = campaign.sends7d || 0;
  const replies = campaign.replies7d || 0;
  const pos = campaign.posReplies7d || 0;
  const bookings = campaign.bookings7d || 0;
  const dailyRate = sends / 7;
  const runwayDays = dailyRate > 0 ? campaign.leadsLeft / dailyRate : (campaign.leadsLeft > 0 ? Infinity : 0);

  // PRR = pos / replies (Instantly definition: of all who replied, how many were positive)
  const prr = replies > 0 ? pos / replies : null;
  const abr = sends > 0 ? bookings / sends : null;

  // Days since last send
  let daysSinceLastSend = null;
  if (campaign.lastSendDate) {
    const last = new Date(campaign.lastSendDate).getTime();
    const now = Date.now();
    daysSinceLastSend = Math.max(0, Math.floor((now - last) / 86400000));
  } else if (sends > 0) {
    daysSinceLastSend = 0;
  }

  // Severity: 0=ok, 1=warn, 2=critical
  let prrSev = 0;
  if (prr !== null && replies >= 10) {
    if (prr < thresholds.prrCritical) prrSev = 2;
    else if (prr < thresholds.prrWarning) prrSev = 1;
  }

  let abrSev = 0;
  if (abr !== null && sends >= 500) {
    if (abr < thresholds.abrCritical) abrSev = 2;
    else if (abr < thresholds.abrWarning) abrSev = 1;
  }

  let runwaySev = 0;
  if (campaign.status === 'Active') {
    if (campaign.leadsLeft === 0 || runwayDays < thresholds.runwayCritical) runwaySev = 2;
    else if (runwayDays < thresholds.runwayWarning) runwaySev = 1;
  }

  // Staleness — only meaningful for lists with leads still available.
  // "Idle" = hasn't sent in N days while leads remain.
  let staleSev = 0;
  let canRerun = false;
  if (daysSinceLastSend !== null && campaign.leadsLeft > 0 && sends === 0) {
    if (daysSinceLastSend >= (thresholds.staleCritical || 60)) staleSev = 2;
    else if (daysSinceLastSend >= (thresholds.staleWarning || 14)) staleSev = 1;
    canRerun = daysSinceLastSend >= 7; // safe to rerun after a week of cooldown
  }

  const overall = Math.max(prrSev, abrSev, runwaySev, staleSev);

  return {
    ...campaign,
    dailyRate,
    runwayDays,
    prr,
    abr,
    prrSev,
    abrSev,
    runwaySev,
    staleSev,
    daysSinceLastSend,
    canRerun,
    overall,
  };
};

window.CSD.DEFAULT_THRESHOLDS = {
  prrWarning: 0.05,    // 5% of replies — pos replies / total replies
  prrCritical: 0.02,   // 2%
  abrWarning: 0.002,    // 0.20%
  abrCritical: 0.001,   // 0.10%
  runwayWarning: 14,    // days
  runwayCritical: 7,    // days
  staleWarning: 14,     // idle days before warning
  staleCritical: 45,    // idle days before critical
};

window.CSD.THRESHOLD_DOCS = {
  prr: 'Positive Reply Rate. Of all replies, how many were positive (opportunities). Benchmark: 5%+. Below 2% means replies aren\'t converting — check copy quality or targeting.',
  abr: 'Appointment Booking Rate. 0.20% on sends is healthy for high-ticket B2B. Below 0.10% means replies aren\'t converting to calls.',
  runway: 'Days of leads remaining at the current 7-day send rate. Refill the list before it hits zero or inboxes sit idle.',
};

// Build action items, ordered by severity then size.
window.CSD.buildActions = function buildActions(derived, thresholds) {
  const items = [];
  for (const c of derived) {
    if (c.runwaySev === 2) {
      items.push({
        id: c.id + ':runway',
        sev: 2,
        client: c.client,
        campaign: c.campaign,
        kind: 'runway',
        label: c.leadsLeft === 0
          ? 'Lead list exhausted'
          : `${Math.round(c.runwayDays)} days of leads left`,
        detail: `${c.sends7d.toLocaleString()} sent / 7d. Refill or pause.`,
      });
    } else if (c.runwaySev === 1) {
      items.push({
        id: c.id + ':runway',
        sev: 1,
        client: c.client,
        campaign: c.campaign,
        kind: 'runway',
        label: `${Math.round(c.runwayDays)} days of leads left`,
        detail: `Plan refill within the week.`,
      });
    }
    if (c.prrSev === 2) {
      items.push({
        id: c.id + ':prr',
        sev: 2,
        client: c.client,
        campaign: c.campaign,
        kind: 'prr',
        label: `Positive reply rate ${(c.prr * 100).toFixed(2)}%`,
        detail: `Below ${(thresholds.prrCritical * 100).toFixed(2)}% on ${c.sends7d.toLocaleString()} sends. Investigate copy or deliverability.`,
      });
    } else if (c.prrSev === 1) {
      items.push({
        id: c.id + ':prr',
        sev: 1,
        client: c.client,
        campaign: c.campaign,
        kind: 'prr',
        label: `Positive reply rate ${(c.prr * 100).toFixed(2)}%`,
        detail: `Below benchmark of ${(thresholds.prrWarning * 100).toFixed(2)}%.`,
      });
    }
    if (c.abrSev === 2) {
      items.push({
        id: c.id + ':abr',
        sev: 2,
        client: c.client,
        campaign: c.campaign,
        kind: 'abr',
        label: `Booking rate ${(c.abr * 100).toFixed(2)}%`,
        detail: `Replies aren't converting to calls.`,
      });
    }
    if (c.staleSev === 2) {
      items.push({
        id: c.id + ':stale',
        sev: 2,
        client: c.client,
        campaign: c.campaign,
        kind: 'stale',
        label: `Idle ${c.daysSinceLastSend}d · ${c.leadsLeft.toLocaleString()} leads waiting`,
        detail: `Hasn't sent in ${c.daysSinceLastSend} days. Safe to rerun — cooldown elapsed.`,
      });
    } else if (c.staleSev === 1) {
      items.push({
        id: c.id + ':stale',
        sev: 1,
        client: c.client,
        campaign: c.campaign,
        kind: 'stale',
        label: `Idle ${c.daysSinceLastSend}d · ${c.leadsLeft.toLocaleString()} leads waiting`,
        detail: c.canRerun ? 'Cooldown elapsed — can rerun.' : 'Worth a check.',
      });
    }
  }
  // Sort: sev desc, then kind priority (runway > stale > prr > abr)
  const kindOrder = { runway: 0, stale: 1, prr: 2, abr: 3 };
  items.sort((a, b) => b.sev - a.sev || kindOrder[a.kind] - kindOrder[b.kind]);
  return items;
};

// Aggregate: agency-wide totals from a list of derived campaigns
window.CSD.aggregate = function aggregate(derived) {
  const sends = derived.reduce((s, c) => s + (c.sends7d || 0), 0);
  const replies = derived.reduce((s, c) => s + (c.replies7d || 0), 0);
  const pos = derived.reduce((s, c) => s + (c.posReplies7d || 0), 0);
  const bookings = derived.reduce((s, c) => s + (c.bookings7d || 0), 0);
  const leadsLeft = derived.reduce((s, c) => s + (c.leadsLeft || 0), 0);
  const totalLeads = derived.reduce((s, c) => s + (c.totalLeads || 0), 0);
  const contacted = derived.reduce((s, c) => s + (c.contacted || 0), 0);
  const active = derived.filter((c) => c.status === 'Active').length;
  const flagged = derived.filter((c) => c.overall === 2).length;
  return {
    sends, replies, pos, bookings, leadsLeft, totalLeads, contacted,
    prr: sends > 0 ? pos / sends : null,
    abr: sends > 0 ? bookings / sends : null,
    replyRate: sends > 0 ? replies / sends : null,
    active,
    flagged,
    total: derived.length,
  };
};

// Merge derived sparkline arrays into one daily-summed series.
window.CSD.sumSparklines = function sumSparklines(derived) {
  const len = Math.max(0, ...derived.map((c) => (c.sparkline || []).length));
  const out = new Array(len).fill(0);
  for (const c of derived) {
    const s = c.sparkline || [];
    for (let i = 0; i < len; i++) out[i] += s[i] || 0;
  }
  return out;
};

// Group derived campaigns by client + compute group totals.
window.CSD.groupByClient = function groupByClient(derived) {
  const map = {};
  for (const c of derived) {
    if (!map[c.client]) map[c.client] = { client: c.client, campaigns: [] };
    map[c.client].campaigns.push(c);
  }
  return Object.values(map).map((g) => {
    const sends = g.campaigns.reduce((s, c) => s + (c.sends7d || 0), 0);
    const replies = g.campaigns.reduce((s, c) => s + (c.replies7d || 0), 0);
    const pos = g.campaigns.reduce((s, c) => s + (c.posReplies7d || 0), 0);
    const bookings = g.campaigns.reduce((s, c) => s + (c.bookings7d || 0), 0);
    const leadsLeft = g.campaigns.reduce((s, c) => s + (c.leadsLeft || 0), 0);
    const totalLeads = g.campaigns.reduce((s, c) => s + (c.totalLeads || 0), 0);
    const active = g.campaigns.filter((c) => c.status === 'Active').length;
    const flagged = g.campaigns.filter((c) => c.overall === 2).length;
    const warned = g.campaigns.filter((c) => c.overall === 1).length;
    const stale = g.campaigns.filter((c) => c.staleSev > 0).length;
    const canRerun = g.campaigns.filter((c) => c.canRerun).length;
    const overall = Math.max(...g.campaigns.map((c) => c.overall || 0));
    const dailyRate = sends / 7;
    const runwayDays = dailyRate > 0 ? leadsLeft / dailyRate : (leadsLeft > 0 ? Infinity : 0);
    // Sum sparklines for client-level daily series
    const sparkLen = Math.max(0, ...g.campaigns.map((c) => (c.sparkline || []).length));
    const sparkline = new Array(sparkLen).fill(0);
    for (const c of g.campaigns) {
      const s = c.sparkline || [];
      for (let i = 0; i < sparkLen; i++) sparkline[i] += s[i] || 0;
    }
    return {
      ...g,
      sends, replies, pos, bookings, leadsLeft, totalLeads,
      active,
      flagged,
      warned,
      stale,
      canRerun,
      overall,
      dailyRate,
      runwayDays,
      sparkline,
      replyRate: sends > 0 ? replies / sends : null,
      prr: sends > 0 ? pos / sends : null,
    };
  }).sort((a, b) => b.sends - a.sends);
};
