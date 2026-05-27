import type { TriggerContext } from '@devvit/public-api';
import type { GavelConfig, UserRecord, StrikeRecord } from './types.js';
import {
  recalculateActiveStrikes,
  saveUserRecord,
  appendObservationLogFull,
} from './storage.js';
import {
  buildWarningMessage,
  buildTempBanMessage,
  buildPermBanMessage,
} from './messages.js';

// ─── Discipline Engine ────────────────────────────────────────────────────────

export async function applyDiscipline(
  context: TriggerContext,
  config: GavelConfig,
  record: UserRecord,
  strike: StrikeRecord
): Promise<void> {
  if (!config.enabled) return;

  record.activeStrikeCount = recalculateActiveStrikes(record, config.strikeExpiryDays);

  const sorted = [...config.thresholds].sort((a, b) => b.strikeCount - a.strikeCount);
  const matched = sorted.find((t) => t.strikeCount <= record.activeStrikeCount);

  if (config.observationMode) {
    let wouldHaveAction: 'warning' | 'temp_ban' | 'permanent_ban' = 'warning';
    let banDays: number | undefined;

    if (matched) {
      wouldHaveAction = matched.action;
      banDays = matched.banDurationDays;
    }

    await appendObservationLogFull(context.redis, record.subredditId, {
      username: record.username,
      wouldHaveAction,
      banDays,
      activeStrikeCount: record.activeStrikeCount,
      strikeId: strike.id,
      timestamp: new Date().toISOString(),
      subredditName: strike.subredditName,
    });

    await saveUserRecord(context.redis, record);
    return;
  }

  if (!matched) {
    strike.actionTaken = 'none';
    await saveUserRecord(context.redis, record);
    return;
  }

  const { action } = matched;
  const banDays = matched.banDurationDays ?? 3;

  const nextThreshold = sorted.find((t) => t.strikeCount > matched.strikeCount);
  const nextThresholdCount = nextThreshold?.strikeCount ?? matched.strikeCount + 1;

  if (action === 'warning') {
    const { subject, body } = buildWarningMessage(config, record, strike, nextThresholdCount);
    try {
      await context.reddit.sendPrivateMessage({
        to: record.username,
        subject,
        text: body,
      });
    } catch (err) {
      console.error('[Gavel][discipline] Failed to send warning PM:', err);
    }
    strike.actionTaken = 'warning';
    record.lastActionTimestamp = new Date().toISOString();
  }

  if (action === 'temp_ban') {
    if (record.currentBanType === 'none') {
      const { body } = buildTempBanMessage(config, record, strike, banDays);
      try {
        await context.reddit.banUser({
          subredditName: strike.subredditName,
          username: record.username,
          duration: banDays,
          reason: `Gavel: Strike ${record.activeStrikeCount}`,
          note: `Auto-issued by Gavel. Strike ID: ${strike.id}`,
          message: body,
        });
        record.currentBanType = 'temp';
        record.currentBanExpiry = new Date(Date.now() + banDays * 86400000).toISOString();
      } catch (err) {
        console.error('[Gavel][discipline] Failed to issue temp ban:', err);
      }
    } else {
      const { subject, body } = buildTempBanMessage(config, record, strike, banDays);
      try {
        await context.reddit.sendPrivateMessage({
          to: record.username,
          subject,
          text: body,
        });
      } catch (err) {
        console.error('[Gavel][discipline] Failed to send temp ban PM:', err);
      }
    }
    strike.actionTaken = 'temp_ban';
    record.lastActionTimestamp = new Date().toISOString();
  }

  if (action === 'permanent_ban') {
    if (record.currentBanType !== 'permanent') {
      const { body } = buildPermBanMessage(config, record, strike);
      try {
        await context.reddit.banUser({
          subredditName: strike.subredditName,
          username: record.username,
          reason: `Gavel: Strike ${record.activeStrikeCount} — permanent`,
          note: `Auto-issued by Gavel. Strike ID: ${strike.id}`,
          message: body,
        });
        record.currentBanType = 'permanent';
        record.currentBanExpiry = undefined;
      } catch (err) {
        console.error('[Gavel][discipline] Failed to issue permanent ban:', err);
      }
    } else {
      const { subject, body } = buildPermBanMessage(config, record, strike);
      try {
        await context.reddit.sendPrivateMessage({
          to: record.username,
          subject,
          text: body,
        });
      } catch (err) {
        console.error('[Gavel][discipline] Failed to send perm ban PM:', err);
      }
    }
    strike.actionTaken = 'permanent_ban';
    record.lastActionTimestamp = new Date().toISOString();
  }

  await saveUserRecord(context.redis, record);
}
