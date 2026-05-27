import type { Context } from '@devvit/public-api';
type FormOnSubmitEvent = { values: Record<string, unknown> };
import { getConfig } from './config.js';
import {
  getUserRecord,
  saveUserRecord,
  getAppealRecord,
  saveAppealRecord,
  addToPendingAppeals,
  removeFromPendingAppeals,
  recalculateActiveStrikes,
} from './storage.js';
import type { AppealRecord } from './types.js';
import {
  buildAppealConfirmationMessage,
  buildAppealForgivenMessage,
  buildAppealUpheldMessage,
} from './messages.js';

// ─── Submit Appeal (user-facing) ──────────────────────────────────────────────

export async function submitAppeal(
  event: FormOnSubmitEvent,
  context: Context
): Promise<void> {
  const { redis, reddit, ui, subredditId } = context;
  const subredditName = context.subredditName ?? '';

  let meUser: Awaited<ReturnType<typeof reddit.getCurrentUser>>;
  try {
    meUser = await reddit.getCurrentUser();
  } catch (err) {
    console.error('[Gavel][appeals] getCurrentUser failed:', err);
    ui.showToast('Could not identify your account. Please try again.');
    return;
  }
  if (!meUser) {
    ui.showToast('Could not identify your account. Please try again.');
    return;
  }

  const username = meUser.username.toLowerCase();
  const config = await getConfig(context);

  if (!config.appealAllowed) {
    ui.showToast('Appeals are not enabled for this community.');
    return;
  }

  const record = await getUserRecord(redis, subredditId, username);
  if (!record) {
    ui.showToast('No moderation record found for your account in this community.');
    return;
  }

  if (record.appealLockedUntil) {
    const lockDate = new Date(record.appealLockedUntil);
    if (Date.now() < lockDate.getTime()) {
      ui.showToast(`Appeals locked until ${lockDate.toDateString()}.`);
      return;
    }
  }

  if (record.appealPending) {
    ui.showToast('You already have a pending appeal.');
    return;
  }

  const userStatement = (event.values['incorrectPart'] as string) ?? '';
  const userContext = (event.values['context'] as string) ?? '';

  if (!userStatement.trim()) {
    ui.showToast('Please describe what you believe was incorrect.');
    return;
  }

  const lastActiveStrike = [...record.strikes]
    .reverse()
    .find((s) => !s.cleared);

  const appealedActionType =
    record.currentBanType === 'permanent'
      ? 'permanent_ban'
      : record.currentBanType === 'temp'
      ? 'temp_ban'
      : 'warning';

  const appeal: AppealRecord = {
    id: `appeal:${subredditId}:${username}:${Date.now()}`,
    username,
    subredditId,
    subredditName,
    strikeId: lastActiveStrike?.id ?? 'unknown',
    appealedActionType,
    userStatement: userStatement.substring(0, 500),
    userContext: userContext.substring(0, 500),
    submittedAt: new Date().toISOString(),
    status: 'pending',
  };

  record.appealPending = true;
  record.lastAppealTimestamp = new Date().toISOString();

  await saveAppealRecord(redis, appeal);
  await saveUserRecord(redis, record);
  await addToPendingAppeals(redis, subredditId, username);

  const confirmMsg = buildAppealConfirmationMessage(username, subredditName);
  try {
    await reddit.sendPrivateMessage({
      to: username,
      subject: confirmMsg.subject,
      text: confirmMsg.body,
    });
  } catch (err) {
    console.error('[Gavel][appeals] Confirmation PM failed:', err);
  }

  try {
    await reddit.modMail.createModInboxConversation({
      subredditId,
      subject: `[Gavel Appeal] u/${username}`,
      bodyMarkdown:
        `u/${username} has submitted a ban appeal.\n\n` +
        `**Statement:** ${userStatement.substring(0, 300)}\n\n` +
        `Use "Gavel: Review appeal" from their post or profile context menu.`,
    });
  } catch (err) {
    console.error('[Gavel][appeals] Modmail notification failed:', err);
  }

  ui.showToast('Appeal submitted. Moderators have been notified.');
}

// ─── Process Appeal Decision (mod-facing) ────────────────────────────────────

export async function processAppealDecision(
  event: FormOnSubmitEvent,
  context: Context
): Promise<void> {
  const { redis, reddit, ui, subredditId } = context;
  const subredditName = context.subredditName ?? '';

  const username = ((event.values['_username'] as string) ?? '').toLowerCase().trim();
  if (!username) {
    ui.showToast('Error: could not identify appeal user. Please try again.');
    return;
  }

  const config = await getConfig(context);
  const record = await getUserRecord(redis, subredditId, username);
  const appeal = await getAppealRecord(redis, subredditId, username);

  if (!record || !appeal) {
    ui.showToast('Error: record not found.');
    return;
  }

  let mod: Awaited<ReturnType<typeof reddit.getCurrentUser>> = undefined;
  try {
    mod = await reddit.getCurrentUser();
  } catch (err) {
    console.error('[Gavel][appeals] getCurrentUser (mod) failed:', err);
  }

  const forgive = event.values['forgive'] === true;
  const modNote = (event.values['modNote'] as string) ?? '';
  const decision: 'forgiven' | 'upheld' = forgive ? 'forgiven' : 'upheld';

  if (decision === 'forgiven') {
    const strikeToClean = [...record.strikes].reverse().find((s) => !s.cleared);
    if (strikeToClean) {
      strikeToClean.cleared = true;
      strikeToClean.clearedBy = mod?.username ?? 'moderator';
      strikeToClean.clearedAt = new Date().toISOString();
      strikeToClean.clearedReason = 'Appeal approved';
    }

    record.activeStrikeCount = recalculateActiveStrikes(record, config.strikeExpiryDays);

    if (record.currentBanType === 'temp' || record.currentBanType === 'permanent') {
      try {
        await reddit.unbanUser(username, subredditName);
        record.currentBanType = 'none';
        record.currentBanExpiry = undefined;
      } catch (err) {
        console.error('[Gavel][appeals] Unban failed:', err);
      }
    }

    appeal.status = 'forgiven';

    const msg = buildAppealForgivenMessage(username, subredditName);
    try {
      await reddit.sendPrivateMessage({ to: username, subject: msg.subject, text: msg.body });
    } catch (err) {
      console.error('[Gavel][appeals] Forgiven PM failed:', err);
    }

    ui.showToast(`Appeal forgiven. u/${username} unbanned and strike cleared.`);
  } else {
    const lockUntil = new Date(Date.now() + config.appealLockDays * 86400000);
    record.appealLockedUntil = lockUntil.toISOString();
    appeal.status = 'upheld';

    const msg = buildAppealUpheldMessage(username, subredditName, config.appealLockDays);
    try {
      await reddit.sendPrivateMessage({ to: username, subject: msg.subject, text: msg.body });
    } catch (err) {
      console.error('[Gavel][appeals] Upheld PM failed:', err);
    }

    ui.showToast(`Appeal upheld. u/${username} remains banned.`);
  }

  appeal.decidedBy = mod?.username ?? 'unknown';
  appeal.decidedAt = new Date().toISOString();
  appeal.modNote = modNote;
  record.appealPending = false;

  await saveAppealRecord(redis, appeal);
  await saveUserRecord(redis, record);
  await removeFromPendingAppeals(redis, subredditId, username);
}
