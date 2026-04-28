/* global React */
const { useState, useEffect, useMemo, useRef } = React;
const fmt = window.CSD.format;

// ---------- Sparkline ----------
function Sparkline({ data, sev = 0, width = 84, height = 24, accent = false }) {
  if (!data || data.length === 0) {
    return React.createElement('span', { style: { width, height, display: 'inline-block', opacity: 0.3, fontSize: 11 } }, '—');
  }
  const max = Math.max(...data, 1);
  const dx = data.length > 1 ? width / (data.length - 1) : 0;
  const points = data.map((v, i) => {
    const x = i * dx;
    const y = height - (v / max) * (height - 2) - 1;
    return [x, y];
  });
  const linePath = points.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ');
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;
  const last = points[points.length - 1];
  const cls = `csd-spark sev-${sev}` + (accent ? ' accent' : '');
  return React.createElement(
    'svg',
    { className: cls, viewBox: `0 0 ${width} ${height}`, width, height, preserveAspectRatio: 'none' },
    React.createElement('path', { d: areaPath, className: 'area' }),
    React.createElement('path', { d: linePath, className: 'line' }),
    React.createElement('circle', { cx: last[0], cy: last[1], r: 1.6 })
  );
}

// ---------- Tooltip ----------
function Tip({ doc, children }) {
  return React.createElement('span', { className: 'csd-tip' },
    children, React.createElement('span', { className: 'csd-tip-content' }, doc));
}

// ---------- Status pill ----------
function StatusDot({ status }) {
  const s = (status || '').toLowerCase();
  return React.createElement('span', { className: `csd-status ${s}` },
    React.createElement('span', { className: 'dot' }), status || '—');
}

// ---------- Runway bar ----------
function RunwayBar({ campaign, compact }) {
  const sev = campaign.runwaySev;
  const pct = campaign.totalLeads > 0
    ? Math.max(0, Math.min(100, (campaign.leadsLeft / campaign.totalLeads) * 100))
    : 0;
  const days = isFinite(campaign.runwayDays) ? campaign.runwayDays : null;
  return React.createElement('div', { className: `csd-runway-bar sev-${sev}` },
    React.createElement('div', { className: 'label' },
      React.createElement('span', null, fmt.numCompact(campaign.leadsLeft)),
      React.createElement('span', { className: 'days' }, fmt.days(days))),
    React.createElement('div', { className: 'track' },
      React.createElement('div', { className: 'fill', style: { width: pct + '%' } })));
}

// ---------- Day chart (per-day sends bar chart) ----------
function DayChart({ data, labels }) {
  const max = Math.max(...data, 1);
  const today = data.length - 1;
  return React.createElement('div', { className: 'csd-daychart-wrap' },
    React.createElement('div', { className: 'l' }, 'Sends · last 7 days'),
    React.createElement('div', { className: 'csd-daychart' },
      data.map((v, i) =>
        React.createElement('div', {
          key: i,
          className: 'bar' + (i === today ? ' today' : ''),
          style: { height: Math.max(2, (v / max) * 100) + '%' }
        },
          React.createElement('span', { className: 'tip' }, fmt.num(v) + ' on ' + (labels[i] || ''))
        ))),
    React.createElement('div', { className: 'csd-daychart-axis' },
      labels.map((l, i) => React.createElement('span', { key: i }, l)))
  );
}

// ---------- Client group ----------
function ClientGroup({ group, isOpen, onToggle, dayLabels }) {
  const flagPill = group.flagged > 0
    ? { cls: 'crit', txt: group.flagged + ' critical' }
    : group.warned > 0
    ? { cls: 'warn', txt: group.warned + ' warning' }
    : { cls: 'ok', txt: 'On benchmark' };
  const stalePill = group.stale > 0
    ? { cls: group.canRerun > 0 ? 'rerun' : 'idle', txt: group.canRerun > 0 ? group.canRerun + ' can rerun' : group.stale + ' idle' }
    : null;

  const initial = group.client.split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase();

  return React.createElement('div', { className: 'csd-clientgroup' + (isOpen ? ' open' : ''), id: 'group-' + group.client.replace(/\s+/g, '-') },
    // Group header
    React.createElement('div', { className: 'csd-clientgroup-head', onClick: onToggle, role: 'button', 'aria-expanded': isOpen },
      React.createElement('span', { className: 'chev' },
        React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
          React.createElement('polyline', { points: '9 18 15 12 9 6' }))),
      React.createElement('div', { className: 'name' },
        React.createElement('div', { className: 'icon' }, initial),
        React.createElement('div', { className: 'text' },
          React.createElement('div', { className: 'n' }, group.client),
          React.createElement('div', { className: 'sub' },
            group.campaigns.length + (group.campaigns.length === 1 ? ' campaign · ' : ' campaigns · ') +
            group.active + ' active' +
            (group.stale > 0 ? ' · ' + group.stale + ' idle' : '')))),
      React.createElement('div', { className: 'stat' },
        React.createElement('span', { className: 'l' }, 'Sends 7d'),
        fmt.num(group.sends)),
      React.createElement('div', { className: 'stat' },
        React.createElement('span', { className: 'l' }, 'Reply rate'),
        group.replyRate !== null ? (group.replyRate * 100).toFixed(2) + '%' : '—'),
      React.createElement('div', { className: 'stat' },
        React.createElement('span', { className: 'l' }, 'PRR'),
        group.prr !== null ? (group.prr * 100).toFixed(2) + '%' : '—'),
      React.createElement('div', { className: 'stat' },
        React.createElement('span', { className: 'l' }, 'Leads left'),
        fmt.numCompact(group.leadsLeft)),
      React.createElement('div', { className: 'stat-spark' },
        React.createElement(Sparkline, { data: group.sparkline, sev: 0, accent: true, width: 100, height: 28 })),
      React.createElement('div', { className: 'pill-stack' },
        stalePill && React.createElement('span', { className: 'flag-pill ' + stalePill.cls },
          React.createElement('span', { className: 'dot' }), stalePill.txt),
        React.createElement('span', { className: 'flag-pill ' + flagPill.cls },
          React.createElement('span', { className: 'dot' }), flagPill.txt))),
    // Body
    isOpen && React.createElement('div', { className: 'csd-clientgroup-body' },
      // Per-day chart for this client — compact horizontal
      React.createElement('div', { className: 'csd-clientgroup-chart' },
        React.createElement('div', { className: 'total' },
          React.createElement('span', { className: 'l' }, 'Avg / day'),
          React.createElement('span', { className: 'v' }, fmt.num(Math.round(group.sends / 7)))),
        React.createElement('div', { className: 'total' },
          React.createElement('span', { className: 'l' }, 'Replies 7d'),
          React.createElement('span', { className: 'v' }, group.replies)),
        React.createElement('div', { className: 'total' },
          React.createElement('span', { className: 'l' }, 'Bookings 7d'),
          React.createElement('span', { className: 'v' }, group.bookings || 0)),
        React.createElement('div', { className: 'total' + (group.stale > 0 ? ' alert' : '') },
          React.createElement('span', { className: 'l' }, 'Idle lists'),
          React.createElement('span', { className: 'v' },
            group.stale || 0,
            group.canRerun > 0 && React.createElement('span', { className: 'unit', style: { color: 'var(--d-accent)' } }, ' · ' + group.canRerun + ' can rerun'))),
        React.createElement(DayChart, { data: group.sparkline, labels: dayLabels })),
      // Column header strip
      React.createElement('div', { className: 'csd-colstrip' },
        React.createElement('span', null),
        React.createElement('span', null, 'Campaign'),
        React.createElement('span', null, 'Sends 7d'),
        React.createElement('span', null, 'Reply rate'),
        React.createElement('span', null, 'PRR'),
        React.createElement('span', null, 'Bookings'),
        React.createElement('span', null, 'Runway'),
        React.createElement('span', { className: 'right' }, 'Trend')),
      // Campaign rows
      group.campaigns.map((c) => React.createElement(CampaignRow, { key: c.id, campaign: c }))
    )
  );
}

// ---------- Campaign row ----------
function CampaignRow({ campaign: c }) {
  const replyRate = c.sends7d > 0 ? (c.replies7d / c.sends7d) : null;
  return React.createElement('div', { className: 'csd-camprow' + (c.status !== 'Active' ? ' is-paused' : '') + (c.staleSev > 0 ? ' is-idle' : '') + (c.canRerun ? ' can-rerun' : '') },
    React.createElement('span', { className: 'gutter' },
      React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' },
        React.createElement('circle', { cx: 12, cy: 12, r: 1.5, fill: 'currentColor' }))),
    React.createElement('div', { className: 'name-cell' },
      React.createElement('span', { className: 'n', title: c.campaign }, c.campaign),
      React.createElement('span', { className: 'sub' },
        React.createElement(StatusDot, { status: c.status }),
        c.daysSinceLastSend != null && React.createElement('span', {
          className: 'idle-tag' + (c.staleSev === 2 ? ' crit' : c.staleSev === 1 ? ' warn' : ''),
        },
          c.daysSinceLastSend === 0 ? 'Sent today'
            : c.daysSinceLastSend === 1 ? 'Sent yesterday'
            : c.daysSinceLastSend < 14 ? `Sent ${c.daysSinceLastSend}d ago`
            : c.daysSinceLastSend < 60 ? `Idle ${c.daysSinceLastSend}d`
            : `Idle ${Math.round(c.daysSinceLastSend / 30)}mo`),
        c.canRerun && React.createElement('span', { className: 'rerun-tag', title: 'Cooldown elapsed — safe to rerun' }, '↻ Rerun ready'))),
    React.createElement('span', { className: 'stat-num' + (c.sends7d === 0 ? ' muted' : '') },
      fmt.num(c.sends7d),
      React.createElement('span', { className: 'sublabel' }, c.dailyRate > 0 ? Math.round(c.dailyRate) + '/day' : 'no sends')),
    React.createElement('span', { className: 'stat-num' + (replyRate === null ? ' muted' : '') },
      replyRate === null ? '—' : (replyRate * 100).toFixed(2) + '%',
      React.createElement('span', { className: 'sublabel' }, c.replies7d + ' replies')),
    React.createElement('span', { className: 'stat-num ' + (c.prrSev === 2 ? 'crit' : c.prrSev === 1 ? 'warn' : c.prr !== null ? '' : 'muted') },
      c.prr === null ? '—' : (c.prr * 100).toFixed(2) + '%',
      React.createElement('span', { className: 'sublabel' }, c.posReplies7d + ' positive')),
    React.createElement('span', { className: 'stat-num' + (c.bookings7d > 0 ? ' good' : ' muted') },
      c.bookings7d || 0,
      React.createElement('span', { className: 'sublabel' }, 'booked')),
    React.createElement(RunwayBar, { campaign: c }),
    React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
      React.createElement(Sparkline, { data: c.sparkline, sev: c.overall, width: 90, height: 26 }))
  );
}

// ---------- Stat card ----------
function StatCard({ label, value, unit, delta, deltaDir, spark, sparkSev, icon }) {
  return React.createElement('div', { className: 'csd-stat-card' },
    React.createElement('div', { className: 'label' },
      icon && React.createElement('span', { className: 'ico' }, icon),
      label),
    spark && React.createElement('span', { className: 'spark-mini' },
      React.createElement(Sparkline, { data: spark, sev: sparkSev || 0, accent: true, width: 64, height: 22 })),
    React.createElement('div', { className: 'v' }, value,
      unit && React.createElement('span', { className: 'unit' }, unit)),
    delta && React.createElement('div', { className: 'delta ' + (deltaDir === 'up' ? 'up' : deltaDir === 'down' ? 'down' : '') },
      React.createElement('span', { className: 'v' }, delta),
      React.createElement('span', null, 'vs prior 7d'))
  );
}

// ---------- Notification drawer ----------
function NotifDrawer({ open, onClose, items, resolved, onResolve, onClearResolved, onJump }) {
  const [tab, setTab] = useState('all');
  const visible = items.filter(i => !resolved[i.id]);
  const crit = visible.filter(i => i.sev === 2);
  const warn = visible.filter(i => i.sev === 1);
  const filtered = tab === 'critical' ? crit : tab === 'warning' ? warn : visible;

  return React.createElement(React.Fragment, null,
    React.createElement('div', { className: 'csd-notif-overlay' + (open ? ' open' : ''), onClick: onClose }),
    React.createElement('aside', { className: 'csd-notif-drawer' + (open ? ' open' : ''), 'aria-hidden': !open },
      React.createElement('div', { className: 'csd-notif-head' },
        React.createElement('h3', null, 'Action queue'),
        React.createElement('div', { className: 'pills' },
          crit.length > 0 && React.createElement('span', { className: 'pill crit' }, crit.length + ' critical'),
          warn.length > 0 && React.createElement('span', { className: 'pill warn' }, warn.length + ' warning')),
        React.createElement('button', { className: 'close-btn', onClick: onClose, 'aria-label': 'Close' },
          React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' },
            React.createElement('line', { x1: 18, y1: 6, x2: 6, y2: 18 }),
            React.createElement('line', { x1: 6, y1: 6, x2: 18, y2: 18 })))),
      React.createElement('div', { className: 'csd-notif-tabs' },
        ['all', 'critical', 'warning'].map(t =>
          React.createElement('button', { key: t, className: tab === t ? 'active' : '', onClick: () => setTab(t) },
            t.charAt(0).toUpperCase() + t.slice(1),
            React.createElement('span', { className: 'count' + (t === 'critical' && crit.length > 0 ? ' crit' : '') },
              t === 'critical' ? crit.length : t === 'warning' ? warn.length : visible.length)))),
      React.createElement('div', { className: 'csd-notif-list' },
        filtered.length === 0
          ? React.createElement('div', { className: 'csd-notif-empty' },
              React.createElement('div', { className: 'check' },
                React.createElement('svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
                  React.createElement('polyline', { points: '20 6 9 17 4 12' }))),
              React.createElement('div', { className: 'head' }, 'Nothing on fire'),
              React.createElement('div', null,
                items.length === 0
                  ? 'All campaigns within benchmark.'
                  : (items.length - visible.length) + ' marked seen. ',
                items.length - visible.length > 0 &&
                  React.createElement('a', {
                    href: '#', style: { color: 'var(--d-accent-soft)' },
                    onClick: (e) => { e.preventDefault(); onClearResolved(); }
                  }, 'Reset')))
          : filtered.map(item =>
              React.createElement('div', { key: item.id, className: `csd-notif-item sev-${item.sev}` },
                React.createElement('span', { className: 'marker' }),
                React.createElement('div', { className: 'body' },
                  React.createElement('div', { className: 'meta' },
                    React.createElement('span', { className: 'client' }, item.client),
                    React.createElement('span', null, '·'),
                    React.createElement('span', null, item.kind === 'runway' ? 'Lead runway' : item.kind === 'stale' ? 'Idle list' : item.kind === 'prr' ? 'Reply quality' : 'Booking rate')),
                  React.createElement('div', { className: 'label' },
                    React.createElement('span', { className: 'camp' }, item.campaign),
                    React.createElement('span', null, ' — '),
                    item.label),
                  React.createElement('div', { className: 'detail' }, item.detail),
                  React.createElement('div', { className: 'row' },
                    React.createElement('button', {
                      className: 'primary',
                      onClick: () => { onJump && onJump(item); onClose(); }
                    }, 'Jump to campaign'),
                    React.createElement('button', { onClick: () => onResolve(item.id) }, 'Mark seen')))))
      ))
  );
}

Object.assign(window, {
  Sparkline, Tip, StatusDot, RunwayBar, DayChart, ClientGroup, CampaignRow, StatCard, NotifDrawer,
});
