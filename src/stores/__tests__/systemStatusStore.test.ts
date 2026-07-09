import { describe, it, expect, beforeEach } from 'vitest';
import { useSystemStatusStore, systemStatus } from '@/stores/systemStatusStore';

const reset = () =>
  useSystemStatusStore.setState({
    health: { server: { state: 'unknown', failures: 0 }, ai: { state: 'unknown', failures: 0 } },
  });

describe('systemStatusStore', () => {
  beforeEach(reset);

  it('does not go down on a single transient server failure (debounced, threshold 2)', () => {
    systemStatus.fail('server', 'blip');
    expect(useSystemStatusStore.getState().health.server.state).not.toBe('down');
    expect(useSystemStatusStore.getState().health.server.failures).toBe(1);
  });

  it('goes down after the server threshold and records a message', () => {
    systemStatus.fail('server', 'unreachable');
    systemStatus.fail('server', 'unreachable');
    const h = useSystemStatusStore.getState().health.server;
    expect(h.state).toBe('down');
    expect(h.message).toBe('unreachable');
    expect(h.since).toBeGreaterThan(0);
  });

  it('recovers to ok on the first success and resets the failure count', () => {
    systemStatus.fail('server');
    systemStatus.fail('server');
    expect(useSystemStatusStore.getState().health.server.state).toBe('down');
    systemStatus.ok('server');
    const h = useSystemStatusStore.getState().health.server;
    expect(h.state).toBe('ok');
    expect(h.failures).toBe(0);
  });

  it('uses a higher threshold for the noisier AI subsystem (3)', () => {
    systemStatus.fail('ai');
    systemStatus.fail('ai');
    expect(useSystemStatusStore.getState().health.ai.state).not.toBe('down');
    systemStatus.fail('ai');
    expect(useSystemStatusStore.getState().health.ai.state).toBe('down');
  });

  it('tracks server and ai independently', () => {
    systemStatus.fail('server');
    systemStatus.fail('server');
    expect(useSystemStatusStore.getState().health.server.state).toBe('down');
    expect(useSystemStatusStore.getState().health.ai.state).toBe('unknown');
  });
});
