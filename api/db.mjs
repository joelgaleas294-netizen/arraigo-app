// Puente entre la aplicación ARRAIGO y su base central, que vive en la plataforma de gestión (SGD).
// El navegador no ve el token: viaja en la cookie HttpOnly y este servidor lo pasa al SGD, que decide los permisos.
const SGD = (process.env.SGD_URL || 'https://sgd.jjglobalsa.com').replace(/\/$/, '');
const COOKIE = 'arraigo_sesion';
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function leerCookie(req, nombre) {
  const c = req.headers.get('cookie') || '';
  const m = c.split(/;\s*/).find((x) => x.startsWith(nombre + '='));
  return m ? decodeURIComponent(m.slice(nombre.length + 1)) : '';
}
function mismoOrigen(req) {
  const o = req.headers.get('origin');
  if (!o) return true;
  try { return new URL(o).host === req.headers.get('host'); } catch { return false; }
}

export async function POST(req) {
  if (!mismoOrigen(req)) return json({ ok: false, error: 'Origen no permitido.' }, 403);
  const token = leerCookie(req, COOKIE);
  if (!token) return json({ ok: false, code: 'unauthenticated', error: 'Inicie sesión de nuevo.' }, 401);
  const cuerpo = await req.text();
  if (cuerpo.length > 1_000_000) return json({ ok: false, error: 'Documento demasiado grande.' }, 413);
  try {
    const r = await fetch(SGD + '/api/arraigo/db', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: cuerpo, cache: 'no-store',
    });
    return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch {
    return json({ ok: false, code: 'unavailable', error: 'Base central no disponible.' }, 502);
  }
}

export async function GET() {
  return json({ ok: true, servicio: 'base central ARRAIGO' });
}
