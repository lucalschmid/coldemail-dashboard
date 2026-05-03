/* global React, ReactDOM */
const { useState, useEffect, useMemo, useCallback } = React;
const fmtA = window.CSD.format;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "density": "comfortable",
  "showBookings": false,
  "groupByClient": true,
  "prrWarning": 0.0035,
  "prrCritical": 0.0025,
  "runwayWarning": 14,
  "runwayCritical": 7
}/*EDITMODE-END*/;

const RESOLVED_KEY = 'csd:resolved:v1';
const OPEN_GROUPS_KEY = 'csd:open-groups:v1';

function loadResolved() {
  try {
    const raw = localStorage.getItem(RESOLVED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const now = Date.now();
    const fresh = {};
    for (const [k, t] of Object.entries(parsed)) {
      if (now - t < 24 * 60 * 60 * 1000) fresh[k] = t;
    }
    return fresh;
  } catch (e) { return {}; }
}
function saveResolved(m) { try { localStorage.setItem(RESOLVED_KEY, JSON.stringify(m)); } catch (e) {} }

function loadOpenGroups() {
  try { return JSON.parse(localStorage.getItem(OPEN_GROUPS_KEY) || '{}'); } catch (e) { return {}; }
}
function saveOpenGroups(m) { try { localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(m)); } catch (e) {} }

function dayLabels(n) {
  const out = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    out.push(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]);
  }
  return out;
}

function openFilePicker(callback) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.csv,text/csv';
  input.onchange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => callback(file.name, ev.target.result);
    reader.readAsText(file);
  };
  input.click();
}
function parseCSVLeadCount(text) {
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  return Math.max(0, lines.length - 1);
}
function downloadBlob(filename, content) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}
function campaignSummaryCSV(c, name) {
  const rr = c.sends7d > 0 ? (c.replies7d / c.sends7d * 100).toFixed(2) + '%' : '—';
  const prr = c.prr != null ? (c.prr * 100).toFixed(2) + '%' : '—';
  const runway = isFinite(c.runwayDays) ? Math.round(c.runwayDays) + 'd' : '∞';
  const headers = ['List Name','Client','Status','Sends 7d','Reply Rate','PRR','Leads Left','Total Leads','Runway'];
  const row = [name, c.client, c.status, c.sends7d, rr, prr, c.leadsLeft, c.totalLeads, runway];
  const esc = v => '"' + String(v).replace(/"/g, '""') + '"';
  return [headers, row].map(r => r.map(esc).join(',')).join('\n');
}

function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [resolved, setResolved] = useState(loadResolved);
  const [openGroups, setOpenGroups] = useState(loadOpenGroups);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeNav, setActiveNav] = useState('campaigns');
  const [clientFilter, setClientFilter] = useState('all');
  const [listNames, setListNames] = useState(() => {
    try { return JSON.parse(localStorage.getItem('csd:list-names:v1') || '{}'); } catch (e) { return {}; }
  });
  const [clientNames, setClientNames] = useState(() => {
    try { return JSON.parse(localStorage.getItem('csd:client-names:v1') || '{}'); } catch (e) { return {}; }
  });
  const [customClients, setCustomClients] = useState(() => {
    try { return JSON.parse(localStorage.getItem('csd:custom-clients:v1') || '[]'); } catch (e) { return []; }
  });
  const [customLists, setCustomLists] = useState(() => {
    try { return JSON.parse(localStorage.getItem('csd:custom-lists:v1') || '[]'); } catch (e) { return []; }
  });
  const [editingId, setEditingId] = useState(null);
  const [deletedCampaignIds, setDeletedCampaignIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem('csd:deleted-campaigns:v1') || '[]'); } catch(e) { return []; }
  });
  const [deletedClientNames, setDeletedClientNames] = useState(() => {
    try { return JSON.parse(localStorage.getItem('csd:deleted-clients:v1') || '[]'); } catch(e) { return []; }
  });
  const [editingClientName, setEditingClientName] = useState(null);
  const [editingClientValue, setEditingClientValue] = useState('');
  const [addingClient, setAddingClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [editingValue, setEditingValue] = useState('');
  const [openLLGroups, setOpenLLGroups] = useState(() => {
    try { return JSON.parse(localStorage.getItem('csd:ll-open:v1') || '{}'); } catch (e) { return {}; }
  });

  // Manual lead list categories and entries
  const [llCategories, setLLCategories] = useState(() => {
    try { return JSON.parse(localStorage.getItem('csd:ll-categories:v1') || '[]'); } catch (e) { return []; }
  });
  const [manualLists, setManualLists] = useState(() => {
    try { return JSON.parse(localStorage.getItem('csd:manual-lists:v1') || '[]'); } catch (e) { return []; }
  });
  const [editingLL, setEditingLL] = useState(null); // { id, field }
  const [editingLLVal, setEditingLLVal] = useState('');
  const [addingLLCategory, setAddingLLCategory] = useState(false);
  const [newLLCategoryName, setNewLLCategoryName] = useState('');
  const [renamingCat, setRenamingCat] = useState(null);
  const [renamingCatVal, setRenamingCatVal] = useState('');

  // Drag-and-drop for unassigned campaigns
  const [campaignClientOverrides, setCampaignClientOverrides] = useState(() => {
    try { return JSON.parse(localStorage.getItem('csd:campaign-client:v1') || '{}'); } catch (e) { return {}; }
  });
  const [dragCampaignId, setDragCampaignId] = useState(null);
  const [dragOverClient, setDragOverClient] = useState(null);

  // Add-list modal
  const [addListModal, setAddListModal] = useState(null); // { categoryId } | null
  const [addListForm, setAddListForm] = useState({ name: '', status: 'Active', lastActive: '', leadCount: '', runningText: '', csvData: null, csvName: '' });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', tweaks.theme);
  }, [tweaks.theme]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const d = await window.DASHBOARD_DATA.load();
      setData(d);
    } catch (e) { console.error(e); }
    finally { setRefreshing(false); setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const id = setInterval(refresh, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        document.getElementById('csd-search-input')?.focus();
      }
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const thresholds = useMemo(() => ({
    prrWarning: Number(tweaks.prrWarning),
    prrCritical: Number(tweaks.prrCritical),
    abrWarning: 0.002,
    abrCritical: 0.001,
    runwayWarning: Number(tweaks.runwayWarning),
    runwayCritical: Number(tweaks.runwayCritical),
  }), [tweaks.prrWarning, tweaks.prrCritical, tweaks.runwayWarning, tweaks.runwayCritical]);

  const derived = useMemo(() => {
    if (!data) return [];
    const delSet = new Set(deletedCampaignIds);
    const base = data.campaigns
      .filter(c => !delSet.has(c.id))
      .map((c) => window.CSD.derive({
        ...c,
        client: campaignClientOverrides[c.id] || clientNames[c.client] || c.client,
      }, thresholds));
    const custom = customLists
      .filter(l => !delSet.has(l.id))
      .map(l => window.CSD.derive({
        id: l.id, client: clientNames[l.client] || l.client,
        campaign: l.name, status: 'Paused',
        sends7d: 0, replies7d: 0, posReplies7d: 0, bookings7d: 0,
        totalLeads: l.totalLeads, contacted: 0, leadsLeft: l.totalLeads,
        bounced: 0, lastSendDate: null, sparkline: [], isCustom: true,
      }, thresholds));
    return [...base, ...custom];
  }, [data, thresholds, clientNames, customLists, deletedCampaignIds, campaignClientOverrides]);

  const actions = useMemo(() => window.CSD.buildActions(derived, thresholds), [derived, thresholds]);
  const allGroups = useMemo(() => {
    const delClientSet = new Set(deletedClientNames);
    const groups = window.CSD.groupByClient(derived).filter(g => !delClientSet.has(g.client));
    const existing = new Set(groups.map(g => g.client));
    // Always pin Compound Scaling as a client
    const PINNED = 'Compound Scaling';
    if (!existing.has(PINNED) && !delClientSet.has(PINNED)) {
      groups.unshift({ client: PINNED, campaigns: [], sends: 0, replies: 0, pos: 0, bookings: 0,
        leadsLeft: 0, totalLeads: 0, active: 0, flagged: 0, warned: 0,
        stale: 0, canRerun: 0, overall: 0, dailyRate: 0,
        runwayDays: Infinity, sparkline: [], replyRate: null, prr: null });
      existing.add(PINNED);
    }
    customClients.forEach(c => {
      const name = clientNames[c.name] || c.name;
      if (!existing.has(name) && !delClientSet.has(name)) groups.push({
        client: name, campaigns: [], sends: 0, replies: 0, pos: 0, bookings: 0,
        leadsLeft: 0, totalLeads: 0, active: 0, flagged: 0, warned: 0,
        stale: 0, canRerun: 0, overall: 0, dailyRate: 0,
        runwayDays: Infinity, sparkline: [], replyRate: null, prr: null,
      });
    });
    return groups;
  }, [derived, customClients, clientNames, deletedClientNames]);

  const filteredByClient = useMemo(() => {
    if (clientFilter === 'all') return derived;
    return derived.filter((c) => c.client === clientFilter);
  }, [derived, clientFilter]);

  const totals = useMemo(() => window.CSD.aggregate(filteredByClient), [filteredByClient]);
  const groups = useMemo(() => window.CSD.groupByClient(filteredByClient), [filteredByClient]);

  const filteredGroups = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        campaigns: g.campaigns.filter((c) =>
          c.campaign.toLowerCase().includes(q) || g.client.toLowerCase().includes(q)),
      }))
      .filter((g) => g.campaigns.length > 0 || g.client.toLowerCase().includes(q));
  }, [groups, search]);

  const labels = useMemo(() => dayLabels(7), []);

  const onResolve = (id) => {
    const next = { ...resolved, [id]: Date.now() };
    setResolved(next); saveResolved(next);
  };
  const clearResolved = () => { setResolved({}); saveResolved({}); };

  const toggleGroup = (clientName) => {
    const next = { ...openGroups, [clientName]: !openGroups[clientName] };
    setOpenGroups(next); saveOpenGroups(next);
  };

  const onJumpToCampaign = (action) => {
    const next = { ...openGroups, [action.client]: true };
    setOpenGroups(next); saveOpenGroups(next);
    setTimeout(() => {
      const els = document.querySelectorAll('.csd-clientgroup');
      for (const el of els) {
        if (el.textContent.includes(action.client)) {
          window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 100, behavior: 'smooth' });
          break;
        }
      }
    }, 100);
  };

  const visibleActions = actions.filter(a => !resolved[a.id]);
  const critCount = visibleActions.filter(a => a.sev === 2).length;
  const warnCount = visibleActions.filter(a => a.sev === 1).length;
  const totalAlerts = visibleActions.length;

  if (loading) {
    return React.createElement('div', { className: 'csd' },
      React.createElement('div', { className: 'csd-loading' },
        React.createElement('div', null, 'Loading campaigns…'),
        React.createElement('div', { className: 'bar' })));
  }

  const isMock = data?.source !== 'live';
  const sourceLabel = data?.source === 'live' ? 'Live · Instantly' : 'Demo data';

  // ---------- Sidebar ----------
  const navItem = (key, label, icon, count) => React.createElement('a', {
    className: activeNav === key ? 'active' : '',
    onClick: () => { setActiveNav(key); setClientFilter('all'); },
  }, icon, label, count != null && React.createElement('span', { className: 'count' }, count));

  const sidebar = React.createElement('aside', { className: 'csd-sidebar' },
    React.createElement('div', { className: 'csd-sidebar-brand' },
      React.createElement('img', { src: 'logo.png', className: 'brand-logo', alt: '' }),
      React.createElement('span', null, 'Compound Scaling')),
    React.createElement('div', { className: 'csd-sidebar-section' }, 'Workspace'),
    React.createElement('nav', { className: 'csd-nav' },
      navItem('overview', 'Overview',
        React.createElement('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' },
          React.createElement('rect', { x: 3, y: 3, width: 7, height: 9 }),
          React.createElement('rect', { x: 14, y: 3, width: 7, height: 5 }),
          React.createElement('rect', { x: 14, y: 12, width: 7, height: 9 }),
          React.createElement('rect', { x: 3, y: 16, width: 7, height: 5 }))),
      navItem('campaigns', 'Campaigns',
        React.createElement('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' },
          React.createElement('path', { d: 'M4 4h16v16H4z' }),
          React.createElement('path', { d: 'M4 9h16' }),
          React.createElement('path', { d: 'M9 9v11' })),
        derived.length),
      navItem('clients', 'Clients',
        React.createElement('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' },
          React.createElement('path', { d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' }),
          React.createElement('circle', { cx: 9, cy: 7, r: 4 }),
          React.createElement('path', { d: 'M23 21v-2a4 4 0 0 0-3-3.87' }),
          React.createElement('path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' })),
        allGroups.filter(g => g.client !== 'Unassigned').length),
      navItem('leadlists', 'Lead Lists',
        React.createElement('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' },
          React.createElement('path', { d: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01' }))),
      navItem('bookings', 'Bookings',
        React.createElement('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' },
          React.createElement('rect', { x: 3, y: 4, width: 18, height: 18, rx: 2 }),
          React.createElement('line', { x1: 16, y1: 2, x2: 16, y2: 6 }),
          React.createElement('line', { x1: 8, y1: 2, x2: 8, y2: 6 }),
          React.createElement('line', { x1: 3, y1: 10, x2: 21, y2: 10 }))),
      navItem('reports', 'Reports',
        React.createElement('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' },
          React.createElement('path', { d: 'M21.21 15.89A10 10 0 1 1 8 2.83' }),
          React.createElement('path', { d: 'M22 12A10 10 0 0 0 12 2v10z' })))),
    React.createElement('div', { className: 'csd-sidebar-section' }, 'Account'),
    React.createElement('nav', { className: 'csd-nav' },
      navItem('settings', 'Settings',
        React.createElement('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' },
          React.createElement('circle', { cx: 12, cy: 12, r: 3 }),
          React.createElement('path', { d: 'M12 1v6M12 17v6M4.22 4.22l4.24 4.24M15.54 15.54l4.24 4.24M1 12h6M17 12h6M4.22 19.78l4.24-4.24M15.54 8.46l4.24-4.24' }))))
  );

  // ---------- Topbar ----------
  const titleByNav = { overview: 'Overview', campaigns: 'Campaigns', clients: 'Clients', leadlists: 'Lead Lists', bookings: 'Bookings', reports: 'Reports', settings: 'Settings' };
  const topbar = React.createElement('div', { className: 'csd-topbar' },
    React.createElement('div', { className: 'csd-topbar-title' },
      React.createElement('h1', null, titleByNav[activeNav] || 'Dashboard'),
      React.createElement('span', { className: 'crumb' },
        clientFilter === 'all'
          ? '· ' + derived.length + ' total · ' + window.CSD.aggregate(derived).active + ' active'
          : '· ' + clientFilter)),
    React.createElement('div', { className: 'csd-topbar-spacer' }),
    React.createElement('div', { className: 'csd-topbar-search' },
      React.createElement('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' },
        React.createElement('circle', { cx: 11, cy: 11, r: 7 }),
        React.createElement('path', { d: 'm20 20-3.5-3.5' })),
      React.createElement('input', {
        id: 'csd-search-input',
        type: 'text',
        placeholder: 'Search campaign or client',
        value: search,
        onChange: (e) => setSearch(e.target.value),
      }),
      React.createElement('kbd', null, '⌘K')),
    React.createElement('div', { className: 'csd-meta-pill' + (isMock ? ' is-mock' : '') },
      React.createElement('span', { className: 'pulse' }),
      React.createElement('span', { className: 'src' }, sourceLabel),
      React.createElement('span', null, '·'),
      React.createElement('span', null, fmtA.timeAgo(data?.generated_at))),
    React.createElement('button', {
      className: 'csd-icon-btn' + (refreshing ? ' is-active' : ''),
      onClick: refresh,
      'aria-label': 'Refresh',
      title: 'Refresh',
    },
      React.createElement('svg', {
        width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
        style: refreshing ? { animation: 'csd-spin 0.8s linear infinite' } : null
      },
        React.createElement('path', { d: 'M3 12a9 9 0 0 1 15-6.7L21 8' }),
        React.createElement('path', { d: 'M21 3v5h-5' }),
        React.createElement('path', { d: 'M21 12a9 9 0 0 1-15 6.7L3 16' }),
        React.createElement('path', { d: 'M3 21v-5h5' }))),
    React.createElement('button', {
      className: 'csd-icon-btn' + (drawerOpen ? ' is-active' : ''),
      onClick: () => setDrawerOpen(!drawerOpen),
      'aria-label': 'Notifications',
      title: 'Action queue',
    },
      React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' },
        React.createElement('path', { d: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9' }),
        React.createElement('path', { d: 'M13.73 21a2 2 0 0 1-3.46 0' })),
      totalAlerts > 0 && React.createElement('span', {
        className: 'badge',
        style: critCount === 0 ? { background: 'var(--d-warning)' } : null,
      }, totalAlerts > 9 ? '9+' : totalAlerts))
  );

  // ---------- Stats row ----------
  const statsRow = React.createElement('div', { className: 'csd-stats' },
    React.createElement(StatCard, {
      label: 'Sends · 7d',
      value: fmtA.num(totals.sends),
      delta: fmtA.num(Math.round(totals.sends * 0.06)),
      deltaDir: 'up',
      spark: window.CSD.sumSparklines(derived),
      icon: React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 },
        React.createElement('path', { d: 'M22 2 11 13' }),
        React.createElement('path', { d: 'M22 2 15 22l-4-9-9-4 20-7z' })),
    }),
    React.createElement(StatCard, {
      label: 'Reply rate',
      value: fmtA.pct(totals.replyRate),
      delta: '0.18 pp',
      deltaDir: 'up',
      icon: React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 },
        React.createElement('path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' })),
    }),
    React.createElement(StatCard, {
      label: 'Positive reply rate',
      value: fmtA.pct(totals.prr),
      delta: '0.05 pp',
      deltaDir: 'down',
      icon: React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 },
        React.createElement('polyline', { points: '20 6 9 17 4 12' })),
    }),
    React.createElement(StatCard, {
      label: 'Leads queued',
      value: fmtA.numCompact(totals.leadsLeft),
      delta: fmtA.numCompact(Math.round(totals.sends)),
      deltaDir: 'down',
      icon: React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 },
        React.createElement('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
        React.createElement('path', { d: 'M3 10h18' })),
    }),
  );

  // Critical banner
  const banner = critCount > 0
    ? React.createElement('div', { className: 'csd-notif-banner', onClick: () => setDrawerOpen(true) },
        React.createElement('span', { className: 'ico' },
          React.createElement('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' },
            React.createElement('path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z' }),
            React.createElement('path', { d: 'M12 9v4' }),
            React.createElement('path', { d: 'M12 17h.01' }))),
        React.createElement('div', { className: 'body' },
          React.createElement('div', { className: 'head' },
            critCount + (critCount === 1 ? ' campaign needs intervention' : ' campaigns need intervention')),
          React.createElement('div', { className: 'sub' },
            warnCount > 0
              ? warnCount + ' warning' + (warnCount > 1 ? 's' : '') + ' also queued. Review now.'
              : 'Open the action queue to triage.')),
        React.createElement('span', { className: 'arrow' },
          React.createElement('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' },
            React.createElement('polyline', { points: '9 18 15 12 9 6' }))))
    : warnCount > 0
    ? React.createElement('div', { className: 'csd-notif-banner warn', onClick: () => setDrawerOpen(true) },
        React.createElement('span', { className: 'ico' },
          React.createElement('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' },
            React.createElement('circle', { cx: 12, cy: 12, r: 10 }),
            React.createElement('line', { x1: 12, y1: 8, x2: 12, y2: 12 }),
            React.createElement('line', { x1: 12, y1: 16, x2: 12.01, y2: 16 }))),
        React.createElement('div', { className: 'body' },
          React.createElement('div', { className: 'head' },
            warnCount + ' campaign' + (warnCount > 1 ? 's' : '') + ' below benchmark'),
          React.createElement('div', { className: 'sub' }, 'No critical issues. Open the queue to review.')),
        React.createElement('span', { className: 'arrow' },
          React.createElement('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' },
            React.createElement('polyline', { points: '9 18 15 12 9 6' }))))
    : null;

  // ---------- Client filter chips ----------
  const clientChips = React.createElement('div', { className: 'csd-clientchips' },
    React.createElement('button', {
      className: 'csd-clientchip all' + (clientFilter === 'all' ? ' is-active' : ''),
      onClick: () => setClientFilter('all'),
    },
      React.createElement('span', { className: 'ico' }, 'All'),
      'All clients',
      React.createElement('span', { style: { color: 'inherit', opacity: 0.7, fontSize: 11, fontWeight: 400 } }, derived.length)),
    allGroups.map((g) => {
      const initial = g.client.split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase();
      return React.createElement('button', {
        key: g.client,
        className: 'csd-clientchip' + (clientFilter === g.client ? ' is-active' : ''),
        onClick: () => setClientFilter(g.client),
      },
        React.createElement('span', { className: 'ico' }, initial),
        g.client,
        g.flagged > 0 && React.createElement('span', { className: 'crit-dot', title: g.flagged + ' critical' }),
        g.flagged === 0 && g.warned > 0 && React.createElement('span', { className: 'warn-dot', title: g.warned + ' warning' }));
    })
  );

  // ---------- Empty page placeholder ----------
  const emptyPage = (title, msg) => React.createElement('div', { className: 'csd-empty-page' },
    React.createElement('h3', null, title),
    React.createElement('p', null, msg));

  // ---------- Clients view ----------
  const unassignedCampaigns = derived.filter(c => c.client === 'Unassigned');
  const assignedGroups = allGroups.filter(g => g.client !== 'Unassigned');

  const clientsView = React.createElement(React.Fragment, null,
    React.createElement('div', { className: 'csd-clients-toolbar' },
      addingClient
        ? React.createElement('div', { className: 'csd-add-client-form' },
            React.createElement('input', {
              className: 'csd-add-client-input',
              placeholder: 'Client name…',
              value: newClientName,
              autoFocus: true,
              onChange: e => setNewClientName(e.target.value),
              onKeyDown: e => { if (e.key === 'Enter') addCustomClient(); if (e.key === 'Escape') { setAddingClient(false); setNewClientName(''); } },
            }),
            React.createElement('button', { className: 'csd-btn-primary', onClick: addCustomClient }, 'Add'),
            React.createElement('button', { className: 'csd-btn-ghost', onClick: () => { setAddingClient(false); setNewClientName(''); } }, 'Cancel'))
        : React.createElement('button', { className: 'csd-btn-primary', onClick: () => setAddingClient(true) }, '+ Add client')),
    React.createElement('div', { className: 'csd-clientcards' },
      assignedGroups.map((g) => {
        const initial = g.client.split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase();
        const isEditingThis = editingClientName === g.client;
        const isDragTarget = dragOverClient === g.client;
        return React.createElement('div', {
          key: g.client,
          className: 'csd-clientcard' + (isDragTarget ? ' drag-over' : ''),
          onDragOver: dragCampaignId ? (e) => { e.preventDefault(); setDragOverClient(g.client); } : undefined,
          onDragLeave: dragCampaignId ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverClient(null); } : undefined,
          onDrop: dragCampaignId ? (e) => { e.preventDefault(); saveCampaignClient(dragCampaignId, g.client); } : undefined,
        },
          React.createElement('div', { className: 'csd-clientcard-head', onClick: () => { if (!isEditingThis) { setActiveNav('campaigns'); setClientFilter(g.client); } } },
            React.createElement('div', { className: 'icon' }, initial),
            React.createElement('div', { style: { flex: 1, minWidth: 0 } },
              isEditingThis
                ? React.createElement('input', {
                    className: 'csd-client-rename-input',
                    value: editingClientValue,
                    autoFocus: true,
                    onClick: e => e.stopPropagation(),
                    onChange: e => setEditingClientValue(e.target.value),
                    onBlur: () => saveClientName(g.client, editingClientValue),
                    onKeyDown: e => {
                      if (e.key === 'Enter') saveClientName(g.client, editingClientValue);
                      if (e.key === 'Escape') setEditingClientName(null);
                    },
                  })
                : React.createElement('div', { className: 'name' }, g.client),
              React.createElement('div', { className: 'sub' }, g.campaigns.length + ' campaigns · ' + g.active + ' active')),
            !isEditingThis && React.createElement('div', { className: 'csd-clientcard-actions' },
              React.createElement('button', {
                className: 'csd-clientcard-edit-btn',
                title: 'Rename client',
                onClick: e => { e.stopPropagation(); setEditingClientName(g.client); setEditingClientValue(g.client); },
              },
                React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
                  React.createElement('path', { d: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' }),
                  React.createElement('path', { d: 'M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z' }))),
              React.createElement('button', {
                className: 'csd-clientcard-edit-btn',
                title: 'Delete client',
                onClick: e => { e.stopPropagation(); deleteClient(g.client); },
              },
                React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
                  React.createElement('polyline', { points: '3 6 5 6 21 6' }),
                  React.createElement('path', { d: 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6' }),
                  React.createElement('path', { d: 'M10 11v6M14 11v6' }))))),
          React.createElement('div', { className: 'csd-clientcard-grid', onClick: () => { setActiveNav('campaigns'); setClientFilter(g.client); } },
            React.createElement('div', { className: 'cell' },
              React.createElement('span', { className: 'l' }, 'Sends 7d'),
              React.createElement('span', { className: 'v' }, fmtA.num(g.sends))),
            React.createElement('div', { className: 'cell' },
              React.createElement('span', { className: 'l' }, 'Reply rate'),
              React.createElement('span', { className: 'v' }, g.replyRate !== null ? (g.replyRate * 100).toFixed(2) + '%' : '—')),
            React.createElement('div', { className: 'cell' },
              React.createElement('span', { className: 'l' }, 'PRR'),
              React.createElement('span', { className: 'v' }, g.prr !== null ? (g.prr * 100).toFixed(2) + '%' : '—')),
            React.createElement('div', { className: 'cell' },
              React.createElement('span', { className: 'l' }, 'Leads left'),
              React.createElement('span', { className: 'v' }, fmtA.numCompact(g.leadsLeft)))));
      })),
    unassignedCampaigns.length > 0 && React.createElement('div', { className: 'csd-unassigned-section' },
      React.createElement('div', { className: 'csd-unassigned-header' },
        React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' },
          React.createElement('circle', { cx: 12, cy: 12, r: 10 }),
          React.createElement('line', { x1: 12, y1: 8, x2: 12, y2: 12 }),
          React.createElement('line', { x1: 12, y1: 16, x2: 12.01, y2: 16 })),
        React.createElement('span', null, 'Unassigned campaigns'),
        React.createElement('span', { className: 'csd-unassigned-hint' }, '— drag to a client card above to assign')),
      React.createElement('div', { className: 'csd-unassigned-list' },
        unassignedCampaigns.map(c =>
          React.createElement('div', {
            key: c.id,
            className: 'csd-unassigned-row' + (dragCampaignId === c.id ? ' dragging' : ''),
            draggable: true,
            onDragStart: (e) => { e.dataTransfer.effectAllowed = 'move'; setDragCampaignId(c.id); },
            onDragEnd: () => { setDragCampaignId(null); setDragOverClient(null); },
          },
            React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', className: 'drag-handle' },
              React.createElement('line', { x1: 9, y1: 5, x2: 9, y2: 19 }),
              React.createElement('line', { x1: 15, y1: 5, x2: 15, y2: 19 })),
            React.createElement('span', { className: 'csd-unassigned-name' }, c.campaign),
            React.createElement('span', { className: 'csd-ll-status ' + c.status.toLowerCase() },
              React.createElement('span', { className: 'dot' }),
              c.status))))));

  // ---------- Campaigns view body ----------
  const campaignsBody = React.createElement(React.Fragment, null,
    clientChips,
    statsRow,
    banner,
    React.createElement('div', { className: 'csd-toolbar' },
      React.createElement('span', { className: 'label' }, 'Group'),
      React.createElement('div', { className: 'csd-segment' },
        React.createElement('button', {
          className: tweaks.groupByClient ? 'active' : '',
          onClick: () => setTweak('groupByClient', true),
        }, 'By client'),
        React.createElement('button', {
          className: !tweaks.groupByClient ? 'active' : '',
          onClick: () => setTweak('groupByClient', false),
        }, 'Flat')),
      React.createElement('button', {
        className: 'csd-ghost-btn',
        onClick: () => {
          const allOpen = filteredGroups.every(g => openGroups[g.client]);
          const next = {};
          if (!allOpen) filteredGroups.forEach(g => next[g.client] = true);
          setOpenGroups(next); saveOpenGroups(next);
        },
      },
        React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' },
          React.createElement('polyline', { points: '6 9 12 15 18 9' })),
        filteredGroups.every(g => openGroups[g.client]) ? 'Collapse all' : 'Expand all')),
    React.createElement('div', { className: 'csd-clientgroups' },
      tweaks.groupByClient
        ? filteredGroups.map((g) =>
            React.createElement(ClientGroup, {
              key: g.client,
              group: g,
              isOpen: !!openGroups[g.client],
              onToggle: () => toggleGroup(g.client),
              dayLabels: labels,
              onDelete: deleteCampaign,
            }))
        : React.createElement('div', { className: 'csd-clientgroup open' },
            React.createElement('div', { className: 'csd-clientgroup-body' },
              filteredGroups.flatMap(g => g.campaigns).map((c) =>
                React.createElement(CampaignRow, { key: c.id, campaign: c, onDelete: deleteCampaign }))))));

  // ---------- Delete handlers ----------
  const deleteCampaign = (id) => {
    const next = [...deletedCampaignIds, id];
    setDeletedCampaignIds(next);
    try { localStorage.setItem('csd:deleted-campaigns:v1', JSON.stringify(next)); } catch(e) {}
  };
  const deleteClient = (clientName) => {
    if (!window.confirm('Delete client "' + clientName + '" and all their campaigns?')) return;
    const nextClients = [...deletedClientNames, clientName];
    setDeletedClientNames(nextClients);
    try { localStorage.setItem('csd:deleted-clients:v1', JSON.stringify(nextClients)); } catch(e) {}
    const nextCustom = customClients.filter(c => (clientNames[c.name] || c.name) !== clientName);
    setCustomClients(nextCustom);
    try { localStorage.setItem('csd:custom-clients:v1', JSON.stringify(nextCustom)); } catch(e) {}
    if (clientFilter === clientName) setClientFilter('all');
  };

  // ---------- Client edit handlers ----------
  const saveClientName = (currentDisplay, newName) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === currentDisplay) { setEditingClientName(null); return; }
    const existingKey = Object.keys(clientNames).find(k => clientNames[k] === currentDisplay) || currentDisplay;
    const next = { ...clientNames, [existingKey]: trimmed };
    setClientNames(next);
    try { localStorage.setItem('csd:client-names:v1', JSON.stringify(next)); } catch (e) {}
    if (clientFilter === currentDisplay) setClientFilter(trimmed);
    setEditingClientName(null);
  };
  const addCustomClient = () => {
    const trimmed = newClientName.trim();
    if (!trimmed) { setAddingClient(false); return; }
    const id = 'cc-' + Date.now();
    const next = [...customClients, { id, name: trimmed }];
    setCustomClients(next);
    try { localStorage.setItem('csd:custom-clients:v1', JSON.stringify(next)); } catch (e) {}
    setNewClientName(''); setAddingClient(false);
  };
  const addCustomList = (clientName, fileName, csvText) => {
    const id = 'cl-' + Date.now();
    const newList = { id, client: clientName, name: fileName.replace(/\.csv$/i, ''), totalLeads: parseCSVLeadCount(csvText), uploadDate: new Date().toISOString().slice(0, 10), csvData: csvText };
    const next = [...customLists, newList];
    setCustomLists(next);
    try { localStorage.setItem('csd:custom-lists:v1', JSON.stringify(next)); } catch (e) {}
  };
  const deleteCustomList = (id) => {
    const next = customLists.filter(l => l.id !== id);
    setCustomLists(next);
    try { localStorage.setItem('csd:custom-lists:v1', JSON.stringify(next)); } catch (e) {}
  };

  // ---------- Campaign client assignment (drag-drop) ----------
  const saveCampaignClient = (campaignId, clientName) => {
    const next = { ...campaignClientOverrides, [campaignId]: clientName };
    setCampaignClientOverrides(next);
    try { localStorage.setItem('csd:campaign-client:v1', JSON.stringify(next)); } catch (e) {}
    setDragCampaignId(null);
    setDragOverClient(null);
  };

  // ---------- Manual lead list handlers ----------
  const addLLCategory = () => {
    const trimmed = newLLCategoryName.trim();
    if (!trimmed) { setAddingLLCategory(false); return; }
    const id = 'mlc-' + Date.now();
    const next = [...llCategories, { id, name: trimmed }];
    setLLCategories(next);
    try { localStorage.setItem('csd:ll-categories:v1', JSON.stringify(next)); } catch (e) {}
    setNewLLCategoryName(''); setAddingLLCategory(false);
  };
  const deleteLLCategory = (id) => {
    if (!window.confirm('Delete this category and all its lists?')) return;
    const next = llCategories.filter(c => c.id !== id);
    setLLCategories(next);
    try { localStorage.setItem('csd:ll-categories:v1', JSON.stringify(next)); } catch (e) {}
    const nextLists = manualLists.filter(l => l.categoryId !== id);
    setManualLists(nextLists);
    try { localStorage.setItem('csd:manual-lists:v1', JSON.stringify(nextLists)); } catch (e) {}
  };
  const renameLLCategory = (id, name) => {
    const trimmed = name.trim();
    const next = llCategories.map(c => c.id === id ? { ...c, name: trimmed || c.name } : c);
    setLLCategories(next);
    try { localStorage.setItem('csd:ll-categories:v1', JSON.stringify(next)); } catch (e) {}
    setRenamingCat(null);
  };
  const addManualList = (categoryId) => {
    const id = 'mll-' + Date.now();
    const today = new Date().toISOString().slice(0, 10);
    const newList = { id, categoryId, name: 'New list', status: 'Active', lastActive: today, leadCount: 0, runningText: '' };
    const next = [...manualLists, newList];
    setManualLists(next);
    try { localStorage.setItem('csd:manual-lists:v1', JSON.stringify(next)); } catch (e) {}
  };
  const deleteManualList = (id) => {
    const next = manualLists.filter(l => l.id !== id);
    setManualLists(next);
    try { localStorage.setItem('csd:manual-lists:v1', JSON.stringify(next)); } catch (e) {}
  };
  const updateManualList = (id, field, value) => {
    const next = manualLists.map(l => l.id === id ? { ...l, [field]: value } : l);
    setManualLists(next);
    try { localStorage.setItem('csd:manual-lists:v1', JSON.stringify(next)); } catch (e) {}
  };
  const submitAddList = () => {
    if (!addListModal) return;
    const id = 'mll-' + Date.now();
    const leadCount = addListForm.csvData
      ? parseCSVLeadCount(addListForm.csvData)
      : (parseInt(addListForm.leadCount) || 0);
    const today = new Date().toISOString().slice(0, 10);
    const newList = {
      id,
      categoryId: addListModal.categoryId,
      name: addListForm.name.trim() || 'New list',
      status: addListForm.status,
      lastActive: addListForm.lastActive || today,
      leadCount,
      runningText: addListForm.runningText,
      csvData: addListForm.csvData,
      csvName: addListForm.csvName,
    };
    const next = [...manualLists, newList];
    setManualLists(next);
    try { localStorage.setItem('csd:manual-lists:v1', JSON.stringify(next)); } catch (e) {}
    const nextOpen = { ...openLLGroups, [addListModal.categoryId]: true };
    setOpenLLGroups(nextOpen);
    try { localStorage.setItem('csd:ll-open:v1', JSON.stringify(nextOpen)); } catch (e) {}
    setAddListModal(null);
  };

  // ---------- Lead Lists helpers ----------
  const saveListName = (id, name) => {
    const next = { ...listNames, [id]: name };
    setListNames(next);
    try { localStorage.setItem('csd:list-names:v1', JSON.stringify(next)); } catch (e) {}
  };
  const toggleLLGroup = (key) => {
    const next = { ...openLLGroups, [key]: !openLLGroups[key] };
    setOpenLLGroups(next);
    try { localStorage.setItem('csd:ll-open:v1', JSON.stringify(next)); } catch (e) {}
  };

  // ---------- Lead Lists view (fully manual) ----------
  const todayStr = new Date().toISOString().slice(0, 10);
  const msToIdleLabel = (ms) => {
    if (ms == null || ms < 0) return '—';
    const days = Math.floor(ms / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return '1d';
    if (days < 60) return days + 'd';
    return Math.round(days / 30) + 'mo';
  };

  const leadListsView = React.createElement('div', { className: 'csd-leadlists' },
    React.createElement('div', { className: 'csd-clients-toolbar' },
      addingLLCategory
        ? React.createElement('div', { className: 'csd-add-client-form' },
            React.createElement('input', {
              className: 'csd-add-client-input',
              placeholder: 'Category name…',
              value: newLLCategoryName,
              autoFocus: true,
              onChange: e => setNewLLCategoryName(e.target.value),
              onKeyDown: e => {
                if (e.key === 'Enter') addLLCategory();
                if (e.key === 'Escape') { setAddingLLCategory(false); setNewLLCategoryName(''); }
              },
            }),
            React.createElement('button', { className: 'csd-btn-primary', onClick: addLLCategory }, 'Add'),
            React.createElement('button', { className: 'csd-btn-ghost', onClick: () => { setAddingLLCategory(false); setNewLLCategoryName(''); } }, 'Cancel'))
        : React.createElement('button', { className: 'csd-btn-primary', onClick: () => setAddingLLCategory(true) }, '+ Add category')),
    llCategories.length === 0
      ? React.createElement('div', { className: 'csd-empty-page', style: { marginTop: 40 } },
          React.createElement('h3', null, 'No lead list categories'),
          React.createElement('p', null, 'Click "+ Add category" to create your first category, then add lists inside it.'))
      : llCategories.map((cat) => {
          const catLists = manualLists.filter(l => l.categoryId === cat.id);
          const isOpen = !!openLLGroups[cat.id];
          const initial = cat.name.split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase();

          return React.createElement('div', { key: cat.id, className: 'csd-ll-group' + (isOpen ? ' open' : '') },
            React.createElement('div', { className: 'csd-ll-group-head' },
              React.createElement('span', {
                className: 'csd-ll-head-left',
                onClick: () => toggleLLGroup(cat.id),
                role: 'button',
              },
                React.createElement('span', { className: 'csd-ll-chev' },
                  React.createElement('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
                    React.createElement('polyline', { points: '9 18 15 12 9 6' }))),
                React.createElement('div', { className: 'csd-ll-icon' }, initial),
                renamingCat === cat.id
                  ? React.createElement('input', {
                      className: 'csd-ll-rename-input',
                      value: renamingCatVal,
                      autoFocus: true,
                      onClick: e => e.stopPropagation(),
                      onChange: e => setRenamingCatVal(e.target.value),
                      onBlur: () => renameLLCategory(cat.id, renamingCatVal),
                      onKeyDown: e => {
                        if (e.key === 'Enter') renameLLCategory(cat.id, renamingCatVal);
                        if (e.key === 'Escape') setRenamingCat(null);
                        e.stopPropagation();
                      },
                    })
                  : React.createElement('span', { className: 'csd-ll-client' }, cat.name),
                React.createElement('span', { className: 'csd-ll-count' }, catLists.length + ' ' + (catLists.length === 1 ? 'list' : 'lists'))),
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 } },
                React.createElement('button', {
                  className: 'csd-ll-rename-btn',
                  style: { display: 'flex' },
                  title: 'Rename category',
                  onClick: e => { e.stopPropagation(); setRenamingCat(cat.id); setRenamingCatVal(cat.name); },
                },
                  React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
                    React.createElement('path', { d: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' }),
                    React.createElement('path', { d: 'M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z' }))),
                React.createElement('button', {
                  className: 'csd-ll-add-btn',
                  onClick: e => {
                    e.stopPropagation();
                    setAddListModal({ categoryId: cat.id });
                    setAddListForm({ name: '', status: 'Active', lastActive: new Date().toISOString().slice(0, 10), leadCount: '', runningText: '', csvData: null, csvName: '' });
                  },
                }, '+ Add list'),
                React.createElement('button', {
                  className: 'csd-ll-action-btn delete',
                  style: { opacity: 1 },
                  title: 'Delete category',
                  onClick: e => { e.stopPropagation(); deleteLLCategory(cat.id); },
                },
                  React.createElement('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
                    React.createElement('polyline', { points: '3 6 5 6 21 6' }),
                    React.createElement('path', { d: 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6' }))))),
            isOpen && React.createElement('div', { className: 'csd-ll-table' },
              catLists.length === 0
                ? React.createElement('div', { style: { padding: '20px 18px', color: 'var(--d-fg-3)', fontSize: 13 } },
                    'No lists yet — click "+ Add list" above to create one.')
                : React.createElement(React.Fragment, null,
                    React.createElement('div', { className: 'csd-ll-thead csd-ll-thead-manual' },
                      React.createElement('span', null, 'List name'),
                      React.createElement('span', null, 'Status'),
                      React.createElement('span', null, 'Last active'),
                      React.createElement('span', null, 'Idle for'),
                      React.createElement('span', null, 'Lead count'),
                      React.createElement('span', null, 'Running for'),
                      React.createElement('span', null, '')),
                    catLists.map((l) => {
                      const lastActiveMs = l.lastActive
                        ? (Date.now() - new Date(l.lastActive + 'T12:00:00').getTime())
                        : null;
                      const idleLabel = l.status === 'Active' ? '—' : msToIdleLabel(lastActiveMs);
                      const isEditingName = editingLL?.id === l.id && editingLL?.field === 'name';
                      const isEditingLA   = editingLL?.id === l.id && editingLL?.field === 'lastActive';
                      const isEditingLC   = editingLL?.id === l.id && editingLL?.field === 'leadCount';
                      const isEditingRT   = editingLL?.id === l.id && editingLL?.field === 'runningText';

                      const startEdit = (field, val) => { setEditingLL({ id: l.id, field }); setEditingLLVal(String(val ?? '')); };
                      const commitEdit = (field) => {
                        const val = field === 'leadCount' ? (parseInt(editingLLVal) || 0) : editingLLVal;
                        updateManualList(l.id, field, val);
                        setEditingLL(null);
                      };

                      return React.createElement('div', { key: l.id, className: 'csd-ll-row csd-ll-row-manual' },
                        React.createElement('span', { className: 'csd-ll-name-cell' },
                          isEditingName
                            ? React.createElement('input', {
                                className: 'csd-ll-rename-input', value: editingLLVal, autoFocus: true,
                                onChange: e => setEditingLLVal(e.target.value),
                                onBlur: () => commitEdit('name'),
                                onKeyDown: e => { if (e.key === 'Enter') commitEdit('name'); if (e.key === 'Escape') setEditingLL(null); },
                              })
                            : React.createElement('span', { className: 'csd-ll-name csd-ll-editable', title: 'Click to rename', onClick: () => startEdit('name', l.name) }, l.name)),
                        React.createElement('span', null,
                          React.createElement('button', {
                            className: 'csd-ll-status-btn ' + l.status.toLowerCase(),
                            onClick: () => updateManualList(l.id, 'status', l.status === 'Active' ? 'Paused' : 'Active'),
                            title: 'Click to toggle status',
                          },
                            React.createElement('span', { className: 'dot' }),
                            l.status)),
                        React.createElement('span', { className: 'csd-ll-meta' },
                          isEditingLA
                            ? React.createElement('input', {
                                type: 'date', className: 'csd-ll-date-input', value: editingLLVal, autoFocus: true,
                                onChange: e => setEditingLLVal(e.target.value),
                                onBlur: () => commitEdit('lastActive'),
                                onKeyDown: e => { if (e.key === 'Enter') commitEdit('lastActive'); if (e.key === 'Escape') setEditingLL(null); },
                              })
                            : React.createElement('span', { className: 'csd-ll-editable', title: 'Click to edit', onClick: () => startEdit('lastActive', l.lastActive || todayStr) },
                                l.lastActive
                                  ? new Date(l.lastActive + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                                  : React.createElement('span', { style: { opacity: 0.4 } }, 'Set date'))),
                        React.createElement('span', { className: 'csd-ll-idle' + (l.status === 'Active' ? ' ok' : '') }, idleLabel),
                        React.createElement('span', { className: 'csd-ll-leads' },
                          isEditingLC
                            ? React.createElement('input', {
                                type: 'number', className: 'csd-ll-number-input', value: editingLLVal, autoFocus: true, min: 0,
                                onChange: e => setEditingLLVal(e.target.value),
                                onBlur: () => commitEdit('leadCount'),
                                onKeyDown: e => { if (e.key === 'Enter') commitEdit('leadCount'); if (e.key === 'Escape') setEditingLL(null); },
                              })
                            : React.createElement('span', { className: 'csd-ll-editable', title: 'Click to edit', onClick: () => startEdit('leadCount', l.leadCount ?? 0) },
                                fmtA.num(l.leadCount || 0))),
                        React.createElement('span', null,
                          isEditingRT
                            ? React.createElement('input', {
                                className: 'csd-ll-rename-input', value: editingLLVal, autoFocus: true,
                                placeholder: 'e.g. 3 weeks, since Jan 5',
                                onChange: e => setEditingLLVal(e.target.value),
                                onBlur: () => commitEdit('runningText'),
                                onKeyDown: e => { if (e.key === 'Enter') commitEdit('runningText'); if (e.key === 'Escape') setEditingLL(null); },
                              })
                            : React.createElement('span', {
                                className: 'csd-ll-editable csd-ll-meta',
                                title: 'Click to edit running duration',
                                onClick: () => startEdit('runningText', l.runningText || ''),
                              }, l.runningText || React.createElement('span', { style: { opacity: 0.4 } }, 'Add…'))),
                        React.createElement('span', { className: 'csd-ll-actions' },
                          l.csvData && React.createElement('button', {
                            className: 'csd-ll-action-btn',
                            title: 'Download CSV',
                            onClick: () => downloadBlob((l.csvName || l.name).replace(/\s+/g, '_'), l.csvData),
                          },
                            React.createElement('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
                              React.createElement('path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }),
                              React.createElement('polyline', { points: '7 10 12 15 17 10' }),
                              React.createElement('line', { x1: 12, y1: 15, x2: 12, y2: 3 }))),
                          React.createElement('button', {
                            className: 'csd-ll-action-btn delete',
                            title: 'Delete list',
                            onClick: () => { if (window.confirm('Delete "' + l.name + '"?')) deleteManualList(l.id); },
                          },
                            React.createElement('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
                              React.createElement('polyline', { points: '3 6 5 6 21 6' }),
                              React.createElement('path', { d: 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6' })))));
                    }))));
        }));

  let viewBody;
  if (activeNav === 'clients') viewBody = clientsView;
  else if (activeNav === 'overview') viewBody = React.createElement(React.Fragment, null, statsRow, banner, emptyPage('Overview coming soon', 'Aggregate trends across the whole portfolio. For now, the Campaigns tab is your command center.'));
  else if (activeNav === 'leadlists') viewBody = leadListsView;
  else if (activeNav === 'bookings') viewBody = emptyPage('Bookings', 'Once Calendly is wired in, this view will show every call booked across all campaigns with attribution back to the source sequence.');
  else if (activeNav === 'reports') viewBody = emptyPage('Reports', 'Weekly and monthly snapshots, exportable as CSV or PDF.');
  else if (activeNav === 'settings') viewBody = emptyPage('Settings', 'Thresholds, integrations, team access. Use the Tweaks toggle for the live design knobs.');
  else viewBody = campaignsBody;

  // ---------- Main ----------
  return React.createElement('div', { className: 'csd' },
    sidebar,
    React.createElement('div', null,
      topbar,
      React.createElement('main', { className: 'csd-content' }, viewBody)
    ),
    React.createElement(NotifDrawer, {
      open: drawerOpen,
      onClose: () => setDrawerOpen(false),
      items: actions,
      resolved,
      onResolve,
      onClearResolved: clearResolved,
      onJump: onJumpToCampaign,
    }),
    addListModal && React.createElement('div', {
      className: 'csd-modal-overlay',
      onClick: () => setAddListModal(null),
    },
      React.createElement('div', { className: 'csd-modal', onClick: e => e.stopPropagation() },
        React.createElement('div', { className: 'csd-modal-header' },
          React.createElement('h2', null, 'Add lead list'),
          React.createElement('button', { className: 'csd-modal-close', onClick: () => setAddListModal(null) },
            React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' },
              React.createElement('line', { x1: 18, y1: 6, x2: 6, y2: 18 }),
              React.createElement('line', { x1: 6, y1: 6, x2: 18, y2: 18 })))),
        React.createElement('div', { className: 'csd-modal-body' },
          React.createElement('div', { className: 'csd-modal-field' },
            React.createElement('label', null, 'List name'),
            React.createElement('input', {
              className: 'csd-modal-input',
              placeholder: 'e.g. Hospital CFOs — Wave 1',
              value: addListForm.name,
              autoFocus: true,
              onChange: e => setAddListForm(f => ({ ...f, name: e.target.value })),
              onKeyDown: e => { if (e.key === 'Enter') submitAddList(); if (e.key === 'Escape') setAddListModal(null); },
            })),
          React.createElement('div', { className: 'csd-modal-field' },
            React.createElement('label', null, 'Status'),
            React.createElement('div', { className: 'csd-segment' },
              React.createElement('button', {
                className: addListForm.status === 'Active' ? 'active' : '',
                onClick: () => setAddListForm(f => ({ ...f, status: 'Active' })),
              }, 'Active'),
              React.createElement('button', {
                className: addListForm.status === 'Paused' ? 'active' : '',
                onClick: () => setAddListForm(f => ({ ...f, status: 'Paused' })),
              }, 'Paused'))),
          React.createElement('div', { className: 'csd-modal-row' },
            React.createElement('div', { className: 'csd-modal-field' },
              React.createElement('label', null, 'Last active'),
              React.createElement('input', {
                type: 'date',
                className: 'csd-modal-input',
                value: addListForm.lastActive,
                onChange: e => setAddListForm(f => ({ ...f, lastActive: e.target.value })),
              })),
            React.createElement('div', { className: 'csd-modal-field' },
              React.createElement('label', null, 'Lead count'),
              React.createElement('input', {
                type: 'number',
                className: 'csd-modal-input',
                placeholder: '0',
                value: addListForm.leadCount,
                min: 0,
                onChange: e => setAddListForm(f => ({ ...f, leadCount: e.target.value })),
              }))),
          React.createElement('div', { className: 'csd-modal-field' },
            React.createElement('label', null, 'Running for'),
            React.createElement('input', {
              className: 'csd-modal-input',
              placeholder: 'e.g. 3 weeks, since Jan 5, day 23',
              value: addListForm.runningText,
              onChange: e => setAddListForm(f => ({ ...f, runningText: e.target.value })),
            })),
          React.createElement('div', { className: 'csd-modal-field' },
            React.createElement('label', null, 'Upload CSV',
              React.createElement('span', { style: { fontWeight: 400, color: 'var(--d-fg-mute)', marginLeft: 6 } }, '— auto-fills lead count')),
            React.createElement('div', { className: 'csd-modal-upload' },
              React.createElement('button', {
                className: 'csd-ll-add-btn',
                type: 'button',
                onClick: () => openFilePicker((name, text) => {
                  setAddListForm(f => ({ ...f, csvData: text, csvName: name, leadCount: parseCSVLeadCount(text) }));
                }),
              }, '+ Choose file'),
              React.createElement('span', { className: 'csd-modal-filename' },
                addListForm.csvName
                  ? React.createElement(React.Fragment, null,
                      React.createElement('span', { style: { color: 'var(--d-positive)' } }, '✓ '),
                      addListForm.csvName,
                      ' (' + (addListForm.leadCount || 0) + ' leads)')
                  : React.createElement('span', { style: { color: 'var(--d-fg-mute)' } }, 'No file selected'))))),
        React.createElement('div', { className: 'csd-modal-footer' },
          React.createElement('button', { className: 'csd-btn-ghost', onClick: () => setAddListModal(null) }, 'Cancel'),
          React.createElement('button', { className: 'csd-btn-primary', onClick: submitAddList }, 'Add list')))),
    React.createElement(TweaksPanel, null,
      React.createElement(TweakSection, { title: 'Theme & density' },
        React.createElement(TweakRadio, {
          label: 'Theme',
          value: tweaks.theme,
          options: [{ value: 'light', label: 'Cream' }, { value: 'dark', label: 'Navy' }],
          onChange: (v) => setTweak('theme', v),
        }),
        React.createElement(TweakRadio, {
          label: 'Density',
          value: tweaks.density,
          options: [{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }],
          onChange: (v) => setTweak('density', v),
        })),
      React.createElement(TweakSection, { title: 'View' },
        React.createElement(TweakToggle, {
          label: 'Group by client',
          value: tweaks.groupByClient,
          onChange: (v) => setTweak('groupByClient', v),
        }),
        React.createElement(TweakToggle, {
          label: 'Show bookings & ABR',
          value: tweaks.showBookings,
          onChange: (v) => setTweak('showBookings', v),
        })),
      React.createElement(TweakSection, { title: 'Thresholds' },
        React.createElement(TweakSlider, {
          label: 'PRR warning (%)',
          value: tweaks.prrWarning * 100,
          min: 0.1, max: 1.0, step: 0.05,
          onChange: (v) => setTweak('prrWarning', v / 100),
          format: (v) => v.toFixed(2) + '%',
        }),
        React.createElement(TweakSlider, {
          label: 'PRR critical (%)',
          value: tweaks.prrCritical * 100,
          min: 0.05, max: 0.8, step: 0.05,
          onChange: (v) => setTweak('prrCritical', v / 100),
          format: (v) => v.toFixed(2) + '%',
        }),
        React.createElement(TweakSlider, {
          label: 'Runway warning (days)',
          value: tweaks.runwayWarning,
          min: 3, max: 30, step: 1,
          onChange: (v) => setTweak('runwayWarning', v),
          format: (v) => v + 'd',
        }),
        React.createElement(TweakSlider, {
          label: 'Runway critical (days)',
          value: tweaks.runwayCritical,
          min: 1, max: 14, step: 1,
          onChange: (v) => setTweak('runwayCritical', v),
          format: (v) => v + 'd',
        }))));
}

const styleEl = document.createElement('style');
styleEl.textContent = '@keyframes csd-spin { to { transform: rotate(360deg); } }';
document.head.appendChild(styleEl);

ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
