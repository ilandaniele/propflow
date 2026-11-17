/**
 * Next.js instrumentation hook — runs once per server instance, before it
 * accepts requests (never during `next build`).
 *
 * The agent-job drain loop is Fly-only: it needs a long-lived Node process.
 * On Cloudflare Workers it is replaced by Cron Triggers, so the Cloudflare
 * build sets PROPFLOW_TARGET=cloudflare (inlined by next.config.ts) and the
 * bundler drops the whole import graph behind the branch below.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.PROPFLOW_TARGET !== 'cloudflare') {
    const { startAgentJobLoop } = await import('./instrumentation-node');
    await startAgentJobLoop();
  }
}
