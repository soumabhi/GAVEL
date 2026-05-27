import { Devvit } from '@devvit/public-api';
import type { MenuItemOnPressEvent, Context } from '@devvit/public-api';
import { getConfig } from './config.js';
import { getUserRecord, getAppealRecord, getPendingAppeals, getObservationLog, getOwnership, getMyReviews } from './storage.js';
import { formatUserHistoryText, formatUserHistoryBlocks, formatObservationSummary } from './messages.js';
import { contextViewForm, manualStrikeForm, clearStrikeForm, appealForm, appealDecisionForm, appealsQueueForm, claimReviewForm, myReviewsForm, addNoteForm } from './forms.js';

// ─── Helper: Resolve Username from targetId ─────────────────────────────────────

async function resolveUsername(event: MenuItemOnPressEvent, context: Context): Promise<string | undefined> {
  const { targetId, location } = event;
  try {
    if (location === 'post') {
      const post = await context.reddit.getPostById(targetId);
      return post?.authorName;
    } else if (location === 'comment') {
      const comment = await context.reddit.getCommentById(targetId);
      return comment?.authorName;
    } else {
      const me = await context.reddit.getCurrentUser();
      return me?.username;
    }
  } catch (err) {
    console.error('[Gavel][menu] resolveUsername failed:', err);
    return undefined;
  }
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const day = d.getDate();
  const suffix = day === 1 || day === 21 || day === 31 ? 'st' : day === 2 || day === 22 ? 'nd' : day === 3 || day === 23 ? 'rd' : 'th';
  const mon = d.toLocaleString('en', { month: 'short' });
  const yr = String(d.getFullYear()).slice(2);
  return `${day}${suffix} ${mon} '${yr}`;
}

// ─── Register All Menu Items ──────────────────────────────────────────────────

export function registerMenuItems(): void {

  // 1. View moderation context
  Devvit.addMenuItem({
    label: 'Gavel: View record',
    location: ['post', 'comment'],
    forUserType: 'moderator',
    onPress: async (event: MenuItemOnPressEvent, context: Context) => {
      const { redis, ui, subredditId } = context;
      const username = (await resolveUsername(event, context))?.toLowerCase();

      if (!username) {
        ui.showToast('Could not identify user.');
        return;
      }

      const record = await getUserRecord(redis, subredditId, username);
      if (!record || record.totalStrikeCount === 0) {
        ui.showToast(`u/${username} — no moderation history in this community.`);
        return;
      }

      const ownership = await getOwnership(redis, subredditId, username);

      // ── Pattern detection — derived from record, no new storage ──
      const now = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1000;
      const recentAll = record.strikes.filter((s) => !s.cleared);
      const todayStrikes = recentAll.filter((s) => now - new Date(s.timestamp).getTime() < oneDayMs);
      const weekStrikes  = recentAll.filter((s) => now - new Date(s.timestamp).getTime() < 7 * oneDayMs);
      const postCount    = recentAll.filter((s) => s.removedContentType === 'post').length;
      const commentCount = recentAll.filter((s) => s.removedContentType === 'comment').length;
      const isSpamPattern  = todayStrikes.length >= 3;
      const isEscalating   = weekStrikes.length >= 3 && record.currentBanType === 'none';
      const isMostlyPosts  = postCount > commentCount * 2;
      const isMostlyComments = commentCount > postCount * 2;

      // ── Line 1: Status — urgency-first ──
      const banLabel =
        record.currentBanType === 'permanent' ? '🔴 Permanent ban' :
        record.currentBanType === 'temp'      ? `🟠 Temporary ban${record.currentBanExpiry ? ` · expires ${new Date(record.currentBanExpiry).toLocaleDateString()}` : ''}` :
        '🟢 User currently active';
      const parts: string[] = [banLabel];
      if (record.activeStrikeCount > 0)       parts.push(`⚠ ${record.activeStrikeCount} unresolved concern${record.activeStrikeCount !== 1 ? 's' : ''}`);
      if (isSpamPattern)                      parts.push('🚨 Repeated pattern detected');
      else if (record.activeStrikeCount >= 3) parts.push('⚠ Repeat offender');
      if (record.appealPending)               parts.push('🟡 Appeal pending');

      // ── Line 2: Activity summary — pattern + intensity ──
      const cleared  = record.strikes.filter((s) => s.cleared).length;
      const modSet   = [...new Set(record.strikes.map((s) => s.moderatorUsername).filter((m) => m !== 'unknown'))];
      const intensity = isSpamPattern ? 'High activity' : weekStrikes.length >= 2 ? 'Elevated activity' : 'Low activity';
      const contentPattern = isMostlyPosts ? ' · post pattern' : isMostlyComments ? ' · comment pattern' : '';
      const statsLine = `📊 ${intensity} · ${record.activeStrikeCount} active event${record.activeStrikeCount !== 1 ? 's' : ''}${cleared > 0 ? ` · ${cleared} cleared` : ''}${contentPattern}`;
      if (cleared > 0) parts.push(`✅ ${cleared} resolved incident${cleared !== 1 ? 's' : ''}`);

      // ── Line 3: Full chronological timeline ──
      // Merge strikes + notes + signals into one sorted event list
      type TLEntry = { ts: number; line: string };
      const tlEntries: TLEntry[] = [];

      // Strikes — all of them, paragraph field scrolls
      for (const s of record.strikes) {
        const icon = s.cleared ? '✅' :
                     s.actionTaken === 'warning' ? '⚠' :
                     s.actionTaken === 'temp_ban' ? '⛔' :
                     s.actionTaken === 'permanent_ban' ? '🔴' : '🔸';
        const type = s.removedContentType === 'post' ? 'post' : s.removedContentType === 'comment' ? 'comment' : 'manual';
        const title = s.removedContentTitle && !s.removedContentTitle.includes('Removed by Reddit')
          ? ` · "${s.removedContentTitle.substring(0, 22)}${s.removedContentTitle.length > 22 ? '…' : ''}"`
          : '';
        const actLabel = s.actionTaken === 'warning' ? ' → Warned' :
                         s.actionTaken === 'temp_ban' ? ' → Temporary ban' :
                         s.actionTaken === 'permanent_ban' ? ' → Permanent ban' : '';
        const reasonStr = s.removalReason && s.removalReason.trim()
          ? ` · "${s.removalReason.substring(0, 40)}${s.removalReason.length > 40 ? '…' : ''}"`
          : '';
        const clearedSuffix = s.cleared
          ? ` · resolved${s.clearedBy ? ` by ${s.clearedBy}` : ''}`
          : '';
        const ageMs = Date.now() - new Date(s.timestamp).getTime();
        const ageLabel = ageMs < 3600000 ? ' (just now)' : ageMs < 86400000 ? ` (${Math.floor(ageMs / 3600000)}h ago)` : ageMs < 604800000 ? ` (${Math.floor(ageMs / 86400000)}d ago)` : '';
        tlEntries.push({
          ts: new Date(s.timestamp).getTime(),
          line: `${icon} ${fmtDate(s.timestamp)}${ageLabel} · ${type}${title}${reasonStr}${actLabel}${clearedSuffix}`,
        });
      }

      // Mod notes — all of them
      for (const n of (record.modNotes ?? [])) {
        const noteIcon = n.addedBy === 'gavel-mod' ? '⚙' : '📝';
        tlEntries.push({
          ts: new Date(n.timestamp).getTime(),
          line: `${noteIcon} ${fmtDate(n.timestamp)} · ${n.addedBy}: "${n.note.substring(0, 45)}"`,
        });
      }

      // Tool signals — each individually, last 5
      for (const sig of (record.toolSignals ?? []).slice(-5)) {
        const isSpam = sig.toolName.startsWith('spam:');
        const icon = isSpam ? '🚫' : '🤖';
        const label = isSpam ? `spam flagged by ${sig.toolName.replace('spam:', '')}` : `${sig.toolName} removal`;
        tlEntries.push({
          ts: new Date(sig.timestamp).getTime(),
          line: `${icon} ${fmtDate(sig.timestamp)} · ${sig.contentType} · ${label}`,
        });
      }

      // Appeal event
      if (record.appealPending && record.lastAppealTimestamp) {
        tlEntries.push({
          ts: new Date(record.lastAppealTimestamp).getTime(),
          line: `📨 ${fmtDate(record.lastAppealTimestamp)} · appeal submitted`,
        });
      }

      // Sort all entries oldest → newest
      tlEntries.sort((a, b) => a.ts - b.ts);
      const timelineLines = tlEntries.map((e) => e.line);

      // ── Suggested next step — human-first, rule-based ──
      let suggestion = '';
      if (record.appealPending) {
        suggestion = '💡 Suggested: Review pending appeal';
      } else if (isSpamPattern && record.currentBanType === 'none') {
        suggestion = '💡 Suggested: Consider temporary ban — rapid repeat violations';
      } else if (isEscalating) {
        suggestion = '💡 Suggested: Escalate — pattern intensifying this week';
      } else if (record.currentBanType === 'permanent') {
        suggestion = '💡 Suggested: Monitor for ban evasion';
      } else if (record.currentBanType === 'temp') {
        suggestion = '💡 Suggested: Watch for activity after ban expiry';
      } else if (cleared > 0 && record.activeStrikeCount === 0) {
        suggestion = '💡 User in good standing — prior events cleared';
      }
      if (suggestion) timelineLines.push(`\n${suggestion}`);

      // ── Risk summary + last action — prepended to timeline ──
      const riskBullets: string[] = [];
      if (record.activeStrikeCount > 0)
        riskBullets.push(`• ${record.activeStrikeCount} unresolved incident${record.activeStrikeCount !== 1 ? 's' : ''}`);
      if (cleared > 0)
        riskBullets.push(`• ${cleared} previously resolved`);
      if (isSpamPattern)
        riskBullets.push('• Rapid repeat violations detected');
      else if (isMostlyPosts && weekStrikes.length >= 2)
        riskBullets.push('• Repeated post removals this week');
      else if (isMostlyComments && weekStrikes.length >= 2)
        riskBullets.push('• Repeated comment removals this week');
      if (record.currentBanType === 'permanent')
        riskBullets.push('• Currently permanently banned');
      else if (record.currentBanType === 'temp')
        riskBullets.push('• Currently under temporary ban');
      const prevUnbans = (record.modNotes ?? []).filter((n) => n.note?.toLowerCase().includes('unbanned')).length;
      if (prevUnbans > 0)
        riskBullets.push(`• Previously unbanned ${prevUnbans} time${prevUnbans !== 1 ? 's' : ''}`);
      if (ownership?.status === 'reviewing')
        riskBullets.push('• Active investigation in progress');
      if (record.appealPending)
        riskBullets.push('• Appeal pending review');

      // Last moderator action — appended to risk bullets
      const lastStrike = [...record.strikes].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
      if (lastStrike) {
        const lastActionLabel = lastStrike.actionTaken === 'warning' ? 'Warned' : lastStrike.actionTaken === 'temp_ban' ? 'Temporary ban' : lastStrike.actionTaken === 'permanent_ban' ? 'Permanent ban' : 'Incident logged';
        riskBullets.push(`🕐 Last action: ${lastActionLabel} by ${lastStrike.moderatorUsername} · ${fmtDate(lastStrike.timestamp)}`);
      }

      const formData: Record<string, string> = {
        username,
        status: parts.join(' · '),
        stats: statsLine,
        timeline: timelineLines.join('\n'),
      };
      if (ownership?.status === 'reviewing') {
        const claimants = Array.isArray(ownership.claimedBy) ? ownership.claimedBy : [ownership.claimedBy].filter(Boolean);
        if (claimants.length > 0) {
          formData['reviewer'] = `${claimants.join(', ')}${ownership.note ? ` · "${ownership.note.substring(0, 60)}"` : ''}`;
        }
      }
      if (riskBullets.length > 0) {
        formData['risk'] = riskBullets.join('\n');
      }
      if (modSet.length > 0) {
        formData['mods'] = modSet.join(', ');
      }

      ui.showForm(contextViewForm, formData);
    },
  });

  // 2. Add manual event
  Devvit.addMenuItem({
    label: 'Gavel: Add incident',
    location: ['post', 'comment'],
    forUserType: 'moderator',
    onPress: async (event: MenuItemOnPressEvent, context: Context) => {
      const username = (await resolveUsername(event, context)) ?? '';
      context.ui.showForm(manualStrikeForm, { username });
    },
  });

  // 3. Clear event
  Devvit.addMenuItem({
    label: 'Gavel: Resolve incident',
    location: ['post', 'comment'],
    forUserType: 'moderator',
    onPress: async (event: MenuItemOnPressEvent, context: Context) => {
      const username = (await resolveUsername(event, context)) ?? '';
      context.ui.showForm(clearStrikeForm, { username });
    },
  });

  // 4. View pending appeals
  Devvit.addMenuItem({
    label: 'Gavel: Appeals queue',
    location: 'subreddit',
    forUserType: 'moderator',
    onPress: async (_event: MenuItemOnPressEvent, context: Context) => {
      const { redis, ui, subredditId } = context;
      const pending = await getPendingAppeals(redis, subredditId);

      if (pending.length === 0) {
        const obsLog = await getObservationLog(redis, subredditId);
        if (obsLog.length > 0) {
          ui.showToast(formatObservationSummary(obsLog));
        } else {
          ui.showToast('No pending appeals.');
        }
        return;
      }

      // Fetch each appeal — filter to still-banned only, sort most recent first
      type AppealEntry = { username: string; appealText: string; submittedAt: string };
      const entries: AppealEntry[] = [];
      for (const u of pending) {
        const rec = await getUserRecord(redis, subredditId, u);
        if (!rec || rec.currentBanType === 'none') continue;
        const appeal = await getAppealRecord(redis, subredditId, u);
        if (!appeal || appeal.status !== 'pending') continue;
        const banLabel = rec.currentBanType === 'permanent' ? '🔴 perm ban' : '🟠 temp ban';
        entries.push({
          username: u,
          appealText: `${banLabel} · "${(appeal.userStatement ?? '').substring(0, 70)}${(appeal.userStatement ?? '').length > 70 ? '…' : ''}"`,
          submittedAt: appeal.submittedAt ?? new Date(0).toISOString(),
        });
      }
      entries.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
      const capped = entries.slice(0, 25);
      if (capped.length === 0) {
        ui.showToast('No pending appeals from currently banned users.');
        return;
      }

      const formData: Record<string, string> = {
        userList: capped.map((e) => e.username).join(','),
        count: String(capped.length),
      };
      capped.forEach((e, i) => { formData[`appeal${i}`] = e.appealText; });

      ui.showForm(appealsQueueForm, formData);
    },
  });

  // 5. Review a user's appeal
  Devvit.addMenuItem({
    label: 'Gavel: Review appeal',
    location: ['post', 'comment'],
    forUserType: 'moderator',
    onPress: async (event: MenuItemOnPressEvent, context: Context) => {
      const { redis, ui, subredditId } = context;
      const username = (await resolveUsername(event, context))?.toLowerCase();

      if (!username) {
        ui.showToast('Could not identify user.');
        return;
      }

      const appeal = await getAppealRecord(redis, subredditId, username);
      if (!appeal || appeal.status !== 'pending') {
        ui.showToast(`No pending appeal for u/${username}.`);
        return;
      }

      const rec = await getUserRecord(redis, subredditId, username);
      const banStatus = rec?.currentBanType === 'permanent' ? '🔴 Permanently banned' :
                        rec?.currentBanType === 'temp' ? `🟠 Temp ban${rec.currentBanExpiry ? ` · expires ${new Date(rec.currentBanExpiry).toLocaleDateString()}` : ''}` :
                        '🟢 No active ban';
      context.ui.showForm(appealDecisionForm, {
        username,
        appealSummary: appeal.userStatement.substring(0, 200),
        banStatus,
        isBanned: rec?.currentBanType !== 'none' ? 'true' : 'false',
      });
    },
  });

  // 6. Claim / resolve review investigation
  Devvit.addMenuItem({
    label: 'Gavel: Claim investigation',
    location: ['post', 'comment'],
    forUserType: 'moderator',
    onPress: async (event: MenuItemOnPressEvent, context: Context) => {
      const { redis, subredditId } = context;
      const username = (await resolveUsername(event, context)) ?? '';
      const ownership = await getOwnership(redis, subredditId, username);
      const claimants: string[] = Array.isArray(ownership?.claimedBy) ? ownership!.claimedBy : (ownership?.claimedBy ? [ownership.claimedBy as unknown as string] : []);
      const currentReviewer = ownership?.status === 'reviewing' && claimants.length > 0
        ? `${claimants.join(', ')}${ownership!.note ? ` · "${ownership!.note.substring(0, 60)}"` : ''}`
        : '';
      context.ui.showForm(claimReviewForm, { username, currentReviewer });
    },
  });

  // 7. My active reviews
  Devvit.addMenuItem({
    label: 'Gavel: My investigations',
    location: 'subreddit',
    forUserType: 'moderator',
    onPress: async (_event: MenuItemOnPressEvent, context: Context) => {
      const { redis, ui, subredditId } = context;
      let mod: { username: string } | undefined | null;
      try { mod = await context.reddit.getCurrentUser(); } catch { /* ignore */ }
      const modUsername = mod?.username ?? '';
      if (!modUsername) { ui.showToast('Could not identify your account.'); return; }

      const usernames = await getMyReviews(redis, subredditId, modUsername);
      if (usernames.length === 0) {
        ui.showToast('You have no active reviews.');
        return;
      }

      type ReviewEntry = { username: string; info: string };
      const entries: ReviewEntry[] = [];
      for (const u of usernames) {
        const ownership = await getOwnership(redis, subredditId, u);
        if (!ownership || ownership.status !== 'reviewing') continue;
        const when = new Date(ownership.claimedAt).toLocaleDateString();
        const note = ownership.note ? ` · "${ownership.note.substring(0, 50)}"` : '';
        const claimedByArr = Array.isArray(ownership.claimedBy) ? ownership.claimedBy : [ownership.claimedBy].filter(Boolean) as string[];
        const others = claimedByArr.filter((m) => m !== modUsername);
        const coReviewers = others.length > 0 ? ` · also: ${others.join(', ')}` : '';
        entries.push({ username: u, info: `claimed ${when}${note}${coReviewers}` });
      }

      if (entries.length === 0) {
        ui.showToast('No active reviews found.');
        return;
      }

      const formData: Record<string, string> = {
        __users: entries.map((e) => e.username).join(','),
      };
      entries.forEach((e, i) => { formData[`info${i}`] = e.info; });

      ui.showForm(myReviewsForm, formData);
    },
  });

  // 8. Add mod note
  Devvit.addMenuItem({
    label: 'Gavel: Add moderator note',
    location: ['post', 'comment'],
    forUserType: 'moderator',
    onPress: async (event: MenuItemOnPressEvent, context: Context) => {
      const username = (await resolveUsername(event, context)) ?? '';
      context.ui.showForm(addNoteForm, { username });
    },
  });

  // 8. Appeal my ban (user-facing)
  Devvit.addMenuItem({
    label: 'Gavel: Submit appeal',
    location: 'subreddit',
    forUserType: 'loggedOut',
    onPress: async (_event: MenuItemOnPressEvent, context: Context) => {
      const config = await getConfig(context);
      if (!config.appealAllowed) {
        context.ui.showToast('Appeals are not enabled for this community.');
        return;
      }
      context.ui.showForm(appealForm);
    },
  });
}
