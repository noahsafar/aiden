# Aiden revamp — remaining work plan

This is the prioritized, build-verified plan for the rest of the "venture-scale, sellable"
revamp. Work in batches; after each batch run `npm run build` (must exit 0) and
`npx tsc --noEmit` (no NEW errors), then commit + push to `main` with **no Claude
attribution** (author = noahsafar; no Co-Authored-By / "Generated with" trailers).

Derived from four deep audits (visual consistency, AI strategy, mock-email routing,
relationship-graph revamp). Already shipped: tsc fix, crash landmine, global compose flow
with AI auto-draft, dead-button fixes, server sync, Today AI day-brief, deadline/routing
accuracy fixes, modal+inbox design-system migration, Schedule event details.

## P0 — Relationship graph revamp (biggest remaining "wow")
Files: `src/components/crm/NetworkGraph.tsx` (full rewrite), `src/pages/Relationships.tsx`.
- Add `d3-force` dep (layout only). Run a headless force sim (charge + link + per-category
  x/y anchors + collide), tick ~300x, freeze positions, hand to reactflow. Clusters by category.
- Circular **avatar** nodes (reuse `PersonAvatar`), size by `relationship_score` (44–96px),
  category-colored ring (unify palette with `categoryTone` in Relationships.tsx:
  Colleague=violet, Client=emerald, Vendor=amber, Friend=sky, Family=rose, Other=gray).
  VIP star badge; cooling (`days_since_contact>30`) = dimmed + dashed amber ring. Label below.
- Edges: thin, neutral, `opacity 0.4`, width by shared-thread volume, NOT animated; remove
  per-edge text labels; on node-select, light up only connected edges + dim the rest.
- Remove NetworkGraph's internal `<h2>` header + debug overlay + all `console.log`s.
- Custom legend (clickable category `Pill`s), styled Controls/MiniMap, Dots `<Background>`,
  `fitView({padding:0.25,duration:600})`. Beautiful loading (pulsing constellation) + `EmptyState`.
- Click node → lift `selectedId` to Relationships.tsx → show the SAME `PersonDetail` panel.
- Cut the manual "Add Connection" mode (NetworkGraph + store `addManualConnection`/`removeManualConnection`).

## P0 — Relationships page functional upgrades
- Smart segment filter rail above list: All · VIPs · Needs attention (cooling: score≥60 &
  days_since_contact>30) · Strong (≥75) · New (first_seen<30d) · by category. Drives list+graph.
- List rows: add right-aligned last-touch `relativeTime(last_contacted)`, amber if >30d.
- Sort control (Strength · Last contact · Most emails · Cooling-first).
- PersonDetail: 2–3 AI "what to talk about next" talking points + one-click "Draft a check-in"
  (compose action, prefilled). Surface `avg_response_time_minutes` ("usually replies in ~2h").

## P1 — Visual consistency sweep (from visual audit)
- Canonical card padding `px-5 py-4`; card-list gap `space-y-3`, section gap `space-y-8`.
- `FocusCard`/`MeetingBriefCard` should use `<Surface interactive>` not hand-rolled classes.
- ONE segmented-control recipe across nav-active / view-toggle / sort / filter chips.
- One hairline token (`gray-100 dark:white/[0.08]`); fix Schedule vs Today meeting-row divider/title weight.
- Consolidate `AidenBox` (Today) + `AiSuggestion` (primitives) into one primitive.
- `SoftButton`: add `focus-visible:ring-2 ring-violet-400/50`. EmptyState icon chip → `rounded-full`.
- Collapse the 4 uppercase-label specs into 2 tokens (section label 13px/semibold/0.08em; eyebrow 11px/bold/0.12em).
- Extract a shared `MeetingRow`/`MeetingCard` used by both Today and Schedule.

## P1 — Today completeness (from AI audit)
- Time-aware "Next up" agenda banner (sort events by `start`; "Team sync in 40 min").
- "Waiting on them" rollup: surface stale `they_owe` commitments (currently dropped on Today).
- Turn on AI commitment extraction selectively (commitmentStore.extract(true) for key/ambiguous
  threads); stop hardcoding confidence 0.9 in aiden.ts extractCommitments.
- "What changed since yesterday" (localStorage snapshot diff). Quick-capture → addManual.
- Surface `sender_tone` as a relationship-risk flag.

## P1 — AI prompt quality (from AI audit)
- Port `generateEventBrief` anti-hallucination rules into `generateMeetingBrief`; feed it body
  snippets, not just subject lines.
- `extractCommitments`: return per-item confidence, drop <0.5, ignore pleasantries / "let me
  know if you have questions", null due-date unless explicit.
- Optional: brain-side phishing/fake-urgency severity cap.

## Notes / constraints
- App is in DEMO MODE (sample emails auto-load; real Gmail fetch disabled) — intentional; don't flip.
- Root `oauth_server.py` is canonical (dev + bundle); keep it byte-identical to `src-tauri/oauth_server.py`.
- ~70 pre-existing type errors are environmental (dual Email type, gapi, NodeJS.Timeout) — don't chase blind.
- Can't click the live Tauri app; verify via tsc + build + careful review.
