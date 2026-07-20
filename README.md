# line-chat-bot

A LINE Messaging API bot for the group chat. Runs on Cloudflare Workers —
same hosting pattern as the Discord bot.

## What it does

- Command system (see **Commands** below), split by prefix: `-` for
  admin-only commands, `!` for public ones anyone can use — gated by a
  bot-admin system since LINE group chats have no built-in admin/owner
  concept at all
- Welcomes new members when they join the group, tagging them with a
  real, tappable @mention, using a per-group customizable template
- Auto-tracks every group/room it's in (a `known_groups` list in KV) the
  moment it sees any activity there — a join, or anyone sending a
  message — so you can list them all — with real group names, not just
  ids — via `-groups` — see **Commands**
- Leaderboard (`!leaderboard`) showing the most active members in a
  group by weekly message count, plus a permanent level next to each
  name — scoped entirely per group (each group's counts are
  independent, never combined). Auto-posts to each group daily at
  00:00 WIB; the weekly message count resets every Monday at 00:00 WIB
  (that tick resets instead of posting) — levels never reset
- Levels — a permanent, never-resetting count of each member's total
  messages, shown on the leaderboard. Crossing a level threshold
  triggers an auto-congratulation mention in the group (toggle with
  `-levelup on` / `-levelup off`, per group, default on)
- Birthdays — anyone can set their own with `!setbirthday MM-DD` (no
  year stored). On their birthday, they're auto-mentioned with a happy
  birthday message in every group where they've set it
- Unsend detection — shows what a message said after someone unsends
  (recalls) it, per group (toggle with `-unsend on` / `-unsend off`,
  default off). Unlike everything else this bot does, this one spends
  real monthly message quota — the unsend webhook event carries no
  replyToken, so showing the recovered text has to go out as a push
- `!picture @name` — shows a tagged member's profile picture. LINE only
  hands the bot a tagged user's userId if that person separately
  consented to profile-info sharing, which most members never do — so
  this falls back to matching the raw `@Name` text against the group's
  own known_members list instead of relying on LINE's mention data alone
- `-status` — bot version, a live KV connectivity check, current monthly
  message quota usage, and current server time; Workers have no real
  "uptime" to report (no persistent process), so this is the meaningful
  equivalent
- Sticker triggers — fully automatic, no commands: an admin sends a
  sticker in the group set as `LINE_GROUP_ID`, and every one of that
  sticker's built-in keywords is silently registered as a trigger for
  it (completely silent — no reply, whether it's new or already saved).
  Resending a sticker fully replaces its keyword associations to match
  what LINE reports right now — added under any missing keyword,
  removed from any keyword it's no longer associated with — so
  resending is a safe way to fix a partial/lost save (e.g. from two
  different stickers being sent rapidly enough to race each other).
  Triggers are stored in one **global** list, shared by every group the
  bot is in — capture only happens in the designated group, but once a
  keyword is registered, anyone in any group can use it. A keyword can
  end up matching several stickers (each sticker has its own set of
  keywords, and different stickers can share one); when a message
  matches, the bot replies with one of the matching stickers at random,
  so multiple stickers on the same trigger don't always send the same
  one
- "Sider" gag feature — optional, toggleable random lurker callouts
- Every command reply is wrapped in a consistent boxed frame (matching
  header/footer bars), so menus, lists, and status messages all look
  tidy and uniform

## Project structure

The bot is split one file per concern rather than one large `index.js`.
Every file, exported function, and internal variable is prefixed `pier_`
throughout — that's a deliberate authorship signature, not a naming
convention forced by anything technical.

```
src/
  index.js              # entry point — fetch() and scheduled() handlers
  webhook.js             # signature verification, dedup, event-type
                          # dispatch, and the text-command pipeline
  lib/                    # shared helpers, no command-specific logic
    pier_constants.js      # shared constant values (templates, timeouts, keys)
    pier_time.js            # WIB date/time helpers
    pier_security.js        # webhook signature verification
    pier_line_api.js        # LINE Messaging API HTTP wrappers
    pier_kv.js               # KV-backed state (groups, members, settings)
    pier_format.js           # text/message formatting helpers
    pier_auth.js              # bot-admin / owner checks, !whoami toggle
    pier_sider.js              # "sider" callout gag feature
  events/                  # non-command webhook event handlers
    pier_member_joined.js
    pier_member_left.js
    pier_unsend.js
    pier_sticker_trigger.js
  scheduled/                # the daily cron job
    pier_daily_tasks.js       # birthdays + leaderboard reset/post
  commands/
    pier_registry.js          # maps command modules for the dispatcher
    public/                   # `!` commands — open to everyone
      pier_whoami.js, pier_leaderboard.js, pier_setbirthday.js,
      pier_picture.js, pier_help.js
    admin/                    # `-` commands — gated by isBotAdmin
      pier_whoami_toggle.js, pier_help.js, pier_testwelcome.js,
      pier_testleavemsg.js, pier_setleavemsg.js, pier_setwelcome.js,
      pier_sider_toggle.js, pier_levelup_toggle.js, pier_unsend_toggle.js,
      pier_status.js, pier_groups.js
tests/                    # see **Testing** below
```

Each command module exports `pier_matches(text)` and `pier_handle(ctx)` —
`webhook.js` loops through `commands/pier_registry.js` in order and calls
the first one that matches. Shared helpers in `lib/` have no knowledge of
any specific command; commands import from `lib/` and `events/`, never
the other way around.



Commands split by prefix: `-` is admin-only (gated by the bot-admin
system below), `!` is open to everyone. `-help` lists the admin
commands; `!help` lists only the public ones, so regular members never
even see that admin commands exist. Every reply is wrapped in a
consistent boxed frame, so menus and status/list output all look tidy
and uniform. Settings are scoped per group/room — each group the bot is
in has its own independent welcome message, leave message, sider
toggle, and level-up toggle.

| Command | Who | What |
|---|---|---|
| `!help` | anyone | lists public commands |
| `!whoami` | anyone (unless disabled) | shows your own userId |
| `!leaderboard [n]` | anyone | shows the top `n` (default 10) most active members this week, with each member's permanent level, for this group only; also auto-posted daily at 00:00 WIB — the weekly count resets every Monday at 00:00 WIB, levels don't |
| `!setbirthday MM-DD` | anyone | sets your own birthday (no year) for this group — triggers an auto-mention on the day |
| `!picture @name` | anyone | shows a tagged member's profile picture — groups only (not rooms/1:1); tag resolution can fail if LINE withholds the mentionee's userId, see **Features** |
| `-whoami on` / `-whoami off` | bot owner only | enables/disables the public `!whoami` command bot-wide, in every group |
| `-help` | admins | lists admin commands |
| `-testwelcome` | admins | previews the welcome message, tagging you, and also shows the raw template text |
| `-setwelcome <text>` | admins | sets the welcome template; use `{mention}` where the tag(s) should go |
| `-testleavemsg` | admins | previews the leave message, using your name, and also shows the raw template text |
| `-setleavemsg <text>` | admins | sets the leave template; use `{name}` (plain text, not a tag — the person's already left by the time this fires) |
| `-groups` | admins | lists every tracked group by name with a live member count (rooms show as "multi-person chat, no name" — LINE rooms have no name at all) |
| `-sider on` / `-sider off` | admins | toggles random lurker callouts — NOT real read-receipt detection (LINE gives bots no such signal); just a random chance + cooldown after qualifying messages |
| `-levelup on` / `-levelup off` | admins | toggles level-up congratulation messages for this group (default on) |
| `-unsend on` / `-unsend off` | admins | toggles showing a message's content after it's unsent, for this group (default off — spends monthly quota, see **Features**) |
| *(no command)* | admins | send a sticker in the group set as `LINE_GROUP_ID` to silently register it, globally for every group — see **Sticker triggers** above |
| `-status` | admins | bot version, live KV health check, monthly message quota usage, and current server time |

All commands are typed directly in the chat they apply to — there's no
separate rich menu or tap UI; every admin action that used to live on
one is now just a `-` command like everything else.

## Bot admin system

`OWNER_USER_ID` (a secret, see below) is the *only* source of admin
status — it can hold one or more comma-separated userIds, and everyone
listed is an admin, in every group, permanently (e.g. `OWNER_USER_ID =
Uabc...,Udef...`). There's no in-chat command to grant or list admins;
to add or remove one, edit the `OWNER_USER_ID` secret on the Cloudflare
worker directly (Settings → Variables and Secrets).

## Setup

### 1. LINE Developers Console

1. Go to [developers.line.biz](https://developers.line.biz), create a
   Provider, then a **Messaging API** channel under it.
2. Copy the **Channel Secret** (Basic settings tab) and issue a
   long-lived **Channel Access Token** (Messaging API tab).
3. In Messaging API settings:
   - Turn **off** the default auto-reply and greeting messages (so they
     don't clash with the bot)
   - Turn **on** "Allow bot to join group chats"
4. In the LINE Official Account Manager's Response settings, make sure
   **Webhooks** is toggled on (separate from "Use webhook" in the
   Developers Console — both need to be on).
5. Add the bot as a friend, then add it to the target group chat.
6. Deploy the bot first (see below), then send `!whoami` in the group
   for your own userId (needed for `OWNER_USER_ID`).

### 2. Cloudflare

1. Create a **KV namespace** (Workers & Pages → KV → Create) and paste
   its id into `wrangler.toml` under `kv_namespaces` (binding must stay
   `BOT_KV` to match the code).
2. Connect this GitHub repo under Workers & Pages → this worker →
   Settings → Builds, so pushes to `main` auto-deploy. (GitHub Actions
   only runs tests/lint for this repo — see **CI/CD** below — deploys are
   handled by Cloudflare's own integration, not duplicated in Actions.)
3. Set these as environment variables / secrets on the worker (Settings
   → Variables and Secrets):

   | Variable | Value |
   |---|---|
   | `LINE_CHANNEL_SECRET` | from step 1 |
   | `LINE_CHANNEL_ACCESS_TOKEN` | from step 1 |
   | `OWNER_USER_ID` | one or more comma-separated LINE userIds (get via `!whoami`) — always bot admins, everywhere |
   | `LINE_GROUP_ID` | (optional) the one group where an admin sending a sticker silently auto-registers its keywords as triggers, usable globally in every group — find this group's id via your Worker's logs (each webhook event includes `source.groupId`). Leave unset to disable sticker auto-capture everywhere |

4. Once deployed, copy the worker's URL and paste it into the LINE
   Developers Console's **Webhook URL** field, then hit **Verify**, then
   toggle **Use webhook** on.

## Working from Android (Termux, no PC)

This project is maintained entirely from an Android phone using
[Termux](https://f-droid.org/en/packages/com.termux/) — no computer
involved. Cloudflare auto-deploys on every push to GitHub (see
**Cloudflare** step 2 above), so pushing from Termux is the entire
deploy process.

### One-time setup

```bash
pkg update -y && pkg upgrade -y
pkg install unzip git -y
termux-setup-storage   # approve the storage permission prompt — needed
                        # to reach the Downloads folder at all
```

`wrangler`'s runtime dependency (`workerd`) has no prebuilt binary for
Android — its install script hard-fails there (not just a warning),
which aborts the *entire* `npm install`, taking `eslint`/`prettier`
down with it even though those are plain JS with no such problem. This
doesn't matter in practice: deploys run through Cloudflare's own build
pipeline (real Linux, no issue there), not `wrangler` on the phone. So
on Termux, always install with:

```bash
npm install --ignore-scripts
```

This skips native-binary-fetching steps for every package, not just
`workerd` — `eslint`/`prettier`/`node --test` all work fine afterward;
only `wrangler dev`/`wrangler deploy` won't function locally (expected
— a phone can't run a local dev server either way).

### Getting a new version of the code onto the phone

When a new `line-chat-bot-main.zip` lands in the Downloads folder
(e.g. saved from a chat with Claude), extract it straight into a
`line-chat-bot` folder:

```bash
cd ~
rm -rf line-chat-bot-main line-chat-bot
unzip /sdcard/Download/line-chat-bot-main.zip -d ~
mv line-chat-bot-main line-chat-bot
cd line-chat-bot
```

### Pushing to github.com/piererra/line-chat-bot

From inside `~/line-chat-bot` (one-time git identity setup, only needed
once per Termux install):

```bash
git config --global user.name "piererra"
git config --global user.email "piererra@users.noreply.github.com"
git config --global credential.helper store   # so the token below is
                                                # only ever entered once

git init
git remote add origin https://github.com/piererra/line-chat-bot.git
git add .
git commit -m "Update bot"
git branch -M main
git push -u origin main --force
```

`--force` is there because each re-extraction starts a brand-new local
repo (no shared history with the last push) — it overwrites whatever
is on GitHub with what's on the phone right now, which is exactly what
you want here. Skip `git remote add origin ...` on runs after the
first — it'll error with "remote origin already exists" if you keep
it, since it only needs to be set once per fresh `git init`.

The first `git push` asks for a username and password — GitHub no
longer accepts an account password here, so use a **Personal Access
Token** instead:

1. On the phone's browser, go to
   github.com/settings/tokens → **Generate new token (classic)** →
   tick the `repo` scope → **Generate token** → copy it.
2. When Termux prompts:
   - Username: `piererra`
   - Password: paste the token (not the GitHub password)

`credential.helper store` (set above) saves it after that first push,
so future pushes don't ask again. Once pushed, Cloudflare picks up the
new commit and redeploys automatically — nothing else to run.

## Testing

Tests use Node's built-in test runner (`node:test`) — no test framework
dependency to install or go stale.

```bash
npm install   # only needed once, or after devDependencies change — on
              # Termux use `npm install --ignore-scripts`, see the
              # Android setup section above
npm test
```

`tests/` mirrors `src/`: `pier_kv.test.mjs`, `pier_format.test.mjs`,
`pier_security.test.mjs`, and `pier_time.test.mjs` unit-test the pure
helper functions in `lib/`; `pier_webhook.test.mjs` is an integration
suite that sends signed, mocked LINE webhook payloads through the real
`pier_handleWebhook()` pipeline and asserts on what would have actually
been sent back to LINE (admin gating, the owner-only `-whoami` toggle,
webhook dedup, `!setbirthday` validation, etc.) — the same kind of check
used by hand throughout this project's early debugging, now permanent
and repeatable instead of a one-off script.

Add a new test alongside the file it covers when adding a command or
lib function — `tests/pier_test_helpers.mjs` has the shared mock KV and
signed-request builder so new integration tests don't need to
reimplement them.

## Linting & formatting

```bash
npm run lint           # ESLint — catches typos like a wrong env var name
                        # before they ever reach production
npm run format          # Prettier — auto-fixes style
npm run format:check    # Prettier — check only, no changes (used by CI)
```

`eslint.config.js` declares the handful of Workers runtime globals this
bot actually uses (`fetch`, `crypto`, `Response`, etc.) by hand, rather
than pulling in the `globals` package for that alone.

## CI/CD

`.github/workflows/ci.yml` runs on every push and pull request against
`main`: `npm test`, `npm run lint`, and `npm run format:check`.

Deploys are **not** handled by this workflow — this repo already has
Cloudflare's own native Git integration connected (Workers & Pages →
this worker → Settings → Builds), which redeploys on every push to
`main` on its own. Running a second, separate deploy from GitHub Actions
on top of that would deploy the same push twice, so Actions here is
scoped to tests/lint only. If that native integration is ever
disconnected, deploying goes back to running `npm run deploy` by hand
(or a deploy job can be added back to `ci.yml` — see this project's
history for a working version of that job).

## Notes

- Reply messages (command responses, welcome messages) don't count
  against LINE's monthly free message quota — only push, multicast,
  broadcast, and narrowcast messages do. Level-up congrats and sider
  callouts ride along on the same reply as whatever response is already
  going out for that message event, since a reply token is otherwise
  usually sitting unused — so they're free too now. Leave messages,
  birthday announcements, and the daily leaderboard post are still pushes
  and always will be: `memberLeft` events carry no reply token at all,
  and the cron-triggered ones aren't responding to a webhook event in the
  first place, so there's no free option available for either.
- `known_members` reads use a 30-second `cacheTtl` (Cloudflare's current
  minimum) rather than the 60-second default, since this key is written
  on every single group message — a write pattern KV's default edge
  cache handles badly. This shrinks, but doesn't eliminate, a small
  window where `!leaderboard`/`!picture`/etc. can show a slightly stale
  count right after a message increments it — KV is eventually
  consistent by design, and no cacheTtl setting makes it instant. If
  this ever needs to be truly real-time, the fix would be moving this
  counter to a Durable Object instead of KV.
- The `known_members` write path (`withKnownMembersLock`, despite the
  name) is a plain read-modify-write — no lock. It briefly used a
  short-lived KV lock to narrow the (rare, since this bot's traffic is a
  handful of people per group) chance of two same-instant writes
  clobbering each other, but that lock caused two real problems and was
  removed:
  1. It used `expirationTtl: 10` on the lock key, below Cloudflare KV's
     hard minimum of 60 — every `put()` threw a 400, meaning the lock
     (and the entire message-count write right after it, in the same
     try block) silently failed on every single message. Message counts
     looked permanently frozen because they never actually incremented.
  2. Fixing the TTL to 60 made the lock start actually working — which
     then caused a worse problem: several extra sequential KV
     round-trips on every message, and if a request ever got cut off
     mid-flight (LINE's webhook client dropping the connection before
     the Worker finished — visible in Cloudflare's dashboard as an
     outcome of `canceled`, no exception logged), the lock it had just
     acquired never got released, leaving every following message in
     that chat stuck retrying against a dead lock for up to 60 seconds
     — a cascading slowdown that pushed more requests toward also being
     cut off. Given how unlikely a true same-instant write is for this
     bot's actual traffic, that tradeoff wasn't worth it, so the lock was
     dropped entirely in favor of a plain, fast get-then-put.
