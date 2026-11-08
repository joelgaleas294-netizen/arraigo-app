// Lectura asistida de documentos para ARRAIGO, con la misma IA de Origen (sgd.jjglobalsa.com).
// ARRAIGO llama primero a Origen: reenvía las páginas, el texto extraído y la instrucción a
// Origen (/api/arraigo/leer) con la sesión del usuario, y Origen aplica su propia configuración de IA,
// sus modelos y sus límites. No se guarda nada aquí: el documento solo pasa.
// Lo leído es una propuesta; la aplicación no lo suma al inventario hasta que una persona lo confirma.
// Respaldo: si Origen no tiene la IA activa o no hay sesión de Origen, se usa la clave propia de este despliegue
// (ANTHROPIC_API_KEY o Vercel AI Gateway), para que la lectura no se detenga.

const ORIGEN = (process.env.SGD_URL || 'https://sgd.jjglobalsa.com').replace(/\/+$/, '');
const MAX_CUERPO = 4_400_000;   // el límite de Vercel es 4,5 MB por solicitud
const MAX_IMG = 6;

const MODELO_ANT = process.env.IA_MODELO || 'claude-sonnet-5-5';
const MODELO_GW = process.env.IA_MODELO_GW || 'anthropic/claude-sonnet-5.5';
const SISTEMA = 'Eres el lector de documentos del Programa ARRAIGO (huella de carbono de producto, café y cacao). Transcribes lo que se ve en el documento y respondes únicamente con JSON válido. Nunca inventas ni estimas cantidades: lo que no se lee queda vacío.';
const gwToken = (req) => process.env.AI_GATEWAY_API_KEY || req.headers.get('x-vercel-oidc-token') || process.env.VERCEL_OIDC_TOKEN || '';
const directoDisponible = (req) => !!(process.env.ANTHROPIC_API_KEY || gwToken(req));
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function origenPermitido(req) {
  const o = req.headers.get('origin');
  if (!o) return true;
  // También se acepta Origen: ARRAIGO se sirve dentro de sgd.jjglobalsa.com/arraigo-app (mismo sitio de JJ Global)
  try { const h = new URL(o).host; return h === req.headers.get('host') || h === req.headers.get('x-forwarded-host') || h === new URL(process.env.SGD_URL || 'https://sgd.jjglobalsa.com').host; } catch { return false; }
}
function sesion(req) {
  const c = req.headers.get('cookie') || '';
  const m = /(?:^|;\s*)arraigo_sesion=([^;]+)/.exec(c);
  return m ? decodeURIComponent(m[1]) : '';
}
// Extrae el primer objeto JSON de una respuesta, aunque venga con texto alrededor
export function extraerJSON(t) {
  const s = String(t || ''), i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(s.slice(i, j + 1)); } catch { return null; }
}

async function aOrigen(req, metodo, cuerpo) {
  const tk = sesion(req);
  if (!tk) return { status: 401, o: { ok: false, disponible: false, code: 'unauthorized', text: 'Sin sesión de Origen.' } };
  try {
    const r = await fetch(ORIGEN + '/api/arraigo/leer', {
      method: metodo, signal: req.signal,
      headers: { authorization: 'Bearer ' + tk, ...(cuerpo ? { 'content-type': 'application/json' } : {}) },
      body: cuerpo,
    });
    const o = extraerJSON(await r.text()) || { ok: false, code: 'upstream', text: 'Origen respondió ' + r.status + '.' };
    return { status: r.status, o };
  } catch {
    return { status: 502, o: { ok: false, disponible: false, code: 'upstream', text: 'Origen no respondió.' } };
  }
}

async function directo(req, { imagenes, texto, instruccion }) {
  const imgs = imagenes.map((u) => /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(u)).filter(Boolean);
  const txt = instruccion + (texto ? '\n\n' + texto : '');
  let r, salida = '';
  try {
    if (process.env.ANTHROPIC_API_KEY) {
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: req.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: MODELO_ANT, max_tokens: 6000, system: SISTEMA, messages: [{ role: 'user', content: [
          ...imgs.map((m) => ({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } })), { type: 'text', text: txt }] }] }),
      });
      if (r.ok) { const o = await r.json(); salida = (o.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''); }
    } else {
      r = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
        method: 'POST', signal: req.signal,
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + gwToken(req) },
        body: JSON.stringify({ model: MODELO_GW, max_tokens: 6000, messages: [{ role: 'system', content: SISTEMA }, { role: 'user', content: [
          ...imgs.map((m) => ({ type: 'image_url', image_url: { url: m[0] } })), { type: 'text', text: txt }] }] }),
      });
      if (r.ok) { const o = await r.json(); salida = o.choices?.[0]?.message?.content || ''; }
    }
  } catch { return json({ ok: false, code: 'upstream', text: 'El servicio de lectura no respondió.' }, 502); }
  if (!r.ok) return json({ ok: false, code: r.status === 429 ? 'rate_limited' : 'upstream', text: 'El servicio de lectura respondió ' + r.status + '.' }, r.status === 429 ? 429 : 502);
  const datos = extraerJSON(salida.replace(/```(?:json)?/gi, ''));
  if (!datos) return json({ ok: false, code: 'invalid_json', text: 'La lectura no devolvió datos interpretables.' }, 502);
  return json({ ok: true, datos, motor: 'arraigo' });
}

export async function GET(req) {
  const r = await aOrigen(req, 'GET');
  if (r.o && r.o.disponible) return json({ disponible: true, motor: 'origen' });
  return json({ disponible: directoDisponible(req), motor: directoDisponible(req) ? 'arraigo' : '' });
}

export async function POST(req) {
  if (!origenPermitido(req)) return json({ ok: false, code: 'forbidden', text: 'Origen no permitido.' }, 403);
  let c;
  try { const t = await req.text(); if (t.length > MAX_CUERPO) return json({ ok: false, code: 'too_large', text: 'El documento pesa demasiado para una sola lectura.' }, 413); c = JSON.parse(t); }
  catch { return json({ ok: false, code: 'bad_request', text: 'Solicitud no válida.' }, 400); }
  const imagenes = (Array.isArray(c.imagenes) ? c.imagenes : []).slice(0, MAX_IMG).map(String)
    .filter((u) => /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(u));
  const instruccion = String(c.instruccion || '').slice(0, 20000);
  const texto = String(c.texto || '').slice(0, 80000);
  if (!instruccion || (!imagenes.length && texto.length < 20)) return json({ ok: false, code: 'bad_request', text: 'Faltan el documento o la instrucción.' }, 400);
  const datos = { imagenes, texto, instruccion };
  const r = await aOrigen(req, 'POST', JSON.stringify(datos));
  if (r.status === 200 && r.o && r.o.ok) return json({ ...r.o, motor: 'origen' });
  // Origen sin IA activa, sin sesión o caído: se lee con la clave de este despliegue, si la hay
  if ([401, 502, 503, 504].includes(r.status) && directoDisponible(req)) return directo(req, datos);
  return json(r.o, r.status);
}
