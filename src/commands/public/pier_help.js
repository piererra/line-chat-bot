// !help — public command list.

import { pier_isWhoamiEnabled } from '../../lib/pier_auth.js';
import { pier_frame } from '../../lib/pier_format.js';
import { pier_sendCombinedReply } from '../../lib/pier_line_api.js';

export function pier_matches(pier_text) {
  return pier_text === '!help';
}

export async function pier_handle(pier_ctx) {
  const { event: pier_event, env: pier_env, chatId: pier_chatId, extraMessages: pier_extraMessages } = pier_ctx;
  const pier_whoamiLine = (await pier_isWhoamiEnabled(pier_env)) ? '➸ !whoami — show your userId\n' : '';

  await pier_sendCombinedReply(
    pier_event.replyToken,
    pier_extraMessages,
    [
      {
        type: 'text',
        text: pier_frame(
          'Help Menu',
          '➸ !help — show this menu\n' +
            pier_whoamiLine +
            '➸ !leaderboard [n] — most active\n' +
            '  members by message count\n' +
            '➸ !setbirthday MM-DD — set your own\n' +
            '  birthday (e.g. !setbirthday 07-17)\n' +
            "➸ !picture @name — show a member's\n" +
            '  profile picture (groups only)\n' +
            '\n' +
            '(these are open to everyone; ask a\n' +
            'group admin about anything else)'
        ),
      },
    ],
    pier_chatId,
    pier_env
  );
}
