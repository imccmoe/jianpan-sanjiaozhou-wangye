export async function onRequest() {
  return Response.json({
    ok: true,
    service: "wy-zfq-config-hub",
    message: "Cloudflare Pages Functions API is ready"
  });
}
