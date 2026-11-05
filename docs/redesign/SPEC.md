# tmux-dispatch redesign specification

Status: implementation handoff. Source inventory checked 2026-11-05. This document and `mockup.html` are design artifacts only. No source changes or new API contracts are required.

## 1. Intent and diagnosis

A calm terminal access console: answer the request, inspect current access, maintain future approval rules. Preserve all existing operations. React, Vite, Tailwind v4, installed shadcn wrappers, Radix, Lucide and Sonner remain the stack. Use native inputs, selects, radio buttons and tables; no table library, router, theme package or external font is needed.

Diagnosis from the current implementation, not a live-app visual audit:

1. `App.tsx` spends vertical space on a slogan, oversized counters and large section gaps before the useful controls. Replace these with one compact navigation/status bar and counts in section headings.
2. `panes-panel.tsx` joins grants and rules into partially populated rows. A rule can exist without access, and access can exist without a rule. The resulting blank cells and ambiguous pin conflate two independent operations. Give agents their grants and rules their own section.
3. Five pills per rule repeat the pane identifier, wrap unpredictably, and use green for all bound values. Struck-out wildcard values can look revoked. Show a consistent five-column scope matrix with literal `Any` values. Edit in a labeled form, not through accidental one-click scope broadening.
4. The permanent seven-control add form dominates routine monitoring. Cloning silently replaces its draft and scrolls the entire page. Use one focused, explicitly titled add/edit/clone dialog, with a reviewable save action.
5. Current tables require 800px width on phones. Critical operations sit offscreen. Reflow into labeled records below 1024px instead of asking users to scroll sideways.
6. Agent visibility currently depends on holding a grant. Show connected agents even with zero grants, and distinguish retained offline agents from live connections.
7. Initial pool/device failures look like empty states and session failure can produce a blank page. Several mutations have no busy state; denial closes even on failure. Use independent loading/error states and preserve input on failure.
8. Request arrow handlers are global, hover changes selection, and a row button contains another button. Scope keyboard behavior to a radio group and use an explicit approval button.
9. Dark mode is forced by `index.html` and Sonner. Existing light tokens are unused. Support system/light/dark consistently; no decorative shadows or translucent text surfaces.

## 2. Information architecture and layout

Routes remain `/` and `/link`, plus existing `/auth/start`. No backend navigation changes. On `/`, a 56px desktop header contains the terminal mark, `tmux-dispatch`, in-page links `Requests 1`, `Agents 2`, `Rules 4`, and `Machines`, followed by event-stream status, appearance selector and Sign out (hidden in token mode). Counts reflect successful snapshots, never initial zeroes. Agents count means connected agents; the section separately lists offline records. Current assignment total appears in the Agents heading. Header is sticky on desktop, static below 640px. Anchor targets use scroll margin so headings remain visible.

Main content: maximum 1440px, centered; 24px outer padding desktop, 16px phone. Vertical sections, in order:

1. Requests, full width, action-first.
2. Agents and current access, compact two-column cards at 1024px and above, single column below.
3. Automatic rules, full-width scope matrix.
4. Paired machines, compact disclosure with count. Initially collapsed when machines exist, expanded when empty or failing. It is separate from agent connections: a paired machine can run several agents.

Section gap 24px; heading-to-content gap 12px. No sidebar, dashboard metrics tiles or marketing copy. No tabs hiding requests. Show all incoming requests, oldest first by `createdAt`, tie by ID. Keep arrival updates from moving focus or resetting drafts. Rule order is the server order (`created_at`, then `id`), with an ordinal column: first matching rule wins. Do not offer sorting or drag reorder that would misrepresent server priority.

## 3. Data and capability inventory

The following fields must remain available. Secondary details use a labeled disclosure; shortened strings always have selectable full text inside it, not tooltip-only access.

| Entity | Fields and presentation |
| --- | --- |
| Session | `authMode`, `signedIn`, `account`: authentication route, sign-out visibility and account text in header settings. Null account shows `Local account`. |
| Agent identity | `mcpClient` primary name, fallback `client`, then `Agent`; `host` and `cwd` visible; `sessionId` explicitly `Agent session`; `tmuxServer` explicitly `Tmux server`. Details: `instanceId`, `pid`, `tmuxSession`, `scope`, raw `client`, full values. Missing optional values read `Not reported`. Agent session is not tmux session. |
| Connected agent | `id` stable key; `connected` determines Connected/Offline; `connectedAt` and `lastSeen` in details with absolute date and relative time; `grants` rendered below identity. Never infer live status from activity age. |
| Grant | `target`, `kind`, parsed `label` (location, command, title), `since`, optional `reason`, nullable `lastActivity`. Primary row: target, location, command, last activity. Details include full label, title, reason and assigned time. Null activity reads `No activity reported`. |
| Request | `id`, `kind`, `reason`, `createdAt`, `expiresAt`, `ageSeconds`, `agent`, `candidates`, `suggested`, `heldElsewhere`, `autoAssigned`, `lastError`. ID, absolute timestamps and agent technical fields live in Request details. Expiry and error stay visible. Null agent reads `Agent identity unavailable`. |
| Candidate | Authoritative `id` for actions, parsed `label` for display; preserve full raw label if parsing is incomplete. `suggested` and `heldElsewhere[id]` are explicit text annotations. |
| Rule | `id`, `pattern`, `kind`, `reusable`, `session`, `cwd`, `host`, `tmuxServer`, `live`, `lastActivity`, `usedAt`, `createdAt`. Five matching elements are always visible. Lifecycle and availability must not be conflated. Details show absolute timestamps and full values. |
| Device | `id`, `name`, `createdAt`, `lastSeenAt`; name and last connection visible, creation date in details. Null lastSeenAt reads `Never connected`. No unsupported join between device ID and host. |

Retain `parseLabel`, `ago`, `shortSession`, `shortServer`, `projectName` where useful. Abbreviations are display-only. Never send a shortened session or server fingerprint back to the API. A label can be malformed; actions always use `Target.id` or `Grant.target`.

### API mapping, unchanged

| UI action | Existing API helper / transport |
| --- | --- |
| Authenticate, sign out | `getSession`, `login(password)`, `logout`; OIDC `/auth/start`; token query/sessionStorage behavior stays intact |
| Read dashboard | `listRequests`, `listPool`, `listDevices` |
| Approve, deny, refresh, dismiss | `grant(id,target)`, `deny(id,reason)`, `refreshTargets(id)`, `dismissRequest(id)` |
| Keep access automatically, revoke, forget | `keepGrant(agentId,target)`, `revokeGrant(agentId,target)`, `forgetAgent(agentId)` |
| Add/clone, edit, delete, reset rule | `addPoolEntry`, `updatePoolEntry`, `removePoolEntry`, `resetPoolEntry` |
| Pair and unpair | `lookupPairing`, `approvePairing`, `denyPairing`, `revokeDevice` |
| Live updates | Browser EventSource `/events`, events `open`, `change`, `request`, `auto-assigned`; agent WebSocket `/agent` is unchanged |

The browser uses SSE, not an agent WebSocket. Keep bearer/cookie behavior in `api.ts`. Preserve desktop notifications and auto-assignment toasts. `DESIGN.md` includes future ideas such as terminal watching and undo; the actual API is authoritative. Do not introduce terminal streaming, historical audit logs, bulk operations, rule disable flags or pretend undo endpoints.

## 4. Requests

Section heading `Requests` with pending count and short explanation `Review access before an agent can use a terminal.` Each card has a subtle warning-colored left border, not a green success border. Header: client name, project, host, age and `Pane request` or `Window request`. The reason is the largest text in the card (16px/24, weight 600); cwd is selectable monospace underneath. Include expiry text `Expires in 4m` derived from expiresAt. At expiry, refresh rather than locally claiming the request has disappeared.

Candidate list is a radio group labeled `Choose a pane` or `Choose a window`. Row contains radio, target ID, location, command, title, optional `Requested` and `Held by {project}`. Retain held candidates as selectable because manual assignment is supported; selection displays full holder cwd and an inline warning that the target is already held. An offered suggestion is initially selected. An unoffered suggestion pre-fills Assign by ID instead. Refresh preserves selection only if it still exists; otherwise clear it and announce `Selected target is no longer offered`. Merely hovering never changes selection or grants access.

Footer: primary `Assign %24` (disabled until selected), secondary `Assign by ID` disclosure, `Refresh`, `Deny`, overflow `Dismiss without answering`. Assign by ID contains visible label, input, submit and explanation `The agent validates this target against its scope`. Normalize digits to `%` for pane and `@` for window exactly as today. Nonempty named values are passed through. Enter inside this form submits only this form. No global approval shortcut.

Grant POST success means the answer was sent, not guaranteed accepted. Show `Assignment sent for %24`, refresh and let the server settle the request. If `lastError` returns, retain the card and show `The agent refused this assignment: {error}. Choose another target.` On disappearance focus the next request heading, else section heading. If `autoAssigned` is present while waiting for acknowledgment, display `Automatically assigned {target} by rule #{entryId}` and avoid duplicate submission until the next snapshot or rejection. Toast auto-assigned SSE events using existing payload; expose no unsupported undo.

Deny dialog: request reason, labeled optional reason textarea, Cancel and `Deny request`. Submit busy state, error stays inline and dialog stays open. Dismiss confirmation: `Remove this request without sending an answer?` Distinguish from denial. Empty candidates: `No panes offered. Open a pane, then refresh, or assign by ID.` Empty section: one 64px row `No pending requests. New requests appear here automatically.` Loading uses card skeleton plus status text, no fake zero. Failed refresh preserves last data with `Could not refresh requests` and Retry. First-load failure displays error in place of the list.

## 5. Agents and current access

Every returned agent gets a card, including connected agents with no grants. Sort connected first, then host, cwd, ID for stability. Header: client, project, textual Connected/Offline status. Next line: host and cwd; details disclose all identity fields. Each grant is a compact row with target, location, command, last activity and explicit `Revoke`. An expandable grant detail exposes remaining fields.

`Keep automatically` is a secondary action on each grant. It calls existing `keepGrant`, then highlights the returned rule and offers `Edit rule`. Explain its actual defaults before action in adjacent helper text or focusable tooltip: reusable, bound to machine and tmux server, plus agent session if reported; otherwise cwd. Session-bound defaults leave cwd unrestricted. If an exact existing rule with those defaults is already known, show `View rule #N`. Do not claim arbitrary glob rules are uniquely associated with a grant. Rules and grants remain separate records even when related.

Revoke is immediate on click with per-grant pending state, then refetch. Success copy for offline agent: `Revocation recorded. Takes effect at its next action.` Explain that revoking current access does not remove automatic rules; link matching exact-ID rules for review. Removing a rule likewise does not revoke access. Offline agent overflow includes `Forget agent`; dialog states the assignment count and `Removes this agent from the overview. Access is not revoked.` Connected agents never offer Forget. An agent can go online during the dialog: show the 409 message and refresh.

Empty: `No agents connected. Agents appear when they connect to dispatch.` If offline records exist, show them with `0 connected · N offline`. Error/loading comes from the request snapshot; do not erase grants during reconnect. There is no automatic claim that Offline means revoked.

## 6. Automatic rules

Heading `Automatic rules`, count, helper `First matching rule answers automatically. All five conditions must match.`, and `Add rule` button. Table columns at >=1024px: order 36px; Target 16%; Agent session 13%; Path 19%; Machine 12%; Tmux server 12%; Use 110px; Actions 96px. Remaining widths flex; cells wrap long values and never force page overflow. Table has one muted header and horizontal separators, no striped rows, nested pills or per-cell borders.

Target shows pattern in monospace and kind below it. Agent session is shortened using `shortSession`, server uses `shortServer` with full machine in neighboring column, path retains enough leading context to distinguish projects. Any unrestricted element displays plain muted `Any session`, `Any path`, `Any machine`, `Any server`; target wildcard displays `Any pane` or `Any window`, with `*` available in detail. Constrained values are ordinary foreground text, not green. All five cells are read-only links/buttons to the editor focused at that element. Accessible name: `Edit machine condition for rule 12`. Include a separate visible Edit action and Clone action; Delete is in overflow or editor footer.

Use column has `Reusable`, `One-shot · Ready`, or `One-shot · Used`. Below it show last handed-over relative time, or `Not used`. A reusable rule with usedAt remains reusable. Server availability appears as secondary text under server: true `Connected`, false `No connected agent`, null no availability claim. Even true does not prove a matching free pane exists. Rule details show createdAt, usedAt and lastActivity separately. A used one-shot rule offers `Reset for one use` through `resetPoolEntry`. Editing does not clear usedAt; switching a used reusable rule to one-shot makes it spent until reset.

Empty: `No automatic rules. Requests need your approval.` with Add rule. Load skeleton is four table rows with status text. Failure: inline error and Retry, preserve previous table. Mutations are pessimistic: disable actions for affected rule until completion, keep other rules usable, toast exact result and refetch. Delete dialog says `Remove rule #{id}? Existing assignments keep their access.` No misleading On/Off switch; deletion is deletion.

### Rule editor: one reusable Dialog component

Desktop max width 680px, 24px padding, scrollable body with max-height calc(100dvh - 48px), footer visible inside dialog. Below 640px use 16px inset, one-column controls, body scroll, touch targets 44px. Title is exactly `Add rule`, `Edit rule #12` or `Clone rule #12`. Description `All conditions must match. Changes apply to future requests.`

Top row: Type select (`Pane`, `Window`) and Use select (`Reusable`, `One-shot`). Type is disabled with explanation during edit because PATCH does not support kind; `Clone as another type` starts clone mode. Defaults for new rule: Pane, Reusable, target Constrained but blank, all four identity elements Any. No implicit values inferred from the first connected agent.

Body: five labeled rows in fixed order Target, Agent session, Path, Machine, Tmux server. Each has a native two-option mode select (`Any`, `Constrained`), value input when constrained, and helper text. Display `Exact value` for identity constraints, `ID or pattern` for target, `Path or glob` for cwd. Do not call all constrained fields exact: actual matcher semantics differ. Preserve each typed draft value while switching temporarily to Any. Returning to Constrained restores draft; if none, focus empty input. Users can type values even with no agent connected. Optional `Use values from agent` select shows client, host and project and explicitly fills identity fields from that agent; absent fields stay Any. This never picks a target implicitly or submits.

| Element | Any encoding | Constrained encoding and help |
| --- | --- | --- |
| Target `pattern` | Literal `*`, never null/empty | Bare `%24` or `@5` compares exactly to candidate ID. Other input is anchored, case-insensitive glob over full label or ID. `*` spans any text, `?` one character. `*agents:*` matches a tmux session anywhere in a label. No regex syntax. |
| Agent session `session` | Omit on POST; null on PATCH | Exact, case-sensitive opaque agent session ID, not tmux session name. |
| Path `cwd` | Omit on POST; null on PATCH | Anchored case-insensitive glob of requesting agent cwd. Example `*/Repos/tmux-*`. `*` may cross slashes; not filesystem glob semantics. |
| Machine `host` | Omit on POST; null on PATCH | Exact, case-sensitive host string reported by agent. |
| Tmux server `tmuxServer` | Omit on POST; null on PATCH | Exact full socket:pid:start_time fingerprint. Never the displayed short PID. |

Trim values on save. Constrained blank is an inline error; never silently broaden a blank field. Bare IDs matching `^[%@]\d+$` require constrained nonempty server, preserving existing frontend guard. Switching server to Any while target is bare leaves draft invalid with `A bare ID needs its tmux server. Bind a server or use a label pattern.` Pattern `*` is valid in Any mode. For mismatch `%` with Window or `@` with Pane show a corrective error. Do not silently convert rule IDs. Broad wildcard rules are allowed without extra approval dialogs.

Below fields show a plain-language scope summary and an exact serialized-value disclosure for review. Example: `Any pane from agents in session sess-frank-01, on frank-mbp, using server :4821. Any path. Reusable.` Full server remains accessible. Footer Cancel, primary Add rule / Save changes / Add cloned rule; edit has separate destructive Delete. Save validates, focuses first invalid field, then calls API. Busy label `Saving…`, no duplicate submits. On error retain all fields and show inline server message. Success closes, announces action, refetches rules and returns focus to origin (or new rule heading if origin was removed).

Edit sends only changed supported fields via PATCH. Preserve kind, createdAt, usedAt and all unrelated fields. If an updated server snapshot conflicts with a dirty form, display `This rule changed. Reload values before saving.` Require explicit reload; do not silently merge. There is no API revision token, so describe this as best-effort stale-edit detection, not atomic concurrency protection. Missing rule becomes read-only `This rule was removed` with Close and `Use as new rule`.

Clone copies pattern, kind, all four identity conditions and reusable into a new draft; never id, timestamps, usedAt, activity or live. No network mutation until Add cloned rule. Cancel leaves original intact. Server POST deduplicates identical condition+kind combinations, ignoring reusable. If unchanged clone would duplicate, show `This rule already exists` and `Edit existing rule`; do not promise a second identical record. Compare returned id after POST as well to catch races. If only reusable differs, direct to edit the existing rule. Draft changes cannot replace an already-open dirty draft: show inline `Discard changes?` with Keep editing / Discard before switching origin or closing. Successful save clears draft.

## 7. Authentication, pairing and machines

Authentication bootstrap: compact skeleton with `Connecting to dispatch…`; failure `Could not connect` and Retry. Never render a blank page or password input before authMode is known. Password screen: 384px panel, product name, `Sign in to manage terminal access`, visible Password label, type=password, autocomplete=current-password, submit. Enter submits, input required, busy `Signing in…`, inline error with aria-describedby. Keep password only in component memory; clear on success. Never log or include it in URL. OIDC shows Continue to identity provider linking existing route. Token mode with invalid/missing token shows `Open dispatch with a valid access link` and Retry, not a password form. Preserve existing query-token removal and storage implementation.

Session expiry (401) shows sign-in while retaining destination `/link` or `/`; do not keep firing background mutations. Sign out failure stays visible and does not falsely claim success. Appearance control remains usable on sign-in.

`/link` follows session bootstrap and auth first, retaining route through sign-in. Same 384px panel: code label, uppercase code input, `Check code`, then device name and `Link machine` / `Decline`. Changing code invalidates prior lookup. Link remains disabled until successful lookup for the current code; existing approve/deny APIs are unchanged. Pending labels and duplicate protection; invalid/expired code error below input, preserve value. Approved state `Machine linked`, declined state `Pairing declined`, both with Back to dashboard. Retry lookup if a code expires before approval. Do not request or display device tokens.

Paired machine records show name, last connection and creation detail. `Unpair` dialog explains token revocation and disconnecting its agents, then calls revokeDevice. Success removes device after refetch. Empty shows exact CLI hint `tmux-mcp dispatch-login` and `Enter pairing code` link to `/link`. Independent skeleton/error/Retry; no fake empty state. Available in all modes as current API supports; token deployments may simply return an empty list.

## 8. State, feedback and accessibility

Use the existing event-driven snapshot model; on SSE reconnect refresh requests, pool and devices. Fan out successful reads independently so one failure cannot blank unrelated sections. Ignore out-of-order responses using a request sequence or AbortController. Mark last successful data `May be out of date` while event stream is offline. Connecting and Reconnecting are text, not just a dot. Retain manual Retry and ordinary REST actions during SSE failure; a stream failure alone does not prove REST is unavailable.

Section loading: skeleton + one role=status. Refreshing existing data: small quiet label, no full skeleton flash. Initial failure: message + Retry. Mutation failure: inline by action/dialog plus concise Sonner error, no loss of draft. Success: toast for 5 seconds and actual visible state update. No mutation optimistically reports success. Browser notifications are enabled via explicit `Enable notifications` in header settings when permission is default; when already granted, preserve incoming-request notifications. Denied/unsupported permission gets explanatory text, never repeated prompts. Do not announce every second of age ticking to screen readers.

Semantic header/nav/main/sections, one h1 and ordered h2 headings. Tables use caption and scoped column headers. Card reflow uses equivalent labeled definition lists; only one responsive version is exposed to accessibility tree. Buttons contain no buttons. Native radio selection gets arrow-key behavior within its group; Tab reaches Assign separately. Dialog uses existing Radix focus trap, labeled title/description, Escape, return focus. Dirty dialogs intercept close through the discard prompt; focus remains trapped. All actions work without hover. Icon-only controls require accessible names and focus-triggered Tooltip, but Clone/Edit should have visible text where space permits. Full strings selectable in details on touch and keyboard. Focus ring 2px plus 2px offset, no removal of outlines. Error text linked to field with aria-invalid. Reduced motion disables pulsing/sliding. New arrivals never autofocus. DOM order matches visible section order.

## 9. Visual tokens and responsive rules

Reuse semantic Tailwind/shadcn CSS variables from `src/index.css`. Existing dark background #101419, card #191f27, foreground #eef2f6, muted foreground #b0bdcc, border #3a4858 remain. Light background white, foreground existing near-black, muted surface existing zinc, border existing zinc. Keep primary/primary-foreground pair for strong actions. Keep dark live #9be5bb; use darker light live text #166534 (current bright live token is unsuitable for small green text on white). Add warning foreground #92400e light / #fcd68a dark and warning surface #fffbeb / #30291d for pending attention only. No gradients, blurred glass or large shadows. Destructive text light #b42318 / existing dark #ff9696; destructive filled buttons must pair with contrasting text, rather than white on pale red.

Typography: system sans; mono existing --font-mono for machine values only. Product 16/24 weight 650, section heading 16/24 weight 600, reason 16/24 weight 600, body 14/20, labels and metadata 12/18; no 11px interactive text. Numerals tabular. Spacing scale 4, 8, 12, 16, 24, 32. Card radius 10px (existing radius), controls 6px, no pill except small status/count badges. Panel padding 16px, row padding 12px vertical, 16px horizontal. Desktop buttons >=32px high; inputs 36px; touch buttons >=44px. Icons 16px, decorative aria-hidden. Minimum text contrast 4.5:1, focus/UI boundaries 3:1; verify both themes before implementation handoff.

Theme selector: System, Light, Dark; default System, persist only explicit preference under `tmux-dispatch-theme`. Apply class before paint in index initialization; subscribe to media query only in System. Set color-scheme consistently and pass resolved theme to Sonner. No new theme dependency.

At >=1024px: full rule table and two agent columns. At 640-1023px: single agent column, rules become cards with target+use header, four labeled condition cells in a two-column grid and persistent actions. Below 640px: conditions one column, header wraps into product/status then navigation/settings, request footer wraps and Assign remains first. Any full paths/fingerprints wrap with overflow-wrap:anywhere. Dialog controls stack with label above. No page-level horizontal scrolling at 360px or at 200% zoom. Long candidate lists use page flow, not a tiny nested scroll trap. Header ceases to be sticky on phones. Four rules should remain readily scannable; do not hide wildcard conditions to save space.

## 10. Implementer checklist and mockup boundaries

Suggested boundaries: AppShell/ConnectionStatus, RequestCard/TargetRow/DenyDialog, AgentsPanel/GrantRow/IdentityDetails, RulesPanel/RuleScope/RuleEditor, DevicesPanel, SignIn/LinkDevice. Existing PanesPanel can become a composition layer. Reuse Button, Card, Dialog, Tooltip, Skeleton, Separator, Sonner; native details for secondary disclosure and installed Radix DropdownMenu for overflow. Keep API helpers as contract and `useInbox` as event owner. UI state is local; rules and grants remain server-owned. No changes to server matching semantics.

Acceptance scenarios:

- Pane and window request approval; selected and unoffered suggestions; manual digits; held warning; refresh losing selected candidate; agent rejection; withdrawal during submit; expired request refresh.
- Deny with and without note; dismiss without answer; no global arrow handler or hover assignment.
- Connected agent with zero grants; retained offline grants; keep defaults with and without session; offline revoke; forget refuses newly connected agent.
- Five conditions independently Any/constrained; wildcard target; typed values without connected agents; bare ID server guard; cwd glob; full session/server round trip; type immutable during edit.
- Clone changes no source record; deduplicated unchanged clone; failed save preserves draft; used one-shot reset; reusable toggle retains usedAt; delete does not revoke grants.
- Initial and refresh errors per section; stream reconnect; 401; simultaneous updates while editor is dirty; race where deleted rule is saved.
- Password/OIDC/token routing; signed-out `/link`; pairing invalid/expired/declined; unpair failure; notifications unsupported or denied.
- Keyboard-only at desktop and 360px; 200% zoom; full-value access without hover; light/dark/system theme and reduced motion.

`mockup.html` is a self-contained static design specimen with fake data: two connected agents, three current grants, four rules in server order and one pending request. Light/dark controls and native disclosures demonstrate appearance only; operational controls are labeled as static examples and make no API calls. A separate editor specimen below the dashboard demonstrates the five-condition layout. The live implementation should open that editor in a dialog, not permanently append it to the dashboard. Spec is authoritative for all flows and states beyond the representative screen. No live app credentials were read or embedded.
