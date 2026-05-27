# DEVVIT PUBLIC UI — Gavel Reference
# Source: developers.reddit.com/docs (verified May 27, 2026)
# Scope: Devvit Public API ONLY — NOT Devvit Web, NOT Blocks, NOT React

---

## 0. THE THREE UI PRIMITIVES (all that exist)

```
showToast()     — bottom-of-screen notification, auto-disappears
showForm()      — modal dialog, fields + submit/cancel buttons
navigateTo()    — redirect to a URL (rarely useful for mod tools)
```

**Critical rule:** All three ONLY work in response to a user-initiated action.
They will NOT work from `Devvit.addTrigger` or `Devvit.addSchedulerJob`.

---

## 1. TOASTS

### What they are
Brief, non-intrusive messages at the bottom of the screen.
Auto-disappear after a few seconds.
**Not expandable. Not scrollable. Truncate at ~80-100 chars.**

### API
```typescript
ui.showToast('Simple text message');

ui.showToast({
  text: 'Operation successful!',
  appearance: 'success', // 'neutral' | 'success'  (only two options)
});
```

### Properties
| Property     | Type     | Required | Default     |
|-------------|----------|----------|-------------|
| `text`      | string   | yes      | —           |
| `appearance`| string   | no       | `'neutral'` |

### When to use
- ✅ Confirming an action completed ("Strike logged.")
- ✅ Error messages ("Could not identify user.")
- ✅ One-line status ("u/foo — no history in this community.")
- ❌ NOT for multi-line content
- ❌ NOT for content mods need to read carefully
- ❌ NOT for critical information

### Gavel pattern
```typescript
// Quick confirm after logging a strike
ui.showToast({ text: `Strike logged for u/${username}. Now at ${count} events.`, appearance: 'success' });

// Error fallback
ui.showToast('Could not identify user.');
```

---

## 2. FORMS

### What they are
Modal dialogs. The **primary display surface** for Devvit Public API apps.
Scrollable. Can have multiple fields. Mod must explicitly close/submit.

### Creating a form (Devvit Public API pattern)
```typescript
// Defined ONCE at module level, NOT inside handlers
export const myForm = Devvit.createForm(
  (data: Record<string, string>) => ({
    title: 'Form title',
    description: 'Optional subtitle text rendered below title',
    fields: [
      { type: 'string',    name: 'f1', label: 'Label', defaultValue: data['f1'] ?? '' },
      { type: 'paragraph', name: 'f2', label: 'Notes', defaultValue: data['f2'] ?? '' },
    ],
    acceptLabel: 'Submit',  // undefined = 'Submit'
    cancelLabel: 'Cancel',  // '' or undefined = hide cancel button
  }),
  async (event, context) => {
    const val = event.values['f1'] as string;
    // handle submission
  }
);
```

### Showing a form with dynamic data
```typescript
// In a menu item handler:
ui.showForm(myForm, { f1: 'pre-populated value', f2: 'another value' });
```

The second argument (`data`) is passed into the form factory function as `data`.

### Form object properties
| Property      | Type        | Required | Notes                              |
|--------------|-------------|----------|------------------------------------|
| `title`       | string      | no       | Bold header of modal               |
| `description` | string      | no       | Subtext below title — plain text, newlines collapse to spaces |
| `fields`      | FormField[] | yes      | Array of field configs             |
| `acceptLabel` | string      | no       | Submit button label (default: 'Submit') |
| `cancelLabel` | string      | no       | Cancel button label; `''` = hide   |

### ⚠ description newline behaviour
**`description` does NOT preserve `\n` as line breaks in Reddit's renderer.**
Newlines are collapsed into spaces. Do not use `description` for structured text.
Use multiple `string` fields instead for structured display.

---

## 3. FORM FIELD TYPES

### string — single-line text input
```typescript
{
  type: 'string',
  name: 'username',
  label: 'Username',
  defaultValue: 'pre-filled',    // optional
  helpText: 'Enter lowercase',   // optional — grey subtext under field
  placeholder: 'e.g. johndoe',  // optional — grey placeholder text
  required: false,               // optional
  disabled: false,               // optional — greys out field, mutes text color
}
```
**Use for:** Single-line display values, short inputs.
**Display as mod read-only info:** Set `defaultValue`, label is the field title.

### paragraph — multi-line text input
```typescript
{
  type: 'paragraph',
  name: 'notes',
  label: 'Notes',
  defaultValue: 'pre-filled multiline\ntext here',
  helpText: 'Optional hint',
  placeholder: 'Enter notes...',
  required: false,
  disabled: false,
  lineHeight: 3,   // optional — controls visible height (number of lines shown)
}
```
**Use for:** Multi-line text. Accepts `\n` in `defaultValue`.
**Key property:** `lineHeight` controls visible rows before scrolling.
**Caution:** Field appears as a textarea input box — looks editable even if read-only.

### select — dropdown
```typescript
{
  type: 'select',
  name: 'action',
  label: 'Action',
  options: [
    { label: 'Warn', value: 'warn' },
    { label: 'Temp Ban', value: 'temp_ban' },
  ],
  defaultValue: ['warn'],   // array even for single-select
  multiSelect: false,
}
```

### number — numeric input
```typescript
{ type: 'number', name: 'days', label: 'Ban days', defaultValue: 3 }
```

### boolean — toggle/checkbox
```typescript
{ type: 'boolean', name: 'notify', label: 'Notify user', defaultValue: true }
```

### group — visual grouping of fields
```typescript
{
  type: 'group',
  label: 'Section header',
  helpText: 'Optional group description',
  fields: [
    { type: 'string', name: 'f1', label: 'Field 1' },
    { type: 'paragraph', name: 'f2', label: 'Field 2' },
  ],
}
```
**Use for:** Visually separating sections in a long form.

### image — file upload
```typescript
{ type: 'image', name: 'img', label: 'Upload image', required: true }
```
Formats: PNG, JPEG, WEBP, GIF. Max 20MB.

---

## 4. USING FORMS AS READ-ONLY DISPLAY (Gavel pattern)

Since Devvit has no panels, cards, or view-only components, forms are the
correct pattern for displaying structured mod context. Key learnings:

### Best approach: multiple `string` fields
Each `string` field renders as a labelled row — clean, like Reddit's native UI.
```typescript
fields: [
  { type: 'string', name: 'ban',   label: 'Ban status',    defaultValue: '🔴 Permanent ban' },
  { type: 'string', name: 'mods',  label: 'Mods involved', defaultValue: 'ModA, ModB' },
  { type: 'string', name: 'count', label: 'Events',        defaultValue: '4 active · 4 total' },
  { type: 'string', name: 'ev0',   label: 'Timeline',      defaultValue: '🔴 5/27/2026 · post "Title"' },
  { type: 'string', name: 'ev1',   label: ' ',             defaultValue: '⚠ 5/26/2026 · comment' },
]
```
- Use `label: ' '` (single space) for continuation rows with no heading
- Do NOT set `disabled: true` — it mutes the text color making it hard to read
- Each field becomes its own visually separated card row

### DO NOT use description for structured content
`description` collapses newlines. Only use it for a single sentence of context.

### Dynamic field arrays
```typescript
export const contextViewForm = Devvit.createForm(
  (data: Record<string, string>) => {
    const fields = [];
    if (data['ban'])  fields.push({ type: 'string', name: 'ban', label: 'Ban status', defaultValue: data['ban'] });
    // add fields conditionally based on data presence
    return { title: `Gavel · u/${data['username']}`, fields, acceptLabel: 'Done', cancelLabel: '' };
  },
  async () => {} // no-op handler for read-only forms
);
```

---

## 5. MENU ITEMS

### Adding a mod-only menu item
```typescript
Devvit.addMenuItem({
  label: 'Gavel: View context',
  location: ['post', 'comment', 'subreddit'],
  forUserType: 'moderator',
  onPress: async (event, context) => {
    const { targetId, location } = event;
    // targetId is a post/comment/subreddit ID — NOT a username
    // Must resolve username via Reddit API:
    const post = await context.reddit.getPostById(targetId);
    const username = post?.authorName;
    // Then do work...
    context.ui.showToast('Done');
    // OR
    context.ui.showForm(myForm, { data: 'value' });
  },
});
```

### Resolving username from targetId
```typescript
async function resolveUsername(event, context) {
  try {
    if (event.location === 'post') {
      const post = await context.reddit.getPostById(event.targetId);
      return post?.authorName;
    }
    if (event.location === 'comment') {
      const comment = await context.reddit.getCommentById(event.targetId);
      return comment?.authorName;
    }
    if (event.location === 'subreddit') {
      const user = await context.reddit.getCurrentUser();
      return user?.username;
    }
  } catch { return undefined; }
}
```

### Location options
| Value        | Where it appears              |
|-------------|-------------------------------|
| `'post'`    | `···` menu on posts           |
| `'comment'` | `···` menu on comments        |
| `'subreddit'`| Subreddit overflow menu      |

### forUserType
| Value           | Who sees it    |
|----------------|----------------|
| `'moderator'`  | Mods only ✅   |
| `'member'`     | All users      |
| `'loggedIn'`   | Logged-in only |

---

## 6. TRIGGERS (ModAction)

```typescript
Devvit.addTrigger({
  event: 'ModAction',
  onEvent: async (event, context) => {
    const { action, targetUser, moderator, subreddit } = event;
    // action: 'removelink' | 'removecomment' | 'banuser' | etc.
    // targetUser: { name, id }
    // moderator: { name, id }
    // ⚠ Cannot call ui.showToast or ui.showForm here — triggers are server-side only
  },
});
```

**Critical:** `showToast` and `showForm` WILL NOT WORK inside triggers.
Triggers are fire-and-forget server events — no UI surface available.

---

## 7. KNOWN PLATFORM BEHAVIOURS (learned from playtesting)

| Behaviour | Detail |
|-----------|--------|
| Toast truncation | ~80-100 chars, then `...`. Never use toast for multi-line context |
| `disabled: true` on fields | Mutes text color — avoid for display-only fields |
| `description` newlines | Collapsed to spaces — do not use for structured content |
| `paragraph` defaultValue | Respects `\n` — use for long free-form text blocks |
| `cancelLabel: ''` | Hides cancel button entirely — good for display-only forms |
| Moderator usernames in playtest | Shown as `[ Redacted ]` — normal in playtest, real names in production |
| Removed content titles in playtest | Shown as `[ Removed by Reddit ]` — same, playtest only |
| `forUserType: 'moderator'` | Menu item hidden from non-mods correctly |

---

## 8. GAVEL-SPECIFIC PATTERNS

### View context flow
```
Mod clicks "Gavel: View context"
  → resolve username from targetId
  → getUserRecord(redis, subredditId, username)
  → if no record: showToast("no history")
  → if record: build formData with individual fields per section
  → showForm(contextViewForm, formData)
```

### Action confirmation flow
```
Mod fills form → onSubmit fires
  → write to Redis
  → showToast("✅ Action confirmed")  ← confirmation only, not display
```

### Field labelling convention for Gavel display forms
```
'Ban status'    → ban/appeal/investigation status
'Mods involved' → who has touched this user
'Events'        → count summary
'Timeline'      → first event (label)
' '             → subsequent events (blank label = continuation)
'Notes'         → latest mod note
'Tool signals'  → AutoModerator/bot removal summary
```

---

## 9. WHAT DOES NOT EXIST (do not attempt)

- ❌ Panels or sidebars
- ❌ Tabs or accordions
- ❌ Custom CSS or styling
- ❌ HTML rendering in any field
- ❌ Markdown rendering in form fields
- ❌ Images in forms (except image upload field)
- ❌ Clickable links inside forms
- ❌ Toast with more than 2 appearance types
- ❌ Multi-action buttons inside forms
- ❌ showToast / showForm from triggers or scheduled jobs
