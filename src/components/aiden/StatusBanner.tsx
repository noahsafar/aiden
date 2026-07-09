import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useSystemStatusStore } from '@/stores/systemStatusStore';

/**
 * Quiet, honest system-health bar. Silent when everything's up. When a
 * subsystem is down, it says so plainly and reassures that the app is running
 * on cached data — the opposite of the old silent-failure behavior, which left
 * a user staring at stale mail with no idea anything was wrong.
 */
export const StatusBanner: React.FC = () => {
  const health = useSystemStatusStore((s) => s.health);

  // Server outage is the more fundamental one — lead with it.
  const down =
    health.server.state === 'down'
      ? { message: health.server.message || 'Connection lost — showing cached data.' }
      : health.ai.state === 'down'
        ? { message: health.ai.message || 'AI features are temporarily unavailable.' }
        : null;

  if (!down) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2.5 border-b border-amber-200/70 bg-amber-50/80 px-6 py-2 text-[13px] text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/[0.10] dark:text-amber-300"
    >
      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
      <span className="min-w-0 truncate">{down.message}</span>
    </div>
  );
};

export default StatusBanner;
