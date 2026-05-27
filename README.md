# Gavel — Moderation Continuity Infrastructure for Reddit

> **Hackathon:** Reddit Mod Tools & Migrated Apps — May 2026
> **Category:** New Mod Tool

> *Tools provide signals. Humans provide decisions. Gavel preserves the context.*

Moderators don't struggle to remove content.
They struggle to **remember context**.

- *"What already happened with this user?"*
- *"Did another moderator already investigate this?"*
- *"Has this user appealed before?"*
- *"Why was this user warned last week?"*

Gavel is a native moderation continuity system for Reddit. It preserves behavioral context, investigation history, moderator coordination, and appeal decisions — directly inside Reddit's moderation workflows.

**One click. Instant context. No leaving Reddit.**

---

## The Problem

Every active moderation team eventually hits the same invisible operational wall:

```
ModA investigates u/problemuser and issues a warning.

Three weeks later — same user, new violation.
ModA is offline. The warning is forgotten. The pattern is invisible.
ModB starts from scratch.
```

The institutional knowledge lives in:
- Individual moderator memory
- Private Discord channels
- Spreadsheets that go stale
- Modmail threads that get buried

**When a moderator leaves, that knowledge disappears with them.**

Research into Reddit moderation workflows consistently identifies this as an unresolved operational gap — moderation teams lack shared context, coordination tools, and persistent behavioral memory across moderator shifts. \[1\]

---

## What Gavel Does

From any Reddit post or comment, any moderator can open the **moderation continuity record** for a user in one click:

```
🛡 (mod shield) → Gavel: View record
```

They instantly see:

```
u/problemuser
────────────────────────────────
Status: 🟠 Temporary ban · ⚠ 2 unresolved incidents · ✅ 12 resolved

📋 Risk summary
• 2 unresolved incidents
• 12 previously resolved
• Repeated post removals this week
• Previously unbanned 2 times
• Active investigation in progress
🕐 Last action: Permanent ban by ModA · 27th May '26

� Investigation owner: ModA
👥 Moderator coordination: ModA, ModB

Timeline
⚠ 27th May '26 (7h ago) · post → Warned
⛔ 26th May '26 · comment → Temporary ban
✅ 20th May '26 · post → Permanent ban · resolved by ModB
📝 19th May '26 · ModA: "Watch for ban evasion"
🤖 19th May '26 · gavel-mod: "Unbanned on 5/19/2026"
```

No external dashboards. No spreadsheets. No context switching.

---

## Core Features

### Moderation Continuity Record
A shared behavioral history visible to the entire moderator team. Tracks warnings, bans, moderator notes, appeals, resolved incidents, investigation ownership, and coordination history. Accessible directly from the mod shield menu on any post or comment.

### Risk Summary
A rule-based intelligence block at the top of every record. Surfaces pattern signals automatically:
- Repeated violation types
- Frequency spikes (rapid removals)
- Prior unban history
- Active investigation status
- Pending appeals

No AI. No external APIs. Derived purely from stored moderation history.

### Structured Incident Logging
Moderators can manually log incidents — harassment, spam, brigading, ban evasion, suspicious behavior — with optional actions: warn, temporary ban, permanent ban, or mute.

### Investigation Ownership
Moderators can claim investigations to prevent duplicate work and coordination confusion. The investigation owner is visible to all team members instantly.

### Incident Resolution Workflow
Moderators can resolve incidents, forgive strikes, unban users, and preserve behavioral timelines. Moderation decisions evolve over time instead of becoming permanent hidden baggage.

### Structured Appeals System
Instead of chaotic modmail threads — users submit structured appeals through Gavel. Moderators review behavioral history, inspect prior incidents, then forgive or uphold. Appeals become operational records, not lost conversations.

### Observation Mode
Gavel can log what it *would* have done without taking any action. This allows mod teams to verify thresholds and understand community impact before enabling enforcement.

```
Install → Observe → Verify → Enforce
```

Moderators stay in control. Gavel earns trust first.

### What Counts as a Strike

**Strikes** are the events that count toward the escalation threshold (warn → temp ban → perm ban):

- A moderator **removes a post or comment** via Reddit's native mod tools — logged automatically
- A moderator **manually adds an incident** via "Gavel: Add incident" — always counts as a strike

**Not strikes** — these are recorded in the timeline for context but do not count toward thresholds:

- Removals by **AutoModerator, bots, or Reddit's anti-evil team** — logged as signals only
- **Bans or unbans** applied directly via Reddit mod tools (outside Gavel) — synced to the record as notes
- **Mutes and unmutes** — synced as timeline notes
- **Spam-marked content** — logged as a signal in the timeline
- **Appeal submissions and decisions** — recorded as events, not strikes
- **Mod notes** — informational only

This separation means bot-driven removals never accidentally escalate a user, and mods retain full control over what actually counts.

---

## How to Use Gavel

### For Moderators

**1. View a user's moderation record**
On any post or comment → 🛡 mod shield → **Gavel: View record**
Instantly see ban status, risk summary, investigation owner, and full behavioral timeline.

**2. Log an incident manually**
On any post or comment → 🛡 mod shield → **Gavel: Add incident**
Record a moderation event with optional warn/ban/mute action.

**3. Resolve an incident**
On any post or comment → 🛡 mod shield → **Gavel: Resolve incident**
Clear strikes, unban users, and preserve resolution history.

**4. Claim an investigation**
On any post or comment → 🛡 mod shield → **Gavel: Claim investigation**
Mark yourself as the investigation owner. Visible to all moderators.

**5. Review appeals**
Subreddit page → ⋮ → **Gavel: Appeals queue** — see all pending appeals.
On any post or comment → 🛡 mod shield → **Gavel: Review appeal** — decide for a specific user.

**6. Add a moderator note**
On any post or comment → 🛡 mod shield → **Gavel: Add moderator note**
Leave a persistent note visible to all moderators.

**7. View your active investigations**
Subreddit page → ⋮ → **Gavel: My investigations** — see and manage users you've claimed.

### For Users

Submit an appeal → Subreddit page → ⋮ → **Gavel: Submit appeal**

### Setup

```bash
npm install -g devvit
devvit login
devvit playtest <your-test-subreddit>
```

1. Install from the Devvit app listing
2. Go to **Mod Tools → App Settings** and review defaults
3. Enable **Observation Mode** for your first week
4. After verifying, enable enforcement thresholds

---

## Enforcement Flow

```
Mod removes post or comment
        ↓
Gavel logs moderation event (visible to entire mod team)
        ↓
Checks active incident count against configured thresholds
        ↓
Incident 1 → Warning PM
Incident 2 → Temporary ban (configurable duration)
Incident 3 → Permanent ban
        ↓
User submits structured appeal
        ↓
Moderator reviews behavioral history → Forgive or Uphold
```

All thresholds, message templates, and ban durations are configurable per subreddit via App Settings.

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Enable Gavel | ON | Master on/off switch |
| Observation Mode | OFF | Log events without enforcement |
| Auto-track removals | ON | Log incident on every mod removal |
| Warning threshold | 1 incident | When to send warning PM |
| Temp ban threshold | 2 incidents | When to issue temp ban |
| Temp ban duration | 3 days | Length of temp ban |
| Perm ban threshold | 3 incidents | When to issue permanent ban |
| Allow appeals | ON | Enable structured appeal system |
| Re-appeal lockout | 30 days | Cooldown after upheld appeal |
| Incident expiry | 0 (never) | Days before an incident stops counting |

---

## Why Existing Tools Are Not Enough

| Tool | What it does well | What it doesn't cover |
|------|------------------|-----------------------|
| AutoModerator | Filtering, keyword automation, removals | Behavioral continuity, investigation ownership |
| Modqueue | Reviewing reported content | Persistent operational memory |
| Modmail | Communication | Structured context, searchable history |
| Toolbox | Workflow enhancements | Cross-mod memory, shared investigation state |

Gavel occupies a specific lane: **moderation continuity infrastructure** — working alongside these tools, not replacing them.

---

## Industry Direction

Reddit itself is actively moving toward contextual moderation tooling, user summaries, and collaborative moderation improvements. \[2\]

Gavel explores this direction directly inside native Reddit workflows — augmenting moderator continuity rather than replacing moderator judgment.

Moderation research consistently shows that decisions are context-sensitive, behavior-dependent, and difficult to standardize without shared operational memory. \[3\] Gavel focuses specifically on preserving that continuity across moderators and across time.

---

## Why This Is Built the Way It Is

Gavel is built entirely using:
- **Reddit Devvit** — `@devvit/public-api ^0.12.23`
- **TypeScript** — strict mode, ES2020
- **Devvit Redis** — all storage, zero external dependencies

**No external servers. No external dashboards. No browser extensions. No AI. No webhooks.**

Everything runs natively inside Reddit's Devvit environment — which means:
- Zero hosting cost
- Zero setup friction for moderators
- Works on mobile and desktop natively
- No data leaves Reddit's infrastructure

The Devvit platform uses native form-based UI components. This is an intentional constraint — it ensures Gavel works identically on mobile and desktop without custom rendering. Post and comment actions appear under the 🛡 mod shield menu. Subreddit-level actions (appeals queue, investigations, submit appeal) appear under the ⋮ menu on the subreddit page.

---

## What Gavel Is Not

- ❌ Not an AI moderator or content classifier
- ❌ Not a spam or bot detection engine
- ❌ Not a modqueue replacement
- ❌ Not an analytics dashboard
- ❌ Not autonomous moderation

**Humans still decide.**

Gavel preserves:
- moderation continuity,
- investigation context,
- behavioral history,
- moderator coordination,
- appeal records.

---

## The Philosophy

Most moderation systems optimize for **content removal**.

Gavel optimizes for **moderation continuity**.

Because moderation is not just removing content or issuing bans — it is preserving institutional understanding across people and across time.

> *Gavel remembers so moderators don't have to.*

---

## References

1. [**"Think about it like you're a firefighter": Understanding How Reddit Moderators Use the Modqueue**](https://arxiv.org/abs/2509.07314) — arXiv, 2025
   > *"We also identify persistent challenges around **review coordination, inconsistent interface signals, and reliance on third-party tools** [...] many still find the queue insufficient to inform their moderation decisions."*
   > — Directly validates Gavel: mods need coordination, shared signals, and persistent context that the modqueue does not provide.

2. [**Evolving Moderation on Reddit: Our Plans for the Year Ahead**](https://www.reddit.com/r/modnews/comments/1lp61my/evolving_moderation_on_reddit_our_plans_for_the/) — Reddit modnews, 2026
   > Reddit's own moderation roadmap identifies **contextual moderation tooling and collaborative moderator features** as strategic priorities for 2026.
   > — Reddit is moving toward the exact problem space Gavel already solves, natively, inside Devvit, today.

3. [**Multilingual Content Moderation: A Case Study on Reddit**](https://aclanthology.org/2023.eacl-main.276/) — ACL Anthology, EACL 2023
   > *"Moderation decisions are based on **violation of rules, which subsumes detection of offensive speech**, and such rules often differ across communities which entails an adaptive solution."*
   > — Validates why rule-based, per-community, human-in-the-loop systems like Gavel are necessary: automated classifiers alone cannot capture community-specific moderation context.

---

*Built for the Reddit Mod Tools & Migrated Apps Hackathon — May 2026*
