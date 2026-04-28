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

// Build day labels for last N days
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
  const [editingId, setEditingId] = useState(null);
  const [editingValue, setEditingValue] = useState('');
  const [openLLGroups, setOpenLLGroups] = useState(() => {
    try { return JSON.parse(localStorage.getItem('csd:ll-open:v1') || '{}'); } catch (e) { return {}; }
  });

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

  // Cmd/Ctrl-K focuses search
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
    return data.campaigns.map((c) => window.CSD.derive(c, thresholds));
  }, [data, thresholds]);

  const actions = useMemo(() => window.CSD.buildActions(derived, thresholds), [derived, thresholds]);
  const allGroups = useMemo(() => window.CSD.groupByClient(derived), [derived]);

  // Apply client filter to derived + groups + actions
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
          el.scrollIntoView ? null : null;
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
      React.createElement('span', { className: 'mark' }, 'C'),
      React.createElement('span', null, 'Compound')),
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
        allGroups.length),
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
          React.createElement('path', { d: 'M12 1v6M12 17v6M4.22 4.22l4.24 4.24M15.54 15.54l4.24 4.24M1 12h6M17 12h6M4.22 19.78l4.24-4.24M15.54 8.46l4.24-4.24' })))),
    React.createElement('div', { className: 'csd-sidebar-footer' },
      React.createElement('div', { className: 'avatar' }, 'BU'),
      React.createElement('div', null,
        React.createElement('div', { className: 'who' }, 'Ben & Utkarsh'),
        React.createElement('div', null, 'Ops')))
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
  const clientsView = React.createElement('div', { className: 'csd-clientcards' },
    allGroups.map((g) => {
      const initial = g.client.split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase();
      return React.createElement('div', {
        key: g.client,
        className: 'csd-clientcard',
        onClick: () => { setActiveNav('campaigns'); setClientFilter(g.client); },
      },
        React.createElement('div', { className: 'csd-clientcard-head' },
          React.createElement('div', { className: 'icon' }, initial),
          React.createElement('div', null,
            React.createElement('div', { className: 'name' }, g.client),
            React.createElement('div', { className: 'sub' }, g.campaigns.length + ' campaigns · ' + g.active + ' active'))),
        React.createElement('div', { className: 'csd-clientcard-grid' },
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
    })
  );

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
            }))
        : React.createElement('div', { className: 'csd-clientgroup open' },
            React.createElement('div', { className: 'csd-clientgroup-body' },
              filteredGroups.flatMap(g => g.campaigns).map((c) =>
                React.createElement(CampaignRow, { key: c.id, campaign: c }))))));

  // ---------- Lead Lists helpers ----------
  const saveListName = (id, name) => {
    const next = { ...listNames, [id]: name };
    setListNames(next);
    try { localStorage.setItem('csd:list-names:v1', JSON.stringify(next)); } catch (e) {}
  };
  const toggleLLGroup = (client) => {
    const next = { ...openLLGroups, [client]: !openLLGroups[client] };
    setOpenLLGroups(next);
    try { localStorage.setItem('csd:ll-open:v1', JSON.stringify(next)); } catch (e) {}
  };

  // ---------- Lead Lists view ----------
  const leadListsView = React.createElement('div', { className: 'csd-leadlists' },
    allGroups.map((g) => {
      const initial = g.client.split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase();
      const isOpen = !!openLLGroups[g.client];
      const clientCampaigns = derived.filter(c => c.client === g.client)
        .sort((a, b) => {
          if (a.status === 'Active' && b.status !== 'Active') return -1;
          if (b.status === 'Active' && a.status !== 'Active') return 1;
          return (b.daysSinceLastSend || 0) - (a.daysSinceLastSend || 0);
        });

      return React.createElement('div', { key: g.client, className: 'csd-ll-group' + (isOpen ? ' open' : '') },
        React.createElement('div', {
          className: 'csd-ll-group-head',
          onClick: () => toggleLLGroup(g.client),
          role: 'button',
        },
          React.createElement('span', { className: 'csd-ll-chev' },
            React.createElement('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
              React.createElement('polyline', { points: '9 18 15 12 9 6' }))),
          React.createElement('div', { className: 'csd-ll-icon' }, initial),
          React.createElement('span', { className: 'csd-ll-client' }, g.client),
          React.createElement('span', { className: 'csd-ll-count' }, clientCampaigns.length + ' lists')),
        isOpen && React.createElement('div', { className: 'csd-ll-table' },
          React.createElement('div', { className: 'csd-ll-thead' },
            React.createElement('span', null, 'List name'),
            React.createElement('span', null, 'Status'),
            React.createElement('span', null, 'Last active'),
            React.createElement('span', null, 'Idle for'),
            React.createElement('span', null, 'Lead count'),
            React.createElement('span', null, 'Rerun')),
          clientCampaigns.map((c) => {
            const isActive = c.status === 'Active';
            const idleDays = c.daysSinceLastSend;
            const displayName = listNames[c.id] || c.campaign;
            const isEditing = editingId === c.id;
            const idleLabel = idleDays == null ? '—'
              : idleDays === 0 ? 'Today'
              : idleDays === 1 ? 'Yesterday'
              : idleDays < 60 ? idleDays + 'd'
              : Math.round(idleDays / 30) + 'mo';
            const sinceLabel = idleDays == null ? '—'
              : idleDays === 0 ? 'Sent today'
              : idleDays === 1 ? 'Sent yesterday'
              : 'Sent ' + (idleDays < 60 ? idleDays + 'd ago' : Math.round(idleDays / 30) + 'mo ago');
            const rerunClass = c.canRerun ? 'csd-ll-rerun ready' : isActive ? 'csd-ll-rerun active' : 'csd-ll-rerun wait';
            const rerunLabel = c.canRerun ? '↻ Ready' : isActive ? 'Running' : idleDays != null && idleDays < 7 ? (7 - idleDays) + 'd left' : '—';
            const rowSev = c.canRerun ? ' is-rerun' : isActive ? ' is-active' : c.staleSev > 0 ? ' is-idle' : '';

            return React.createElement('div', { key: c.id, className: 'csd-ll-row' + rowSev },
              React.createElement('span', { className: 'csd-ll-name-cell' },
                isEditing
                  ? React.createElement('input', {
                      className: 'csd-ll-rename-input',
                      value: editingValue,
                      autoFocus: true,
                      onChange: (e) => setEditingValue(e.target.value),
                      onBlur: () => { saveListName(c.id, editingValue.trim() || c.campaign); setEditingId(null); },
                      onKeyDown: (e) => {
                        if (e.key === 'Enter') { saveListName(c.id, editingValue.trim() || c.campaign); setEditingId(null); }
                        if (e.key === 'Escape') setEditingId(null);
                      },
                      onClick: (e) => e.stopPropagation(),
                    })
                  : React.createElement(React.Fragment, null,
                      React.createElement('span', { className: 'csd-ll-name', title: c.campaign }, displayName),
                      React.createElement('button', {
                        className: 'csd-ll-rename-btn',
                        title: 'Rename',
                        onClick: (e) => { e.stopPropagation(); setEditingId(c.id); setEditingValue(displayName); },
                      },
                        React.createElement('svg', { width: 11, height: 11, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
                          React.createElement('path', { d: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' }),
                          React.createElement('path', { d: 'M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z' }))))),
              React.createElement('span', null,
                React.createElement('span', { className: 'csd-ll-status ' + c.status.toLowerCase() },
                  React.createElement('span', { className: 'dot' }),
                  c.status)),
              React.createElement('span', { className: 'csd-ll-meta' }, sinceLabel),
              React.createElement('span', { className: 'csd-ll-idle' + (c.staleSev === 2 ? ' crit' : c.staleSev === 1 ? ' warn' : isActive ? ' ok' : '') },
                isActive ? '—' : idleLabel),
              React.createElement('span', { className: 'csd-ll-leads' }, fmtA.num(c.totalLeads)),
              React.createElement('span', { className: rerunClass }, rerunLabel));
          })));
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
    // Tweaks panel
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

// Inject keyframes for spinner
const styleEl = document.createElement('style');
styleEl.textContent = '@keyframes csd-spin { to { transform: rotate(360deg); } }';
document.head.appendChild(styleEl);

ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
