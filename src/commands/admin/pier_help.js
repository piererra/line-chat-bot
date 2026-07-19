// -help — admin command list.

import { pier_frame } from '../../lib/pier_format.js';

export function pier_matches(pier_text) {
  return pier_text === '-help';
}

// Admin command handlers return the reply message array; webhook.js
// folds it into the single end-of-chain sendCombinedReply call, same as
// the original bot's replyMessages variable.
export async function pier_handle() {
  return [
    {
      type: 'text',
      text: pier_frame(
        'Admin Help Menu',
        '➸ -help — show this menu\n' +
          '(members: send !help for the\n' +
          'public command list)\n' +
          '\n' +
          '── Welcome ──\n' +
          '➸ -testwelcome — preview + raw template\n' +
          '➸ -setwelcome <text>\n' +
          '\n' +
          '── Leave ──\n' +
          '➸ -testleavemsg — preview + raw template\n' +
          '➸ -setleavemsg <text>\n' +
          '\n' +
          '── Group ──\n' +
          '➸ -groups — list all tracked groups\n' +
          '  (with live member counts)\n' +
          '➸ -sider on / off\n' +
          '➸ -levelup on / off — toggle level-up\n' +
          '  congratulation messages\n' +
          '➸ -unsend on / off — show unsent\n' +
          '  messages (spends quota, off by\n' +
          '  default)\n' +
          '➸ -status — bot version, KV health\n' +
          '  & message quota\n' +
          '\n' +
          '── Stickers ──\n' +
          '➸ Send a sticker (as admin, in the\n' +
          '  group set as LINE_GROUP_ID) to\n' +
          '  auto-register its keywords —\n' +
          '  fully silent, no commands\n' +
          '\n' +
          '── Owner only ──\n' +
          '➸ -whoami on / off — enable/disable\n' +
          '  the public !whoami command\n' +
          '\n' +
          '(all commands here are admin-only;\n' +
          'settings apply to this group only,\n' +
          'except -whoami on/off)'
      ),
    },
  ];
}
