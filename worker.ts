import openNext from './.open-next/worker.js';
import { runScheduled } from './src/lib/cron/scheduled';

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from './.open-next/worker.js';

export default {
  fetch: openNext.fetch,
  async scheduled(controller: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduled(controller.cron, new Date(controller.scheduledTime), env, ctx, openNext.fetch));
  },
} satisfies ExportedHandler<CloudflareEnv>;
