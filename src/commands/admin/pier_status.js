// -status — bot version, KV health, and message quota.

import { pier_BOT_VERSION } from '../../lib/pier_constants.js';
import { pier_checkKvHealth } from '../../lib/pier_kv.js';
import { pier_getMessageQuota, pier_getMessageQuotaConsumption } from '../../lib/pier_line_api.js';
import { pier_frame } from '../../lib/pier_format.js';

export function pier_matches(pier_text) {
  return pier_text === '-status';
}

export async function pier_handle(pier_ctx) {
  const { env: pier_env } = pier_ctx;

  const [pier_kvOk, pier_quota, pier_consumption] = await Promise.all([
    pier_checkKvHealth(pier_env),
    pier_getMessageQuota(pier_env),
    pier_getMessageQuotaConsumption(pier_env),
  ]);

  let pier_quotaLine;
  if (!pier_quota) {
    pier_quotaLine = 'Quota: unavailable';
  } else if (pier_quota.type === 'none') {
    pier_quotaLine = 'Quota: unlimited plan';
  } else {
    const pier_used = pier_consumption ? pier_consumption.totalUsage : '?';
    pier_quotaLine = `Quota: ${pier_used} / ${pier_quota.value} messages this month`;
  }

  return [
    {
      type: 'text',
      text: pier_frame(
        'Bot Status',
        `Version: ${pier_BOT_VERSION}\n` +
          `KV storage: ${pier_kvOk ? '✅ OK' : '❌ unreachable'}\n` +
          `${pier_quotaLine}\n` +
          `Server time (UTC): ${new Date().toISOString()}`
      ),
    },
  ];
}
