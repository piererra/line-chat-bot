// -testleavemsg — preview this group's leave message + show its raw
// template.

import { pier_getLeaveTemplate } from '../../lib/pier_kv.js';
import { pier_getGroupMemberProfile } from '../../lib/pier_line_api.js';

export function pier_matches(pier_text) {
  return pier_text === '-testleavemsg';
}

export async function pier_handle(pier_ctx) {
  const { event: pier_event, env: pier_env, chatId: pier_chatId, isGroupOrRoom: pier_isGroupOrRoom } = pier_ctx;

  if (!pier_isGroupOrRoom) {
    return [{ type: 'text', text: 'This only works in a group or multi-person chat.' }];
  }

  const pier_template = await pier_getLeaveTemplate(pier_env, pier_chatId);
  let pier_displayName = 'You';
  try {
    const pier_profile = await pier_getGroupMemberProfile(pier_chatId, pier_event.source.userId, pier_env);
    if (pier_profile?.displayName) pier_displayName = pier_profile.displayName;
  } catch (pier_err) {
    console.error('Profile lookup failed:', pier_err);
  }

  return [
    { type: 'text', text: pier_template.replace('{name}', pier_displayName) },
    { type: 'text', text: `Raw template for this group:\n${pier_template}` },
  ];
}
