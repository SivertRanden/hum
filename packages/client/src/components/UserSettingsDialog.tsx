import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/index.js';

export interface HumSettings {
  theme: 'dark' | 'light';
  notifyOnMention: boolean;
  micDeviceId: string | null;
}

export const DEFAULT_SETTINGS: HumSettings = {
  theme: 'dark',
  notifyOnMention: true,
  micDeviceId: null,
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: HumSettings;
  onSettingsChange: (settings: HumSettings) => void;
}

type Tab = 'notifications' | 'appearance' | 'voice';

function Toggle({
  checked,
  onChange,
  id,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  id: string;
}) {
  return (
    <button
      id={id}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="settings-toggle"
      data-checked={checked}
      type="button"
    >
      <span className="settings-toggle-thumb" />
    </button>
  );
}

export function UserSettingsDialog({ open, onOpenChange, settings, onSettingsChange }: Props) {
  const [tab, setTab] = useState<Tab>('notifications');
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [notifyPermission, setNotifyPermission] = useState<NotificationPermission>('default');

  useEffect(() => {
    if (!open) return;
    if ('Notification' in window) {
      setNotifyPermission(Notification.permission);
    }
    // Enumerate microphone devices
    navigator.mediaDevices
      .enumerateDevices()
      .then(devices => setMicDevices(devices.filter(d => d.kind === 'audioinput')))
      .catch(() => setMicDevices([]));
  }, [open]);

  const set = <K extends keyof HumSettings>(key: K, value: HumSettings[K]) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  const requestNotifyPermission = async () => {
    if (!('Notification' in window)) return;
    const result = await Notification.requestPermission();
    setNotifyPermission(result);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="settings-dialog">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="settings-tabs">
          {(['notifications', 'appearance', 'voice'] as Tab[]).map(t => (
            <button
              key={t}
              type="button"
              className={`settings-tab${tab === t ? ' active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'notifications' ? 'Notifications' : t === 'appearance' ? 'Appearance' : 'Voice & Audio'}
            </button>
          ))}
        </div>

        <div className="settings-body">
          {tab === 'notifications' && (
            <div className="settings-section">
              <div className="settings-row">
                <div className="settings-row-label">
                  <span>Mention notifications</span>
                  <span className="settings-row-hint">Show a desktop notification when you are @mentioned</span>
                </div>
                <Toggle
                  id="notify-mention"
                  checked={settings.notifyOnMention}
                  onChange={v => set('notifyOnMention', v)}
                />
              </div>

              {notifyPermission !== 'granted' && (
                <div className="settings-notice">
                  {notifyPermission === 'denied' ? (
                    <span>Browser notifications are blocked. Enable them in your browser settings.</span>
                  ) : (
                    <button
                      type="button"
                      className="settings-link-btn"
                      onClick={() => void requestNotifyPermission()}
                    >
                      Grant browser notification permission
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === 'appearance' && (
            <div className="settings-section">
              <div className="settings-row">
                <div className="settings-row-label">
                  <span>Light theme</span>
                  <span className="settings-row-hint">Switch between dark and light appearance</span>
                </div>
                <Toggle
                  id="theme-toggle"
                  checked={settings.theme === 'light'}
                  onChange={v => set('theme', v ? 'light' : 'dark')}
                />
              </div>
            </div>
          )}

          {tab === 'voice' && (
            <div className="settings-section">
              <div className="settings-field">
                <label htmlFor="mic-select" className="settings-field-label">Microphone</label>
                {micDevices.length === 0 ? (
                  <p className="settings-row-hint">No microphone devices found.</p>
                ) : (
                  <select
                    id="mic-select"
                    className="settings-select"
                    value={settings.micDeviceId ?? ''}
                    onChange={e => set('micDeviceId', e.target.value || null)}
                  >
                    <option value="">Default</option>
                    {micDevices.map(d => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                      </option>
                    ))}
                  </select>
                )}
                <p className="settings-row-hint" style={{ marginTop: 6 }}>
                  The selected microphone will be used when joining voice rooms.
                </p>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
