// LINE webhook entry point: signature verification, per-event dedup,
// event-type dispatch, and the text-message command pipeline.

import { pier_DEDUP_TTL_SECONDS } from './lib/pier_constants.js';
import { pier_verifySignature } from './lib/pier_security.js';
import { pier_getChatId, pier_addKnownGroup, pier_removeKnownGroup, pier_recordMessage, pier_scopedKey } from './lib/pier_kv.js';
import { pier_isBotAdmin } from './lib/pier_auth.js';
import { pier_buildMentionMessage } from './lib/pier_format.js';
import { pier_sendCombinedReply } from './lib/pier_line_api.js';
import { pier_buildSiderCalloutMessage } from './lib/pier_sider.js';

import { pier_handleMemberJoined } from './events/pier_member_joined.js';
import { pier_handleMemberLeft } from './events/pier_member_left.js';
import { pier_handleUnsendEvent } from './events/pier_unsend.js';
import { pier_handleStickerMessage, pier_matchStickerTrigger } from './events/pier_sticker_trigger.js';
import { pier_tryAdminPassphraseTrigger } from './events/pier_admin_passphrase.js';

import { pier_publicCommands, pier_adminCommands } from './commands/pier_registry.js';
import * as pier_whoamiToggle from './commands/admin/pier_whoami_toggle.js';

export async function pier_handleWebhook(pier_request, pier_env, pier_ctx) {
  const pier_rawBody = await pier_request.text();
  const pier_signature = pier_request.headers.get('x-line-signature') || '';

  const pier_valid = await pier_verifySignature(pier_rawBody, pier_signature, pier_env.LINE_CHANNEL_SECRET);
  if (!pier_valid) {
    return new Response('Invalid signature', { status: 401 });
  }

  const pier_payload = JSON.parse(pier_rawBody);
  const pier_events = pier_payload.events || [];

  // Handle events sequentially so replies go out before we return 200.
  for (const pier_event of pier_events) {
    try {
      if (await pier_isDuplicateEvent(pier_env, pier_event, pier_ctx)) {
        console.log('Skipping duplicate webhook event:', pier_event.webhookEventId);
        continue;
      }
      await pier_handleEvent(pier_event, pier_env);
    } catch (pier_err) {
      console.error('Error handling event:', pier_err);
    }
  }

  return new Response('OK', { status: 200 });
}

async function pier_isDuplicateEvent(pier_env, pier_event, pier_execCtx) {
  if (!pier_env.BOT_KV || !pier_event.webhookEventId) return false;
  const pier_key = `dedup:${pier_event.webhookEventId}`;
  const pier_seen = await pier_env.BOT_KV.get(pier_key);
  if (pier_seen) return true;
  const pier_markSeen = pier_env.BOT_KV.put(pier_key, '1', { expirationTtl: pier_DEDUP_TTL_SECONDS });
  if (pier_execCtx?.waitUntil) {
    pier_execCtx.waitUntil(pier_markSeen);
  } else {
    await pier_markSeen;
  }
  return false;
}

async function pier_handleEvent(pier_event, pier_env) {
  if (pier_event.type === 'message' && pier_event.message.type === 'text') {
    await pier_handleTextMessage(pier_event, pier_env);
    return;
  }

  if (pier_event.type === 'message' && pier_event.message.type === 'sticker') {
    await pier_handleStickerMessage(pier_event, pier_env);
    return;
  }

  if (pier_event.type === 'memberJoined') {
    await pier_handleMemberJoined(pier_event, pier_env);
    return;
  }

  if (pier_event.type === 'memberLeft') {
    await pier_handleMemberLeft(pier_event, pier_env);
    return;
  }

  // 'join' fires when the bot itself is added to a group/room — auto-
  // register it in the known_groups list. 'leave' fires when the bot is
  // removed from (or leaves) one — deregister it so the list stays
  // accurate. Both are bot-level events, distinct from memberJoined/
  // memberLeft (which are about *other* participants).
  if (pier_event.type === 'join') {
    const pier_chatId = pier_getChatId(pier_event.source);
    await pier_addKnownGroup(pier_env, pier_chatId, pier_event.source.type);
    return;
  }

  if (pier_event.type === 'leave') {
    const pier_chatId = pier_getChatId(pier_event.source);
    await pier_removeKnownGroup(pier_env, pier_chatId);
    return;
  }

  if (pier_event.type === 'unsend') {
    await pier_handleUnsendEvent(pier_event, pier_env);
    return;
  }

  // Other event types (follow, unfollow, etc.) are no-ops for now — add
  // handling here as needed.
}

// Used at the "no recognized command" exit points — folds in a sider
// callout (if one fires) alongside any already-pending extra messages
// (e.g. a level-up congrats) into a single free reply. If nothing ends up
// pending, the replyToken is simply left unused, which costs nothing.
async function pier_finalizeWithNoCommandReply(pier_event, pier_env, pier_chatId, pier_isGroupOrRoom, pier_extraMessages) {
  let pier_sider = null;
  if (pier_isGroupOrRoom) pier_sider = await pier_buildSiderCalloutMessage(pier_event, pier_env);
  const pier_combined = pier_sider ? [...pier_extraMessages, pier_sider] : pier_extraMessages;
  await pier_sendCombinedReply(pier_event.replyToken, [], pier_combined, pier_chatId, pier_env);
}

async function pier_handleTextMessage(pier_event, pier_env) {
  const pier_text = pier_event.message.text.trim();
  const pier_isGroupOrRoom = pier_event.source.type === 'group' || pier_event.source.type === 'room';
  const pier_chatId = pier_getChatId(pier_event.source);

  // DM-only admin self-add trigger — checked first, before anything else,
  // since it's a plain-text match rather than a "-" command (see that
  // file for why). No-ops immediately for any non-DM chat or non-matching
  // text, so this is a cheap check for the overwhelming majority of
  // messages.
  if (!pier_isGroupOrRoom) {
    const pier_triggered = await pier_tryAdminPassphraseTrigger(pier_event, pier_env);
    if (pier_triggered) return;
  }

  // Messages that would otherwise cost quota (level-up congrats, sider
  // callouts) get folded into this event's reply instead, since reply
  // messages are free and the replyToken would usually go unused
  // otherwise.
  const pier_extraMessages = [];

  // Auto-track this group/room on any activity, not just the 'join' event —
  // covers groups the bot was added to before tracking existed, with no
  // manual step needed. pier_addKnownGroup() no-ops if it's already tracked.
  //
  // These three checks touch independent KV keys (known_groups,
  // known_members:<chatId>, unsend_enabled:<chatId>) with no data
  // dependency between them, so they run concurrently — this used to run
  // as three sequential round trips on every single message, in every
  // group, regardless of which command (if any) was being run, adding
  // baseline latency ahead of every reply, public commands included.
  let pier_leveledUp = null;
  if (pier_isGroupOrRoom) {
    const [, pier_leveledUpResult, pier_unsendEnabled] = await Promise.all([
      pier_addKnownGroup(pier_env, pier_chatId, pier_event.source.type),
      pier_recordMessage(pier_env, pier_chatId, pier_event.source.userId),
      pier_env.BOT_KV ? pier_env.BOT_KV.get(pier_scopedKey('unsend_enabled', pier_chatId)) : Promise.resolve(null),
    ]);
    pier_leveledUp = pier_leveledUpResult;

    if (pier_leveledUp) {
      // Per-group toggle, default ON — -levelup off disables it.
      const pier_enabled = (await pier_env.BOT_KV.get(pier_scopedKey('levelup_enabled', pier_chatId))) !== '0';
      if (pier_enabled) {
        const { text: pier_lvlText, substitution: pier_lvlSubstitution } = pier_buildMentionMessage(
          `🎉 Congrats {mention}, you leveled up to Lv.${pier_leveledUp.newLevel}!`,
          [pier_leveledUp.userId]
        );
        pier_extraMessages.push({ type: 'textV2', text: pier_lvlText, substitution: pier_lvlSubstitution });
      }
    }

    // Per-group toggle, default OFF — see -unsend on/off. Only cache when
    // enabled, since this is a KV write on every single text message and
    // most groups won't want it. TTL slightly exceeds LINE's 24h unsend
    // window so a message is never missing from cache when its unsend
    // event actually arrives.
    if (pier_unsendEnabled === '1') {
      await pier_env.BOT_KV.put(
        `unsend_cache:${pier_event.message.id}`,
        JSON.stringify({ userId: pier_event.source.userId, text: pier_event.message.text }),
        { expirationTtl: 90000 }
      );
    }
  }

  const pier_ctx = {
    event: pier_event,
    env: pier_env,
    text: pier_text,
    chatId: pier_chatId,
    isGroupOrRoom: pier_isGroupOrRoom,
    extraMessages: pier_extraMessages,
  };

  // -whoami on/off is a global, owner-only switch, checked before every
  // other command (including public ones) — see pier_whoami_toggle.js.
  if (pier_whoamiToggle.pier_matches(pier_text)) {
    const pier_result = await pier_whoamiToggle.pier_handle(pier_ctx);
    if (pier_result === 'deny') {
      await pier_finalizeWithNoCommandReply(pier_event, pier_env, pier_chatId, pier_isGroupOrRoom, pier_extraMessages);
    }
    return;
  }

  // Public commands ('!' prefix) — open to everyone, no admin gate. Each
  // returns directly rather than falling through to the admin-only chain
  // below.
  for (const pier_cmd of pier_publicCommands) {
    if (pier_cmd.pier_matches(pier_text)) {
      await pier_cmd.pier_handle(pier_ctx);
      return;
    }
  }

  // Sticker keyword triggers — public, exact (case-insensitive) match
  // against the global trigger list (captured only in LINE_GROUP_ID, but
  // usable by anyone in any group/room). Checked after the named public
  // commands above so it never shadows them.
  if (pier_isGroupOrRoom && pier_env.BOT_KV) {
    const pier_stickerReply = await pier_matchStickerTrigger(pier_text, pier_env);
    if (pier_stickerReply) {
      await pier_sendCombinedReply(pier_event.replyToken, pier_extraMessages, [pier_stickerReply], pier_chatId, pier_env);
      return;
    }
  }

  // All remaining commands are admin-only — regular members get no
  // response at all to a "-" message, same as any unrecognized text.
  if (pier_text.startsWith('-')) {
    const pier_allowed = await pier_isBotAdmin(pier_env, pier_chatId, pier_event.source.userId);
    if (!pier_allowed) {
      await pier_finalizeWithNoCommandReply(pier_event, pier_env, pier_chatId, pier_isGroupOrRoom, pier_extraMessages);
      return;
    }
  }

  let pier_replyMessages = null;
  for (const pier_cmd of pier_adminCommands) {
    if (pier_cmd.pier_matches(pier_text)) {
      pier_replyMessages = await pier_cmd.pier_handle(pier_ctx);
      break;
    }
  }

  if (!pier_replyMessages) {
    await pier_finalizeWithNoCommandReply(pier_event, pier_env, pier_chatId, pier_isGroupOrRoom, pier_extraMessages);
    return; // not a recognized command, stay quiet
  }

  await pier_sendCombinedReply(pier_event.replyToken, pier_extraMessages, pier_replyMessages, pier_chatId, pier_env);
}
