import { create } from 'zustand';

/**
 * System health — the difference between "silently broken" and "quietly honest".
 *
 * Every network path in the app degrades gracefully (by design: cached data
 * keeps the UI alive), but a product must also TELL the user when it's running
 * on cache. Two subsystems match the real plumbing:
 *   - server: the local Python backend (email + calendar + Slack all ride on it)
 *   - ai:     the AI processing pipeline (summaries, classification, drafts)
 *
 * Failures are debounced by count so one transient blip doesn't flash a banner:
 * a subsystem goes visibly down after N consecutive failures and recovers on
 * the first success.
 */

export type Subsystem = 'server' | 'ai';
export type HealthState = 'ok' | 'down' | 'unknown';

interface SubsystemHealth {
  state: HealthState;
  /** consecutive failures observed (resets on success) */
  failures: number;
  /** last failure message, for the banner/tooltip */
  message?: string;
  /** ms epoch of the last transition into `down` */
  since?: number;
}

// One flaky call shouldn't alarm anyone; a pattern should.
const DOWN_AFTER: Record<Subsystem, number> = { server: 2, ai: 3 };

interface SystemStatusState {
  health: Record<Subsystem, SubsystemHealth>;
  reportOk: (subsystem: Subsystem) => void;
  reportFailure: (subsystem: Subsystem, message?: string) => void;
}

const initial = (): SubsystemHealth => ({ state: 'unknown', failures: 0 });

export const useSystemStatusStore = create<SystemStatusState>((set) => ({
  health: { server: initial(), ai: initial() },

  reportOk: (subsystem) =>
    set((s) => ({
      health: {
        ...s.health,
        [subsystem]: { state: 'ok', failures: 0 },
      },
    })),

  reportFailure: (subsystem, message) =>
    set((s) => {
      const prev = s.health[subsystem];
      const failures = prev.failures + 1;
      const goesDown = failures >= DOWN_AFTER[subsystem];
      return {
        health: {
          ...s.health,
          [subsystem]: {
            state: goesDown ? 'down' : prev.state === 'down' ? 'down' : prev.state,
            failures,
            message: message || prev.message,
            since: goesDown && prev.state !== 'down' ? Date.now() : prev.since,
          },
        },
      };
    }),
}));

/** Convenience for non-React callers (stores, api modules). */
export const systemStatus = {
  ok: (subsystem: Subsystem) => useSystemStatusStore.getState().reportOk(subsystem),
  fail: (subsystem: Subsystem, message?: string) =>
    useSystemStatusStore.getState().reportFailure(subsystem, message),
};
