import type { RedisClient } from '@devvit/public-api';
import type { UserRecord, AppealRecord, ObservationLogEntry, OwnershipRecord } from './types.js';

// ─── Key Patterns ─────────────────────────────────────────────────────────────

const userKey = (subredditId: string, username: string) =>
  `gavel:user:${subredditId}:${username.toLowerCase()}`;

const appealKey = (subredditId: string, username: string) =>
  `gavel:appeal:${subredditId}:${username.toLowerCase()}`;

const pendingKey = (subredditId: string) =>
  `gavel:pending:${subredditId}`;

const obsKey = (subredditId: string) =>
  `gavel:obs:${subredditId}`;

const ownerKey = (subredditId: string, username: string) =>
  `gavel:owner:${subredditId}:${username.toLowerCase()}`;

// ─── User Record ──────────────────────────────────────────────────────────────

export async function getUserRecord(
  redis: RedisClient,
  subredditId: string,
  username: string
): Promise<UserRecord | null> {
  try {
    const raw = await redis.get(userKey(subredditId, username));
    if (!raw) return null;
    return JSON.parse(raw) as UserRecord;
  } catch (err) {
    console.error('[Gavel][storage] parse error (getUserRecord):', err);
    return null;
  }
}

export async function saveUserRecord(
  redis: RedisClient,
  record: UserRecord
): Promise<void> {
  try {
    if (record.strikes.length > 200) {
      record.strikes = record.strikes.slice(-200);
    }
    await redis.set(userKey(record.subredditId, record.username), JSON.stringify(record));
  } catch (err) {
    console.error('[Gavel][storage] write error (saveUserRecord):', err);
  }
}

export async function getOrCreateUserRecord(
  redis: RedisClient,
  subredditId: string,
  subredditName: string,
  username: string
): Promise<UserRecord> {
  const existing = await getUserRecord(redis, subredditId, username);
  if (existing) return existing;

  const fresh: UserRecord = {
    username: username.toLowerCase(),
    subredditId,
    strikes: [],
    activeStrikeCount: 0,
    totalStrikeCount: 0,
    currentBanType: 'none',
    appealPending: false,
  };
  return fresh;
}

// ─── Strike Recalculation ─────────────────────────────────────────────────────

export function recalculateActiveStrikes(
  record: UserRecord,
  strikeExpiryDays: number
): number {
  const now = Date.now();
  const expiryMs = strikeExpiryDays > 0 ? strikeExpiryDays * 86400000 : 0;

  return record.strikes.filter((s) => {
    if (s.cleared) return false;
    if (expiryMs > 0) {
      const age = now - new Date(s.timestamp).getTime();
      if (age > expiryMs) return false;
    }
    return true;
  }).length;
}

// ─── Appeal Record ────────────────────────────────────────────────────────────

export async function getAppealRecord(
  redis: RedisClient,
  subredditId: string,
  username: string
): Promise<AppealRecord | null> {
  try {
    const raw = await redis.get(appealKey(subredditId, username));
    if (!raw) return null;
    return JSON.parse(raw) as AppealRecord;
  } catch (err) {
    console.error('[Gavel][storage] parse error (getAppealRecord):', err);
    return null;
  }
}

export async function saveAppealRecord(
  redis: RedisClient,
  appeal: AppealRecord
): Promise<void> {
  try {
    await redis.set(appealKey(appeal.subredditId, appeal.username), JSON.stringify(appeal));
  } catch (err) {
    console.error('[Gavel][storage] write error (saveAppealRecord):', err);
  }
}

// ─── Pending Appeals ──────────────────────────────────────────────────────────

export async function getPendingAppeals(
  redis: RedisClient,
  subredditId: string
): Promise<string[]> {
  try {
    const raw = await redis.get(pendingKey(subredditId));
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  } catch (err) {
    console.error('[Gavel][storage] parse error (getPendingAppeals):', err);
    return [];
  }
}

export async function addToPendingAppeals(
  redis: RedisClient,
  subredditId: string,
  username: string
): Promise<void> {
  try {
    const list = await getPendingAppeals(redis, subredditId);
    const lower = username.toLowerCase();
    if (!list.includes(lower)) {
      list.push(lower);
      await redis.set(pendingKey(subredditId), JSON.stringify(list));
    }
  } catch (err) {
    console.error('[Gavel][storage] write error (addToPendingAppeals):', err);
  }
}

export async function removeFromPendingAppeals(
  redis: RedisClient,
  subredditId: string,
  username: string
): Promise<void> {
  try {
    const list = await getPendingAppeals(redis, subredditId);
    const lower = username.toLowerCase();
    const updated = list.filter((u) => u !== lower);
    await redis.set(pendingKey(subredditId), JSON.stringify(updated));
  } catch (err) {
    console.error('[Gavel][storage] write error (removeFromPendingAppeals):', err);
  }
}

// ─── Ownership / Investigation ──────────────────────────────────────────────

export async function getOwnership(
  redis: RedisClient,
  subredditId: string,
  username: string
): Promise<OwnershipRecord | null> {
  try {
    const raw = await redis.get(ownerKey(subredditId, username));
    if (!raw) return null;
    return JSON.parse(raw) as OwnershipRecord;
  } catch (err) {
    console.error('[Gavel][storage] parse error (getOwnership):', err);
    return null;
  }
}

export async function saveOwnership(
  redis: RedisClient,
  record: OwnershipRecord
): Promise<void> {
  try {
    await redis.set(ownerKey(record.subredditId, record.username), JSON.stringify(record));
  } catch (err) {
    console.error('[Gavel][storage] write error (saveOwnership):', err);
  }
}

export async function clearOwnership(
  redis: RedisClient,
  subredditId: string,
  username: string
): Promise<void> {
  try {
    await redis.del(ownerKey(subredditId, username));
  } catch (err) {
    console.error('[Gavel][storage] delete error (clearOwnership):', err);
  }
}

// ─── Per-mod Review Index ─────────────────────────────────────────────────────

const myReviewsKey = (subredditId: string, modUsername: string) =>
  `gavel:myreviews:${subredditId}:${modUsername.toLowerCase()}`;

export async function saveMyReview(
  redis: RedisClient,
  subredditId: string,
  modUsername: string,
  targetUsername: string
): Promise<void> {
  try {
    const key = myReviewsKey(subredditId, modUsername);
    const raw = await redis.get(key);
    const list: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    const lower = targetUsername.toLowerCase();
    if (!list.includes(lower)) {
      list.push(lower);
      await redis.set(key, JSON.stringify(list));
    }
  } catch (err) {
    console.error('[Gavel][storage] write error (saveMyReview):', err);
  }
}

export async function removeMyReview(
  redis: RedisClient,
  subredditId: string,
  modUsername: string,
  targetUsername: string
): Promise<void> {
  try {
    const key = myReviewsKey(subredditId, modUsername);
    const raw = await redis.get(key);
    if (!raw) return;
    const list = (JSON.parse(raw) as string[]).filter(
      (u) => u !== targetUsername.toLowerCase()
    );
    await redis.set(key, JSON.stringify(list));
  } catch (err) {
    console.error('[Gavel][storage] write error (removeMyReview):', err);
  }
}

export async function getMyReviews(
  redis: RedisClient,
  subredditId: string,
  modUsername: string
): Promise<string[]> {
  try {
    const raw = await redis.get(myReviewsKey(subredditId, modUsername));
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  } catch (err) {
    console.error('[Gavel][storage] parse error (getMyReviews):', err);
    return [];
  }
}

// ─── Observation Log ──────────────────────────────────────────────────────────

export async function getObservationLog(
  redis: RedisClient,
  subredditId: string
): Promise<ObservationLogEntry[]> {
  try {
    const raw = await redis.get(obsKey(subredditId));
    if (!raw) return [];
    return JSON.parse(raw) as ObservationLogEntry[];
  } catch (err) {
    console.error('[Gavel][storage] parse error (getObservationLog):', err);
    return [];
  }
}

export async function appendObservationLog(
  redis: RedisClient,
  subredditId: string,
  event: { username: string; wouldHaveAction: string; timestamp: string; reason: string }
): Promise<void> {
  try {
    const log = await getObservationLog(redis, subredditId);
    const entry: ObservationLogEntry = {
      username: event.username,
      wouldHaveAction: event.wouldHaveAction as ObservationLogEntry['wouldHaveAction'],
      activeStrikeCount: 0,
      strikeId: '',
      timestamp: event.timestamp,
      subredditName: '',
    };
    log.push(entry);
    const trimmed = log.slice(-50);
    await redis.set(obsKey(subredditId), JSON.stringify(trimmed));
  } catch (err) {
    console.error('[Gavel][storage] write error (appendObservationLog):', err);
  }
}

export async function appendObservationLogFull(
  redis: RedisClient,
  subredditId: string,
  entry: ObservationLogEntry
): Promise<void> {
  try {
    const log = await getObservationLog(redis, subredditId);
    log.push(entry);
    const trimmed = log.slice(-50);
    await redis.set(obsKey(subredditId), JSON.stringify(trimmed));
  } catch (err) {
    console.error('[Gavel][storage] write error (appendObservationLogFull):', err);
  }
}
