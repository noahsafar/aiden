/**
 * Demo mode — opt-in, off by default.
 *
 * When either VITE_DEMO_EMAILS or VITE_DEMO_CHANNELS is set, the app is running
 * with sample data (for offline demos / screenshots). Outside of demo mode we
 * must NEVER substitute fabricated data for real data — an empty calendar should
 * read as "you're clear", not as a fake "Investor meeting with Sarah Chen".
 * Showing invented data as if it were real is the fastest way to lose a user's
 * trust in an assistant.
 */
export const IS_DEMO_MODE =
  import.meta.env.VITE_DEMO_EMAILS === 'true' ||
  import.meta.env.VITE_DEMO_CHANNELS === 'true';
