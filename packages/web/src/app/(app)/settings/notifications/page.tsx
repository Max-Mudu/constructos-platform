'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Bell, ChevronLeft, CheckCircle2 } from 'lucide-react';
import { notificationApi, ApiError } from '@/lib/api';
import { NotificationPreference } from '@/lib/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Alert, AlertDescription } from '@/components/ui/Alert';

// ─── Type metadata ─────────────────────────────────────────────────────────────

const TYPE_META: Record<string, { label: string; description: string }> = {
  instruction_created: {
    label:       'New Instructions',
    description: 'When a consultant instruction is issued that affects you.',
  },
  instruction_updated: {
    label:       'Instruction Updates',
    description: 'When an instruction you are involved with changes status.',
  },
  budget_approved: {
    label:       'Budget Approvals',
    description: 'When a project budget is approved or locked.',
  },
  invoice_status_changed: {
    label:       'Invoice Status Changes',
    description: 'When an invoice is approved, paid, disputed, or cancelled.',
  },
  delivery_received: {
    label:       'Delivery Received',
    description: 'When a material delivery is recorded at a project site.',
  },
  drawing_approved: {
    label:       'Drawing Approved',
    description: 'When a drawing revision is approved for construction.',
  },
  system: {
    label:       'System Notifications',
    description: 'Platform-level announcements and administrative alerts.',
  },
};

// ─── Toggle row ───────────────────────────────────────────────────────────────

function ToggleRow({
  pref,
  onChange,
}: {
  pref: NotificationPreference;
  onChange: (type: string, enabled: boolean) => void;
}) {
  const meta = TYPE_META[pref.type] ?? { label: pref.type, description: '' };

  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{meta.label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{meta.description}</p>
      </div>
      {/* Toggle switch */}
      <button
        role="switch"
        aria-checked={pref.enabled}
        onClick={() => onChange(pref.type, !pref.enabled)}
        className={`relative inline-flex h-5 w-9 flex-none cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
          pref.enabled ? 'bg-primary' : 'bg-muted'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${
            pref.enabled ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function NotificationSettingsPage() {
  const [preferences, setPreferences] = useState<NotificationPreference[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');
  const [saved,       setSaved]       = useState(false);

  useEffect(() => {
    notificationApi.getPreferences()
      .then((r) => setPreferences(r.preferences))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load preferences'))
      .finally(() => setLoading(false));
  }, []);

  function handleToggle(type: string, enabled: boolean) {
    setPreferences((prev) =>
      prev.map((p) => (p.type === type ? { ...p, enabled } : p)),
    );
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const result = await notificationApi.updatePreferences(
        preferences.map((p) => ({ type: p.type, enabled: p.enabled })),
      );
      setPreferences(result.preferences);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to save preferences');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="px-6 py-8 space-y-4">
        <Skeleton className="h-12 w-72 rounded-xl" />
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="px-6 py-8 space-y-6 animate-fade-in">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/notifications" className="hover:text-foreground transition-colors flex items-center gap-1">
          <ChevronLeft className="h-4 w-4" />
          Notifications
        </Link>
      </div>

      <PageHeader
        title="Notification Settings"
        subtitle="Choose which notifications you want to receive in-app."
        action={
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        }
      />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {saved && (
        <Alert>
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          <AlertDescription>Preferences saved successfully.</AlertDescription>
        </Alert>
      )}

      <div className="rounded-xl border border-border bg-card divide-y divide-border/60 px-6">
        {preferences.length === 0 ? (
          <div className="py-10 flex flex-col items-center gap-3">
            <Bell className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No notification types configured.</p>
          </div>
        ) : (
          preferences.map((pref) => (
            <ToggleRow
              key={pref.type}
              pref={pref}
              onChange={handleToggle}
            />
          ))
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Disabling a notification type only affects in-app notifications. Email notifications, when
        enabled, are configured separately.
      </p>
    </div>
  );
}
