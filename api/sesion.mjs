// Inicio y cierre de sesión de ARRAIGO con las cuentas de la plataforma de gestión (SGD).
// La contraseña se envía al SGD para verificarla y no se guarda aquí; la sesión vive en una cookie HttpOnly.
const SGD = (process.env.SGD_URL || 'https://sgd.jjglobalsa.com').replace(/\/$/, '');
const COOKIE = 'arraigo_sesion';
const json = (o, status = 200, extra = {}) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });

function mismoOrigen(req) {
  const o = req.headers.get('origin');
  if (!o) return true;
  // También se acepta Origen: ARRAIGO se sirve dentro de sgd.jjglobalsa.com/arraigo-app (mismo sitio de JJ Global)
  try { const h = new URL(o).host; return h === req.headers.get('host') || h === req.headers.get('x-forwarded-host') || h === new URL(process.env.SGD_URL || 'https://sgd.jjglobalsa.com').host; } catch { return false; }
}

// Entrada desde Origen: formulario (POST) con un pase firmado de un solo uso que se canjea con el SGD.
// Llega aquí también por /api/entrar (vercel.json). El pase nunca viaja en la dirección (URL) ni se guarda.
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
async function entradaOrigen(req) {
  if (!origenSgd(req)) return ir('/login.html?e=origen');
  let pase = '', r = '/';
  try { const d = new URLSearchParams(await req.text()); pase = String(d.get('pase') || ''); r = destinoSeguro(d.get('r')); } catch { return ir('/login.html?e=entrada'); }
  // Dentro de Origen (sgd.jjglobalsa.com/arraigo-app) las direcciones llevan ese prefijo
  const B = r === '/arraigo-app' || r.startsWith('/arraigo-app/') || r.startsWith('/arraigo-app?') ? '/arraigo-app' : '';
  if (!pase || pase.length > 2000) return ir(B + '/login.html?e=entrada');
  let x, d = {};
  try {
    x = await globalThis.fetch(SGD + '/api/arraigo/sesion', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entrada: pase }) });
    d = await x.json().catch(() => ({}));
  } catch { return ir(B + '/login.html?e=red'); }
  if (!x.ok || !d.ok || !d.token) return ir(B + '/login.html?e=entrada');
  return ir(r, { 'set-cookie': `${COOKIE}=${encodeURIComponent(d.token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${12 * 3600}` });
}

export async function POST(req) {
  if ((req.headers.get('content-type') || '').includes('application/x-www-form-urlencoded')) return entradaOrigen(req);
  if (!mismoOrigen(req)) return json({ ok: false, error: 'Origen no permitido.' }, 403);
  let b;
  try { b = await req.json(); } catch { return json({ ok: false, error: 'Solicitud no válida.' }, 400); }
  const email = String(b.email || '').trim().slice(0, 200), clave = String(b.clave || '').slice(0, 200);
  if (!email || !clave) return json({ ok: false, error: 'Escriba su correo y su contraseña.' }, 400);
  let r, d = {};
  try {
    r = await fetch(SGD + '/api/arraigo/sesion', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': req.headers.get('x-forwarded-for') || '' },
      body: JSON.stringify({ email, clave }),
    });
    d = await r.json().catch(() => ({}));
  } catch {
    return json({ ok: false, error: 'No se pudo comprobar el acceso. Intente de nuevo.' }, 502);
  }
  if (!r.ok || !d.ok || !d.token) return json({ ok: false, error: d.error || 'Credenciales incorrectas.' }, r.status === 429 ? 429 : 401);
  const cookie = `${COOKIE}=${encodeURIComponent(d.token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${12 * 3600}`;
  return json({ ok: true, nombre: d.nombre }, 200, { 'set-cookie': cookie });
}

export async function DELETE() {
  return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
}
