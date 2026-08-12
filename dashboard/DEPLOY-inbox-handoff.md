# Hand-off: Deploy the upgraded Leads Inbox

This work was drafted in a **cloud session** with no SFTP access. Finish it in a
**local Claude Code session** (or by hand) that has FileZilla + the SFTP login.

**Branch:** `claude/dashboard-inbox-update-lkuvnu`
**What ships:** a richer "Leads" admin page — two-pane triage inbox with contact
info, AI summary/notes, and the full conversation thread (which the current
inbox stores in `wp_paa_conversations` but never displays).

---

## Files on the branch

| File | Purpose |
|---|---|
| `dashboard/render_leads_page.php` | The new `render_leads_page()` method — the thing you deploy |
| `dashboard/lead-inbox.html` | Standalone visual prototype (reference only, do NOT deploy) |
| `dashboard/DEPLOY-inbox-handoff.md` | This file |

**Target on the server (SFTP):**
`/wp-content/plugins/property-ai-assistant/includes/class-admin-dashboard.php`

---

## Step 1 — Get the branch and the live file

```bash
git fetch origin
git checkout claude/dashboard-inbox-update-lkuvnu
```

In **FileZilla** (`sftp://mattgabmanagement.com`, port 2207):
- Download `.../includes/class-admin-dashboard.php` to your desktop.
- **Keep a copy named `class-admin-dashboard.BACKUP.php`.** This is your rollback.

## Step 2 — Safety check: is the live file still a plain leads table?

Open the live file and find:

```php
public function render_leads_page() {
```

The current (expected) version just builds a `<table class="widefat">` of leads
with a status `<select>`. **If the live `render_leads_page()` looks materially
different — someone already customized it — STOP and diff carefully before
replacing.** Otherwise continue.

> Baseline reference: this method was last seen (Feb 11, 2026 copy in Google
> Drive → folder `property-ai-assistant 3/includes/`) as a simple filter-bar +
> table. If live matches that shape, you're safe.

## Step 3 — Swap in the new method

In the **live** `class-admin-dashboard.php`, replace the **entire**
`render_leads_page()` method — from its signature line:

```php
    public function render_leads_page() {
```

down to its closing `}` that sits **immediately before** the next method:

```php
    /**
     * Analytics page
     */
    public function render_analytics_page() {
```

Paste in the replacement method from `dashboard/render_leads_page.php`
(everything from line 46 — the `public function render_leads_page() {` — to the
final `}` at end of file). Do **not** copy the file's top `<?php` or the header
comment block; only the method itself.

Nothing else in the class changes. No constructor edit, no new AJAX handler.

## Step 4 — One field to confirm: `notes` vs `ai_summary`

The new method shows the AI summary from the **`notes`** column
(`$selected->notes`). Confirm where your voice agent's summary actually lands:

- Check `lead-api.php` on the server (what column it writes the summary to), or
- Look at a recent voice lead row in `wp_paa_leads`.

If the summary lives in a dedicated **`ai_summary`** column instead, do a
find/replace in the new method: `$selected->notes` → `$selected->ai_summary`
(two occurrences, both in the "AI Summary / Notes" block). If it's in `notes`,
change nothing.

## Step 5 — Verify syntax before upload

```bash
php -l class-admin-dashboard.php
# expect: No syntax errors detected
```

If PHP isn't handy locally, at minimum confirm brace balance didn't break.

## Step 6 — Deploy

Upload the edited `class-admin-dashboard.php` back to
`/wp-content/plugins/property-ai-assistant/includes/` via FileZilla (overwrite).

## Step 7 — Smoke test in wp-admin

Go to **WP Admin → AI Assistant → Leads** and confirm:

- [ ] Page loads with no PHP error (white screen = check `php -l` / error log,
      re-upload the BACKUP if needed).
- [ ] Status filter chips (New/Contacted/Qualified/Converted/Lost) show counts.
- [ ] Clicking a lead opens the right-hand detail pane.
- [ ] The status dropdown in the detail pane still saves (reuses existing AJAX).
- [ ] A lead that had a chat shows its conversation thread.
- [ ] A voice/Zillow lead with no thread shows the graceful "no conversation"
      note rather than an error.
- [ ] Duplicate rows (shared phone/email) show the "dup" flag.

## Rollback

Re-upload `class-admin-dashboard.BACKUP.php` over the live file. Instant revert.

---

## Known follow-ups (not blockers for this deploy)

- **Conversation threads only appear where rows are written to
  `wp_paa_conversations` with a matching `lead_id`.** Chat is confirmed; verify
  voice/SMS write there too (via `lead-api.php`). If they don't, the thread view
  shows chat only until that's wired — the summary/notes still show.
- **Zillow duplicate rows** are only *flagged* here, not merged. Real de-dup
  belongs at insert time in `lead-api.php` (`save_lead` inserts with no dedup).
- **Pagination** is done in PHP (25/page). Fine for current volume; for scale,
  add `LIMIT/OFFSET` support to `PAA_Database::get_leads()`.
