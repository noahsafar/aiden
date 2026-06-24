# Aiden revamp — remaining work plan

Work in build-verified batches; after each run `npm run build` (exit 0) + `npx tsc --noEmit`
(no NEW errors), then commit + push to `main` with **no Claude attribution**
(author = noahsafar; no Co-Authored-By / "Generated with" trailers).

## ✅ DONE (shipped to main)
- tsc safety net (pinned @types/d3-dispatch), vite-env types
- Crash landmine (email-click) fixed; restored safe email AI fns
- Global compose flow with context-aware AI auto-draft across surfaces
- Dead-button fixes (commitments, open-loops, schedule, inbox cluster)
- Server sync (/chat, fetch_url, attendees) + root↔src-tauri identical
- Today AI day-brief; "Next up" agenda banner; "Waiting on them" rollup
- Routing accuracy: deadline date-resolution (no fabricated/past urgency, social
  guard), no double-surfaced commitments, cold-sales filter, tighter opp signals,
  real AI summaries used in attention
- Design system: modals + Inbox migrated to tokens (violet, rounded-2xl, blur,
  scale-in, EmptyState); Ask composer divider aligned
- **Relationship graph fully revamped**: force-directed clustering (d3-force),
  avatar nodes sized/colored, calm edges that light up on select, dots bg,
  loading constellation + empty state, click→PersonDetail slide-in panel
- Relationships list: segment filters, sort, last-touch dates, category legend,
  response-time signal in profile
- Visual sweep: SoftButton focus ring, rounded empty-state icon, SectionLabel
  dense prop, Schedule/Commitments/AidenShell token + spacing fixes
- AI prompt quality: anti-hallucination meeting brief, confidence-gated commitment
  extraction

## Remaining (P1/P2 — nice-to-have, lower risk/reward)
- **Today visual consistency**: FocusCard/MeetingBriefCard could use `<Surface interactive>`
  instead of hand-rolled classes; unify card padding to `px-5 py-4` across Today cards.
  (Low risk but unverifiable without rendering — do carefully.)
- **Shared MeetingRow/MeetingCard** component used by both Today and Schedule.
- **Consolidate** `AidenBox` (Today) + `AiSuggestion` (primitives) into one primitive.
- **Today "what changed since yesterday"** (localStorage snapshot diff) + quick-capture
  (`commitmentStore.addManual` exists) + surface `sender_tone` as a risk flag.
- **PersonDetail "what to talk about next"**: 2–3 AI talking points + one-click
  "Draft a check-in" (compose action already wired on the Email button).
- **Turn on AI commitment extraction selectively** (commitmentStore.extract(true) for
  key/ambiguous threads) — improved prompt is ready; currently heuristic-by-default
  to avoid firing AI on every load in demo mode.
- **Phishing/fake-urgency** brain-side severity cap (optional).

## Constraints
- DEMO MODE is intentional (sample emails; real Gmail fetch disabled) — don't flip.
- Root `oauth_server.py` is canonical (dev + bundle); keep byte-identical to src-tauri copy.
- ~70 pre-existing type errors are environmental (dual Email type, gapi, NodeJS.Timeout) — don't chase.
- Can't render the live Tauri app; verify via tsc + build + adversarial review subagents.
