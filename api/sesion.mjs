// Inicio y cierre de sesión de ARRAIGO con las cuentas de la plataforma de gestión (SGD).
// La contraseña se envía al SGD para verificarla y no se guarda aquí; la sesión vive en una cookie HttpOnly.
const SGD = (process.env.SGD_URL || 'https://sgd.jjglobalsa.com').replace(/\/$/, '');
const COOKIE = 'arraigo_sesion';
const json = (o, status = 200, extra = {}) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });

function mismoOrigen(req) {
  const o = req.headers.get('origin');
  if (!o) return true;
  try { return new URL(o).host === req.headers.get('host'); } catch { return false; }
}

export async function POST(req) {
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
