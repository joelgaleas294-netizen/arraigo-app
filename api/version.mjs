// Versión publicada de ARRAIGO: la aplicación la consulta para avisar cuando hay una mejora nueva y ofrecer «Actualizar».
// Solo devuelve el identificador de la publicación; no expone datos.
export async function GET() {
  const v = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || '';
  return new Response(JSON.stringify({ v: v.slice(0, 12) }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
