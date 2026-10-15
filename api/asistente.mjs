// Asistente técnico de ARRAIGO fuera del entorno Claude.
// Proveedor: clave propia de Anthropic (ANTHROPIC_API_KEY) si existe; si no, Vercel AI Gateway
// (AI_GATEWAY_API_KEY o el token OIDC del despliegue). Las claves viven solo en las variables de entorno de Vercel.
// La aplicación envía únicamente códigos (proyecto, finca, parcela, medidor): nunca nombres de personas ni de empresas.

const MODELO_ANT = process.env.IA_MODELO || 'claude-sonnet-5-5';
const MODELO_GW = process.env.IA_MODELO_GW || 'anthropic/claude-sonnet-5.5';
const MAX_CUERPO = 120000;      // caracteres por consulta
const MAX_TURNOS = 30;
const VENTANA_MS = 60000, MAX_POR_VENTANA = 12;
const visitas = new Map();      // límite por IP, de mejor esfuerzo (por instancia)

const SISTEMA = 'Eres el asistente técnico del Programa ARRAIGO de JJ Global. Solo respondes sobre los datos del ciclo que la aplicación te entrega y sobre medición de carbono en café y cacao (ISO 14064-1, ISO 14067, ISO 14068-1, insetting y créditos de carbono). Si la consulta no trata de eso, dilo en una frase y no la respondas. Las personas y organizaciones aparecen solo por código: refiérete a ellas por su código y nunca intentes deducir un nombre.';

function token(req) {
  return process.env.AI_GATEWAY_API_KEY || req.headers.get('x-vercel-oidc-token') || process.env.VERCEL_OIDC_TOKEN || '';
}
const disponible = (req) => !!(process.env.ANTHROPIC_API_KEY || token(req));

function origenPermitido(req) {
  const o = req.headers.get('origin');
  if (!o) return true;                       // misma página (algunos navegadores no envían Origin)
  try { return new URL(o).host === req.headers.get('host'); } catch { return false; }
}
function limitar(req) {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'x';
  const ahora = Date.now(), v = (visitas.get(ip) || []).filter((t) => ahora - t < VENTANA_MS);
  v.push(ahora); visitas.set(ip, v);
  return v.length > MAX_POR_VENTANA;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export async function GET(req) {
  return json({ disponible: disponible(req), proveedor: process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'gateway' });
}

export async function POST(req) {
  if (!origenPermitido(req)) return json({ code: 'forbidden', text: 'Origen no permitido.' }, 403);
  if (!disponible(req)) return json({ code: 'unavailable', text: 'El asistente no está configurado en este despliegue.' }, 503);
  if (limitar(req)) return json({ code: 'rate_limited', text: 'Demasiadas consultas seguidas.' }, 429);
  let cuerpo;
  try { const t = await req.text(); if (t.length > MAX_CUERPO) return json({ code: 'too_large', text: 'La consulta es demasiado grande.' }, 413); cuerpo = JSON.parse(t); }
  catch { return json({ code: 'bad_request', text: 'Consulta no válida.' }, 400); }
  const turnos = (Array.isArray(cuerpo.turnos) ? cuerpo.turnos : []).slice(-MAX_TURNOS)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 40000) }));
  if (!turnos.length || turnos[0].role !== 'user') return json({ code: 'bad_request', text: 'Consulta vacía.' }, 400);

  let r, formato;
  if (process.env.ANTHROPIC_API_KEY) {
    formato = 'anthropic';
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: req.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODELO_ANT, max_tokens: 2500, stream: true, system: SISTEMA, messages: turnos }),
    });
  } else {
    formato = 'openai';
    r = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
      method: 'POST', signal: req.signal,
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token(req) },
      body: JSON.stringify({ model: MODELO_GW, max_tokens: 2500, stream: true, messages: [{ role: 'system', content: SISTEMA }, ...turnos] }),
    });
  }
  if (!r.ok || !r.body) {
    const st = r.status === 429 ? 429 : 502;
    return json({ code: st === 429 ? 'rate_limited' : 'upstream', text: 'El servicio de IA no respondió (' + r.status + ').' }, st);
  }
  // Se convierte el flujo del proveedor en texto plano, trozo a trozo.
  const dec = new TextDecoder(), enc = new TextEncoder();
  let resto = '';
  const salida = new TransformStream({
    transform(chunk, ctl) {
      resto += dec.decode(chunk, { stream: true });
      const lineas = resto.split('\n'); resto = lineas.pop();
      for (const l of lineas) {
        if (!l.startsWith('data:')) continue;
        const d = l.slice(5).trim(); if (!d || d === '[DONE]') continue;
        try {
          const o = JSON.parse(d);
          const t = formato === 'anthropic'
            ? (o.type === 'content_block_delta' && o.delta && o.delta.text) || ''
            : (o.choices && o.choices[0] && o.choices[0].delta && o.choices[0].delta.content) || '';
          if (t) ctl.enqueue(enc.encode(t));
        } catch { /* línea parcial o de control */ }
      }
    },
  });
  return new Response(r.body.pipeThrough(salida), { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}
