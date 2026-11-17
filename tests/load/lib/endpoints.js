// Real propflow routes. `auth` routes need the admin session cookie.
// `marker(res)` validates the BODY, so a redirect to /login or an empty shell fails.
const isDashboardPage = (title) => (res) =>
  res.status === 200 &&
  res.body.includes(`<title>${title} | PropFlow</title>`) &&
  res.body.includes('id="main-content"') &&
  res.body.includes('Load Test Org');

const tenantsApi = (res) => {
  if (res.status !== 200) return false;
  const json = res.json();
  return Array.isArray(json.tenants) && json.tenants.length > 0 && typeof json.tenants[0].fullName === 'string';
};

export const ENDPOINTS = {
  health: { path: '/api/health', auth: false, marker: (r) => r.status === 200 && r.json('status') === 'ok' },
  landing: { path: '/', auth: false, marker: (r) => r.status === 200 && r.body.includes('<title>PropFlow') },
  login: { path: '/login', auth: false, marker: (r) => r.status === 200 && r.body.includes('<title>PropFlow</title>') },
  dashboard: { path: '/dashboard', auth: true, marker: isDashboardPage('Dashboard') },
  payments: { path: '/dashboard/payments', auth: true, marker: isDashboardPage('Payments') },
  tenants: { path: '/dashboard/tenants', auth: true, marker: isDashboardPage('Tenants') },
  units: { path: '/dashboard/units', auth: true, marker: isDashboardPage('Units') },
  properties: { path: '/dashboard/properties', auth: true, marker: isDashboardPage('Properties') },
  contracts: { path: '/dashboard/contracts', auth: true, marker: isDashboardPage('Contracts') },
  api_tenants: { path: '/api/admin/tenants?limit=20&page=1', auth: true, marker: tenantsApi },
  api_tenants_search: { path: '/api/admin/tenants?limit=20&search=Quispe', auth: true, marker: tenantsApi },
};

// Weighted browsing mix of an admin (dashboard-heavy) plus a bit of anonymous traffic.
export const MIX = [
  ['dashboard', 30],
  ['payments', 15],
  ['tenants', 15],
  ['units', 8],
  ['properties', 6],
  ['contracts', 6],
  ['api_tenants', 10],
  ['api_tenants_search', 4],
  ['health', 3],
  ['landing', 2],
  ['login', 1],
];
