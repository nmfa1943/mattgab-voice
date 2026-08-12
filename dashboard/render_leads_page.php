<?php
/**
 * ============================================================================
 * UPGRADED LEADS INBOX  —  drop-in replacement for PAA_Admin_Dashboard::render_leads_page()
 * ============================================================================
 *
 * WHAT THIS IS
 *   A richer replacement for the flat leads table currently rendered by
 *   render_leads_page() in includes/class-admin-dashboard.php. It turns the
 *   "Leads" admin page into a two-pane triage inbox:
 *     - Left  : filterable, searchable, paginated list of leads
 *     - Right : detail pane with contact info, AI summary/notes, and the FULL
 *               conversation thread (pulled from wp_paa_conversations, which the
 *               current inbox never displays)
 *
 * WHY IT IS SAFE TO DROP IN
 *   - No database schema change. Reads only existing tables/columns.
 *   - Reuses existing methods only: PAA_Database::get_leads(),
 *     ::get_lead_counts(), ::get_lead_sources(), ::get_conversations().
 *   - Lead selection is done server-side via a ?lead=ID query param (a normal
 *     page reload) — NO new AJAX endpoint, NO change to the constructor.
 *   - Status changes reuse the EXISTING .paa-status-select AJAX handler and
 *     admin.js, unchanged.
 *   - All CSS/JS is inlined and scoped under .paa-inbox so it cannot collide
 *     with wp-admin or other plugin styles.
 *
 * HOW TO DEPLOY
 *   1. In includes/class-admin-dashboard.php, replace the entire existing
 *      public function render_leads_page() { ... } with the method below.
 *   2. Nothing else changes.
 *
 * ASSUMPTIONS TO VERIFY AGAINST LIVE CODE (see chat notes)
 *   - The wp_paa_leads "notes" column is where the voice agent's ai_summary
 *     lands. If the live schema added a dedicated ai_summary column, change
 *     $lead->notes to $lead->ai_summary in _paa_render_summary_block().
 *   - Conversation threads only appear for leads whose channel actually writes
 *     rows into wp_paa_conversations with a matching lead_id. Chat is confirmed;
 *     voice/SMS need lead-api.php verified. The pane degrades gracefully when a
 *     lead has no stored conversation.
 * ============================================================================
 */

    /**
     * Leads management page — triage inbox.
     */
    public function render_leads_page() {
        // ---- Inputs -------------------------------------------------------
        $status_filter = sanitize_text_field($_GET['status'] ?? '');
        $source_filter = sanitize_text_field($_GET['source'] ?? '');
        $search        = trim(sanitize_text_field($_GET['s'] ?? ''));
        $selected_id   = intval($_GET['lead'] ?? 0);
        $paged         = max(1, intval($_GET['paged'] ?? 1));
        $per_page      = 25;
        $statuses      = array('new', 'contacted', 'qualified', 'converted', 'lost');

        // ---- Fetch (respect status/source filters at the DB layer) --------
        $args = array();
        if ($status_filter !== '') $args['status'] = $status_filter;
        if ($source_filter !== '') $args['source'] = $source_filter;
        $all = PAA_Database::get_leads($args);
        if (!is_array($all)) $all = array();

        // ---- Free-text search (name / email / phone / interest) -----------
        if ($search !== '') {
            $needle = strtolower($search);
            $all = array_values(array_filter($all, function ($l) use ($needle) {
                $hay = strtolower(($l->name ?? '') . ' ' . ($l->email ?? '') . ' ' .
                                  ($l->phone ?? '') . ' ' . ($l->property_interest ?? ''));
                return strpos($hay, $needle) !== false;
            }));
        }

        // ---- Duplicate detection (same phone or email across rows) --------
        $phone_counts = array();
        $email_counts = array();
        foreach ($all as $l) {
            $p = preg_replace('/\D/', '', (string) ($l->phone ?? ''));
            if ($p !== '') $phone_counts[$p] = ($phone_counts[$p] ?? 0) + 1;
            $e = strtolower(trim((string) ($l->email ?? '')));
            if ($e !== '') $email_counts[$e] = ($email_counts[$e] ?? 0) + 1;
        }
        $is_dupe = function ($l) use ($phone_counts, $email_counts) {
            $p = preg_replace('/\D/', '', (string) ($l->phone ?? ''));
            $e = strtolower(trim((string) ($l->email ?? '')));
            return ($p !== '' && ($phone_counts[$p] ?? 0) > 1) ||
                   ($e !== '' && ($email_counts[$e] ?? 0) > 1);
        };

        // ---- Summary counts + sources -------------------------------------
        $counts  = PAA_Database::get_lead_counts();
        $sources = PAA_Database::get_lead_sources();
        if (!is_array($sources)) $sources = array();

        // ---- Pagination (in PHP; get_leads has no offset support) ---------
        $total = count($all);
        $pages = max(1, (int) ceil($total / $per_page));
        $paged = min($paged, $pages);
        $page_leads = array_slice($all, ($paged - 1) * $per_page, $per_page);

        // ---- Resolve the selected lead + its conversation -----------------
        $selected = null;
        foreach ($all as $l) {
            if ((int) $l->id === $selected_id) { $selected = $l; break; }
        }
        if (!$selected && !empty($page_leads)) {
            $selected = $page_leads[0];       // default to first visible lead
        }
        $convo = array();
        if ($selected) {
            $convo = PAA_Database::get_conversations((int) $selected->id);
            if (!is_array($convo)) $convo = array();
        }

        // Base URL for links that preserve the current filters/search.
        $base_args = array('page' => 'paa-leads');
        if ($status_filter !== '') $base_args['status'] = $status_filter;
        if ($source_filter !== '') $base_args['source'] = $source_filter;
        if ($search !== '')        $base_args['s']      = $search;
        $base_url = admin_url('admin.php?' . http_build_query($base_args));
        $link = function ($extra = array()) use ($base_url) {
            return esc_url($base_url . (empty($extra) ? '' : '&' . http_build_query($extra)));
        };
        ?>
        <div class="wrap paa-inbox">
            <h1>Leads Inbox</h1>

            <!-- Summary stat row -->
            <div class="paa-ib-stats">
                <div class="paa-ib-stat"><span class="n"><?php echo intval($counts['total']); ?></span><span class="l">Total</span></div>
                <div class="paa-ib-stat is-new"><span class="n"><?php echo intval($counts['new']); ?></span><span class="l">New</span></div>
                <div class="paa-ib-stat"><span class="n"><?php echo intval($counts['contacted']); ?></span><span class="l">Contacted</span></div>
                <div class="paa-ib-stat"><span class="n"><?php echo intval($counts['qualified']); ?></span><span class="l">Qualified</span></div>
                <div class="paa-ib-stat is-won"><span class="n"><?php echo intval($counts['converted']); ?></span><span class="l">Converted</span></div>
            </div>

            <!-- Filter + search bar -->
            <div class="paa-ib-toolbar">
                <div class="paa-ib-filters">
                    <a href="<?php echo $link(); ?>" class="paa-ib-chip <?php echo $status_filter === '' ? 'is-active' : ''; ?>">All</a>
                    <?php foreach ($statuses as $s): ?>
                        <a href="<?php echo esc_url(add_query_arg('status', $s, $link())); ?>"
                           class="paa-ib-chip <?php echo $status_filter === $s ? 'is-active' : ''; ?>">
                            <?php echo esc_html(ucfirst($s)); ?>
                            <span class="c"><?php echo intval($counts[$s] ?? 0); ?></span>
                        </a>
                    <?php endforeach; ?>
                </div>
                <form method="get" class="paa-ib-search">
                    <input type="hidden" name="page" value="paa-leads" />
                    <?php if ($status_filter !== ''): ?><input type="hidden" name="status" value="<?php echo esc_attr($status_filter); ?>" /><?php endif; ?>
                    <?php if ($source_filter !== ''): ?><input type="hidden" name="source" value="<?php echo esc_attr($source_filter); ?>" /><?php endif; ?>
                    <input type="search" name="s" value="<?php echo esc_attr($search); ?>" placeholder="Search name, phone, email&hellip;" />
                    <button type="submit" class="button">Search</button>
                    <?php if ($search !== ''): ?><a href="<?php echo esc_url(remove_query_arg('s', $link())); ?>" class="button">Clear</a><?php endif; ?>
                </form>
            </div>

            <?php if (!empty($sources)): ?>
            <div class="paa-ib-sources">
                <span class="lbl">Source:</span>
                <a href="<?php echo esc_url(remove_query_arg('source', $link())); ?>" class="<?php echo $source_filter === '' ? 'is-active' : ''; ?>">All</a>
                <?php foreach ($sources as $src): ?>
                    <a href="<?php echo esc_url(add_query_arg('source', $src->source, $link())); ?>"
                       class="<?php echo $source_filter === $src->source ? 'is-active' : ''; ?>">
                        <?php echo esc_html(ucfirst(str_replace('_', ' ', $src->source))); ?> (<?php echo intval($src->count); ?>)
                    </a>
                <?php endforeach; ?>
            </div>
            <?php endif; ?>

            <!-- Two-pane inbox -->
            <div class="paa-ib-layout">

                <!-- LIST -->
                <div class="paa-ib-list">
                    <?php if (empty($page_leads)): ?>
                        <div class="paa-ib-empty">No leads match these filters.</div>
                    <?php else: ?>
                        <?php foreach ($page_leads as $l):
                            $sel   = ($selected && (int) $selected->id === (int) $l->id);
                            $name  = $l->name !== '' ? $l->name : '(No name)';
                            $st    = $l->status ?: 'new';
                            $dupe  = $is_dupe($l);
                        ?>
                        <a class="paa-ib-card <?php echo $sel ? 'is-selected' : ''; ?>"
                           href="<?php echo $link(array('lead' => (int) $l->id, 'paged' => $paged)); ?>">
                            <div class="row1">
                                <span class="nm"><?php echo esc_html($name); ?></span>
                                <span class="dt"><?php echo esc_html(date('M j', strtotime($l->created_at))); ?></span>
                            </div>
                            <div class="row2">
                                <span class="paa-ib-badge st-<?php echo esc_attr($st); ?>"><?php echo esc_html(ucfirst($st)); ?></span>
                                <?php if (!empty($l->source)): ?><span class="paa-ib-tag"><?php echo esc_html(ucfirst(str_replace('_', ' ', $l->source))); ?></span><?php endif; ?>
                                <?php if (!empty($l->property_interest)): ?><span class="paa-ib-tag"><?php echo esc_html($l->property_interest); ?></span><?php endif; ?>
                                <?php if ($dupe): ?><span class="paa-ib-flag" title="Another lead shares this phone or email">&#9888; dup</span><?php endif; ?>
                            </div>
                        </a>
                        <?php endforeach; ?>
                    <?php endif; ?>

                    <?php if ($pages > 1): ?>
                    <div class="paa-ib-pager">
                        <?php if ($paged > 1): ?><a class="button" href="<?php echo $link(array('paged' => $paged - 1)); ?>">&laquo; Prev</a><?php endif; ?>
                        <span class="pg">Page <?php echo intval($paged); ?> of <?php echo intval($pages); ?> &middot; <?php echo intval($total); ?> leads</span>
                        <?php if ($paged < $pages): ?><a class="button" href="<?php echo $link(array('paged' => $paged + 1)); ?>">Next &raquo;</a><?php endif; ?>
                    </div>
                    <?php endif; ?>
                </div>

                <!-- DETAIL -->
                <div class="paa-ib-detail">
                    <?php if (!$selected): ?>
                        <div class="paa-ib-empty">Select a lead to see the conversation and details.</div>
                    <?php else:
                        $name  = $selected->name !== '' ? $selected->name : '(No name)';
                        $st    = $selected->status ?: 'new';
                    ?>
                        <div class="paa-ib-dhead">
                            <div class="paa-ib-dtop">
                                <h2><?php echo esc_html($name); ?></h2>
                                <select class="paa-status-select paa-ib-status" data-lead-id="<?php echo intval($selected->id); ?>">
                                    <?php foreach ($statuses as $s): ?>
                                        <option value="<?php echo esc_attr($s); ?>" <?php selected($st, $s); ?>><?php echo esc_html(ucfirst($s)); ?></option>
                                    <?php endforeach; ?>
                                </select>
                            </div>
                            <div class="paa-ib-contact">
                                <?php if (!empty($selected->phone)): ?>
                                    <span>&#128222; <a href="tel:<?php echo esc_attr(preg_replace('/[^0-9+]/', '', $selected->phone)); ?>"><?php echo esc_html($selected->phone); ?></a></span>
                                <?php else: ?>
                                    <span class="paa-ib-flag">&#9888; No phone captured</span>
                                <?php endif; ?>
                                <?php if (!empty($selected->email)): ?>
                                    <span>&#9993; <a href="mailto:<?php echo esc_attr($selected->email); ?>"><?php echo esc_html($selected->email); ?></a></span>
                                <?php endif; ?>
                            </div>
                            <div class="paa-ib-dmeta">
                                <?php if (!empty($selected->source)): ?><span class="paa-ib-tag"><?php echo esc_html(ucfirst(str_replace('_', ' ', $selected->source))); ?></span><?php endif; ?>
                                <?php if (!empty($selected->property_interest)): ?><span class="paa-ib-tag"><?php echo esc_html($selected->property_interest); ?></span><?php endif; ?>
                                <span class="paa-ib-tag"><?php echo esc_html(date('M j, Y g:ia', strtotime($selected->created_at))); ?></span>
                                <?php if ($is_dupe($selected)): ?><span class="paa-ib-flag">&#9888; Possible duplicate</span><?php endif; ?>
                            </div>
                        </div>

                        <?php // ---- AI summary / notes ---- ?>
                        <div class="paa-ib-section">
                            <h4>AI Summary / Notes</h4>
                            <?php if (!empty($selected->notes)): ?>
                                <div class="paa-ib-summary"><?php echo esc_html($selected->notes); ?></div>
                            <?php else: ?>
                                <div class="paa-ib-summary is-missing">&#9888; No summary recorded for this lead. If this is a voice or Zillow lead, the auto-reply may not have logged a summary here &mdash; worth a manual check.</div>
                            <?php endif; ?>
                        </div>

                        <?php // ---- Conversation thread (the data the old inbox hid) ---- ?>
                        <div class="paa-ib-section">
                            <h4>Conversation<?php echo !empty($convo) ? ' (' . count($convo) . ')' : ''; ?></h4>
                            <?php if (empty($convo)): ?>
                                <div class="paa-ib-summary is-missing">No stored conversation for this lead yet.</div>
                            <?php else: ?>
                                <div class="paa-ib-thread">
                                    <?php foreach ($convo as $m):
                                        $role   = strtolower((string) ($m->role ?? 'user'));
                                        $is_out = in_array($role, array('assistant', 'ai', 'agent', 'bot', 'system'), true);
                                        $who    = $is_out ? 'AI Agent' : ($name !== '(No name)' ? $name : 'Prospect');
                                    ?>
                                        <div class="paa-ib-msg <?php echo $is_out ? 'out' : 'in'; ?>">
                                            <div class="who"><?php echo esc_html($who); ?><?php echo !empty($m->channel) ? ' &middot; ' . esc_html($m->channel) : ''; ?></div>
                                            <div class="tx"><?php echo esc_html($m->message); ?></div>
                                            <div class="ts"><?php echo esc_html(date('M j, g:ia', strtotime($m->created_at))); ?></div>
                                        </div>
                                    <?php endforeach; ?>
                                </div>
                            <?php endif; ?>
                        </div>
                    <?php endif; ?>
                </div>
            </div>
        </div>

        <style>
        .paa-inbox .paa-ib-stats{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}
        .paa-inbox .paa-ib-stat{background:#fff;border:1px solid #dcdcde;border-radius:8px;padding:10px 16px;min-width:92px}
        .paa-inbox .paa-ib-stat .n{display:block;font-size:22px;font-weight:700;line-height:1.1;color:#1d2327}
        .paa-inbox .paa-ib-stat .l{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#646970;margin-top:3px}
        .paa-inbox .paa-ib-stat.is-new .n{color:#2563eb}
        .paa-inbox .paa-ib-stat.is-won .n{color:#0e7c6b}
        .paa-inbox .paa-ib-toolbar{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:10px}
        .paa-inbox .paa-ib-filters{display:flex;gap:6px;flex-wrap:wrap}
        .paa-inbox .paa-ib-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:20px;border:1px solid #dcdcde;background:#fff;color:#3c434a;text-decoration:none;font-size:13px}
        .paa-inbox .paa-ib-chip:hover{border-color:#0e7c6b;color:#0e7c6b}
        .paa-inbox .paa-ib-chip.is-active{background:#0e7c6b;border-color:#0e7c6b;color:#fff}
        .paa-inbox .paa-ib-chip .c{font-size:11px;opacity:.8}
        .paa-inbox .paa-ib-search{display:flex;gap:6px;align-items:center}
        .paa-inbox .paa-ib-sources{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:14px;font-size:12px}
        .paa-inbox .paa-ib-sources .lbl{color:#646970;text-transform:uppercase;letter-spacing:.05em;font-size:11px}
        .paa-inbox .paa-ib-sources a{text-decoration:none;color:#3c434a}
        .paa-inbox .paa-ib-sources a.is-active{color:#0e7c6b;font-weight:600}
        .paa-inbox .paa-ib-layout{display:grid;grid-template-columns:minmax(280px,360px) 1fr;gap:16px;align-items:start}
        .paa-inbox .paa-ib-list{display:flex;flex-direction:column;gap:8px}
        .paa-inbox .paa-ib-card{display:block;background:#fff;border:1px solid #dcdcde;border-radius:8px;padding:11px 13px;text-decoration:none;color:#1d2327}
        .paa-inbox .paa-ib-card:hover{border-color:#0e7c6b;box-shadow:0 1px 4px rgba(0,0,0,.06)}
        .paa-inbox .paa-ib-card.is-selected{border-color:#0e7c6b;box-shadow:0 0 0 1px #0e7c6b}
        .paa-inbox .paa-ib-card .row1{display:flex;justify-content:space-between;align-items:center;gap:8px}
        .paa-inbox .paa-ib-card .nm{font-weight:600;font-size:14px}
        .paa-inbox .paa-ib-card .dt{font-size:11px;color:#8a8f94;white-space:nowrap}
        .paa-inbox .paa-ib-card .row2{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px;align-items:center}
        .paa-inbox .paa-ib-badge{font-size:11px;padding:2px 8px;border-radius:12px;font-weight:600}
        .paa-inbox .paa-ib-badge.st-new{background:#e7eefe;color:#2563eb}
        .paa-inbox .paa-ib-badge.st-contacted{background:#fbeedd;color:#b45309}
        .paa-inbox .paa-ib-badge.st-qualified{background:#ede9fe;color:#6d28d9}
        .paa-inbox .paa-ib-badge.st-converted{background:#e2f1e8;color:#177e4a}
        .paa-inbox .paa-ib-badge.st-lost{background:#f0f0f1;color:#646970}
        .paa-inbox .paa-ib-tag{font-size:11px;padding:2px 8px;border-radius:12px;background:#f0f0f1;color:#50575e}
        .paa-inbox .paa-ib-flag{font-size:11px;color:#b45309;font-weight:600}
        .paa-inbox .paa-ib-pager{display:flex;align-items:center;gap:10px;margin-top:12px}
        .paa-inbox .paa-ib-pager .pg{font-size:12px;color:#646970}
        .paa-inbox .paa-ib-detail{background:#fff;border:1px solid #dcdcde;border-radius:8px;min-height:320px}
        .paa-inbox .paa-ib-empty{padding:40px 20px;text-align:center;color:#8a8f94}
        .paa-inbox .paa-ib-dhead{padding:18px 20px;border-bottom:1px solid #f0f0f1}
        .paa-inbox .paa-ib-dtop{display:flex;justify-content:space-between;align-items:center;gap:12px}
        .paa-inbox .paa-ib-dtop h2{margin:0;font-size:20px}
        .paa-inbox .paa-ib-status{max-width:160px}
        .paa-inbox .paa-ib-contact{margin-top:8px;display:flex;gap:16px;flex-wrap:wrap;font-size:13px}
        .paa-inbox .paa-ib-contact a{text-decoration:none}
        .paa-inbox .paa-ib-dmeta{margin-top:12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
        .paa-inbox .paa-ib-section{padding:16px 20px;border-bottom:1px solid #f0f0f1}
        .paa-inbox .paa-ib-section h4{margin:0 0 10px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#8a8f94}
        .paa-inbox .paa-ib-summary{background:#f6f8f8;border:1px solid #e4e9ea;border-left:3px solid #0e7c6b;border-radius:6px;padding:11px 13px;font-size:13px;line-height:1.5}
        .paa-inbox .paa-ib-summary.is-missing{border-left-color:#b45309;color:#646970;font-style:italic}
        .paa-inbox .paa-ib-thread{display:flex;flex-direction:column;gap:9px}
        .paa-inbox .paa-ib-msg{max-width:80%;padding:8px 12px;border-radius:11px;font-size:13px;line-height:1.45}
        .paa-inbox .paa-ib-msg.in{background:#f6f8f8;border:1px solid #e4e9ea;border-top-left-radius:3px;align-self:flex-start}
        .paa-inbox .paa-ib-msg.out{background:#e1f0ed;color:#0a5a4e;border-top-right-radius:3px;align-self:flex-end}
        .paa-inbox .paa-ib-msg .who{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#8a8f94;margin-bottom:2px}
        .paa-inbox .paa-ib-msg .ts{font-size:10px;color:#8a8f94;margin-top:3px;text-align:right}
        @media(max-width:960px){.paa-inbox .paa-ib-layout{grid-template-columns:1fr}}
        </style>
        <?php
    }
