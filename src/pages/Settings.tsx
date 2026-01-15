import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Bell, Moon, Users, Zap, Clock } from 'lucide-react';

interface AppSettings {
  polling_interval_minutes: number;
  enable_notifications: boolean;
  enable_auto_reply: boolean;
  auto_reply_delay_minutes: number;
  urgent_keywords: string[];
  important_senders: string[];
  working_hours_start: string;
  working_hours_end: string;
  timezone: string;
  // Smart notification settings
  notification_mode: 'all' | 'smart' | 'vip_only';
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  batch_notifications_enabled: boolean;
  batch_interval_minutes: number;
  vip_senders: string[];
  emergency_keywords: string[];
}

const DEFAULT_SETTINGS: AppSettings = {
  polling_interval_minutes: 5,
  enable_notifications: true,
  enable_auto_reply: false,
  auto_reply_delay_minutes: 30,
  urgent_keywords: ['urgent', 'emergency', 'asap', 'immediately'],
  important_senders: [],
  working_hours_start: '09:00',
  working_hours_end: '17:00',
  timezone: 'UTC',
  notification_mode: 'smart',
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '08:00',
  batch_notifications_enabled: true,
  batch_interval_minutes: 15,
  vip_senders: [],
  emergency_keywords: ['emergency', '911', 'urgent', 'critical', 'immediate', 'asap', 'fire'],
};

export function Settings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

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

  const handleSave = async () => {
    setSaving(true);
    try {
      await invoke('save_settings', { settings });
      setSaved(true);
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

  const updateArraySetting = (key: keyof AppSettings, value: string) => {
    const arr = (settings[key] as string[]) || [];
    if (arr.includes(value)) {
      updateSetting(key as any, arr.filter(v => v !== value));
    } else {
      updateSetting(key as any, [...arr, value]);
    }
  };

  const addListItem = (key: keyof AppSettings, value: string) => {
    if (!value.trim()) return;
    const arr = (settings[key] as string[]) || [];
    if (!arr.includes(value)) {
      updateSetting(key as any, [...arr, value.trim()]);
    }
  };

  const removeListItem = (key: keyof AppSettings, value: string) => {
    const arr = (settings[key] as string[]) || [];
    updateSetting(key as any, arr.filter(v => v !== value));
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-gray-500">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
              Settings
            </h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Configure Aiden to your preferences
            </p>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              saved
                ? 'bg-green-600 text-white'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            } ${saving ? 'opacity-50 cursor-wait' : ''}`}
          >
            {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl space-y-6">
          {/* Notifications Section */}
          <div className="rounded-lg bg-white p-6 shadow-sm dark:bg-gray-800">
            <div className="flex items-center gap-3 mb-4">
              <Bell className="w-5 h-5 text-blue-600" />
              <h2 className="text-lg font-medium text-gray-900 dark:text-white">
                Smart Notifications
              </h2>
            </div>

            {/* Enable Notifications */}
            <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-gray-700">
              <div>
                <p className="font-medium text-gray-900 dark:text-white">
                  Enable Notifications
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Receive notifications for new emails
                </p>
              </div>
              <button
                onClick={() => updateSetting('enable_notifications', !settings.enable_notifications)}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  settings.enable_notifications ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span
                  className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                    settings.enable_notifications ? 'translate-x-7' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Notification Mode */}
            {settings.enable_notifications && (
              <>
                <div className="py-4 border-b border-gray-100 dark:border-gray-700">
                  <p className="font-medium text-gray-900 dark:text-white mb-2">
                    Notification Mode
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Choose when to be notified about new emails
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    <button
                      onClick={() => updateSetting('notification_mode', 'all')}
                      className={`p-4 rounded-lg border-2 text-left transition-colors ${
                        settings.notification_mode === 'all'
                          ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                      }`}
                    >
                      <div className="font-medium text-gray-900 dark:text-white">All</div>
                      <div className="text-xs text-gray-500 mt-1">Every email</div>
                    </button>
                    <button
                      onClick={() => updateSetting('notification_mode', 'smart')}
                      className={`p-4 rounded-lg border-2 text-left transition-colors ${
                        settings.notification_mode === 'smart'
                          ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                      }`}
                    >
                      <div className="font-medium text-gray-900 dark:text-white">Smart</div>
                      <div className="text-xs text-gray-500 mt-1">Recommended</div>
                    </button>
                    <button
                      onClick={() => updateSetting('notification_mode', 'vip_only')}
                      className={`p-4 rounded-lg border-2 text-left transition-colors ${
                        settings.notification_mode === 'vip_only'
                          ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                      }`}
                    >
                      <div className="font-medium text-gray-900 dark:text-white">VIP Only</div>
                      <div className="text-xs text-gray-500 mt-1">Priority only</div>
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-3">
                    {settings.notification_mode === 'all' && 'You will receive a notification for every new email.'}
                    {settings.notification_mode === 'smart' && 'Immediate notifications for urgent/important emails. Normal emails are batched.'}
                    {settings.notification_mode === 'vip_only' && 'Only urgent, important, and VIP senders trigger notifications.'}
                  </p>
                </div>

                {/* Batching */}
                <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-gray-700">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">
                      Batch Notifications
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Combine multiple emails into one notification
                    </p>
                  </div>
                  <button
                    onClick={() => updateSetting('batch_notifications_enabled', !settings.batch_notifications_enabled)}
                    className={`relative w-12 h-6 rounded-full transition-colors ${
                      settings.batch_notifications_enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                  >
                    <span
                      className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                        settings.batch_notifications_enabled ? 'translate-x-7' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {settings.batch_notifications_enabled && (
                  <div className="py-3 px-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg mb-3 border-b border-gray-100 dark:border-gray-700">
                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                      Batch Interval: {settings.batch_interval_minutes} minutes
                    </label>
                    <input
                      type="range"
                      min="5"
                      max="60"
                      step="5"
                      value={settings.batch_interval_minutes}
                      onChange={(e) => updateSetting('batch_interval_minutes', Number(e.target.value))}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-gray-500 mt-1">
                      <span>5 min</span>
                      <span>30 min</span>
                      <span>60 min</span>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Quiet Hours Section */}
          {settings.enable_notifications && (
            <div className="rounded-lg bg-white p-6 shadow-sm dark:bg-gray-800">
              <div className="flex items-center gap-3 mb-4">
                <Moon className="w-5 h-5 text-purple-600" />
                <h2 className="text-lg font-medium text-gray-900 dark:text-white">
                  Quiet Hours
                </h2>
              </div>

              <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-gray-700">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">
                    Enable Quiet Hours
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Silence notifications during sleep hours
                  </p>
                </div>
                <button
                  onClick={() => updateSetting('quiet_hours_enabled', !settings.quiet_hours_enabled)}
                  className={`relative w-12 h-6 rounded-full transition-colors ${
                    settings.quiet_hours_enabled ? 'bg-purple-600' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  <span
                    className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                      settings.quiet_hours_enabled ? 'translate-x-7' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {settings.quiet_hours_enabled && (
                <div className="grid grid-cols-2 gap-4 py-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
                      Start Time
                    </label>
                    <input
                      type="time"
                      value={settings.quiet_hours_start}
                      onChange={(e) => updateSetting('quiet_hours_start', e.target.value)}
                      className="w-full rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
                      End Time
                    </label>
                    <input
                      type="time"
                      value={settings.quiet_hours_end}
                      onChange={(e) => updateSetting('quiet_hours_end', e.target.value)}
                      className="w-full rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                </div>
              )}

              {settings.quiet_hours_enabled && (
                <div className="mt-3 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                  <p className="text-sm text-purple-800 dark:text-purple-300">
                    <Zap className="w-4 h-4 inline mr-1" />
                    Emergency keywords will bypass quiet hours
                  </p>
                </div>
              )}
            </div>
          )}

          {/* VIP & Important Senders */}
          {settings.enable_notifications && (
            <div className="rounded-lg bg-white p-6 shadow-sm dark:bg-gray-800">
              <div className="flex items-center gap-3 mb-4">
                <Users className="w-5 h-5 text-green-600" />
                <h2 className="text-lg font-medium text-gray-900 dark:text-white">
                  Priority Senders
                </h2>
              </div>

              {/* VIP Senders */}
              <div className="mb-4">
                <p className="font-medium text-gray-900 dark:text-white mb-2">
                  VIP Senders
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  Always notify immediately, even during quiet hours
                </p>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    placeholder="Add email or name..."
                    className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white px-3 py-2"
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        addListItem('vip_senders', (e.target as HTMLInputElement).value);
                        ((e.target as HTMLInputElement).value = '');
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      const input = document.querySelector('input[placeholder="Add email or name..."]') as HTMLInputElement;
                      if (input) {
                        addListItem('vip_senders', input.value);
                        input.value = '';
                      }
                    }}
                    className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                  >
                    Add
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {settings.vip_senders.map(sender => (
                    <span
                      key={sender}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 rounded-full text-sm"
                    >
                      {sender}
                      <button
                        onClick={() => removeListItem('vip_senders', sender)}
                        className="hover:text-green-600"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {settings.vip_senders.length === 0 && (
                    <span className="text-sm text-gray-500 italic">No VIP senders added</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* AI & Processing Section */}
          <div className="rounded-lg bg-white p-6 shadow-sm dark:bg-gray-800">
            <div className="flex items-center gap-3 mb-4">
              <Zap className="w-5 h-5 text-yellow-600" />
              <h2 className="text-lg font-medium text-gray-900 dark:text-white">
                Email Processing
              </h2>
            </div>

            <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-gray-700">
              <div>
                <p className="font-medium text-gray-900 dark:text-white">
                  Auto-send Replies
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Automatically send AI-generated replies
                </p>
              </div>
              <button
                onClick={() => updateSetting('enable_auto_reply', !settings.enable_auto_reply)}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  settings.enable_auto_reply ? 'bg-yellow-600' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span
                  className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                    settings.enable_auto_reply ? 'translate-x-7' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="py-4">
              <label className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
                Polling Interval
              </label>
              <select
                value={settings.polling_interval_minutes}
                onChange={(e) => updateSetting('polling_interval_minutes', Number(e.target.value))}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-yellow-500 focus:ring-yellow-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              >
                <option value={1}>Every minute</option>
                <option value={5}>Every 5 minutes</option>
                <option value={10}>Every 10 minutes</option>
                <option value={15}>Every 15 minutes</option>
                <option value={30}>Every 30 minutes</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
