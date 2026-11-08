// Puerta de ARRAIGO en el servidor: la aplicación y el asistente solo se entregan con una sesión válida.
// La sesión se valida contra la plataforma de gestión (SGD); ARRAIGO no guarda contraseñas.
// Sin sesión: la página pide usuario y contraseña (/login.html) y no se descarga nada del programa.
export const config = {
  matcher: ['/', '/index.html', '/api/asistente', '/api/leer-factura',
    '/arraigo-app', '/arraigo-app/', '/arraigo-app/index.html', '/arraigo-app/api/asistente', '/arraigo-app/api/leer-factura'],
};

const SGD = (process.env.SGD_URL || 'https://sgd.jjglobalsa.com').replace(/\/$/, '');
const COOKIE = 'arraigo_sesion';
const cache = new Map(); // token → vence (ms): evita consultar al SGD en cada carga

function leerCookie(req, nombre) {
  const c = req.headers.get('cookie') || '';
  const m = c.split(/;\s*/).find((x) => x.startsWith(nombre + '='));
  return m ? decodeURIComponent(m.slice(nombre.length + 1)) : '';
}

export async function sesionValida(token, f = fetch) {
  if (!token) return false;
  const v = cache.get(token);
  if (v && v > Date.now()) return true;
  try {
    const r = await f(SGD + '/api/arraigo/sesion', { headers: { authorization: 'Bearer ' + token }, cache: 'no-store' });
    if (!r.ok) { cache.delete(token); return false; }
    cache.set(token, Date.now() + 5 * 60_000);
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return true;
  } catch {
    return false;
  }
}

export default async function middleware(req) {
  const url = new URL(req.url);
  if (await sesionValida(leerCookie(req, COOKIE))) {
    return new Response(null, { headers: { 'x-middleware-next': '1' } });
  }
  // Servida dentro de Origen (sgd.jjglobalsa.com/arraigo-app): las direcciones llevan ese prefijo y no el dominio de Vercel
  const B = url.pathname === '/arraigo-app' || url.pathname.startsWith('/arraigo-app/') ? '/arraigo-app' : '';
  if (url.pathname.startsWith(B + '/api/')) {
    return new Response(JSON.stringify({ code: 'unauthorized', text: 'Inicie sesión de nuevo.' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }
  const q = url.search ? '?r=' + encodeURIComponent(url.pathname + url.search) : '';
  // Dirección sin dominio: si se entró por Origen, el navegador se queda en sgd.jjglobalsa.com
  return new Response(null, { status: 307, headers: { location: B + '/login.html' + q, 'cache-control': 'no-store' } });
}
