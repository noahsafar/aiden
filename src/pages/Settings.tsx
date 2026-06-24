import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Bell,
  Moon,
  Users,
  Zap,
  Check,
  LogOut,
  Palette,
  Eye,
  Clock,
  Sun,
  Monitor,
  X,
  Plus,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';
import {
  Surface,
  SurfaceHeader,
  SoftButton,
  PersonAvatar,
} from '@/components/aiden/primitives';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Settings shape — mirrors the Rust AppSettings struct. Backend-only  */
/* fields (important_senders, anthropic_api_key) are preserved on save */
/* via the raw-loaded ref so a save never silently drops them.         */
/* ------------------------------------------------------------------ */
interface AppSettings {
  theme: 'light' | 'dark' | 'auto';
  timezone: string;
  enable_notifications: boolean;
  show_notification_preview: boolean;
  notification_mode: 'all' | 'smart' | 'vip_only';
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  batch_notifications_enabled: boolean;
  batch_interval_minutes: number;
  vip_senders: string[];
  emergency_keywords: string[];
  visible_categories: string[];
  mark_as_read_on_view: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'auto',
  timezone: 'America/New_York',
  enable_notifications: true,
  show_notification_preview: true,
  notification_mode: 'smart',
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '08:00',
  batch_notifications_enabled: true,
  batch_interval_minutes: 15,
  vip_senders: [],
  emergency_keywords: ['emergency', '911', 'urgent', 'critical', 'immediate', 'asap', 'fire'],
  visible_categories: ['Urgent', 'Important', 'Normal', 'Low'],
  mark_as_read_on_view: true,
};

const TIMEZONE_OPTIONS = [
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Phoenix', label: 'Arizona (MST, no DST)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKST)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (HST)' },
  { value: 'America/Halifax', label: 'Atlantic Time (AT)' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Central European (CET)' },
  { value: 'Europe/Berlin', label: 'Berlin (CET)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { value: 'Asia/Shanghai', label: 'Shanghai (CST)' },
  { value: 'Asia/Dubai', label: 'Dubai (GST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST)' },
  { value: 'UTC', label: 'UTC' },
];

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const isValidEmail = (email: string) => EMAIL_REGEX.test(email.trim());

const THEME_OPTIONS = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'auto', label: 'System', icon: Monitor },
] as const;

const CATEGORY_TONE: Record<string, string> = {
  Urgent: 'bg-rose-50 text-rose-700 ring-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300',
  Important: 'bg-amber-50 text-amber-700 ring-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300',
  Normal: 'bg-sky-50 text-sky-700 ring-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300',
  Low: 'bg-gray-100 text-gray-600 ring-gray-400/30 dark:bg-white/10 dark:text-gray-300',
};

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */

const Card: React.FC<{
  icon: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
}> = ({ icon, title, description, children }) => (
  <Surface tone="raised" className="overflow-hidden">
    <div className="flex items-center gap-3 border-b border-gray-100 px-6 py-4 dark:border-white/[0.06]">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-500 dark:bg-violet-500/10 dark:text-violet-400">
        {icon}
      </div>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
        {description && <p className="text-[12px] text-muted">{description}</p>}
      </div>
    </div>
    <div className="px-6 py-5">{children}</div>
  </Surface>
);

const Row: React.FC<{
  title: string;
  description?: string;
  children: React.ReactNode;
  divided?: boolean;
}> = ({ title, description, children, divided }) => (
  <div
    className={cn(
      'flex items-center justify-between gap-4',
      divided && 'mt-5 border-t border-gray-100 pt-5 dark:border-white/[0.06]',
    )}
  >
    <div className="min-w-0">
      <p className="text-[14px] font-medium text-foreground">{title}</p>
      {description && <p className="mt-0.5 text-[12.5px] text-muted">{description}</p>}
    </div>
    <div className="flex-shrink-0">{children}</div>
  </div>
);

const Toggle: React.FC<{ checked: boolean; onChange: () => void }> = ({ checked, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={onChange}
    className={cn(
      'relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50',
      checked ? 'bg-violet-500' : 'bg-gray-200 dark:bg-white/[0.12]',
    )}
  >
    <span
      className={cn(
        'inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200',
        checked ? 'translate-x-6' : 'translate-x-1',
      )}
    />
  </button>
);

const TokenChips: React.FC<{
  values: string[];
  onRemove: (v: string) => void;
  tone: 'violet' | 'rose';
  empty: string;
}> = ({ values, onRemove, tone, empty }) => {
  const tones = {
    violet: 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300',
    rose: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
  };
  if (values.length === 0) return <p className="text-[13px] italic text-muted/70">{empty}</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {values.map((v) => (
        <span
          key={v}
          className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-medium', tones[tone])}
        >
          {v}
          <button onClick={() => onRemove(v)} className="rounded-full p-0.5 transition-colors hover:bg-black/10 dark:hover:bg-white/10">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
};

const inputCls =
  'w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-[14px] text-foreground transition-colors placeholder:text-muted focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/40 dark:border-white/[0.1] dark:bg-white/[0.04]';

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export function Settings() {
  const { signOut, user } = useAuthStore();
  const { setTheme, setThemeWithoutSave } = useThemeStore();

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [vipEmailInput, setVipEmailInput] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [vipError, setVipError] = useState('');

  // The full settings object as loaded from disk — used to preserve fields the
  // UI doesn't surface (important_senders, anthropic_api_key) when saving.
  const rawLoadedRef = useRef<Record<string, unknown>>({});
  const originalThemeRef = useRef<'light' | 'dark' | 'auto'>('auto');
  const isLoadedRef = useRef(false);

  useEffect(() => {
    invoke<AppSettings>('get_settings')
      .then((loaded) => {
        rawLoadedRef.current = (loaded as unknown as Record<string, unknown>) || {};
        const merged = { ...DEFAULT_SETTINGS, ...loaded };
        setSettings(merged);
        originalThemeRef.current = merged.theme;
        isLoadedRef.current = true;
        setLoading(false);
      })
      .catch(() => {
        setSettings(DEFAULT_SETTINGS);
        originalThemeRef.current = DEFAULT_SETTINGS.theme;
        isLoadedRef.current = true;
        setLoading(false);
      });
  }, []);

  // Revert any unsaved theme preview when leaving the page.
  useEffect(() => {
    return () => {
      if (isLoadedRef.current) setThemeWithoutSave(originalThemeRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Spread the raw loaded object first so backend-only fields survive,
      // then overlay the UI-managed values.
      const payload = { ...rawLoadedRef.current, ...settings };
      await invoke('save_settings', { settings: payload });
      rawLoadedRef.current = payload;
      setTheme(settings.theme);
      originalThemeRef.current = settings.theme;
      setSaved(true);
      setHasChanges(false);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error('Failed to save settings:', error);
    } finally {
      setSaving(false);
    }
  };

  const addVip = () => {
    const email = vipEmailInput.trim();
    if (!isValidEmail(email)) return setVipError('Enter a valid email address');
    if (settings.vip_senders.some((s) => s.toLowerCase() === email.toLowerCase())) return setVipError('Already in your VIP list');
    update('vip_senders', [...settings.vip_senders, email]);
    setVipEmailInput('');
    setVipError('');
  };

  const addKeyword = () => {
    const kw = keywordInput.trim().toLowerCase();
    if (!kw) return;
    if (settings.emergency_keywords.some((k) => k.toLowerCase() === kw)) return;
    update('emergency_keywords', [...settings.emergency_keywords, kw]);
    setKeywordInput('');
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-7 w-7 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
          <p className="text-sm text-muted">Loading settings…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-7 pb-16">
      <SurfaceHeader
        title="Settings"
        subtitle="Manage how Aiden works for you."
        actions={
          <SoftButton
            variant={saved ? 'soft' : 'primary'}
            icon={saved ? <Check className="h-3.5 w-3.5" /> : undefined}
            onClick={handleSave}
            disabled={saving || (!hasChanges && !saved)}
          >
            {saved ? 'Saved' : saving ? 'Saving…' : 'Save changes'}
          </SoftButton>
        }
      />

      {/* Account */}
      <Card icon={<Users className="h-4 w-4" />} title="Account" description="Your signed-in Google account">
        <div className="flex items-center gap-3">
          <PersonAvatar name={user?.name} email={user?.email} size={44} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-medium text-foreground">{user?.name || 'You'}</p>
            <p className="truncate text-[12.5px] text-muted">{user?.email || 'Not signed in'}</p>
          </div>
          <SoftButton variant="ghost" icon={<LogOut className="h-3.5 w-3.5" />} onClick={signOut} className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-500/10">
            Sign out
          </SoftButton>
        </div>
      </Card>

      {/* Appearance */}
      <Card icon={<Palette className="h-4 w-4" />} title="Appearance" description="How Aiden looks">
        <Row title="Theme" description="Choose light, dark, or follow your system">
          <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1 dark:bg-white/[0.06]">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => {
                  setThemeWithoutSave(opt.id);
                  update('theme', opt.id);
                }}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors',
                  settings.theme === opt.id
                    ? 'bg-white text-foreground shadow-sm dark:bg-white/[0.12]'
                    : 'text-muted hover:text-foreground',
                )}
              >
                <opt.icon className="h-3.5 w-3.5" />
                {opt.label}
              </button>
            ))}
          </div>
        </Row>
      </Card>

      {/* Notifications */}
      <Card icon={<Bell className="h-4 w-4" />} title="Notifications" description="When and how Aiden reaches you">
        <Row title="Enable notifications" description="Get notified about new messages">
          <Toggle checked={settings.enable_notifications} onChange={() => update('enable_notifications', !settings.enable_notifications)} />
        </Row>

        {settings.enable_notifications && (
          <>
            <Row title="Show preview" description="Include a summary in the notification" divided>
              <Toggle checked={settings.show_notification_preview} onChange={() => update('show_notification_preview', !settings.show_notification_preview)} />
            </Row>

            <div className="mt-5 border-t border-gray-100 pt-5 dark:border-white/[0.06]">
              <p className="text-[14px] font-medium text-foreground">Notification mode</p>
              <p className="mt-0.5 mb-3 text-[12.5px] text-muted">Decide what's worth interrupting you</p>
              <div className="grid grid-cols-3 gap-2.5">
                {([
                  { id: 'all', label: 'All', desc: 'Every message' },
                  { id: 'smart', label: 'Smart', desc: 'Priority instant, rest batched' },
                  { id: 'vip_only', label: 'VIP only', desc: 'Priority senders only' },
                ] as const).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => update('notification_mode', m.id)}
                    className={cn(
                      'relative rounded-xl border px-3.5 py-3 text-left transition-all',
                      settings.notification_mode === m.id
                        ? 'border-violet-400 bg-violet-50/60 dark:border-violet-500/40 dark:bg-violet-500/[0.08]'
                        : 'border-gray-200 hover:border-gray-300 dark:border-white/[0.08] dark:hover:border-white/[0.15]',
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-semibold text-foreground">{m.label}</span>
                      {m.id === 'smart' && (
                        <span className="rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-600 dark:text-violet-400">
                          Rec
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11.5px] leading-tight text-muted">{m.desc}</div>
                    {settings.notification_mode === m.id && (
                      <Check className="absolute right-2 top-2 h-3.5 w-3.5 text-violet-500" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            <Row title="Batch notifications" description="Group non-urgent messages into a digest" divided>
              <Toggle checked={settings.batch_notifications_enabled} onChange={() => update('batch_notifications_enabled', !settings.batch_notifications_enabled)} />
            </Row>

            {settings.batch_notifications_enabled && (
              <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3.5 dark:bg-white/[0.03]">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[13px] font-medium text-foreground">Batch every</span>
                  <span className="text-[13px] font-semibold tabular-nums text-violet-600 dark:text-violet-400">
                    {settings.batch_interval_minutes} min
                  </span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={60}
                  step={5}
                  value={settings.batch_interval_minutes}
                  onChange={(e) => update('batch_interval_minutes', Number(e.target.value))}
                  className="w-full cursor-pointer accent-violet-500"
                />
                <div className="mt-1 flex justify-between text-[11px] text-muted">
                  <span>5 min</span>
                  <span>60 min</span>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Quiet hours */}
      {settings.enable_notifications && (
        <Card icon={<Moon className="h-4 w-4" />} title="Quiet hours" description="Silence non-urgent notifications">
          <Row title="Enable quiet hours" description="Mute notifications during these hours">
            <Toggle checked={settings.quiet_hours_enabled} onChange={() => update('quiet_hours_enabled', !settings.quiet_hours_enabled)} />
          </Row>
          {settings.quiet_hours_enabled && (
            <>
              <div className="mt-5 grid grid-cols-2 gap-4 border-t border-gray-100 pt-5 dark:border-white/[0.06]">
                <div>
                  <label className="mb-1.5 block text-[12.5px] font-medium text-muted">Start</label>
                  <input type="time" value={settings.quiet_hours_start} onChange={(e) => update('quiet_hours_start', e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12.5px] font-medium text-muted">End</label>
                  <input type="time" value={settings.quiet_hours_end} onChange={(e) => update('quiet_hours_end', e.target.value)} className={inputCls} />
                </div>
              </div>
              <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-violet-50/60 px-3.5 py-2.5 dark:bg-violet-500/[0.07]">
                <Zap className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-violet-500" />
                <p className="text-[12.5px] leading-relaxed text-violet-900/80 dark:text-violet-200/90">
                  Emergency keywords and VIP senders still reach you during quiet hours.
                </p>
              </div>
            </>
          )}
        </Card>
      )}

      {/* VIP senders */}
      {settings.enable_notifications && (
        <Card icon={<Users className="h-4 w-4" />} title="VIP senders" description="Always notify immediately — even during quiet hours">
          <div className="mb-3 flex gap-2">
            <input
              type="email"
              value={vipEmailInput}
              onChange={(e) => {
                setVipEmailInput(e.target.value);
                setVipError('');
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addVip())}
              placeholder="name@company.com"
              className={inputCls}
            />
            <SoftButton variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={addVip}>
              Add
            </SoftButton>
          </div>
          {vipError && <p className="mb-3 text-[12.5px] text-rose-600 dark:text-rose-400">{vipError}</p>}
          <TokenChips values={settings.vip_senders} onRemove={(v) => update('vip_senders', settings.vip_senders.filter((s) => s !== v))} tone="violet" empty="No VIP senders yet" />
        </Card>
      )}

      {/* Emergency keywords */}
      {settings.enable_notifications && (
        <Card icon={<Zap className="h-4 w-4" />} title="Emergency keywords" description="These bypass every notification setting, including quiet hours">
          <div className="mb-3 flex gap-2">
            <input
              type="text"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addKeyword())}
              placeholder="e.g. emergency, asap"
              className={inputCls}
            />
            <SoftButton variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={addKeyword}>
              Add
            </SoftButton>
          </div>
          <TokenChips values={settings.emergency_keywords} onRemove={(v) => update('emergency_keywords', settings.emergency_keywords.filter((k) => k !== v))} tone="rose" empty="No emergency keywords yet" />
        </Card>
      )}

      {/* Calendar */}
      <Card icon={<Clock className="h-4 w-4" />} title="Calendar" description="Used for events and scheduling">
        <Row title="Timezone" description="Your local timezone for calendar events">
          <select value={settings.timezone} onChange={(e) => update('timezone', e.target.value)} className={cn(inputCls, 'w-auto min-w-[200px] cursor-pointer')}>
            {TIMEZONE_OPTIONS.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
        </Row>
      </Card>

      {/* Email behavior */}
      <Card icon={<Eye className="h-4 w-4" />} title="Email behavior" description="How Aiden handles your inbox">
        <Row title="Mark as read when opened" description="Automatically mark emails read when you view them">
          <Toggle checked={settings.mark_as_read_on_view} onChange={() => update('mark_as_read_on_view', !settings.mark_as_read_on_view)} />
        </Row>
        <div className="mt-5 border-t border-gray-100 pt-5 dark:border-white/[0.06]">
          <p className="text-[14px] font-medium text-foreground">Visible categories</p>
          <p className="mt-0.5 mb-3 text-[12.5px] text-muted">Which priority levels show in your inbox</p>
          <div className="flex flex-wrap gap-2">
            {['Urgent', 'Important', 'Normal', 'Low'].map((cat) => {
              const on = settings.visible_categories.includes(cat);
              return (
                <button
                  key={cat}
                  onClick={() =>
                    update(
                      'visible_categories',
                      on ? settings.visible_categories.filter((c) => c !== cat) : [...settings.visible_categories, cat],
                    )
                  }
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium ring-1 transition-all',
                    on ? CATEGORY_TONE[cat] : 'bg-transparent text-muted/60 ring-gray-200 dark:ring-white/[0.08]',
                  )}
                >
                  {cat}
                  {on && <Check className="h-3 w-3" />}
                </button>
              );
            })}
          </div>
        </div>
      </Card>
    </div>
  );
}
