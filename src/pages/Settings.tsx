import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { Bell, Moon, Users, Zap, Check, LogOut, ArrowLeft, Palette, Eye } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';
import logo from '/aiden-logo.png';

interface AppSettings {
  // Appearance
  theme: 'light' | 'dark' | 'auto';
  // Notifications
  enable_notifications: boolean;
  show_notification_preview: boolean;
  // Smart notification settings
  notification_mode: 'all' | 'smart' | 'vip_only';
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  batch_notifications_enabled: boolean;
  batch_interval_minutes: number;
  vip_senders: string[];
  emergency_keywords: string[];
  // Email behavior
  visible_categories: string[];
  mark_as_read_on_view: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'auto',
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

// Toggle Switch Component
function Switch({ checked, onChange, color = 'blue' }: { checked: boolean; onChange: () => void; color?: 'blue' | 'purple' | 'yellow' | 'green' }) {
  const colors = {
    blue: 'bg-blue-600',
    purple: 'bg-purple-600',
    yellow: 'bg-yellow-600',
    green: 'bg-green-600',
  };

  return (
    <button
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? colors[color] : 'bg-gray-200 dark:bg-gray-700'
      }`}
      type="button"
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

// Email validation regex (more permissive than RFC 5322 but practical)
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim());
}

export function Settings() {
  const navigate = useNavigate();
  const { signOut, user } = useAuthStore();
  const { setTheme } = useThemeStore();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [vipEmailInput, setVipEmailInput] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [emailError, setEmailError] = useState('');

  // Load settings on mount
  useEffect(() => {
    invoke<AppSettings>('get_settings')
      .then(loaded => {
        setSettings({ ...DEFAULT_SETTINGS, ...loaded });
        setLoading(false);
      })
      .catch(() => {
        setSettings(DEFAULT_SETTINGS);
        setLoading(false);
      });
  }, []);

  // Track changes
  useEffect(() => {
    if (!loading) {
      setHasChanges(true);
    }
  }, [settings, loading]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await invoke('save_settings', { settings });
      setSaved(true);
      setHasChanges(false);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error('Failed to save settings:', error);
    } finally {
      setSaving(false);
    }
  };

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const removeListItem = (key: keyof AppSettings, value: string) => {
    const arr = (settings[key] as string[]) || [];
    updateSetting(key as any, arr.filter(v => v !== value));
  };

  const addVipSender = () => {
    const email = vipEmailInput.trim();
    if (!email) {
      setEmailError('Please enter an email address');
      return;
    }
    if (!isValidEmail(email)) {
      setEmailError('Please enter a valid email address');
      return;
    }
    if (settings.vip_senders.some(s => s.toLowerCase() === email.toLowerCase())) {
      setEmailError('This email is already in your VIP list');
      return;
    }
    updateSetting('vip_senders', [...settings.vip_senders, email]);
    setVipEmailInput('');
    setEmailError('');
  };

  const addEmergencyKeyword = () => {
    const keyword = keywordInput.trim().toLowerCase();
    if (!keyword) {
      setEmailError('Please enter a keyword');
      return;
    }
    if (settings.emergency_keywords.some(k => k.toLowerCase() === keyword)) {
      setEmailError('This keyword is already in your emergency keywords list');
      return;
    }
    updateSetting('emergency_keywords', [...settings.emergency_keywords, keyword]);
    setKeywordInput('');
    setEmailError('');
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header - matches dashboard style */}
      <header className="h-14 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 z-10">
        <div className="flex items-center gap-0">
          <Link to="/dashboard" className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors mr-2" title="Back to Dashboard">
            <ArrowLeft className="h-4 w-4 text-gray-600 dark:text-gray-400" />
          </Link>
          <img
            src={logo}
            alt="Aiden Logo"
            className="h-8 w-8"
          />
          <h1 className="text-xl font-bold text-gray-900 dark:text-white ml-2">Aiden</h1>
          <span className="ml-4 text-sm text-gray-500">
            {user ? `${user.email}` : 'Not logged in'}
          </span>
        </div>

        <div className="flex items-center space-x-2">
          <button
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors relative"
          >
            <Bell className="h-4 w-4 text-gray-600 dark:text-gray-400" />
            <span className="absolute top-1 right-1 h-2 w-2 bg-red-500 rounded-full"></span>
          </button>
          <button
            onClick={signOut}
            className="px-3 py-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 rounded-lg font-medium text-sm transition-colors flex items-center gap-1"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h2>
            <p className="text-gray-600 dark:text-gray-400 mt-1">Configure your preferences</p>
          </div>
          {hasChanges && (
            <button
              onClick={handleSave}
              disabled={saving}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                saved
                  ? 'bg-green-600 text-white'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              } ${saving ? 'opacity-70 cursor-wait' : ''}`}
            >
              {saved ? (
                <>
                  <Check className="w-4 h-4" />
                  Saved
                </>
              ) : (
                saving ? 'Saving...' : 'Save Changes'
              )}
            </button>
          )}
        </div>

        <div className="space-y-6">
          {/* Notifications Section */}
          <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                <Bell className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Smart Notifications</h2>
            </div>

            <div className="p-6 space-y-6">
              {/* Enable Notifications */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">Enable Notifications</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Receive notifications for new emails</p>
                </div>
                <Switch
                  checked={settings.enable_notifications}
                  onChange={() => updateSetting('enable_notifications', !settings.enable_notifications)}
                  color="blue"
                />
              </div>

              {settings.enable_notifications && (
                <>
                  {/* Show Notification Preview */}
                  <div className="flex items-center justify-between border-t border-gray-200 dark:border-gray-700 pt-6">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">Show Notification Preview</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Display email summary in notifications</p>
                    </div>
                    <Switch
                      checked={settings.show_notification_preview}
                      onChange={() => updateSetting('show_notification_preview', !settings.show_notification_preview)}
                      color="blue"
                    />
                  </div>
                </>
              )}

              {settings.enable_notifications && (
                <>
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                    <p className="font-medium text-gray-900 dark:text-white mb-1">Notification Mode</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Choose when to be notified about new emails</p>
                    <div className="grid grid-cols-3 gap-3">
                      <button
                        onClick={() => updateSetting('notification_mode', 'all')}
                        className={`relative p-4 rounded-xl border-2 text-left transition-all ${
                          settings.notification_mode === 'all'
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-sm'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                        }`}
                      >
                        <div className="font-medium text-gray-900 dark:text-white">All</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Every email</div>
                        {settings.notification_mode === 'all' && (
                          <div className="absolute top-2 right-2 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        )}
                      </button>
                      <button
                        onClick={() => updateSetting('notification_mode', 'smart')}
                        className={`relative p-4 rounded-xl border-2 text-left transition-all ${
                          settings.notification_mode === 'smart'
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-sm'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                        }`}
                      >
                        <div className="flex items-center gap-1">
                          <span className="font-medium text-gray-900 dark:text-white">Smart</span>
                          <span className="text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">Recommended</span>
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Priority = instant, others = batched</div>
                        {settings.notification_mode === 'smart' && (
                          <div className="absolute top-2 right-2 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        )}
                      </button>
                      <button
                        onClick={() => updateSetting('notification_mode', 'vip_only')}
                        className={`relative p-4 rounded-xl border-2 text-left transition-all ${
                          settings.notification_mode === 'vip_only'
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-sm'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                        }`}
                      >
                        <div className="font-medium text-gray-900 dark:text-white">VIP Only</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Priority senders only</div>
                        {settings.notification_mode === 'vip_only' && (
                          <div className="absolute top-2 right-2 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-gray-200 dark:border-gray-700 pt-6">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">Batch Notifications</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Combine multiple emails into one digest</p>
                    </div>
                    <Switch
                      checked={settings.batch_notifications_enabled}
                      onChange={() => updateSetting('batch_notifications_enabled', !settings.batch_notifications_enabled)}
                      color="blue"
                    />
                  </div>

                  {settings.batch_notifications_enabled && (
                    <div className="ml-2 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-xl">
                      <div className="flex items-center justify-between mb-3">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          Batch every {settings.batch_interval_minutes} minutes
                        </label>
                      </div>
                      <input
                        type="range"
                        min="5"
                        max="60"
                        step="5"
                        value={settings.batch_interval_minutes}
                        onChange={(e) => updateSetting('batch_interval_minutes', Number(e.target.value))}
                        className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
                      />
                      <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-2">
                        <span>5 min</span>
                        <span>60 min</span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>

          {/* Quiet Hours Section */}
          {settings.enable_notifications && (
            <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
                <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                  <Moon className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                </div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Quiet Hours</h2>
              </div>

              <div className="p-6 space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">Enable Quiet Hours</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Silence notifications during sleep time</p>
                  </div>
                  <Switch
                    checked={settings.quiet_hours_enabled}
                    onChange={() => updateSetting('quiet_hours_enabled', !settings.quiet_hours_enabled)}
                    color="purple"
                  />
                </div>

                {settings.quiet_hours_enabled && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Start Time
                        </label>
                        <input
                          type="time"
                          value={settings.quiet_hours_start}
                          onChange={(e) => updateSetting('quiet_hours_start', e.target.value)}
                          className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          End Time
                        </label>
                        <input
                          type="time"
                          value={settings.quiet_hours_end}
                          onChange={(e) => updateSetting('quiet_hours_end', e.target.value)}
                          className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-3 p-4 bg-purple-50 dark:bg-purple-900/20 rounded-xl">
                      <Zap className="w-5 h-5 text-purple-600 dark:text-purple-400 flex-shrink-0" />
                      <p className="text-sm text-purple-800 dark:text-purple-300">
                        Emergency keywords like "emergency", "911", and "urgent" will bypass quiet hours. VIP senders can also reach you.
                      </p>
                    </div>
                  </>
                )}
              </div>
            </section>
          )}

          {/* VIP Senders Section */}
          {settings.enable_notifications && (
            <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
                <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                  <Users className="w-5 h-5 text-green-600 dark:text-green-400" />
                </div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">VIP Senders</h2>
              </div>

              <div className="p-6">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Add email addresses that should always notify you immediately, even during quiet hours.
                </p>

                <div className="flex gap-2 mb-4">
                  <input
                    type="email"
                    value={vipEmailInput}
                    onChange={(e) => {
                      setVipEmailInput(e.target.value);
                      setEmailError('');
                    }}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addVipSender();
                      }
                    }}
                    placeholder="example@email.com"
                    className={`flex-1 px-4 py-2 rounded-lg border ${
                      emailError
                        ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                        : 'border-gray-300 dark:border-gray-600 focus:ring-green-500 focus:border-green-500'
                    } bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:border-transparent`}
                  />
                  <button
                    onClick={addVipSender}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium text-sm transition-colors"
                  >
                    Add
                  </button>
                </div>
                {emailError && (
                  <p className="text-sm text-red-600 dark:text-red-400 mb-4">{emailError}</p>
                )}

                {settings.vip_senders.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {settings.vip_senders.map(sender => (
                      <span
                        key={sender}
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 rounded-full text-sm"
                      >
                        {sender}
                        <button
                          onClick={() => removeListItem('vip_senders', sender)}
                          className="hover:bg-green-200 dark:hover:bg-green-800 rounded-full p-0.5 transition-colors"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 dark:text-gray-500 italic">No VIP senders added yet</p>
                )}
              </div>
            </section>
          )}

          {/* Emergency Keywords Section */}
          {settings.enable_notifications && (
            <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
                <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg">
                  <Zap className="w-5 h-5 text-red-600 dark:text-red-400" />
                </div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Emergency Keywords</h2>
              </div>

              <div className="p-6">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Keywords that bypass all notification settings, including quiet hours.
                </p>

                <div className="flex gap-2 mb-4">
                  <input
                    type="text"
                    value={keywordInput}
                    onChange={(e) => {
                      setKeywordInput(e.target.value);
                      setEmailError('');
                    }}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addEmergencyKeyword();
                      }
                    }}
                    placeholder="e.g., emergency, 911"
                    className={`flex-1 px-4 py-2 rounded-lg border ${
                      emailError
                        ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                        : 'border-gray-300 dark:border-gray-600 focus:ring-red-500 focus:border-red-500'
                    } bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:border-transparent`}
                  />
                  <button
                    onClick={addEmergencyKeyword}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium text-sm transition-colors"
                  >
                    Add
                  </button>
                </div>
                {emailError && (
                  <p className="text-sm text-red-600 dark:text-red-400 mb-4">{emailError}</p>
                )}

                {settings.emergency_keywords.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {settings.emergency_keywords.map(keyword => (
                      <span
                        key={keyword}
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 rounded-full text-sm"
                      >
                        {keyword}
                        <button
                          onClick={() => removeListItem('emergency_keywords', keyword)}
                          className="hover:bg-red-200 dark:hover:bg-red-800 rounded-full p-0.5 transition-colors"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 dark:text-gray-500 italic">No emergency keywords added yet</p>
                )}
              </div>
            </section>
          )}

          {/* Appearance Section */}
          <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
              <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
                <Palette className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Appearance</h2>
            </div>

            <div className="p-6 space-y-6">
              {/* Theme */}
              <div>
                <p className="font-medium text-gray-900 dark:text-white mb-1">Theme</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Choose your preferred color scheme</p>
                <div className="grid grid-cols-3 gap-3">
                  {(['light', 'dark', 'auto'] as const).map((themeOption) => (
                    <button
                      key={themeOption}
                      onClick={() => {
                        setTheme(themeOption);
                        updateSetting('theme', themeOption);
                      }}
                      className={`relative p-4 rounded-xl border-2 text-left transition-all capitalize ${
                        settings.theme === themeOption
                          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 shadow-sm'
                          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                      }`}
                    >
                      <div className="font-medium text-gray-900 dark:text-white">{themeOption}</div>
                      {themeOption === 'auto' && (
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Follows system</div>
                      )}
                      {settings.theme === themeOption && (
                        <div className="absolute top-2 right-2 w-4 h-4 bg-indigo-500 rounded-full flex items-center justify-center">
                          <Check className="w-3 h-3 text-white" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Email Behavior Section */}
          <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
              <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                <Eye className="w-5 h-5 text-orange-600 dark:text-orange-400" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Email Behavior</h2>
            </div>

            <div className="p-6 space-y-6">
              {/* Mark as Read */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">Mark as read when viewed</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Automatically mark emails as read when you open them</p>
                </div>
                <Switch
                  checked={settings.mark_as_read_on_view}
                  onChange={() => updateSetting('mark_as_read_on_view', !settings.mark_as_read_on_view)}
                  color="blue"
                />
              </div>

              {/* Visible Categories */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                <p className="font-medium text-gray-900 dark:text-white mb-1">Visible Categories</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Choose which email categories to show in your inbox</p>
                <div className="flex flex-wrap gap-2">
                  {['Urgent', 'Important', 'Normal', 'Low'].map((category) => (
                    <button
                      key={category}
                      onClick={() => {
                        const updated = settings.visible_categories.includes(category)
                          ? settings.visible_categories.filter(c => c !== category)
                          : [...settings.visible_categories, category];
                        updateSetting('visible_categories', updated);
                      }}
                      className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                        settings.visible_categories.includes(category)
                          ? category === 'Urgent'
                            ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-2 border-red-500'
                            : category === 'Important'
                            ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 border-2 border-yellow-500'
                            : category === 'Normal'
                            ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-2 border-blue-500'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-2 border-gray-500'
                          : 'bg-gray-50 dark:bg-gray-800 text-gray-400 dark:text-gray-500 border-2 border-transparent'
                      }`}
                    >
                      {category}
                      {settings.visible_categories.includes(category) && (
                        <Check className="w-3 h-3 inline ml-1" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
