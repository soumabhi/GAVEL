# AGENTS.md — Gavel
# Moderation Continuity Infrastructure for Reddit
# Hackathon: Reddit Mod Tools & Migrated Apps — Deadline May 27, 2026 6:00 PM PDT
# Prizes targeting: $10,000 New Mod Tool + $10,000 Moderator's Choice

> READ THIS ENTIRE FILE BEFORE WRITING ONE LINE OF CODE.
> Every decision in this file is intentional. Do not deviate without a documented reason.

---

## 0. THE ONE-SENTENCE MISSION

**Gavel gives every Reddit mod team a shared institutional memory of rule violations,
a consistent escalation ladder, and a structured appeal system — reducing moderation
inconsistency and unstructured modmail volume.**

---

## 1. WHAT GAVEL IS (AND IS NOT)

### What it IS
- A **moderation continuity system**: tracks violations across time, per user, per subreddit
- A **progressive discipline engine**: warns → temp bans → perm bans at mod-configured thresholds
- A **structured appeal workflow**: replaces chaotic modmail with a form-based, one-click decision flow
- A **visibility tool**: right-click any user to instantly surface their full enforcement history
- An **opt-in, reversible, auditable** system — mods are always in control

### What it is NOT
- ❌ Not an AI moderator or content classifier
- ❌ Not a spam/bot detection engine (that is Bot Bouncer's domain)
- ❌ Not a queue manager or kanban board (that is Mod Triage Board's domain)
- ❌ Not a replacement for Reddit's modqueue or AutoModerator
- ❌ Not an autonomous enforcement agent — humans decide, Gavel remembers and suggests

### The core insight
Reddit moderation teams currently track repeat offenders in spreadsheets, Discord channels,
or moderator memory. When a mod leaves, that knowledge disappears. When a new mod joins,
they have no context. Gavel solves institutional memory loss.

---

## 2. VERIFIED TECH STACK (MAY 2026)

```
Platform:          Reddit Devvit (Blocks-style app, no Web/React frontend)
Runtime:           Devvit app — TypeScript, QuickJS VM, ES2020 modules
Package:           @devvit/public-api ^0.12.23   ← VERIFIED LATEST (npm, May 2026)
CLI:               devvit ^0.12.22               ← VERIFIED LATEST (npm, May 2026)
Language:          TypeScript 5.3+ strict mode
Node requirement:  20+ (LTS) for devvit CLI
Build:             tsc (TypeScript compiler, bundler moduleResolution)
Dev command:       devvit playtest <subreddit>
Upload command:    devvit upload
Publish command:   devvit publish
Storage:           Devvit Redis (context.redis) — ZERO external dependencies
```

### Critical version note
The original AGENTS.md used `^0.11.0` — that version is OUTDATED. Devvit is now on
`0.12.x`. API shapes, trigger signatures, and Redis methods may differ. Always verify
against `https://developers.reddit.com/docs` and `https://developers.reddit.com/docs/changelog`
before finalizing any method call.

### Dependency rule
**Zero external npm dependencies beyond `@devvit/public-api`.** No axios, fetch to
external URLs, firebase, mongodb, or any third-party library. Everything lives in
Devvit Redis. This is both a technical constraint and a judging-criteria selling point
("reliable UX", "works at scale", "launch-ready").

---

## 3. COMPLETE FILE STRUCTURE

Generate ALL of these files. Do not skip any. Do not add files not listed here.

```
gavel/
├── AGENTS.md              ← this file (do not modify during build)
├── README.md              ← Devpost submission content (see Section 15)
├── package.json
├── devvit.yaml
├── tsconfig.json
└── src/
    ├── main.ts            ← entry point: Devvit.configure + wire all handlers
    ├── types.ts           ← all TypeScript interfaces, enums, DEFAULT_CONFIG
    ├── storage.ts         ← all Redis CRUD, key patterns, error handling
    ├── config.ts          ← app settings schema, getConfig, saveConfig
    ├── discipline.ts      ← enforcement engine: threshold check → action → message
    ├── triggers.ts        ← onModAction handler (the core event trigger)
    ├── menuItems.ts       ← all Devvit.addMenuItem() calls
    ├── forms.ts           ← all Devvit.createForm() definitions + handlers
    ├── appeals.ts         ← appeal submit + mod Forgive/Uphold logic
    └── messages.ts        ← modmail/PM templates with variable substitution
```

---

## 4. TYPES — src/types.ts

Define these interfaces EXACTLY. All other files import from here. No deviations.

```typescript
// ─── Strike & User Records ────────────────────────────────────────────────────

export interface StrikeRecord {
  id: string;                       // `${subredditId}:${username}:${Date.now()}`
  username: string;                 // always lowercase
  subredditId: string;
  subredditName: string;
  removedContentType: 'post' | 'comment' | 'manual';
  removedContentId: string;         // post/comment id, or 'manual' for manual strikes
  removedContentTitle?: string;     // first 100 chars of title or comment body
  moderatorUsername: string;        // who triggered this strike
  removalReason?: string;           // from event.details or manual entry
  timestamp: string;                // ISO 8601
  cleared: boolean;                 // was this strike pardoned?
  clearedBy?: string;
  clearedAt?: string;
  clearedReason?: string;
}

export interface UserRecord {
  username: string;                 // always lowercase
  subredditId: string;
  strikes: StrikeRecord[];          // max 200; trim oldest when over limit
  activeStrikeCount: number;        // non-cleared, non-expired strikes
  totalStrikeCount: number;         // all-time total (including cleared)
  currentBanType: 'none' | 'temp' | 'permanent';
  currentBanExpiry?: string;        // ISO 8601; only for temp bans
  lastActionTimestamp?: string;     // ISO 8601
  appealPending: boolean;
  lastAppealTimestamp?: string;
  appealLockedUntil?: string;       // ISO 8601; set when an appeal is upheld
}

export interface AppealRecord {
  id: string;                       // `appeal:${subredditId}:${username}:${Date.now()}`
  username: string;
  subredditId: string;
  subredditName: string;
  strikeId: string;                 // most recent active strike id
  appealedActionType: 'warning' | 'temp_ban' | 'permanent_ban';
  userStatement: string;            // why they think it was wrong
  userContext: string;              // additional context (optional)
  submittedAt: string;              // ISO 8601
  status: 'pending' | 'upheld' | 'forgiven';
  decidedBy?: string;               // mod username
  decidedAt?: string;               // ISO 8601
  modNote?: string;                 // internal mod note on decision
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface DisciplineThreshold {
  strikeCount: number;
  action: 'warning' | 'temp_ban' | 'permanent_ban';
  banDurationDays?: number;         // only for temp_ban
}

export interface GavelConfig {
  enabled: boolean;                 // master on/off switch
  observationMode: boolean;         // log actions but do NOT execute them
  thresholds: DisciplineThreshold[];
  warningMessageTemplate: string;
  tempBanMessageTemplate: string;
  permBanMessageTemplate: string;
  appealAllowed: boolean;
  appealLockDays: number;           // days a user cannot re-appeal after upheld
  trackRemovals: boolean;           // auto-log strikes on mod removals
  strikeExpiryDays: number;         // 0 = never expire
}

export const DEFAULT_CONFIG: GavelConfig = {
  enabled: true,
  observationMode: false,
  thresholds: [
    { strikeCount: 1, action: 'warning' },
    { strikeCount: 2, action: 'temp_ban', banDurationDays: 3 },
    { strikeCount: 3, action: 'permanent_ban' },
  ],
  warningMessageTemplate:
    `Hi u/{username},\n\nA moderator removed your recent {contentType} from r/{subredditName}.\n\n` +
    `**Reason:** {removalReason}\n\n` +
    `This is your **Strike {strikeCount}** (warning). Another violation may result in a temporary ban.\n\n` +
    `If you believe this was an error: {appealLink}\n\n— The r/{subredditName} mod team`,
  tempBanMessageTemplate:
    `Hi u/{username},\n\nYou have been issued a **{banDays}-day temporary ban** from r/{subredditName}.\n\n` +
    `**Reason:** {strikeCount} rule violations recorded by Gavel.\n\n` +
    `Ban expires: {banExpiry}\n\n` +
    `To appeal: {appealLink}\n\n— The r/{subredditName} mod team`,
  permBanMessageTemplate:
    `Hi u/{username},\n\nYou have been **permanently banned** from r/{subredditName}.\n\n` +
    `**Reason:** {strikeCount} rule violations recorded by Gavel.\n\n` +
    `To appeal: {appealLink}\n\n— The r/{subredditName} mod team`,
  appealAllowed: true,
  appealLockDays: 30,
  trackRemovals: true,
  strikeExpiryDays: 0,
};
```

---

## 5. REDIS KEY SCHEMA — src/storage.ts

### Key patterns (never deviate)

```
gavel:user:{subredditId}:{username_lowercase}     → JSON UserRecord
gavel:appeal:{subredditId}:{username_lowercase}   → JSON AppealRecord
gavel:config:{subredditId}                        → JSON GavelConfig
gavel:pending:{subredditId}                       → JSON string[] of usernames (pending appeals)
gavel:debounce:{subredditId}:{username}           → "1" with 10-second TTL (Unix expiry timestamp)
gavel:obs:{subredditId}                           → JSON ObservationLog[] (last 50 observation events)
```

### Functions to implement (all async, all must handle errors gracefully)

```typescript
// Returns null if key missing or JSON parse fails — NEVER throws
getUserRecord(redis, subredditId: string, username: string): Promise<UserRecord | null>

// Saves record; trims strikes array to 200 max (remove oldest first)
saveUserRecord(redis, record: UserRecord): Promise<void>

// Gets existing record OR creates fresh one with zero counts
getOrCreateUserRecord(
  redis,
  subredditId: string,
  subredditName: string,
  username: string
): Promise<UserRecord>

// Counts non-cleared strikes; if strikeExpiryDays > 0, skips strikes older than N days
recalculateActiveStrikes(record: UserRecord, strikeExpiryDays: number): number

// Returns null if key missing
getAppealRecord(redis, subredditId: string, username: string): Promise<AppealRecord | null>

saveAppealRecord(redis, appeal: AppealRecord): Promise<void>

// Adds username to pending list; deduplicates (do not double-add)
addToPendingAppeals(redis, subredditId: string, username: string): Promise<void>

// Removes username from pending list; safe if not present
removeFromPendingAppeals(redis, subredditId: string, username: string): Promise<void>

// Returns [] if key missing or parse fails
getPendingAppeals(redis, subredditId: string): Promise<string[]>

// Appends observation event; trims log to last 50 entries
appendObservationLog(
  redis,
  subredditId: string,
  event: { username: string; wouldHaveAction: string; timestamp: string; reason: string }
): Promise<void>

// Returns [] if key missing
getObservationLog(redis, subredditId: string): Promise<ObservationLogEntry[]>
```

### Error handling rules (non-negotiable)

- Every Redis call wrapped in `try/catch`
- Missing key → return `null` or `[]`, never throw
- JSON parse error → `console.error('[Gavel][storage] parse error:', err)`, return null
- Write failure → log to console, fail silently (do NOT crash the trigger)
- Never let any storage error propagate to a trigger or menu handler

---

## 6. CONFIG — src/config.ts

### App settings fields (Devvit.addSettings)

Define as `SettingsFormField[]`, export as `settingsFields`:

| name             | type    | label                                    | default |
|------------------|---------|------------------------------------------|---------|
| enabled          | boolean | "Enable Gavel"                           | true    |
| observationMode  | boolean | "Observation Mode (log only, no actions)"| false   |
| trackRemovals    | boolean | "Auto-track removals as strikes"         | true    |
| strike1Count     | number  | "Warning threshold (strikes)"            | 1       |
| strike2Count     | number  | "Temp ban threshold (strikes)"           | 2       |
| tempBanDays      | number  | "Temp ban duration (days)"               | 3       |
| strike3Count     | number  | "Perm ban threshold (strikes)"           | 3       |
| appealAllowed    | boolean | "Allow ban appeals"                      | true    |
| appealLockDays   | number  | "Re-appeal lockout after uphold (days)"  | 30      |
| strikeExpiryDays | number  | "Strike expiry in days (0 = never)"      | 0       |

### Functions

```typescript
// Read from context.settings, merge with DEFAULT_CONFIG for any missing fields
getConfig(context: TriggerContext | MenuItemOnPressEvent): Promise<GavelConfig>

// Converts raw settings object → GavelConfig struct
settingsToConfig(settings: Record<string, SettingValue>): GavelConfig
```

### Config reading pattern — ALWAYS use this

```typescript
// Never trust settings values are valid numbers; always guard
const s1 = Math.max(1, Number(settings['strike1Count'] ?? 1));
const s2 = Math.max(2, Number(settings['strike2Count'] ?? 2));
const s3 = Math.max(3, Number(settings['strike3Count'] ?? 3));
const tempDays = Math.max(1, Number(settings['tempBanDays'] ?? 3));
```

---

## 7. MESSAGES — src/messages.ts

### Template variable substitution

All message templates use `{variable}` syntax. The `fillTemplate()` function replaces:

| Placeholder         | Value                                                  |
|---------------------|--------------------------------------------------------|
| `{username}`        | lowercase username                                     |
| `{subredditName}`   | subreddit name without r/                              |
| `{contentType}`     | "post" or "comment"                                    |
| `{removalReason}`   | reason string or "No reason provided"                  |
| `{strikeCount}`     | current activeStrikeCount                              |
| `{strikesUntilBan}` | strikes until next threshold                           |
| `{banDays}`         | temp ban duration in days                              |
| `{banExpiry}`       | human-readable date string of ban expiry               |
| `{appealLink}`      | structured appeal URL (see below)                      |

### Appeal link format

```
https://www.reddit.com/message/compose?to=r%2F{subredditName}&subject=Gavel+Appeal&message=APPEAL_REQUEST:{username}
```

### Functions to implement

```typescript
buildWarningMessage(
  config: GavelConfig,
  record: UserRecord,
  strike: StrikeRecord,
  nextBanThreshold: number
): { subject: string; body: string }

buildTempBanMessage(
  config: GavelConfig,
  record: UserRecord,
  strike: StrikeRecord,
  banDays: number
): { subject: string; body: string }

buildPermBanMessage(
  config: GavelConfig,
  record: UserRecord,
  strike: StrikeRecord
): { subject: string; body: string }

buildAppealConfirmationMessage(
  username: string,
  subredditName: string
): { subject: string; body: string }

buildAppealForgivenMessage(
  username: string,
  subredditName: string
): { subject: string; body: string }

buildAppealUpheldMessage(
  username: string,
  subredditName: string,
  lockDays: number
): { subject: string; body: string }

// Returns a multi-line formatted string for toasts and mod review
formatUserHistoryText(record: UserRecord): string

// Returns compact observation mode summary for toast display
formatObservationSummary(log: ObservationLogEntry[]): string
```

---

## 8. DISCIPLINE ENGINE — src/discipline.ts

This is the core enforcement brain. Called after every strike is written.

### Complete algorithm

```
function applyDiscipline(context, config, record, strike):

  1. Recalculate record.activeStrikeCount via recalculateActiveStrikes()

  2. If config.observationMode === true:
     - Build action string ("would warn" / "would temp ban 3d" / "would perm ban")
     - Append to observation log via appendObservationLog()
     - Show toast to triggering mod (if available): "[Observation] Would have: {action}"
     - Save record (strikes still recorded in observation mode)
     - RETURN — do not execute any Reddit API action

  3. Sort config.thresholds descending by strikeCount

  4. Find first threshold where threshold.strikeCount <= record.activeStrikeCount
     If none found → save record and return (no action yet, e.g. below threshold)

  5. Determine action: 'warning' | 'temp_ban' | 'permanent_ban'

  6. Safety guards (MUST check before ANY action):
     - if !config.enabled → return
     - if record.currentBanType === 'permanent' → skip ban, still send message
     - NEVER ban the app's own account username
     - Wrap ALL reddit.* calls in try/catch with console.error logging

  7. For 'warning':
     - Build message: buildWarningMessage(config, record, strike, nextThreshold)
     - try: await context.reddit.sendPrivateMessage({ to: username, subject, text: body })
     - record.lastActionTimestamp = new Date().toISOString()

  8. For 'temp_ban':
     - If record.currentBanType is already 'temp' or 'permanent' → skip ban, still message
     - try: await context.reddit.banUser({
         subredditName: record.subredditName,
         username: record.username,
         duration: banDays,          // integer days
         reason: `Gavel: Strike ${record.activeStrikeCount}`,
         note: `Auto-issued by Gavel. Strike ID: ${strike.id}`,
         message: body,
       })
     - record.currentBanType = 'temp'
     - record.currentBanExpiry = new Date(Date.now() + banDays*86400000).toISOString()
     - Build and send PM: buildTempBanMessage(...)

  9. For 'permanent_ban':
     - If record.currentBanType === 'permanent' → skip ban, still message
     - try: await context.reddit.banUser({
         subredditName: record.subredditName,
         username: record.username,
         reason: `Gavel: Strike ${record.activeStrikeCount} — permanent`,
         note: `Auto-issued by Gavel. Strike ID: ${strike.id}`,
         message: body,
       })
     - record.currentBanType = 'permanent'
     - Build and send PM: buildPermBanMessage(...)

  10. record.lastActionTimestamp = new Date().toISOString()
  11. await saveUserRecord(redis, record)
```

### Safety rules (non-negotiable)

- NEVER ban if `currentBanType === 'permanent'` (already banned — skip)
- NEVER ban the app's own account (check `event.moderator?.name === appUsername`)
- NEVER execute discipline if `config.enabled === false`
- ALWAYS wrap `context.reddit.banUser()`, `context.reddit.unbanUser()`,
  and `context.reddit.sendPrivateMessage()` in `try/catch`
- Log every error: `console.error('[Gavel][discipline]', err)`
- A failed ban must never crash the trigger handler

---

## 9. TRIGGERS — src/triggers.ts

### ModAction handler

```typescript
export async function handleModAction(
  event: ModAction,
  context: TriggerContext
): Promise<void>
```

### Step-by-step logic

```
1. If event.action NOT in ['removelink', 'removecomment'] → return immediately

2. Get config (getConfig). If !config.enabled || !config.trackRemovals → return

3. Get targetUsername: event.targetUser?.name
   If !targetUsername || targetUsername === '[deleted]' → return

4. Get subredditName: event.subreddit?.name
   Get subredditId: context.subredditId (from TriggerContext)

5. Get app's own username:
   try { const me = await context.reddit.getCurrentUser(); appUsername = me?.username }
   catch { appUsername = undefined }
   If event.moderator?.name === appUsername → return (prevent self-trigger loop)

6. Normalize: const username = targetUsername.toLowerCase()

7. Debounce check (prevent double-fire on same removal):
   const debounceKey = `gavel:debounce:${subredditId}:${username}`
   const existing = await context.redis.get(debounceKey)
   if (existing) → return
   // Set with 10-second TTL using Unix timestamp
   const expiresAt = Math.floor(Date.now() / 1000) + 10
   await context.redis.set(debounceKey, '1', { expiration: expiresAt })

8. Get or create UserRecord:
   const record = await getOrCreateUserRecord(redis, subredditId, subredditName, username)

9. Build StrikeRecord:
   const strikeId = `${subredditId}:${username}:${Date.now()}`
   const contentType = event.action === 'removelink' ? 'post' : 'comment'
   const contentId = event.targetPost?.id ?? event.targetComment?.id ?? 'unknown'
   const contentTitle = (
     event.targetPost?.title ?? event.targetComment?.body ?? ''
   ).substring(0, 100)
   const strike: StrikeRecord = {
     id: strikeId,
     username,
     subredditId,
     subredditName,
     removedContentType: contentType,
     removedContentId: contentId,
     removedContentTitle: contentTitle,
     moderatorUsername: event.moderator?.name ?? 'unknown',
     removalReason: event.details ?? '',
     timestamp: new Date().toISOString(),
     cleared: false,
   }

10. Push strike: record.strikes.push(strike)
    Trim to 200: if (record.strikes.length > 200) record.strikes = record.strikes.slice(-200)

11. record.totalStrikeCount = record.strikes.length
    record.activeStrikeCount = recalculateActiveStrikes(record, config.strikeExpiryDays)

12. await applyDiscipline(context, config, record, strike)
    (applyDiscipline handles its own record save)
```

### Event fields reference (verified against Devvit 0.12.x)

```typescript
event.action          // 'removelink' | 'removecomment' | 'banuser' | etc.
event.targetUser?.name         // string | undefined
event.moderator?.name          // string | undefined
event.targetPost?.id           // string | undefined
event.targetPost?.title        // string | undefined
event.targetComment?.id        // string | undefined
event.targetComment?.body      // string | undefined
event.subreddit?.name          // string | undefined
event.details                  // string | undefined (removal reason)
context.subredditId            // string (always available in TriggerContext)
context.subredditName          // string (always available)
context.redis                  // RedisClient
context.reddit                 // RedditAPIClient
```

---

## 10. MENU ITEMS — src/menuItems.ts

Export a single `registerMenuItems()` function called from main.ts.

### All six menu items

```typescript
// 1. View strike history — mods only, available on post/comment/subreddit
Devvit.addMenuItem({
  label: 'Gavel: View history',
  location: ['post', 'comment', 'subreddit'],
  forUserType: 'moderator',
  onPress: async (event, context) => {
    // Extract username from event.targetUser?.name
    //   or event.targetPost?.authorName
    //   or event.targetComment?.authorName
    // Fetch UserRecord
    // If null: context.ui.showToast(`u/${username} has no Gavel history`)
    // If found: context.ui.showToast(formatUserHistoryText(record))
    // Also: console.log('[Gavel] History:', JSON.stringify(record, null, 2))
  }
})

// 2. Add manual strike — mods only, post/comment/subreddit
Devvit.addMenuItem({
  label: 'Gavel: Add strike',
  location: ['post', 'comment', 'subreddit'],
  forUserType: 'moderator',
  onPress: async (event, context) => {
    // Extract username from event
    // context.ui.showForm(manualStrikeForm, { username })
  }
})

// 3. Clear strike — mods only
Devvit.addMenuItem({
  label: 'Gavel: Clear strike',
  location: ['post', 'comment', 'subreddit'],
  forUserType: 'moderator',
  onPress: async (event, context) => {
    // Extract username from event
    // context.ui.showForm(clearStrikeForm, { username })
  }
})

// 4. View pending appeals — subreddit level, mods only
Devvit.addMenuItem({
  label: 'Gavel: Pending appeals',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (event, context) => {
    // pending = await getPendingAppeals(redis, subredditId)
    // if empty: showToast('No pending appeals')
    // else: showToast(`${pending.length} pending: ${pending.slice(0,3).join(', ')}...`)
  }
})

// 5. Review a user's appeal — mods only
Devvit.addMenuItem({
  label: 'Gavel: Review appeal',
  location: ['post', 'comment', 'subreddit'],
  forUserType: 'moderator',
  onPress: async (event, context) => {
    // Extract username from event
    // appeal = await getAppealRecord(redis, subredditId, username)
    // if !appeal || appeal.status !== 'pending': showToast('No pending appeal')
    // else: context.ui.showForm(appealDecisionForm, { username, appealSummary: appeal.userStatement.substring(0, 200) })
  }
})

// 6. Appeal my ban — all logged-in users, subreddit level
Devvit.addMenuItem({
  label: 'Gavel: Appeal my ban',
  location: 'subreddit',
  forUserType: 'loggedIn',
  onPress: async (event, context) => {
    // config = await getConfig(context)
    // if !config.appealAllowed: showToast('Appeals are not enabled for this community')
    // else: context.ui.showForm(appealForm)
  }
})
```

---

## 11. FORMS — src/forms.ts

### Form 1: manualStrikeForm

```
Fields:
  username    : string (required) — pre-populated from menu event
  reason      : paragraph (required) — "Why is this strike being added?"
  contentType : select ['post', 'comment'] (required)

Handler:
  1. Get config; if !config.enabled: showToast('Gavel is disabled') return
  2. Get or create UserRecord
  3. Build StrikeRecord (removedContentType = 'manual', removedContentId = 'manual')
  4. Push strike, update counts
  5. applyDiscipline(context, config, record, strike)
  6. showToast(`Strike added. u/${username} now has ${record.activeStrikeCount} active strike(s).`)
```

### Form 2: clearStrikeForm

```
Fields:
  username  : string (required) — pre-populated
  clearType : select ['last', 'all'] (required) — "Clear last strike or all strikes?"
  reason    : paragraph (optional) — "Reason for clearing"

Handler:
  1. Fetch UserRecord; if null: showToast(`No record for u/${username}`) return
  2. If clearType === 'all':
       mark every non-cleared strike as cleared with clearedBy/clearedAt/clearedReason
  3. If clearType === 'last':
       find the most recent non-cleared strike by timestamp, mark cleared
  4. Recalculate activeStrikeCount
  5. Save record
  6. showToast(`Cleared. u/${username} now has ${record.activeStrikeCount} active strike(s).`)
```

### Form 3: appealForm (user-facing)

```
Fields:
  incorrectPart : paragraph (required, max 500 chars)
                  Label: "What part of the moderation action do you believe was incorrect?"
  context       : paragraph (optional, max 500 chars)
                  Label: "Any additional context you'd like to provide?"

Handler: calls submitAppeal(event, context) from appeals.ts
```

### Form 4: appealDecisionForm (mod-facing)

```
Dynamic — receives { username, appealSummary } as form data

Title:       "Appeal: u/{username}"
Description: First 200 chars of user's statement

Fields:
  decision : select ['forgiven', 'upheld'] (required)
             Labels: "Forgive — clear last strike and unban" / "Uphold — ban stands"
  modNote  : paragraph (optional) — "Internal note (not shown to user)"

Handler: calls processAppealDecision(event, context) from appeals.ts

IMPORTANT: Before showing this form, store username:
  (context as any)._gavelAppealUsername = username
  Then read it back in the handler.
```

---

## 12. APPEALS — src/appeals.ts

### submitAppeal(event, context)

```
1. Get current user: const me = await context.reddit.getCurrentUser()
   If !me: showToast('Could not identify your account') return

2. const username = me.username.toLowerCase()

3. Get config; if !config.appealAllowed: showToast('Appeals are not enabled') return

4. Get UserRecord; if null: showToast('No moderation record found for your account') return

5. Check appeal lock:
   if (record.appealLockedUntil) {
     const lockDate = new Date(record.appealLockedUntil)
     if (Date.now() < lockDate.getTime()) {
       showToast(`Appeals locked until ${lockDate.toDateString()}`) return
     }
   }

6. Check pending: if record.appealPending: showToast('You already have a pending appeal') return

7. Get form values from event.values:
   const userStatement = event.values.incorrectPart as string
   const userContext = event.values.context as string ?? ''

8. Find most recent active (non-cleared) strike for strikeId

9. Build AppealRecord:
   {
     id: `appeal:${subredditId}:${username}:${Date.now()}`,
     username,
     subredditId,
     subredditName: context.subredditName,
     strikeId: lastActiveStrike?.id ?? 'unknown',
     appealedActionType: record.currentBanType === 'permanent' ? 'permanent_ban'
                       : record.currentBanType === 'temp' ? 'temp_ban' : 'warning',
     userStatement,
     userContext,
     submittedAt: new Date().toISOString(),
     status: 'pending',
   }

10. record.appealPending = true
    record.lastAppealTimestamp = new Date().toISOString()

11. await saveAppealRecord(redis, appeal)
    await saveUserRecord(redis, record)
    await addToPendingAppeals(redis, subredditId, username)

12. Send confirmation PM to user: buildAppealConfirmationMessage(username, subredditName)
    try { await context.reddit.sendPrivateMessage({ to: username, ...msg }) } catch {}

13. Notify subreddit modmail:
    try {
      await context.reddit.modMail.createModInboxConversation({
        subredditName: context.subredditName,
        subject: `[Gavel Appeal] u/${username}`,
        bodyMarkdown: `u/${username} has submitted a ban appeal.\n\nStatement: ${userStatement.substring(0, 300)}\n\nUse "Gavel: Review appeal" from their post or profile context menu.`,
      })
    } catch (e) {
      console.error('[Gavel][appeals] modmail failed:', e)
      // Fallback: try sendPrivateMessage to r/subredditName
    }

14. showToast('Appeal submitted. Moderators have been notified.')
```

### processAppealDecision(event, context)

```
1. const username = ((context as any)._gavelAppealUsername as string)?.toLowerCase()
   if (!username): showToast('Error: could not identify appeal user') return

2. Get config, UserRecord, AppealRecord
   If any null: showToast('Error: record not found') return

3. Get mod username: const mod = await context.reddit.getCurrentUser()

4. const decision = event.values.decision as 'forgiven' | 'upheld'
   const modNote = event.values.modNote as string ?? ''

5. If decision === 'forgiven':
   a. Find most recent non-cleared strike, mark cleared (clearedBy = mod.username, clearedAt = now)
   b. record.activeStrikeCount = recalculateActiveStrikes(record, config.strikeExpiryDays)
   c. If record.currentBanType is 'temp' or 'permanent':
      try { await context.reddit.unbanUser({ subredditName, username }) } catch (e) { log }
      record.currentBanType = 'none'
      record.currentBanExpiry = undefined
   d. appeal.status = 'forgiven'
   e. Send forgiven message to user: buildAppealForgivenMessage(username, subredditName)
   f. showToast(`Appeal forgiven. u/${username} unbanned and strike cleared.`)

6. If decision === 'upheld':
   a. Set appeal lock: const lockUntil = new Date(Date.now() + config.appealLockDays * 86400000)
      record.appealLockedUntil = lockUntil.toISOString()
   b. appeal.status = 'upheld'
   c. Send upheld message: buildAppealUpheldMessage(username, subredditName, config.appealLockDays)
   d. showToast(`Appeal upheld. u/${username} remains banned.`)

7. appeal.decidedBy = mod?.username ?? 'unknown'
   appeal.decidedAt = new Date().toISOString()
   appeal.modNote = modNote

8. record.appealPending = false

9. await saveAppealRecord(redis, appeal)
   await saveUserRecord(redis, record)
   await removeFromPendingAppeals(redis, subredditId, username)
```

---

## 13. OBSERVATION MODE — Additional implementation notes

Observation Mode is Gavel's most important trust feature. When enabled:

- Every discipline trigger is **logged** but **not executed**
- Strikes are still recorded (so history builds up accurately)
- A toast appears to any logged-in mod: `[Observation] Would have warned u/${username}`
- The observation log (Redis key `gavel:obs:{subredditId}`) accumulates events
- Mods can view the log via the "Gavel: Pending appeals" menu → add observation summary

### Why this is critical for judges
The hackathon criteria explicitly includes "reliable UX" and "easy to install and configure."
Observation Mode lets mods **see Gavel's behavior before committing** — this directly
addresses moderator fear of automation and false positives. Bot Bouncer does the same
thing with its "filter" mode and that is a major reason it has 7,600+ installs.

### Observation log entry type

```typescript
export interface ObservationLogEntry {
  username: string;
  wouldHaveAction: 'warning' | 'temp_ban' | 'permanent_ban';
  banDays?: number;
  activeStrikeCount: number;
  strikeId: string;
  timestamp: string;
  subredditName: string;
}
```

---

## 14. ENTRY POINT — src/main.ts

```typescript
import Devvit from '@devvit/public-api';
import { handleModAction } from './triggers.js';
import { registerMenuItems } from './menuItems.js';
import {
  manualStrikeForm,
  clearStrikeForm,
  appealForm,
  appealDecisionForm,
} from './forms.js';
import { settingsFields } from './config.js';

Devvit.configure({
  redditAPI: true,
  redis: true,
});

Devvit.addSettings(settingsFields);

Devvit.addForm(manualStrikeForm);
Devvit.addForm(clearStrikeForm);
Devvit.addForm(appealForm);
Devvit.addForm(appealDecisionForm);

registerMenuItems();

Devvit.addTrigger({
  event: 'ModAction',
  onEvent: async (event, context) => {
    try {
      await handleModAction(event, context);
    } catch (err) {
      console.error('[Gavel] Unhandled error in ModAction trigger:', err);
    }
  },
});

Devvit.addTrigger({
  event: 'AppInstall',
  onEvent: async (_event, context) => {
    console.log(`[Gavel] Installed in r/${context.subredditName} (${context.subredditId})`);
  },
});

export default Devvit;
```

---

## 15. CONFIG FILES

### devvit.yaml

```yaml
name: gavel
version: 1.0.0
slug: gavel
description: "Moderation continuity — strike tracking, progressive discipline, structured appeals."

permissions:
  - reddit.read
  - reddit.write
  - reddit.mod.ban
  - reddit.mod.read
  - reddit.mod.modmail
  - reddit.mod.usernotes
```

### package.json

```json
{
  "name": "gavel",
  "version": "1.0.0",
  "description": "Consistent moderation enforcement — strike tracking, progressive discipline, structured appeals",
  "main": "dist/main.js",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "devvit playtest",
    "upload": "devvit upload",
    "publish": "devvit publish",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@devvit/public-api": "^0.12.23"
  },
  "devDependencies": {
    "typescript": "^5.3.0"
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "moduleResolution": "bundler",
    "lib": ["ES2020"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

## 16. README.md — Devpost submission content

The README must contain these sections verbatim for the Devpost form fields:

### Tool Overview

Gavel is a moderation continuity system for Reddit subreddits. It automatically tracks
rule violations as strikes, escalates enforcement through configurable warning → temp ban
→ perm ban thresholds, and handles ban appeals through a structured form flow — giving
mod teams shared institutional memory and consistent enforcement regardless of which
moderator is online.

**Core features:**
- **Strike tracking**: every post or comment removal automatically logs a strike in
  subreddit-scoped Redis storage. Strikes persist across the entire mod team.
- **Progressive discipline**: warn at Strike 1, temp ban at Strike 2, perm ban at Strike 3.
  All thresholds are configurable in App Settings.
- **Observation Mode**: Gavel logs what it *would* have done without executing any action.
  Mod teams can verify accuracy before enabling live enforcement.
- **Structured appeal flow**: banned users receive a modmail with an appeal link. They
  fill a structured form. Mods see a summary and click Forgive or Uphold — no back-and-forth.
- **User history menu**: right-click any user, post, or comment to see strike count, ban
  status, and appeal history without leaving the page.
- **Works on install**: default settings are sensible and require zero configuration.

### Project Impact

**r/worldnews (31M members)**
Their mod team of 50+ volunteers currently tracks repeat offenders mentally or via private
spreadsheets. Enforcement is inconsistent: a user banned by one mod may not be recognized
by another. Gavel creates a shared institutional memory for the entire team automatically.

**r/learnprogramming (4.8M members)**
Receives thousands of posts per week. New mods frequently make inconsistent decisions on
repeat offenders because they have no visible history. Gavel surfaces that history in a
single right-click, making new mod onboarding dramatically faster.

**r/personalfinance (18M members)**
Runs a zero-tolerance policy on financial misinformation. Manual ban tracking across a
large mod team creates gaps. Gavel's progressive discipline ensures repeat offenders are
automatically escalated, protecting vulnerable community members.

---

## 17. BUILD & TEST SEQUENCE

Execute these steps in order. Do not skip any.

### Step 1 — Install CLI and authenticate

```bash
npm install -g devvit        # installs CLI 0.12.22
devvit --version             # verify: should print 0.12.x
devvit login                 # opens browser OAuth flow — complete it
```

### Step 2 — Scaffold and replace

```bash
devvit new gavel --template empty
cd gavel
# Delete all generated src/ content
# Place files from this spec into src/
npm install
```

### Step 3 — Type-check (zero errors required before proceeding)

```bash
npm run typecheck
# Fix every TypeScript error before moving to Step 4
# Do not proceed with any type errors outstanding
```

### Step 4 — Create test subreddit

```
1. Go to reddit.com → Create Community
2. Name: gaveltest (or any private name you control)
3. Set to Private
4. Add yourself as moderator (you already are as creator)
5. Create a second test Reddit account for the "victim" role
```

### Step 5 — Playtest

```bash
devvit playtest gaveltest
# Hot-reloads on save
# Open r/gaveltest in browser to interact with the app
# Install the app: r/gaveltest → Mod Tools → Installed Apps → Add app
```

### Step 6 — Test the complete flow (all steps must pass)

```
TEST A — Auto strike + warning:
1. Post something as test account (not mod account)
2. Remove that post as mod
3. Right-click author → "Gavel: View history" → must show Strike 1
4. Check modmail or PM → warning message must arrive

TEST B — Second strike + temp ban:
5. Post again as test account
6. Remove as mod
7. Verify: "Gavel: View history" shows Strike 2
8. Verify: test account receives temp ban notification PM
9. Verify: test account is actually banned from r/gaveltest

TEST C — Appeal flow:
10. As test account: click appeal link in ban PM
11. Fill in appeal form → submit
12. As mod: right-click test user → "Gavel: Review appeal"
13. Appeal form opens with user's statement
14. Click "Forgive"
15. Verify: test account is unbanned
16. Verify: Strike 2 is marked cleared in history

TEST D — Observation Mode:
17. In App Settings, enable Observation Mode
18. Remove another post from test account
19. Verify: NO ban is issued
20. Verify: "Gavel: View history" shows the observation event was logged
21. Disable Observation Mode

TEST E — Manual strike + clear:
22. Right-click test user → "Gavel: Add strike" → fill form → submit
23. Verify: strike appears in history
24. Right-click test user → "Gavel: Clear strike" → clear last
25. Verify: activeStrikeCount decreases
```

### Step 7 — Upload

```bash
devvit upload
# App appears at developers.reddit.com/apps/gavel
```

---

## 18. ANTI-PATTERNS — NEVER DO THESE

| DO NOT | DO INSTEAD |
|--------|-----------|
| Use `fetch()` to external URLs | Use only Devvit Redis and reddit API |
| Auto-ban based on posts in other subs | Only act on removals in THIS subreddit |
| Call `reddit.banUser()` without try/catch | Always wrap in try/catch |
| Log sensitive user data to console | Log only usernames, action types, error names |
| Use `localStorage` or browser APIs | N/A — Devvit Blocks has no browser context |
| Use `setTimeout` for delays | Use Devvit scheduler if timing is needed |
| Throw unhandled errors in triggers | Always catch at the trigger level in main.ts |
| Use the phrase "ban bot" in README or listing | Use "progressive discipline automation" |
| Default auto-discipline to enabled | default is `enabled: true` but `observationMode: false` — mods opt into live enforcement by verifying obs mode first |
| Assume event fields are non-null | Use optional chaining (`event.targetUser?.name`) everywhere |
| Store more than 200 strikes per user | Trim strikes array to 200, oldest first |
| Double-ban a permanently banned user | Check `record.currentBanType === 'permanent'` before calling banUser |
| Build AI content classification | Gavel does not classify content — it tracks human mod decisions |

---

## 19. API METHOD REFERENCE

Verify every method against `https://developers.reddit.com/docs` before finalizing.
These are the Devvit 0.12.x shapes as of May 2026:

```typescript
// ─── Moderation ───────────────────────────────────────────────────────────────

// Ban a user
await context.reddit.banUser({
  subredditName: string,
  username: string,
  duration?: number,       // integer days; omit for permanent ban
  reason?: string,         // visible in mod log (max ~300 chars)
  note?: string,           // internal mod note
  message?: string,        // PM sent to user on ban
})

// Unban a user
await context.reddit.unbanUser({
  subredditName: string,
  username: string,
})

// ─── Messaging ────────────────────────────────────────────────────────────────

// Send a private message to a user
await context.reddit.sendPrivateMessage({
  to: string,              // username (no u/ prefix)
  subject: string,
  text: string,            // markdown body
})

// Create a modmail conversation
await context.reddit.modMail.createModInboxConversation({
  subredditName: string,
  subject: string,
  bodyMarkdown: string,
})

// ─── User ─────────────────────────────────────────────────────────────────────

// Get the currently authenticated app account (or current user in menu context)
const user = await context.reddit.getCurrentUser()
// Returns: { username: string, ... } | undefined

// ─── Redis ────────────────────────────────────────────────────────────────────

// Get a value — returns string | null
const val = await context.redis.get(key: string)

// Set a value — optional expiration as Unix timestamp (seconds)
await context.redis.set(key: string, value: string, options?: { expiration?: number })

// Delete a key
await context.redis.del(key: string)

// ─── UI ───────────────────────────────────────────────────────────────────────

context.ui.showToast(message: string)
context.ui.showToast({ text: string, appearance?: 'neutral' | 'success' })
context.ui.showForm(form: FormKey, data?: Record<string, unknown>)

// ─── Context fields ───────────────────────────────────────────────────────────

context.subredditId        // string — always available in TriggerContext
context.subredditName      // string — always available
context.userId             // string | undefined — logged-in user ID
context.reddit             // RedditAPIClient
context.redis              // RedisClient
context.ui                 // UIClient (available in menu/form handlers)
context.settings           // SettingsClient
```

If any method signature above does not match the live docs, **adapt to the current docs
immediately**. Do not code against this file; verify against the changelog at
`https://developers.reddit.com/docs/changelog`.

---

## 20. FRAMING — EXACT LANGUAGE FOR JUDGES

Use these framings everywhere: Devpost form, README, app listing, demo video.

| NEVER say | ALWAYS say |
|-----------|-----------|
| "auto-ban bot" | "mod-configured progressive discipline automation" |
| "bans users automatically" | "escalates enforcement according to thresholds set by the mod team" |
| "tracks bad actors" | "creates institutional moderation memory so teams enforce consistently" |
| "AI moderation" | "structured enforcement workflow with moderator oversight" |
| "replaces moderators" | "assists moderators with continuity and context" |

**One-sentence pitch for judges:**
> "Gavel automates the enforcement ladder every subreddit already has but currently
> tracks manually — giving mod teams consistent, transparent, configurable discipline
> with a structured appeal system that reduces modmail volume while improving fairness."

**Observation Mode pitch:**
> "Before enforcing a single ban, Gavel runs in Observation Mode — showing moderators
> exactly what it would have done, so teams can calibrate thresholds with confidence."

---

## 21. SUBMISSION CHECKLIST — DO NOT SKIP ANY ITEM

- [ ] All 10 source files generated and pass `tsc --noEmit` with zero errors
- [ ] All 5 test flows in Section 17 Step 6 pass manually
- [ ] App uploaded: `devvit upload` succeeds
- [ ] App listing live at `developers.reddit.com/apps/gavel`
- [ ] App listing has: description, at least 2 screenshots, correct permissions listed
- [ ] App version in devvit.yaml and package.json is `1.0.0` (not `0.1.0`)
- [ ] README.md contains Tool Overview and Project Impact sections (Section 16)
- [ ] Devpost submission created at `mod-tools-migration.devpost.com`
- [ ] Devpost fields completed: App listing URL, Reddit username, Tool Overview, Project Impact, Category = "New Mod Tool"
- [ ] Demo video recorded (2–3 minutes): shows auto-strike → discipline → appeal → forgive flow
- [ ] Optional: Feedback survey completed (separate $200 prize opportunity)
- [ ] Post in r/Devvit linking to the app for community visibility
- [ ] Submitted before **May 27, 2026 at 6:00 PM PDT** — target submission by noon PDT

---

## 22. COMPETITIVE CONTEXT (DO NOT OVERBUILD)

After deep ecosystem research, here is what Gavel must NOT become:

| Temptation | Why it kills Gavel |
|------------|-------------------|
| Add bot detection | Bot Bouncer owns this; entering their lane loses differentiation |
| Build full queue management | Mod Triage Board owns this |
| Add AI content review | AI Moderator exists; adds trust risk and complexity |
| Clone Comment Mop / Remove Macro | Saturated; loses focus |
| Build 20-feature dashboard | Cognitive overload; mods uninstall |

Gavel's moat is exactly and only:

```
strike memory + escalation + appeals + reversibility + observation mode
```

That is the complete product. Ship that to a high standard. Nothing more.

---

## 23. PRODUCT PHILOSOPHY (READ BEFORE WRITING ANY CODE)

1. **Reduce moderator friction** — every feature must reduce clicks or mental load
2. **Preserve moderator agency** — humans decide; Gavel remembers and suggests
3. **Prioritize visibility** over automation — mods must always know what happened and why
4. **Prefer explainability** — no hidden scoring, no opaque AI reasoning
5. **Keep workflows reversible** — every action can be undone (clear strike, forgive appeal)
6. **Stay auditable** — every action is logged with who did it and when
7. **Trust through observation** — Observation Mode is not optional; it is the onboarding flow

**The single most important lesson from the ecosystem:**
The apps that reached 5,000–7,000+ communities are boring in concept but elite in
operational execution. Comment Mop, Remove Macro, Admin Tattler — they compress painful
workflows dramatically and do exactly what they say they will do. Gavel wins the same way:
one workflow, done extremely well, extremely reliably.

---

*End of AGENTS.md — version 2.0 — verified May 21, 2026*
*@devvit/public-api: 0.12.23 | devvit CLI: 0.12.22 | TypeScript: 5.3+ | Node: 20+*
