// Coded by: Piererra Felldiaz
// Command registry — maps command modules for the text-message dispatcher
// in webhook.js. Each module exports pier_matches(text) and
// pier_handle(ctx). Order matters: it's checked in this order, matching
// the original bot's command chain.

import * as pier_whoami from './public/pier_whoami.js';
import * as pier_leaderboard from './public/pier_leaderboard.js';
import * as pier_setbirthday from './public/pier_setbirthday.js';
import * as pier_picture from './public/pier_picture.js';
import * as pier_help from './public/pier_help.js';

import * as pier_helpAdmin from './admin/pier_help.js';
import * as pier_testwelcome from './admin/pier_testwelcome.js';
import * as pier_testleavemsg from './admin/pier_testleavemsg.js';
import * as pier_setleavemsg from './admin/pier_setleavemsg.js';
import * as pier_setwelcome from './admin/pier_setwelcome.js';
import * as pier_siderToggle from './admin/pier_sider_toggle.js';
import * as pier_levelupToggle from './admin/pier_levelup_toggle.js';
import * as pier_unsendToggle from './admin/pier_unsend_toggle.js';
import * as pier_status from './admin/pier_status.js';
import * as pier_groups from './admin/pier_groups.js';
import * as pier_adminlist from './admin/pier_adminlist.js';
import * as pier_adminremove from './admin/pier_adminremove.js';
import * as pier_setadminpass from './admin/pier_setadminpass.js';
import * as pier_showadminpass from './admin/pier_showadminpass.js';
import * as pier_clearadminpass from './admin/pier_clearadminpass.js';

// Public ('!' prefix) commands — open to everyone, no admin gate. Each
// handler sends its own reply and the dispatcher returns immediately
// after a match.
export const pier_publicCommands = [pier_whoami, pier_leaderboard, pier_setbirthday, pier_picture, pier_help];

// Admin ('-' prefix) commands — only reachable after the isBotAdmin gate
// in webhook.js. Each handler returns a reply message array, folded into
// one combined reply at the end of the dispatch chain.
export const pier_adminCommands = [
  pier_helpAdmin,
  pier_testwelcome,
  pier_testleavemsg,
  pier_setleavemsg,
  pier_setwelcome,
  pier_siderToggle,
  pier_levelupToggle,
  pier_unsendToggle,
  pier_status,
  pier_groups,
  pier_adminlist,
  pier_adminremove,
  pier_setadminpass,
  pier_showadminpass,
  pier_clearadminpass,
];
