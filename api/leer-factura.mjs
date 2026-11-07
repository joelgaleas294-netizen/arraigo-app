// Lectura asistida de facturas para ARRAIGO, fuera del entorno Claude.
// Recibe de una a tres imágenes (páginas de la factura, ya reducidas en el navegador) y la instrucción que arma la
// aplicación, y devuelve el JSON que propone el modelo. No guarda nada: la imagen solo pasa por aquí.
// Lo leído es una propuesta; la aplicación no lo suma al inventario hasta que una persona lo confirma.
// Proveedor: ANTHROPIC_API_KEY si existe; si no, Vercel AI Gateway (igual que /api/asistente).

const MODELO_ANT = process.env.IA_MODELO || 'claude-sonnet-5-5';
const MODELO_GW = process.env.IA_MODELO_GW || 'anthropic/claude-sonnet-5.5';
const MAX_CUERPO = 4_000_000;   // el límite de Vercel es 4,5 MB por solicitud
const MAX_IMG = 3;
const VENTANA_MS = 60000, MAX_POR_VENTANA = 8;
const visitas = new Map();

const SISTEMA = 'Eres el lector de facturas del Programa ARRAIGO. Transcribes lo que se ve en el documento y respondes únicamente con JSON válido. Nunca inventas ni estimas cantidades: lo que no se lee queda vacío. No copias nombres de personas naturales, números de identidad ni datos de tarjetas.';

const token = (req) => process.env.AI_GATEWAY_API_KEY || req.headers.get('x-vercel-oidc-token') || process.env.VERCEL_OIDC_TOKEN || '';
const disponible = (req) => !!(process.env.ANTHROPIC_API_KEY || token(req));
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function origenPermitido(req) {
  const o = req.headers.get('origin');
  if (!o) return true;
  try { return new URL(o).host === req.headers.get('host'); } catch { return false; }
}
function limitar(req) {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'x';
  const ahora = Date.now(), v = (visitas.get(ip) || []).filter((t) => ahora - t < VENTANA_MS);
  v.push(ahora); visitas.set(ip, v);
  return v.length > MAX_POR_VENTANA;
}
// Extrae el primer objeto JSON de la respuesta, aunque venga con texto o bloque de código alrededor
export function extraerJSON(t) {
  const s = String(t || ''), i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(s.slice(i, j + 1)); } catch { return null; }
}

export async function GET(req) {
  return json({ disponible: disponible(req) });
}

export async function POST(req) {
  if (!origenPermitido(req)) return json({ ok: false, code: 'forbidden', text: 'Origen no permitido.' }, 403);
  if (!disponible(req)) return json({ ok: false, code: 'unavailable', text: 'La lectura no está configurada en este despliegue.' }, 503);
  if (limitar(req)) return json({ ok: false, code: 'rate_limited', text: 'Demasiadas lecturas seguidas.' }, 429);
  let c;
  try { const t = await req.text(); if (t.length > MAX_CUERPO) return json({ ok: false, code: 'too_large', text: 'La factura pesa demasiado.' }, 413); c = JSON.parse(t); }
  catch { return json({ ok: false, code: 'bad_request', text: 'Solicitud no válida.' }, 400); }
  const imgs = (Array.isArray(c.imagenes) ? c.imagenes : []).slice(0, MAX_IMG)
    .map((u) => /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(u || '')))
    .filter(Boolean);
  const instr = String(c.instruccion || '').slice(0, 12000);
  if (!imgs.length || !instr) return json({ ok: false, code: 'bad_request', text: 'Faltan la imagen o la instrucción.' }, 400);

  let r, texto = '';
  try {
    if (process.env.ANTHROPIC_API_KEY) {
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: req.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: MODELO_ANT, max_tokens: 2000, system: SISTEMA, messages: [{ role: 'user', content: [
          ...imgs.map((m) => ({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } })),
          { type: 'text', text: instr }] }] }),
      });
      if (r.ok) { const o = await r.json(); texto = (o.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''); }
    } else {
      r = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
        method: 'POST', signal: req.signal,
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token(req) },
        body: JSON.stringify({ model: MODELO_GW, max_tokens: 2000, messages: [{ role: 'system', content: SISTEMA }, { role: 'user', content: [
          ...imgs.map((m) => ({ type: 'image_url', image_url: { url: m[0] } })),
          { type: 'text', text: instr }] }] }),
      });
      if (r.ok) { const o = await r.json(); texto = o.choices?.[0]?.message?.content || ''; }
    }
  } catch {
    return json({ ok: false, code: 'upstream', text: 'El servicio de lectura no respondió.' }, 502);
  }
  if (!r.ok) return json({ ok: false, code: r.status === 429 ? 'rate_limited' : 'upstream', text: 'El servicio de lectura respondió ' + r.status + '.' }, r.status === 429 ? 429 : 502);
  const datos = extraerJSON(texto);
  if (!datos) return json({ ok: false, code: 'invalid_json', text: 'La lectura no devolvió datos interpretables.' }, 502);
  return json({ ok: true, datos });
}
