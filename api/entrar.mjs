// Entrada a ARRAIGO desde Origen (SGD) sin volver a escribir la contraseña.
// Origen envía por POST un pase firmado de un solo uso (60 s); aquí se canjea con el SGD por la sesión de 12 h
// y se guarda en la cookie HttpOnly de siempre. El pase nunca viaja en la dirección (URL) ni se guarda.
const SGD = (process.env.SGD_URL || 'https://sgd.jjglobalsa.com').replace(/\/$/, '');
const COOKIE = 'arraigo_sesion';
const ir = (destino, extra = {}) => new Response(null, { status: 303, headers: { location: destino, 'cache-control': 'no-store', ...extra } });

export function origenSgd(req, sgd = SGD) {
  const o = req.headers.get('origin');
  if (!o || o === 'null') return false;
  try { return new URL(o).host === new URL(sgd).host; } catch { return false; }
}
export function destinoSeguro(r) {
  r = String(r || '/');
  return r.startsWith('/') && !r.startsWith('//') && !r.includes('\\') ? r.slice(0, 300) : '/';
}

export async function POST(req, f = fetch) {
  if (!origenSgd(req)) return ir('/login.html?e=origen');
  let pase = '', r = '/';
  try { const d = await req.formData(); pase = String(d.get('pase') || ''); r = destinoSeguro(d.get('r')); } catch { return ir('/login.html?e=entrada'); }
  if (!pase || pase.length > 2000) return ir('/login.html?e=entrada');
  let x, d = {};
  try {
    x = await f(SGD + '/api/arraigo/sesion', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entrada: pase }) });
    d = await x.json().catch(() => ({}));
  } catch { return ir('/login.html?e=red'); }
  if (!x.ok || !d.ok || !d.token) return ir('/login.html?e=entrada');
  return ir(r, { 'set-cookie': `${COOKIE}=${encodeURIComponent(d.token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${12 * 3600}` });
}
