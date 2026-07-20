// !picture @name — anyone can look up another member's profile picture.
// Only works in groups (LINE's member-profile API is group-only — a
// multi-person room has no equivalent endpoint). See
// pier_resolveMentionedUserId() for why a tag can still fail to resolve.

import { pier_parseKnownMembers, pier_scopedKey } from '../../lib/pier_kv.js';
import { pier_resolveMentionedUserId } from '../../lib/pier_format.js';
import { pier_sendCombinedReply, pier_getGroupMemberProfile } from '../../lib/pier_line_api.js';

export function pier_matches(pier_text) {
  return pier_text === '!picture' || pier_text.startsWith('!picture ');
}

export async function pier_handle(pier_ctx) {
  const { event: pier_event, env: pier_env, chatId: pier_chatId, extraMessages: pier_extraMessages } = pier_ctx;

  if (pier_event.source.type !== 'group') {
    await pier_sendCombinedReply(
      pier_event.replyToken,
      pier_extraMessages,
      [{ type: 'text', text: 'This only works in a group (not a multi-person room or 1:1 chat).' }],
      pier_chatId,
      pier_env
    );
    return;
  }

  const pier_members = pier_env.BOT_KV
    ? pier_parseKnownMembers(await pier_env.BOT_KV.get(pier_scopedKey('known_members', pier_chatId), { cacheTtl: 30 }))
    : [];
  const pier_targetUserId = pier_resolveMentionedUserId(pier_event, pier_members);

  if (!pier_targetUserId) {
    await pier_sendCombinedReply(
      pier_event.replyToken,
      pier_extraMessages,
      [
        {
          type: 'text',
          text:
            'Usage: !picture @name — tag the member whose picture you want.\n' +
            "Couldn't identify that tag — either mention someone by their exact display name, or ask them to send any message first so the bot has seen them.",
        },
      ],
      pier_chatId,
      pier_env
    );
    return;
  }

  const pier_profile = await pier_getGroupMemberProfile(pier_chatId, pier_targetUserId, pier_env);
  if (!pier_profile?.pictureUrl) {
    await pier_sendCombinedReply(
      pier_event.replyToken,
      pier_extraMessages,
      [{ type: 'text', text: "That user has no profile picture set, or they're no longer in this group." }],
      pier_chatId,
      pier_env
    );
    return;
  }

  await pier_sendCombinedReply(
    pier_event.replyToken,
    pier_extraMessages,
    [{ type: 'image', originalContentUrl: pier_profile.pictureUrl, previewImageUrl: pier_profile.pictureUrl }],
    pier_chatId,
    pier_env
  );
}
