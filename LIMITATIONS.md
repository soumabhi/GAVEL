# LIMITATIONS.md — Devvit Public API Hard Constraints
# Verified against developers.reddit.com/docs — May 27, 2026
# Applies to: @devvit/public-api (not Devvit Web, not Blocks UI)

---

## 1. TOAST LIMITATIONS

| Constraint | Detail |
|---|---|
| Max length | ~80–100 chars before truncation — no overflow, no ellipsis control |
| Appearance options | Only `'neutral'` and `'success'` — no warning, error, info types |
| Multi-line | ❌ Impossible — newlines ignored, collapsed to space |
| Persistence | Auto-disappears — cannot be pinned or kept visible |
| From triggers | ❌ Cannot call `showToast` from `Devvit.addTrigger` or scheduled jobs |
| From triggers | ❌ Cannot call `showToast` from `Devvit.addTrigger` or scheduled jobs |
| Actionable | ❌ No buttons, links, or click targets inside a toast |
| Multiple toasts | Avoid — overlapping toasts are undefined behavior |

**Rule:** Toast = one-line confirmation only. Never use for content mods need to read.

---

## 2. FORM LIMITATIONS

### Layout
| Constraint | Detail |
|---|---|
| Structure | Flat vertical list of fields only — no columns, no grid |
| Tabs | ❌ Does not exist |
| Sections / dividers | ❌ Does not exist (only `group` type adds a label box) |
| Scrolling | ✅ Form scrolls if fields exceed viewport height |
| Custom width/height | ❌ Not controllable — Reddit sets the modal size |
| Header area | `title` (bold) + `description` (plain text) only |
| `description` newlines | ❌ `\n` collapsed to spaces — cannot use for structured content |
| Footer area | Two buttons only: `acceptLabel` + `cancelLabel` |

### Buttons
| Constraint | Detail |
|---|---|
| Max buttons | 2 total — one accept, one cancel |
| Button position | Fixed at bottom — cannot be moved |
| Inline buttons | ❌ No buttons inside field rows |
| Conditional buttons | ❌ Cannot show/hide buttons based on data |
| Button actions | Accept fires `onSubmit` handler; cancel dismisses — no custom actions |

### Fields
| Constraint | Detail |
|---|---|
| Available types | `string`, `paragraph`, `number`, `boolean`, `select`, `image`, `group` only |
| Custom field types | ❌ Not possible |
| Read-only fields | ❌ No native read-only — `disabled: true` greys out text color |
| Field ordering | Fixed by array order — cannot reorder dynamically after render |
| Max fields | No documented limit but large counts degrade UX |
| Clickable rows | ❌ No per-row actions or links |
| Icons per row | ❌ No icon support except emoji in label text |
| Timestamps per row | Only via label/defaultValue text — no native timestamp formatting |
| Conditional fields | ✅ Build fields array dynamically in the factory function |

### String field
| Property | Behaviour |
|---|---|
| `defaultValue` | Pre-fills input — field still looks editable (grey box) |
| `helpText` | Grey subtext below label — but empty input box still renders above it |
| `disabled: true` | Greys out text color — box still visible |
| `placeholder` | Shows hint text when field is empty |
| Single-line only | Cannot contain newlines — use `paragraph` for multi-line |

### Paragraph field
| Property | Behaviour |
|---|---|
| `defaultValue` | Pre-fills textarea — respects `\n` as line breaks |
| `lineHeight` | Controls visible rows before internal scroll |
| `disabled: true` | Greys out text but box still renders |
| Appearance | Looks like a textarea input — cannot be made to look like plain text |

### Boolean field
| Property | Behaviour |
|---|---|
| Renders as | Label text on left + toggle switch on right |
| `label` | The only place to put display content |
| `defaultValue` | Sets toggle on/off — irrelevant for display use |
| No input box | ✅ No grey text box — cleanest row format available |
| Toggle artifact | ❌ Toggle always visible — cannot be hidden |

### Select field
| Property | Behaviour |
|---|---|
| Renders as | Dropdown — requires user interaction to open |
| `defaultValue` | Must be `string[]` even for single-select |
| `multiSelect` | Allows multiple selections |
| Display use | ❌ Poor — looks interactive, not informational |

---

## 3. MENU ITEM LIMITATIONS

| Constraint | Detail |
|---|---|
| Locations | `'post'`, `'comment'`, `'subreddit'` only |
| `targetId` | Post/comment ID — NOT username. Must resolve via Reddit API |
| Username from subreddit | Must call `context.reddit.getCurrentUser()` — gives current mod, not target user |
| Response options | `showToast()` or `showForm()` only — no custom panels |
| Sort order | ❌ Cannot control order of items in the `···` menu |
| Dynamic labels | ❌ `label` is static — cannot change per-context |
| Icons | ❌ No icon support in menu item label |
| Separators | ❌ Cannot add visual dividers between menu items |
| Max items | No hard limit but Reddit UI truncates long menus |

---

## 4. TRIGGER LIMITATIONS

| Constraint | Detail |
|---|---|
| UI calls | ❌ Cannot call `showToast` or `showForm` from any trigger |
| Triggers are server-side | Runs in QuickJS VM — no browser context |
| ModAction event | Fires on ALL mod actions — must filter by `action` field |
| Double-fire risk | Same event can fire twice — use Redis debounce with TTL |
| Bot detection | `moderatorUsername` is `'devvit-dev-bot'` or similar for automated actions |
| Deleted users | `targetUser.name` may be `[deleted]` — must guard |
| No chaining | Cannot call `showForm` after trigger completes — no UI surface |

---

## 5. NAVIGATION LIMITATIONS

| Constraint | Detail |
|---|---|
| `navigateTo()` | Can redirect to a URL — opens in same tab |
| Cannot open modals | ❌ `navigateTo` cannot open a form or panel |
| Cannot navigate to Reddit profile | Technically works but takes mod away from context |

---

## 6. WHAT DOES NOT EXIST IN DEVVIT PUBLIC API

These are commonly desired UI patterns that simply do not exist:

| Desired | Reality |
|---|---|
| Custom panel / sidebar | ❌ |
| Persistent overlay / HUD | ❌ |
| Tabs or accordion | ❌ |
| Data table / list with columns | ❌ |
| Markdown rendering in forms | ❌ |
| HTML in any field | ❌ |
| Clickable links inside forms | ❌ |
| Multiple action buttons in form body | ❌ |
| Per-row actions or buttons | ❌ |
| Icons in form rows | ❌ (emoji only) |
| Custom CSS / styling | ❌ |
| Animations | ❌ |
| Images in display context | ❌ (only image upload field) |
| Toast with more than 2 appearance types | ❌ |
| Form that stays open after submit | ❌ |
| Real-time updates in open form | ❌ |
| Toast from trigger / scheduled job | ❌ |

---

## 7. PLAYTEST-SPECIFIC BEHAVIOURS (not production bugs)

| Behaviour | Cause |
|---|---|
| Mod usernames show as `[ Redacted ]` | Playtest privacy mask — real names in production |
| Post/comment titles show as `[ Removed by Reddit ]` | Same — playtest mask on removed content |
| `getCurrentUser()` returns test account | Expected — use real mod account in production |

---

## 8. WHAT REQUIRES DEVVIT WEB / BLOCKS UI TO ACHIEVE

If you need any of the following, you must migrate away from `@devvit/public-api`:

- Custom UI panels with React components
- Row-based list with icon + text + timestamp (like Reddit's "Previous Actions")
- Tabs, accordions, collapsible sections
- Buttons inside content (not just form footer)
- Real-time data refresh without user action
- Custom modal layouts with multiple action buttons
- Full HTML/CSS rendering

**Devvit Web** = Node.js + Hono + React frontend (`src/client/`)
**Blocks UI** = `<vstack>/<hstack>/<text>` rendered inside a Reddit post

Both require significant architecture changes and are not recommended before the hackathon deadline.
