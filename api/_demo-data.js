const LOCAL_DEMO_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

function requestHostName(req) {
  const rawHost = String(req?.headers?.host || '').trim().toLowerCase();
  if (!rawHost) return '';
  if (rawHost.startsWith('[')) {
    const end = rawHost.indexOf(']');
    return end > 0 ? rawHost.slice(1, end) : rawHost;
  }
  return rawHost.split(':')[0];
}

export function shouldServeDemoData(req) {
  if (process.env.WAPPTRACK_DEMO_DATA === 'true') return true;
  if (process.env.NODE_ENV === 'production') return false;

  const host = requestHostName(req);
  return LOCAL_DEMO_HOSTS.has(host) || host.endsWith('.localhost');
}
