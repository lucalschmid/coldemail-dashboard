/* ============================================================
   Cold Email Dashboard — data layer
   ------------------------------------------------------------
   Loads campaigns from the Apps Script /exec endpoint via
   JSONP (CORS-free), falls back to representative mock data.
   ============================================================ */

window.DASHBOARD_DATA = (function () {
  // ---------- Configuration ----------
  // Set this to your Apps Script /exec URL to load real data.
  // Leave empty string to always use mock data.
  const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz15_4j2mUUCyM0LqPt6s_HMdy0ENGezx_ZyAgjP7fUDvAwNMJwspHQ1nfzJ6rOK8rTIA/exec';

  // ---------- Mock data (shaped like real n8n payload) ----------
  // Field names match the transform_node_v2 output the user already wired up.
  const generated = '2026-04-26T08:14:00Z';

  // 14-day sparklines: synthetic but plausible
  const spark = (base, jitter, trend = 0) =>
    Array.from({ length: 14 }, (_, i) => {
      const t = trend * i;
      return Math.max(0, Math.round(base + t + (Math.random() - 0.5) * jitter));
    });

  const campaigns = [
    {
      id: 'b7e396a4-f893-47ed-a2f7-3017457bd705',
      client: 'Cory ID Axis',
      campaign: 'Cory Campaign — University',
      status: 'Active',
      sends7d: 142,
      replies7d: 4,
      posReplies7d: 2,
      bookings7d: 1,
      totalLeads: 820,
      contacted: 114,
      leadsLeft: 706,
      bounced: 1,
      lastSendDate: '2026-04-26',
      sparkline: spark(20, 8, 0.1),
    },
    {
      id: 'a3c8821e-1d74-4f10-9b77-22a1115cc422',
      client: 'Cory ID Axis',
      campaign: 'Cory Campaign — Hospitals',
      status: 'Active',
      sends7d: 488,
      replies7d: 6,
      posReplies7d: 3,
      bookings7d: 1,
      totalLeads: 1240,
      contacted: 612,
      leadsLeft: 628,
      bounced: 4,
      lastSendDate: '2026-04-26',
      sparkline: spark(70, 18, -0.5),
    },
    {
      id: '5fa9e11a-6210-46aa-bb33-aa70c123f9aa',
      client: 'Cory ID Axis',
      campaign: 'Cory Campaign — University Rerun 1',
      status: 'Active',
      sends7d: 902,
      replies7d: 7,
      posReplies7d: 4,
      bookings7d: 2,
      totalLeads: 1500,
      contacted: 1402,
      leadsLeft: 98,
      bounced: 6,
      lastSendDate: '2026-04-25',
      sparkline: spark(130, 22, -1.2),
    },
    {
      id: '38e62cfe-bd3e-4f4f-90b1-7b54a2d7d301',
      client: 'Cory ID Axis',
      campaign: 'Cory — General Facilities and Security 2',
      status: 'Active',
      sends7d: 1069,
      replies7d: 5,
      posReplies7d: 3,
      bookings7d: 0,
      totalLeads: 1069,
      contacted: 1069,
      leadsLeft: 0,
      bounced: 11,
      lastSendDate: '2026-04-21',
      sparkline: spark(170, 30, -3),
    },
    {
      id: 'c9b21a55-7afd-43e1-bf99-66dd441a6f88',
      client: 'Lukas',
      campaign: 'Lukas Campaign',
      status: 'Active',
      sends7d: 442,
      replies7d: 36,
      posReplies7d: 14,
      bookings7d: 4,
      totalLeads: 980,
      contacted: 442,
      leadsLeft: 538,
      bounced: 2,
      lastSendDate: '2026-04-26',
      sparkline: spark(64, 14, 0.2),
    },
    {
      id: '04e2bb83-aa41-4f9a-9d36-f01112bc91ee',
      client: 'Comwrap',
      campaign: 'Comwrap Reply Campaign',
      status: 'Paused',
      sends7d: 0,
      replies7d: 0,
      posReplies7d: 0,
      bookings7d: 0,
      totalLeads: 410,
      contacted: 188,
      leadsLeft: 222,
      bounced: 0,
      lastSendDate: '2026-03-10',
      sparkline: spark(0, 0),
    },
    {
      id: 'fa221bcc-9e4b-4d29-93dd-1aa6628a8c99',
      client: 'Compound Scaling',
      campaign: 'CS Campaign — CS Inboxes w CS Domains',
      status: 'Active',
      sends7d: 3600,
      replies7d: 17,
      posReplies7d: 9,
      bookings7d: 3,
      totalLeads: 12000,
      contacted: 5400,
      leadsLeft: 6600,
      bounced: 24,
      lastSendDate: '2026-04-26',
      sparkline: spark(515, 60, 1),
    },
    {
      id: 'ee774b21-1cdf-4cf1-a2bc-2310aa55b8e4',
      client: 'Compound Scaling',
      campaign: 'CS Campaign (Leads Rerun 3)',
      status: 'Paused',
      sends7d: 0,
      replies7d: 0,
      posReplies7d: 0,
      bookings7d: 0,
      totalLeads: 8200,
      contacted: 2929,
      leadsLeft: 5271,
      bounced: 11,
      lastSendDate: '2026-01-27',
      sparkline: spark(0, 0),
    },
    {
      id: 'b1f9d84d-22ff-46c8-a4a2-8e2b3a8f4421',
      client: 'Compound Scaling',
      campaign: 'SAAS | US | 1 to 50 employees',
      status: 'Active',
      sends7d: 6580,
      replies7d: 7,
      posReplies7d: 1,
      bookings7d: 0,
      totalLeads: 18000,
      contacted: 12100,
      leadsLeft: 5900,
      bounced: 102,
      lastSendDate: '2026-04-26',
      sparkline: spark(940, 80, 0.5),
    },
  ];

  const clients = [
    {
      name: 'Compound Scaling',
      mrr: 0,
      callsTarget: 12,
      callsBooked: 3,
      renewalDays: null,
      note: 'Internal',
    },
    {
      name: 'Cory ID Axis',
      mrr: 3500,
      callsTarget: 12,
      callsBooked: 4,
      renewalDays: 47,
      note: 'Wholesale + distribution',
    },
    {
      name: 'Lukas',
      mrr: 2500,
      callsTarget: 10,
      callsBooked: 4,
      renewalDays: 22,
      note: 'High reply rate',
    },
    {
      name: 'Comwrap',
      mrr: 4000,
      callsTarget: 10,
      callsBooked: 0,
      renewalDays: 81,
      note: 'Adobe partner',
    },
  ];

  const mock = { generated_at: generated, campaigns, clients };

  // ---------- JSONP loader (CORS-free) ----------
  function loadJSONP(url, callbackParam = 'callback') {
    return new Promise((resolve, reject) => {
      const cbName = '__cs_dashboard_cb_' + Date.now();
      const script = document.createElement('script');
      let timer = setTimeout(() => {
        cleanup();
        reject(new Error('JSONP timeout'));
      }, 12000);
      function cleanup() {
        clearTimeout(timer);
        delete window[cbName];
        if (script.parentNode) script.parentNode.removeChild(script);
      }
      window[cbName] = (data) => {
        cleanup();
        resolve(data);
      };
      script.onerror = () => {
        cleanup();
        reject(new Error('JSONP load error'));
      };
      const sep = url.includes('?') ? '&' : '?';
      script.src = url + sep + callbackParam + '=' + cbName;
      document.head.appendChild(script);
    });
  }

  async function load() {
    if (!APPS_SCRIPT_URL) {
      return { ...mock, source: 'mock' };
    }
    try {
      const data = await loadJSONP(APPS_SCRIPT_URL);
      return { ...data, source: 'live' };
    } catch (e) {
      console.warn('Live data failed, falling back to mock:', e.message);
      return { ...mock, source: 'mock-fallback', error: e.message };
    }
  }

  return { load, mock, APPS_SCRIPT_URL };
})();
