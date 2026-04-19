'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { attendanceApi, workerApi, ApiError } from '@/lib/api';
import { Worker, AttendanceStatus } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ArrowLeft, AlertCircle } from 'lucide-react';

const STATUS_OPTIONS: { value: AttendanceStatus; label: string }[] = [
  { value: 'present',  label: 'Present' },
  { value: 'absent',   label: 'Absent' },
  { value: 'late',     label: 'Late' },
  { value: 'half_day', label: 'Half Day' },
  { value: 'excused',  label: 'Excused' },
];

function today(): string {
  return new Date().toISOString().split('T')[0];
}

export default function NewAttendancePage() {
  const { projectId, siteId } = useParams<{ projectId: string; siteId: string }>();
  const router = useRouter();

  const [workers,      setWorkers]      = useState<Worker[]>([]);
  const [workerId,     setWorkerId]     = useState('');
  const [date,         setDate]         = useState(today());
  const [status,       setStatus]       = useState<AttendanceStatus>('present');
  const [checkInTime,  setCheckInTime]  = useState('');
  const [checkOutTime, setCheckOutTime] = useState('');
  const [notes,        setNotes]        = useState('');
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState('');

  useEffect(() => {
    if (!projectId || !siteId) return;
    workerApi.listSiteWorkers(projectId, siteId)
      .then((d) => setWorkers(d.workers))
      .catch(() => {});
  }, [projectId, siteId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workerId) { setError('Please select a worker'); return; }
    setSaving(true);
    setError('');
    try {
      await attendanceApi.create(projectId, siteId, {
        workerId,
        date,
        status,
        ...(checkInTime  && { checkInTime }),
        ...(checkOutTime && { checkOutTime }),
        ...(notes        && { notes }),
      });
      router.push(`/projects/${projectId}/sites/${siteId}/attendance`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create attendance record');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-lg">
      <div>
        <Link
          href={`/projects/${projectId}/sites/${siteId}/attendance`}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Attendance
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Add Attendance Record</h1>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Record Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Worker */}
            <div className="space-y-1">
              <label className="text-sm font-medium">Worker *</label>
              <select
                value={workerId}
                onChange={(e) => setWorkerId(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                required
              >
                <option value="">Select a worker…</option>
                {workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.firstName} {w.lastName}{w.trade ? ` — ${w.trade}` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Date */}
            <div className="space-y-1">
              <label className="text-sm font-medium">Date *</label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>

            {/* Status */}
            <div className="space-y-1">
              <label className="text-sm font-medium">Status *</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as AttendanceStatus)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                required
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {/* Check-in / Check-out */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Check-in Time</label>
                <Input
                  type="time"
                  value={checkInTime}
                  onChange={(e) => setCheckInTime(e.target.value)}
                  placeholder="HH:MM"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Check-out Time</label>
                <Input
                  type="time"
                  value={checkOutTime}
                  onChange={(e) => setCheckOutTime(e.target.value)}
                  placeholder="HH:MM"
                />
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1">
              <label className="text-sm font-medium">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="Optional notes…"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save Record'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push(`/projects/${projectId}/sites/${siteId}/attendance`)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
