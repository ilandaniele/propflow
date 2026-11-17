const ALGORITHM_BITS = 256;

async function deriveOnce(iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('correct horse battery staple'), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, ALGORITHM_BITS);
}

export default {
  async fetch(request) {
    const iterations = Number(new URL(request.url).searchParams.get('iterations') ?? 10_000);
    const started = performance.now();
    await deriveOnce(iterations);
    return Response.json({ iterations, innerMs: performance.now() - started });
  },
};
