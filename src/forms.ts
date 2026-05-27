import { Devvit } from '@devvit/public-api';
import type { Context } from '@devvit/public-api';
type FormOnSubmitEvent = { values: Record<string, unknown> };
import { getConfig } from './config.js';
import {
  getOrCreateUserRecord,
  getUserRecord,
  recalculateActiveStrikes,
  saveUserRecord,
  getAppealRecord,
  saveAppealRecord,
  removeFromPendingAppeals,
  saveOwnership,
  getOwnership,
  saveMyReview,
  removeMyReview,
  getMyReviews,
} from './storage.js';
import { submitAppeal, processAppealDecision } from './appeals.js';
import {
  buildAppealForgivenMessage,
  buildAppealUpheldMessage,
} from './messages.js';
import type { StrikeRecord, ModNote } from './types.js';

// ─── Form 0: Context View (read-only display) ────────────────────────────────

export const contextViewForm = Devvit.createForm(
  (data: Record<string, string>) => {
    // 3 compressed fields — maximum density, minimum vertical waste
    // paragraph respects \n so timeline renders as a real multi-line list
    type StrField = { type: 'string'; name: string; label: string; defaultValue: string };
    type ParaField = { type: 'paragraph'; name: string; label: string; defaultValue: string; lineHeight: number };
    const fields: (StrField | ParaField)[] = [
      {
        type: 'string' as const,
        name: 'status',
        label: 'Status',
        defaultValue: data['status'] ?? '',
      },
    ];

    if (data['risk']) {
      fields.push({ type: 'paragraph' as const, name: 'risk', label: '📋 Risk summary', defaultValue: data['risk'], lineHeight: 4 });
    }
    if (data['reviewer']) {
      fields.push({ type: 'string' as const, name: 'reviewer', label: '🔍 Investigation owner', defaultValue: data['reviewer'] });
    }
    if (data['mods']) {
      fields.push({ type: 'string' as const, name: 'mods', label: 'Moderator coordination', defaultValue: data['mods'] });
    }

    fields.push({
      type: 'paragraph' as const,
      name: 'timeline',
      label: 'Timeline',
      defaultValue: data['timeline'] ?? '',
      lineHeight: 6,
    });

    return {
      title: `u/${data['username'] ?? '?'}`,
      description: 'Moderation continuity record — Gavel',
      fields,
      acceptLabel: 'Close',
      cancelLabel: '',
    };
  },
  async (_event: FormOnSubmitEvent, _context: Context) => {
    // read-only
  }
);

// ─── Form 1: Log Event (Manual) ─────────────────────────────────────────────

export const manualStrikeForm = Devvit.createForm(
  (data: Record<string, string>) => ({
    title: `Log Moderation Event${data['username'] ? ` — u/${data['username']}` : ''}`,
    fields: [
      {
        type: 'string' as const,
        name: 'username',
        label: 'Username',
        required: true,
        defaultValue: data['username'] ?? '',
      },
      {
        type: 'paragraph' as const,
        name: 'reason',
        label: 'Reason for logging this event',
        required: true,
      },
      {
        type: 'select' as const,
        name: 'contentType',
        label: 'Content type',
        options: [
          { label: 'Post', value: 'post' },
          { label: 'Comment', value: 'comment' },
        ],
        required: true,
        multiSelect: false,
      },
      {
        type: 'boolean' as const,
        name: 'banUser',
        label: 'Ban this user',
        defaultValue: false,
      },
      {
        type: 'boolean' as const,
        name: 'muteUser',
        label: 'Mute this user',
        defaultValue: false,
      },
    ],
    acceptLabel: 'Log Event',
    cancelLabel: 'Cancel',
  }),
  async (event: FormOnSubmitEvent, context: Context) => {
    const { redis, ui, subredditId } = context;
    const subredditName = context.subredditName ?? '';
    const config = await getConfig(context);

    if (!config.enabled) {
      ui.showToast('Gavel is disabled.');
      return;
    }

    const username = ((event.values['username'] as string) ?? '').toLowerCase().trim();
    if (!username) {
      ui.showToast('Username is required.');
      return;
    }

    const reason = (event.values['reason'] as string) ?? '';
    const contentTypeVal = (event.values['contentType'] as string[]) ?? ['post'];
    const contentType = Array.isArray(contentTypeVal) ? contentTypeVal[0] : contentTypeVal;
    const shouldBan = event.values['banUser'] === true;
    const shouldMute = event.values['muteUser'] === true;

    const record = await getOrCreateUserRecord(redis, subredditId, subredditName, username);

    let mod: { username: string } | undefined | null;
    try {
      mod = await context.reddit.getCurrentUser();
    } catch { /* ignore */ }

    const strike: StrikeRecord = {
      id: `${subredditId}:${username}:${Date.now()}`,
      username,
      subredditId,
      subredditName,
      removedContentType: (contentType === 'comment' ? 'comment' : 'post') as 'post' | 'comment',
      removedContentId: 'manual',
      moderatorUsername: mod?.username ?? 'unknown',
      removalReason: reason,
      timestamp: new Date().toISOString(),
      cleared: false,
    };

    record.strikes.push(strike);
    if (record.strikes.length > 200) record.strikes = record.strikes.slice(-200);

    record.totalStrikeCount = record.strikes.length;
    record.activeStrikeCount = recalculateActiveStrikes(record, config.strikeExpiryDays);

    if (shouldBan && record.currentBanType !== 'permanent') {
      try {
        await context.reddit.banUser({
          subredditName,
          username,
          reason: `Gavel manual ban — ${reason.substring(0, 100)}`,
          note: `Manually banned by ${mod?.username ?? 'mod'} via Gavel.`,
        });
        record.currentBanType = 'permanent';
        record.currentBanExpiry = undefined;
        strike.actionTaken = 'permanent_ban';
      } catch (err) {
        console.error('[Gavel][manualStrike] Failed to ban user:', err);
        ui.showToast('Event logged but ban failed — check permissions.');
      }
    } else {
      strike.actionTaken = 'none';
    }

    if (shouldMute) {
      try {
        await context.reddit.muteUser({ username, subredditName });
      } catch (err) {
        console.error('[Gavel][manualStrike] Failed to mute user:', err);
      }
    }

    record.lastActionTimestamp = new Date().toISOString();
    await saveUserRecord(redis, record);

    const banMsg = shouldBan && record.currentBanType === 'permanent' ? ' User banned.' : '';
    const muteMsg = shouldMute ? ' User muted.' : '';
    ui.showToast(`Event logged. u/${username} — ${record.activeStrikeCount} active event(s).${banMsg}${muteMsg}`);
  }
);

// ─── Form 2: Clear Event ─────────────────────────────────────────────────────

export const clearStrikeForm = Devvit.createForm(
  (data: Record<string, string>) => ({
    title: `Clear Event${data['username'] ? ` — u/${data['username']}` : ''}`,
    fields: [
      {
        type: 'string' as const,
        name: 'username',
        label: 'Username',
        required: true,
        defaultValue: data['username'] ?? '',
      },
      {
        type: 'select' as const,
        name: 'clearType',
        label: 'Which events to clear?',
        options: [
          { label: 'Clear most recent event', value: 'last' },
          { label: 'Clear all events', value: 'all' },
        ],
        required: true,
        multiSelect: false,
      },
      {
        type: 'boolean' as const,
        name: 'unbanUser',
        label: 'Unban user if banned',
        defaultValue: false,
      },
      {
        type: 'boolean' as const,
        name: 'unmuteUser',
        label: 'Unmute user if muted',
        defaultValue: false,
      },
      {
        type: 'paragraph' as const,
        name: 'reason',
        label: 'Reason for clearing (optional)',
        required: false,
      },
    ],
    acceptLabel: 'Clear',
    cancelLabel: 'Cancel',
  }),
  async (event: FormOnSubmitEvent, context: Context) => {
    const { redis, ui, subredditId } = context;
    const subredditName = context.subredditName ?? '';
    const config = await getConfig(context);

    const username = ((event.values['username'] as string) ?? '').toLowerCase().trim();
    if (!username) {
      ui.showToast('Username is required.');
      return;
    }

    const record = await getUserRecord(redis, subredditId, username);
    if (!record) {
      ui.showToast(`No Gavel record found for u/${username}.`);
      return;
    }

    const clearTypeVal = (event.values['clearType'] as string[]) ?? ['last'];
    const clearType = Array.isArray(clearTypeVal) ? clearTypeVal[0] : clearTypeVal;
    const reason = (event.values['reason'] as string) ?? '';
    const shouldUnban = event.values['unbanUser'] === true;
    const shouldUnmute = event.values['unmuteUser'] === true;

    let mod: { username: string } | undefined | null;
    try {
      mod = await context.reddit.getCurrentUser();
    } catch { /* ignore */ }

    const now = new Date().toISOString();

    if (clearType === 'all') {
      for (const s of record.strikes) {
        if (!s.cleared) {
          s.cleared = true;
          s.clearedBy = mod?.username ?? 'moderator';
          s.clearedAt = now;
          s.clearedReason = reason || 'Cleared by moderator';
        }
      }
    } else {
      const last = [...record.strikes].reverse().find((s) => !s.cleared);
      if (last) {
        last.cleared = true;
        last.clearedBy = mod?.username ?? 'moderator';
        last.clearedAt = now;
        last.clearedReason = reason || 'Cleared by moderator';
      }
    }

    record.activeStrikeCount = recalculateActiveStrikes(record, config.strikeExpiryDays);

    // Lift ban only if mod toggled unban ON
    if (shouldUnban && record.currentBanType !== 'none') {
      try {
        await context.reddit.unbanUser(username, subredditName);
        record.currentBanType = 'none';
        record.currentBanExpiry = undefined;
        record.modNotes = [
          ...(record.modNotes ?? []),
          {
            id: `note:${context.subredditId}:${username}:${Date.now()}`,
            addedBy: mod?.username ?? 'moderator',
            note: `Ban lifted — all strikes cleared${reason ? `: ${reason}` : ''}`,
            timestamp: now,
          },
        ].slice(-50);
      } catch (err) {
        console.error('[Gavel][clearEvent] Failed to unban user:', err);
      }
    }

    await saveUserRecord(redis, record);

    if (shouldUnmute) {
      try {
        await context.reddit.unmuteUser(username, subredditName);
      } catch (err) {
        console.error('[Gavel][clearEvent] Failed to unmute user:', err);
      }
    }

    const unbanMsg = shouldUnban && record.currentBanType === 'none' ? ' Ban lifted.' : '';
    const unmuteMsg = shouldUnmute ? ' User unmuted.' : '';
    ui.showToast(`Cleared. u/${username} — ${record.activeStrikeCount} active event(s) remaining.${unbanMsg}${unmuteMsg}`);
  }
);

// ─── Form 3: Appeal (user-facing) ─────────────────────────────────────────────

export const appealForm = Devvit.createForm(
  {
    title: 'Appeal Moderation Action',
    fields: [
      {
        type: 'paragraph' as const,
        name: 'incorrectPart',
        label: 'What part of the moderation action do you believe was incorrect?',
        required: true,
        helpText: 'Maximum 500 characters.',
      },
      {
        type: 'paragraph' as const,
        name: 'context',
        label: 'Any additional context you\'d like to provide? (optional)',
        required: false,
        helpText: 'Maximum 500 characters.',
      },
    ],
    acceptLabel: 'Submit Appeal',
    cancelLabel: 'Cancel',
  },
  async (event: FormOnSubmitEvent, context: Context) => {
    await submitAppeal(event, context);
  }
);

// ─── Form 5: Appeals Queue (per-user flat layout) ─────────────────────────────
// userList = "user1,user2,..." (most recent first)
// appealN  = appeal text for slot N
// forgiveN = boolean toggle per slot (OFF=banned/uphold, ON=forgive)

export const appealsQueueForm = Devvit.createForm(
  (data: Record<string, string>) => {
    const users = (data['userList'] ?? '')
      .split(',').map((u) => u.trim()).filter(Boolean);

    type AnyField =
      | { type: 'string';   name: string; label: string; defaultValue: string }
      | { type: 'boolean';  name: string; label: string; defaultValue: boolean }
      | { type: 'paragraph'; name: string; label: string; defaultValue: string; lineHeight: number };

    const fields: AnyField[] = [
      { type: 'paragraph' as const, name: '__users', label: '(do not edit)', defaultValue: data['userList'] ?? '', lineHeight: 1 },
    ];
    for (let i = 0; i < users.length; i++) {
      const u = users[i];
      const appealText = data[`appeal${i}`] ?? '';
      fields.push({ type: 'string'  as const, name: `user${i}`,    label: `u/${u}`,              defaultValue: appealText });
      fields.push({ type: 'boolean' as const, name: `forgive${i}`, label: `Forgive u/${u}`,       defaultValue: false });
    }

    return {
      title: `⏳ Pending Appeals (${users.length})`,
      description: 'Toggle ON to forgive & unban. Leave OFF to uphold ban. Submit to action all.',
      fields,
      acceptLabel: 'Submit Decisions',
      cancelLabel: 'Close',
    };
  },
  async (event: FormOnSubmitEvent, context: Context) => {
    const { redis, reddit, ui, subredditId } = context;
    const subredditName = context.subredditName ?? '';

    const userListField = (event.values['__users'] as string) ?? '';
    const usernames = userListField.split(',').map((u) => u.trim()).filter(Boolean);

    if (usernames.length === 0) {
      ui.showToast('Could not identify users. Please retry.');
      return;
    }

    const config = await getConfig(context);
    let mod: Awaited<ReturnType<typeof reddit.getCurrentUser>> = undefined;
    try { mod = await reddit.getCurrentUser(); } catch { /* ignore */ }

    let forgiven = 0; let upheld = 0;
    for (let idx = 0; idx < usernames.length; idx++) {
      const username = usernames[idx].toLowerCase();
      const shouldForgive = event.values[`forgive${idx}`] === true;

      const record = await getUserRecord(redis, subredditId, username);
      const appeal = await getAppealRecord(redis, subredditId, username);
      if (!record || !appeal || appeal.status !== 'pending') continue;

      if (shouldForgive) {
        const strikeToClean = [...record.strikes].reverse().find((s) => !s.cleared);
        if (strikeToClean) {
          strikeToClean.cleared = true;
          strikeToClean.clearedBy = mod?.username ?? 'moderator';
          strikeToClean.clearedAt = new Date().toISOString();
          strikeToClean.clearedReason = 'Appeal approved';
        }
        record.activeStrikeCount = recalculateActiveStrikes(record, config.strikeExpiryDays);
        if (record.currentBanType !== 'none') {
          try {
            await reddit.unbanUser(username, subredditName);
            record.currentBanType = 'none';
            record.currentBanExpiry = undefined;
          } catch (err) { console.error('[Gavel][queue] Unban failed:', err); }
        }
        appeal.status = 'forgiven';
        try {
          const msg = buildAppealForgivenMessage(username, subredditName);
          await reddit.sendPrivateMessage({ to: username, subject: msg.subject, text: msg.body });
        } catch { /* ignore */ }
        forgiven++;
      } else {
        const lockUntil = new Date(Date.now() + config.appealLockDays * 86400000);
        record.appealLockedUntil = lockUntil.toISOString();
        appeal.status = 'upheld';
        try {
          const msg = buildAppealUpheldMessage(username, subredditName, config.appealLockDays);
          await reddit.sendPrivateMessage({ to: username, subject: msg.subject, text: msg.body });
        } catch { /* ignore */ }
        upheld++;
      }

      appeal.decidedBy = mod?.username ?? 'unknown';
      appeal.decidedAt = new Date().toISOString();
      record.appealPending = false;
      await saveAppealRecord(redis, appeal);
      await saveUserRecord(redis, record);
      await removeFromPendingAppeals(redis, subredditId, username);
    }

    ui.showToast(`Done — ${forgiven} forgiven, ${upheld} upheld.`);
  }
);

// ─── Form 6: Appeal Decision (legacy single-user, from Decide appeal menu item) ─────

export const appealDecisionForm = Devvit.createForm(
  (data: Record<string, string>) => ({
    title: `Appeal: u/${data['username'] ?? 'unknown'}`,
    description: data['appealSummary'] ? `[${data['appealSummary']}]` : 'Review and decide.',
    fields: [
      { type: 'string' as const, name: '_username', label: 'Username', defaultValue: data['username'] ?? '' },
      { type: 'string' as const, name: 'banStatus', label: 'Current status', defaultValue: data['banStatus'] ?? '' },
      { type: 'boolean' as const, name: 'forgive', label: 'Forgive — unban and clear last strike', defaultValue: data['isBanned'] === 'true' ? false : true },
      { type: 'paragraph' as const, name: 'modNote', label: 'Internal note (optional)', required: false },
    ],
    acceptLabel: 'Submit Decision',
    cancelLabel: 'Cancel',
  }),
  async (event: FormOnSubmitEvent, context: Context) => {
    await processAppealDecision(event, context);
  }
);

// ─── Form 7: Claim Review ───────────────────────────────────────────────────

export const claimReviewForm = Devvit.createForm(
  (data: Record<string, string>) => {
    type StrField = { type: 'string'; name: string; label: string; defaultValue: string };
    type ParaField = { type: 'paragraph'; name: string; label: string; required: boolean };
    const fields: (StrField | ParaField)[] = [
      { type: 'string' as const, name: 'username', label: 'Username', defaultValue: data['username'] ?? '' },
    ];
    if (data['currentReviewer']) {
      fields.unshift({ type: 'string' as const, name: 'currentReviewer', label: 'Already claimed by', defaultValue: data['currentReviewer'] });
    }
    fields.push({ type: 'paragraph' as const, name: 'note', label: 'Investigation note (optional)', required: false });
    return {
      title: `Claim Review — u/${data['username'] ?? '?'}`,
      fields,
      acceptLabel: 'Claim',
      cancelLabel: 'Cancel',
    };
  },
  async (event: FormOnSubmitEvent, context: Context) => {
    const { redis, ui, subredditId } = context;
    const subredditName = context.subredditName ?? '';
    const username = ((event.values['username'] as string) ?? '').toLowerCase().trim();
    if (!username) { ui.showToast('Username required.'); return; }
    let mod: { username: string } | undefined | null;
    try { mod = await context.reddit.getCurrentUser(); } catch { /* ignore */ }
    const note = (event.values['note'] as string) ?? '';
    const claimedBy = mod?.username ?? 'mod';
    const existing = await getOwnership(redis, subredditId, username);
    const rawClaimedBy = existing?.claimedBy;
    const currentClaimants: string[] = Array.isArray(rawClaimedBy) ? rawClaimedBy : (rawClaimedBy ? [rawClaimedBy as unknown as string] : []);
    if (!currentClaimants.includes(claimedBy)) currentClaimants.push(claimedBy);
    await saveOwnership(redis, {
      username,
      subredditId,
      claimedBy: currentClaimants,
      claimedAt: existing?.claimedAt ?? new Date().toISOString(),
      status: 'reviewing',
      note: note.substring(0, 100) || existing?.note || undefined,
    });
    await saveMyReview(redis, subredditId, claimedBy, username);
    ui.showToast(`Review claimed for u/${username}.`);
  }
);

// ─── Form 8: My Reviews Queue ────────────────────────────────────────────────

export const myReviewsForm = Devvit.createForm(
  (data: Record<string, string>) => {
    const users = (data['__users'] ?? '').split(',').map((u) => u.trim()).filter(Boolean);
    type StrField  = { type: 'string';  name: string; label: string; defaultValue: string };
    type BoolField = { type: 'boolean'; name: string; label: string; defaultValue: boolean };
    const fields: (StrField | BoolField)[] = [];
    for (let i = 0; i < users.length; i++) {
      const u = users[i];
      const info = data[`info${i}`] ? ` · ${data[`info${i}`]}` : '';
      fields.push({ type: 'boolean' as const, name: `keep__${u}`, label: `u/${u}${info}`, defaultValue: true });
    }
    return {
      title: `🔍 My Active Investigations (${users.length})`,
      description: 'Toggle OFF to release an investigation. Submit to save changes.',
      fields,
      acceptLabel: 'Save',
      cancelLabel: 'Close',
    };
  },
  async (event: FormOnSubmitEvent, context: Context) => {
    const { redis, ui, subredditId } = context;
    let mod: { username: string } | undefined | null;
    try { mod = await context.reddit.getCurrentUser(); } catch { /* ignore */ }
    const modUsername = mod?.username ?? '';
    if (!modUsername) { ui.showToast('Could not identify your account.'); return; }

    const keepKeys = Object.keys(event.values).filter((k) => k.startsWith('keep__'));
    let released = 0;
    for (const key of keepKeys) {
      const keep = event.values[key] === true;
      if (!keep) {
        const u = key.slice('keep__'.length);
        await removeMyReview(redis, subredditId, modUsername, u);
        const ownership = await getOwnership(redis, subredditId, u);
        if (ownership) {
          const cb = Array.isArray(ownership.claimedBy) ? ownership.claimedBy : (ownership.claimedBy ? [ownership.claimedBy as unknown as string] : []);
          ownership.claimedBy = cb.filter((m) => m !== modUsername);
          if (ownership.claimedBy.length === 0) ownership.status = 'resolved';
          await saveOwnership(redis, ownership);
        }
        released++;
      }
    }
    if (released > 0) {
      ui.showToast(`Released ${released} review${released !== 1 ? 's' : ''}.`);
    } else {
      ui.showToast('No changes made.');
    }
  }
);

// ─── Form 9: Add Mod Note ──────────────────────────────────────────────────────

export const addNoteForm = Devvit.createForm(
  (data: Record<string, string>) => ({
    title: `Add Note — u/${data['username'] ?? '?'}`,
    fields: [
      { type: 'string' as const, name: 'username', label: 'Username', required: true, defaultValue: data['username'] ?? '' },
      { type: 'paragraph' as const, name: 'note', label: 'Note', required: true },
    ],
    acceptLabel: 'Save Note',
    cancelLabel: 'Cancel',
  }),
  async (event: FormOnSubmitEvent, context: Context) => {
    const { redis, ui, subredditId } = context;
    const subredditName = context.subredditName ?? '';
    const username = ((event.values['username'] as string) ?? '').toLowerCase().trim();
    if (!username) { ui.showToast('Username required.'); return; }
    const note = ((event.values['note'] as string) ?? '').trim();
    if (!note) { ui.showToast('Note cannot be empty.'); return; }
    let mod: { username: string } | undefined | null;
    try { mod = await context.reddit.getCurrentUser(); } catch { /* ignore */ }
    const record = await getOrCreateUserRecord(redis, subredditId, subredditName, username);
    record.modNotes = [
      ...(record.modNotes ?? []),
      { id: `note:${subredditId}:${username}:${Date.now()}`, addedBy: mod?.username ?? 'mod', note: note.substring(0, 300), timestamp: new Date().toISOString() },
    ].slice(-50);
    record.lastActionTimestamp = new Date().toISOString();
    await saveUserRecord(redis, record);
    ui.showToast(`Note saved for u/${username}.`);
  }
);
