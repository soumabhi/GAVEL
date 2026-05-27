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
  actionTaken?: 'warning' | 'temp_ban' | 'permanent_ban' | 'none'; // what Gavel did
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
  toolSignals?: ToolSignal[];       // max 50; automated tool removals (no discipline)
  modNotes?: ModNote[];             // max 50; manual mod annotations
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

// ─── Tool Signals (automated removals — separate from human strikes) ──────────

export interface ToolSignal {
  toolName: string;                 // e.g. 'AutoModerator', 'BotBouncer'
  contentType: 'post' | 'comment';
  contentTitle?: string;            // first 80 chars
  timestamp: string;                // ISO 8601
}

// ─── Mod Notes (manual annotations by mods) ───────────────────────────────────

export interface ModNote {
  id: string;                       // `note:${subredditId}:${username}:${Date.now()}`
  addedBy: string;                  // mod username
  note: string;                     // up to 300 chars
  timestamp: string;                // ISO 8601
}

// ─── Ownership / Investigation ────────────────────────────────────────────────

export interface OwnershipRecord {
  username: string;                 // target user being reviewed (lowercase)
  subredditId: string;
  claimedBy: string[];              // mods who have claimed this review (append-only)
  claimedAt: string;                // ISO 8601 of first claim
  status: 'reviewing' | 'resolved';
  note?: string;                    // optional context note from the mod
  resolvedAt?: string;              // ISO 8601
}

// ─── Observation ──────────────────────────────────────────────────────────────

export interface ObservationLogEntry {
  username: string;
  wouldHaveAction: 'warning' | 'temp_ban' | 'permanent_ban';
  banDays?: number;
  activeStrikeCount: number;
  strikeId: string;
  timestamp: string;
  subredditName: string;
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
  observationMode: true,
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
