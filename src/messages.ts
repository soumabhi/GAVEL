import type { GavelConfig, UserRecord, StrikeRecord, ObservationLogEntry, OwnershipRecord, ModNote } from './types.js';

// ─── Template Substitution ────────────────────────────────────────────────────

function fillTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.split(`{${key}}`).join(value);
  }
  return result;
}

function appealLink(subredditName: string, username: string): string {
  return `https://www.reddit.com/message/compose?to=r%2F${encodeURIComponent(subredditName)}&subject=Gavel+Appeal&message=APPEAL_REQUEST:${encodeURIComponent(username)}`;
}

// ─── Warning Message ──────────────────────────────────────────────────────────

export function buildWarningMessage(
  config: GavelConfig,
  record: UserRecord,
  strike: StrikeRecord,
  nextBanThreshold: number
): { subject: string; body: string } {
  const strikesUntilBan = Math.max(0, nextBanThreshold - record.activeStrikeCount);
  const vars: Record<string, string> = {
    username: record.username,
    subredditName: strike.subredditName,
    contentType: strike.removedContentType === 'post' ? 'post' : 'comment',
    removalReason: strike.removalReason || 'No reason provided',
    strikeCount: String(record.activeStrikeCount),
    strikesUntilBan: String(strikesUntilBan),
    banDays: '',
    banExpiry: '',
    appealLink: appealLink(strike.subredditName, record.username),
  };

  return {
    subject: `[r/${strike.subredditName}] Gavel: Moderation notice (event ${record.activeStrikeCount})`,
    body: fillTemplate(config.warningMessageTemplate, vars),
  };
}

// ─── Temp Ban Message ─────────────────────────────────────────────────────────

export function buildTempBanMessage(
  config: GavelConfig,
  record: UserRecord,
  strike: StrikeRecord,
  banDays: number
): { subject: string; body: string } {
  const expiry = new Date(Date.now() + banDays * 86400000);
  const vars: Record<string, string> = {
    username: record.username,
    subredditName: strike.subredditName,
    contentType: strike.removedContentType === 'post' ? 'post' : 'comment',
    removalReason: strike.removalReason || 'No reason provided',
    strikeCount: String(record.activeStrikeCount),
    strikesUntilBan: '0',
    banDays: String(banDays),
    banExpiry: expiry.toDateString(),
    appealLink: appealLink(strike.subredditName, record.username),
  };

  return {
    subject: `[r/${strike.subredditName}] Gavel: Temporary ban (${banDays} days)`,
    body: fillTemplate(config.tempBanMessageTemplate, vars),
  };
}

// ─── Perm Ban Message ─────────────────────────────────────────────────────────

export function buildPermBanMessage(
  config: GavelConfig,
  record: UserRecord,
  strike: StrikeRecord
): { subject: string; body: string } {
  const vars: Record<string, string> = {
    username: record.username,
    subredditName: strike.subredditName,
    contentType: strike.removedContentType === 'post' ? 'post' : 'comment',
    removalReason: strike.removalReason || 'No reason provided',
    strikeCount: String(record.activeStrikeCount),
    strikesUntilBan: '0',
    banDays: '',
    banExpiry: '',
    appealLink: appealLink(strike.subredditName, record.username),
  };

  return {
    subject: `[r/${strike.subredditName}] Gavel: Permanent ban`,
    body: fillTemplate(config.permBanMessageTemplate, vars),
  };
}

// ─── Appeal Messages ──────────────────────────────────────────────────────────

export function buildAppealConfirmationMessage(
  username: string,
  subredditName: string
): { subject: string; body: string } {
  return {
    subject: `[r/${subredditName}] Appeal received`,
    body:
      `Hi u/${username},\n\n` +
      `Your appeal for r/${subredditName} has been received and is pending moderator review.\n\n` +
      `You will receive a message once a moderator has reviewed your appeal.\n\n` +
      `— The r/${subredditName} mod team`,
  };
}

export function buildAppealForgivenMessage(
  username: string,
  subredditName: string
): { subject: string; body: string } {
  return {
    subject: `[r/${subredditName}] Appeal approved`,
    body:
      `Hi u/${username},\n\n` +
      `Your appeal for r/${subredditName} has been **approved**.\n\n` +
      `Your most recent strike has been cleared and any active ban has been lifted.\n\n` +
      `Please review the subreddit rules to avoid future violations.\n\n` +
      `— The r/${subredditName} mod team`,
  };
}

export function buildAppealUpheldMessage(
  username: string,
  subredditName: string,
  lockDays: number
): { subject: string; body: string } {
  return {
    subject: `[r/${subredditName}] Appeal decision`,
    body:
      `Hi u/${username},\n\n` +
      `After reviewing your appeal for r/${subredditName}, the moderation team has decided to **uphold** the original action.\n\n` +
      `You will not be able to submit another appeal for ${lockDays} days.\n\n` +
      `— The r/${subredditName} mod team`,
  };
}

// ─── History Formatter ────────────────────────────────────────────────────────

function relativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 2) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 30) return `${diffDays}d ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

export function formatUserHistoryText(record: UserRecord, ownership?: OwnershipRecord): string {
  const lines: string[] = [];

  // ── BLOCK 1: Compressed summary — instant scan, no scrolling needed ──────────

  const banLabel =
    record.currentBanType === 'permanent' ? '🔴 Active perm ban' :
    record.currentBanType === 'temp'      ? `🟠 Active temp ban${record.currentBanExpiry ? ` (exp ${new Date(record.currentBanExpiry).toLocaleDateString()})` : ''}` :
    '🟢 No active ban';

  const eventWord = record.activeStrikeCount === 1 ? 'event' : 'events';
  const repeatFlag = record.activeStrikeCount >= 3 ? ' ⚠ Repeat offender' : '';

  lines.push(`� u/${record.username}`);
  lines.push(`${banLabel}${repeatFlag}`);

  if (record.appealPending) {
    lines.push(`🟡 Appeal pending`);
  }

  if (ownership && ownership.status === 'reviewing') {
    const when = relativeTime(ownership.claimedAt);
    const note = ownership.note ? ` — "${ownership.note.substring(0, 40)}"` : '';
    lines.push(`🔍 Under review by u/${ownership.claimedBy} · ${when}${note}`);
  } else {
    lines.push(`No active investigation`);
  }

  const modSet = new Set(record.strikes.map((s) => s.moderatorUsername).filter((m) => m !== 'unknown'));
  if (modSet.size > 0) {
    lines.push(`👥 ${Array.from(modSet).slice(0, 4).join(', ')}`);
  }

  // ── BLOCK 2: Timeline — last 5 events ────────────────────────────────────────

  const cleared = record.strikes.filter((s) => s.cleared);
  const recent = record.strikes.slice(-5).reverse();

  if (recent.length > 0) {
    lines.push(`─`);
    lines.push(`${record.activeStrikeCount} active · ${record.totalStrikeCount} total · ${cleared.length} cleared`);
    for (const s of recent) {
      const when = relativeTime(s.timestamp);
      const type = s.removedContentType === 'post' ? 'post' : 'comment';
      const content = s.removedContentTitle ? ` "${s.removedContentTitle.substring(0, 28)}${s.removedContentTitle.length > 28 ? '…' : ''}"` : '';
      const mod = s.moderatorUsername !== 'unknown' ? ` · ${s.moderatorUsername}` : '';
      const actionIcon =
        s.actionTaken === 'warning'       ? ' ⚠' :
        s.actionTaken === 'temp_ban'      ? ' ⛔' :
        s.actionTaken === 'permanent_ban' ? ' 🔴' :
        '';
      const clearedFlag = s.cleared ? ' ✓' : '';
      lines.push(`• ${when}: ${type}${content}${actionIcon}${mod}${clearedFlag}`);
    }
    if (record.appealPending && record.lastAppealTimestamp) {
      lines.push(`• ${relativeTime(record.lastAppealTimestamp)}: 📨 appeal submitted`);
    } else if (!record.appealPending && record.lastAppealTimestamp) {
      lines.push(`• ${relativeTime(record.lastAppealTimestamp)}: ✅ appeal decided`);
    }
  }

  // ── BLOCK 3: Mod notes ────────────────────────────────────────────────────────

  const notes = (record.modNotes ?? []).slice(-3).reverse();
  if (notes.length > 0) {
    lines.push(`─`);
    for (const n of notes) {
      lines.push(`📝 ${relativeTime(n.timestamp)} · ${n.addedBy}: "${n.note.substring(0, 60)}${n.note.length > 60 ? '…' : ''}"`);
    }
  }

  // ── BLOCK 4: Tool signals — quiet, secondary ──────────────────────────────────

  const signals = record.toolSignals ?? [];
  if (signals.length > 0) {
    const toolCounts: Record<string, number> = {};
    for (const s of signals) {
      toolCounts[s.toolName] = (toolCounts[s.toolName] ?? 0) + 1;
    }
    const summary = Object.entries(toolCounts)
      .map(([tool, count]) => `${tool}×${count}`)
      .join(', ');
    lines.push(`─`);
    lines.push(`🤖 Tool signals (${signals.length}): ${summary}`);
  }

  return lines.join('\n');
}

export function formatUserHistoryBlocks(
  record: UserRecord,
  ownership?: OwnershipRecord
): { summary: string; timeline: string } {
  const banLabel =
    record.currentBanType === 'permanent' ? '🔴 Active perm ban' :
    record.currentBanType === 'temp'      ? `🟠 Active temp ban${record.currentBanExpiry ? ` (exp ${new Date(record.currentBanExpiry).toLocaleDateString()})` : ''}` :
    '🟢 No active ban';

  const repeatFlag = record.activeStrikeCount >= 3 ? ' ⚠ Repeat offender' : '';
  const summaryLines: string[] = [];
  summaryLines.push(`${banLabel}${repeatFlag}`);
  if (record.appealPending) summaryLines.push(`🟡 Appeal pending`);
  if (ownership && ownership.status === 'reviewing') {
    const note = ownership.note ? ` — "${ownership.note.substring(0, 40)}"` : '';
    summaryLines.push(`🔍 Under review by u/${ownership.claimedBy} · ${relativeTime(ownership.claimedAt)}${note}`);
  } else {
    summaryLines.push(`No active investigation`);
  }
  const modSet = new Set(record.strikes.map((s) => s.moderatorUsername).filter((m) => m !== 'unknown'));
  if (modSet.size > 0) summaryLines.push(`👥 ${Array.from(modSet).slice(0, 4).join(', ')}`);

  const timelineLines: string[] = [];
  const cleared = record.strikes.filter((s) => s.cleared);
  const recent = record.strikes.slice(-5).reverse();
  if (recent.length > 0) {
    timelineLines.push(`${record.activeStrikeCount} active · ${record.totalStrikeCount} total · ${cleared.length} cleared`);
    for (const s of recent) {
      const when = relativeTime(s.timestamp);
      const type = s.removedContentType === 'post' ? 'post' : 'comment';
      const content = s.removedContentTitle ? ` "${s.removedContentTitle.substring(0, 28)}${s.removedContentTitle.length > 28 ? '…' : ''}"` : '';
      const mod = s.moderatorUsername !== 'unknown' ? ` · ${s.moderatorUsername}` : '';
      const actionIcon = s.actionTaken === 'warning' ? ' ⚠' : s.actionTaken === 'temp_ban' ? ' ⛔' : s.actionTaken === 'permanent_ban' ? ' 🔴' : '';
      timelineLines.push(`• ${when}: ${type}${content}${actionIcon}${mod}${s.cleared ? ' ✓' : ''}`);
    }
    if (record.appealPending && record.lastAppealTimestamp) timelineLines.push(`• ${relativeTime(record.lastAppealTimestamp)}: 📨 appeal submitted`);
    else if (!record.appealPending && record.lastAppealTimestamp) timelineLines.push(`• ${relativeTime(record.lastAppealTimestamp)}: ✅ appeal decided`);
  } else {
    timelineLines.push('No moderation events recorded.');
  }
  const notes = (record.modNotes ?? []).slice(-3).reverse();
  if (notes.length > 0) {
    timelineLines.push(`─`);
    for (const n of notes) timelineLines.push(`📝 ${relativeTime(n.timestamp)} · ${n.addedBy}: "${n.note.substring(0, 60)}${n.note.length > 60 ? '…' : ''}"`);
  }
  const signals = record.toolSignals ?? [];
  if (signals.length > 0) {
    const toolCounts: Record<string, number> = {};
    for (const s of signals) toolCounts[s.toolName] = (toolCounts[s.toolName] ?? 0) + 1;
    timelineLines.push(`─`);
    timelineLines.push(`🤖 Tool signals (${signals.length}): ${Object.entries(toolCounts).map(([t, c]) => `${t}×${c}`).join(', ')}`);
  }

  return { summary: summaryLines.join('\n'), timeline: timelineLines.join('\n') };
}

// ─── Observation Summary ──────────────────────────────────────────────────────

export function formatObservationSummary(log: ObservationLogEntry[]): string {
  if (log.length === 0) return '👁 Observation mode active — no events recorded yet.';
  const recent = log.slice(-5).reverse();
  const lines = recent.map((e) => {
    const when = relativeTime(e.timestamp);
    const actionLabel =
      e.wouldHaveAction === 'warning'       ? '⚠ warn' :
      e.wouldHaveAction === 'temp_ban'      ? `⛔ temp ban${e.banDays ? ` ${e.banDays}d` : ''}` :
      e.wouldHaveAction === 'permanent_ban' ? '🔴 perm ban' :
      e.wouldHaveAction;
    return `• ${when}: u/${e.username} → ${actionLabel} (${e.activeStrikeCount} events · human decides)`;
  });
  return `👁 Observation mode — ${recent.length} suppressed action(s):\n${lines.join('\n')}`;
}
