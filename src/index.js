// Coded by: Piererra Felldiaz
/**
 * line-chat-bot
 *
 * A Cloudflare Worker that handles the LINE Messaging API webhook —
 * verifies signatures, replies to messages, welcomes new group members.
 *
 * Required environment variables / secrets (set in the Cloudflare
 * dashboard under Workers & Pages > this worker > Settings > Variables):
 *   LINE_CHANNEL_SECRET        - from the LINE Developers Console
 *   LINE_CHANNEL_ACCESS_TOKEN  - long-lived channel access token
 *   OWNER_USER_ID               - your own LINE userId; always a bot admin
 *                                 everywhere, permanently (comma-separate
 *                                 for multiple owners)
 *
 * KV binding (see wrangler.toml):
 *   BOT_KV - remembers known groups and per-group settings
 *
 * Code layout (see each file for details):
 *   lib/        - shared helpers (KV state, LINE API, formatting, auth, security)
 *   events/     - non-command webhook event handlers (join/leave/unsend/stickers)
 *   scheduled/  - the daily cron job (birthdays + leaderboard)
 *   commands/   - one file per bot command, split into public/ and admin/
 *   webhook.js  - webhook entry point + command dispatch pipeline
 */

import { pier_handleWebhook } from './webhook.js';
import { pier_runDailyScheduledTasks } from './scheduled/pier_daily_tasks.js';

export default {
  async fetch(pier_request, pier_env, pier_ctx) {
    const pier_url = new URL(pier_request.url);

    if (pier_url.pathname === '/' && pier_request.method === 'POST') {
      return pier_handleWebhook(pier_request, pier_env, pier_ctx);
    }

    return new Response('line-chat-bot is running', { status: 200 });
  },

  async scheduled(pier_controller, pier_env, pier_ctx) {
    pier_ctx.waitUntil(pier_runDailyScheduledTasks(pier_env, pier_controller.scheduledTime));
  },
};
