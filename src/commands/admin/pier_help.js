// Coded by: Piererra Felldiaz
// -help — admin command list. Usable anywhere by any admin (owner or
// self-added) — NOT restricted to LINE_GROUP_ID, unlike -adminlist/
// -adminremove/-setadminpass themselves. Only the "Admin management"
// section below is owner-gated: a self-added admin sees everything else
// exactly as an owner would, just without those 3 lines, so they never
// even learn those commands exist.

import { pier_frame } from '../../lib/pier_format.js';
import { pier_isOwner } from '../../lib/pier_auth.js';

export function pier_matches(pier_text) {
  return pier_text === '-help';
}

// Admin command handlers return the reply message array; webhook.js
// folds it into the single end-of-chain sendCombinedReply call, same as
// the original bot's replyMessages variable.
export async function pier_handle(pier_ctx) {
  const { env: pier_env, event: pier_event } = pier_ctx;
  const pier_isTrueOwner = pier_isOwner(pier_env, pier_event.source.userId);

  const pier_adminManagementSection = pier_isTrueOwner
    ? '\n\n── Admin management (LINE_GROUP_ID only) ──\n' +
      '➸ -adminlist — list self-added admins\n' +
      '➸ -adminremove <number>\n' +
      '➸ -setadminpass — generate a random\n' +
      '  DM-claimable code, one-time use\n' +
      '➸ -showadminpass — re-show the active\n' +
      '  code\n' +
      '➸ -clearadminpass — revoke it early'
    : '';

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
          '  the public !whoami command' +
          pier_adminManagementSection +
          '\n\n' +
          '(all commands here are admin-only;\n' +
          'settings apply to this group only,\n' +
          'except -whoami on/off)'
      ),
    },
  ];
}
