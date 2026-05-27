import type { TriggerContext } from '@devvit/public-api';
import type { ModAction as ProtoModAction } from '@devvit/protos';
import { getConfig } from './config.js';
import { getOrCreateUserRecord, recalculateActiveStrikes, saveUserRecord } from './storage.js';
import { applyDiscipline } from './discipline.js';
import type { StrikeRecord, ToolSignal } from './types.js';

// ─── ModAction Handler ────────────────────────────────────────────────────────

export async function handleModAction(
  event: ProtoModAction,
  context: TriggerContext
): Promise<void> {
  const action = event.action ?? '';

  // ── Sync all Reddit mod actions → Gavel record ──
  const SYNC_ACTIONS = new Set([
    'banuser', 'unbanuser',
    'muteuser', 'unmuteuser',
    'spamlink', 'spamcomment',
  ]);

  if (SYNC_ACTIONS.has(action)) {
    const targetUsername = event.targetUser?.name;
    if (!targetUsername || targetUsername === '[deleted]') return;
    const subredditId = context.subredditId;
    const subredditName = event.subreddit?.name ?? context.subredditName;
    const username = targetUsername.toLowerCase();
    const modName = event.moderator?.name ?? 'mod';
    const when = new Date().toLocaleDateString();
    try {
      const record = await getOrCreateUserRecord(context.redis, subredditId, subredditName ?? '', username);

      const noteTs = new Date().toISOString();
      const noteId = `note:${subredditId}:${username}:${Date.now()}`;

      const addNote = (text: string) => {
        record.modNotes = [
          ...(record.modNotes ?? []),
          { id: noteId, addedBy: modName, note: text, timestamp: noteTs },
        ].slice(-50);
      };

      if (action === 'unbanuser') {
        record.currentBanType = 'none';
        record.currentBanExpiry = undefined;
        addNote(`Unbanned on ${when}`);

      } else if (action === 'banuser') {
        if (record.currentBanType === 'none') {
          record.currentBanType = 'permanent';
          addNote(`Banned on ${when} (via Reddit mod tools)`);
        }

      } else if (action === 'muteuser') {
        addNote(`Muted on ${when}`);

      } else if (action === 'unmuteuser') {
        addNote(`Unmuted on ${when}`);

      } else if (action === 'spamlink' || action === 'spamcomment') {
        const contentType = action === 'spamlink' ? 'post' : 'comment';
        const signal: ToolSignal = {
          toolName: `spam:${modName}`,
          contentType,
          contentTitle: (event.targetPost?.title ?? event.targetComment?.body ?? '').substring(0, 80) || undefined,
          timestamp: noteTs,
        };
        record.toolSignals = [...(record.toolSignals ?? []), signal].slice(-50);
      }

      record.lastActionTimestamp = new Date().toISOString();
      await saveUserRecord(context.redis, record);
    } catch (err) {
      console.error('[Gavel][triggers] Failed to sync mod action:', err);
    }
    return;
  }

  if (action !== 'removelink' && action !== 'removecomment') return;

  const config = await getConfig(context);
  if (!config.enabled || !config.trackRemovals) return;

  const targetUsername = event.targetUser?.name;
  if (!targetUsername || targetUsername === '[deleted]') return;

  const subredditName = event.subreddit?.name ?? context.subredditName;
  const subredditId = context.subredditId;

  let appUsername: string | undefined;
  try {
    const me = await context.reddit.getCurrentUser();
    appUsername = me?.username;
  } catch {
    appUsername = undefined;
  }
  if (appUsername && event.moderator?.name === appUsername) return;

  const moderatorName = event.moderator?.name ?? '';
  const BOT_BLOCKLIST = new Set([
    'automoderator',
    'botbouncer',
    'reddit',
    'anti-evil-operations',
    'safetybotreddit',
    'mod-triage-board',
  ]);
  const modLower = moderatorName.toLowerCase();
  const isBot = BOT_BLOCKLIST.has(modLower) || (modLower.endsWith('bot') && modLower.length > 3);

  const username = targetUsername.toLowerCase();

  if (isBot) {
    const record = await getOrCreateUserRecord(context.redis, subredditId, subredditName ?? '', username);
    const signal: ToolSignal = {
      toolName: moderatorName,
      contentType: action === 'removelink' ? 'post' : 'comment',
      contentTitle: (event.targetPost?.title ?? event.targetComment?.body ?? '').substring(0, 80) || undefined,
      timestamp: new Date().toISOString(),
    };
    record.toolSignals = [...(record.toolSignals ?? []), signal].slice(-50);
    await saveUserRecord(context.redis, record);
    return;
  }

  const debounceKey = `gavel:debounce:${subredditId}:${username}`;
  try {
    const existing = await context.redis.get(debounceKey);
    if (existing) return;
    const expiresAt = new Date(Date.now() + 10000);
    await context.redis.set(debounceKey, '1', { expiration: expiresAt });
  } catch (err) {
    console.error('[Gavel][triggers] Debounce check failed:', err);
  }

  const record = await getOrCreateUserRecord(context.redis, subredditId, subredditName ?? '', username);

  const strikeId = `${subredditId}:${username}:${Date.now()}`;
  const contentType = action === 'removelink' ? 'post' : 'comment';
  const contentId = event.targetPost?.id ?? event.targetComment?.id ?? 'unknown';
  const contentTitle = (
    event.targetPost?.title ?? event.targetComment?.body ?? ''
  ).substring(0, 100);

  const strike: StrikeRecord = {
    id: strikeId,
    username,
    subredditId,
    subredditName: subredditName ?? '',
    removedContentType: contentType as 'post' | 'comment',
    removedContentId: contentId ?? 'unknown',
    removedContentTitle: contentTitle,
    moderatorUsername: event.moderator?.name ?? 'unknown',
    removalReason: '',
    timestamp: new Date().toISOString(),
    cleared: false,
  };

  record.strikes.push(strike);
  if (record.strikes.length > 200) {
    record.strikes = record.strikes.slice(-200);
  }

  record.totalStrikeCount = record.strikes.length;
  record.activeStrikeCount = recalculateActiveStrikes(record, config.strikeExpiryDays);

  await applyDiscipline(context, config, record, strike);
}
