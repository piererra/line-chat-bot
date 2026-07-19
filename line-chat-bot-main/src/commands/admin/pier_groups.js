// -groups — list all tracked groups with live member counts.

import { pier_getKnownGroups } from '../../lib/pier_kv.js';
import { pier_describeGroup } from '../../lib/pier_line_api.js';
import { pier_frame } from '../../lib/pier_format.js';

export function pier_matches(pier_text) {
  return pier_text === '-groups';
}

export async function pier_handle(pier_ctx) {
  const { env: pier_env } = pier_ctx;

  if (!pier_env.BOT_KV) {
    return [{ type: 'text', text: 'KV storage is not configured.' }];
  }

  const pier_groups = await pier_getKnownGroups(pier_env);
  if (!pier_groups.length) {
    return [
      {
        type: 'text',
        text: 'No groups tracked yet. The bot auto-tracks a group the ' +
          'moment it sees any activity there (a join, or anyone sending ' +
          'a message).',
      },
    ];
  }

  // Rooms (multi-person chats, not groups) have no name in LINE at all —
  // only Group Summary is a real endpoint. Refreshed live each time
  // rather than cached, since group names can change.
  const pier_labels = await Promise.all(pier_groups.map((g) => pier_describeGroup(g, pier_env)));
  const pier_lines = pier_labels.map((pier_label, pier_i) => `➸ ${pier_i + 1}. ${pier_label}`);

  return [
    {
      type: 'text',
      text: pier_frame(`Tracked Groups (${pier_groups.length})`, pier_lines.join('\n')),
    },
  ];
}
