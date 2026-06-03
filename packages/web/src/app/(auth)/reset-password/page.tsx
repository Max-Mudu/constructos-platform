'use client';

import { Suspense, useState, FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authApi, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') ?? '';

  const [password,  setPassword]  = useState('');
  const [loading,   setLoading]   = useState(false);
  const [done,      setDone]      = useState(false);
  const [error,     setError]     = useState('');

  if (!token) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          This reset link is invalid or has expired.{' '}
          <Link href="/forgot-password" className="underline underline-offset-2">
            Request a new one.
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError('This reset link is invalid or has already been used. Request a new one.');
        } else if (err.details?.password) {
          setError(err.details.password[0]!);
        } else {
          setError(err.message);
        }
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <>
        <Alert variant="default" className="border-green-500/30 bg-green-500/10 mb-6">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-700 dark:text-green-400">
            Password reset successfully. You can now sign in with your new password.
          </AlertDescription>
        </Alert>
        <Link
          href="/login"
          className="block w-full rounded-lg bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Go to sign in
        </Link>
      </>
    );
  }

  return (
    <>
      <div className="mb-6">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Set a new password</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Choose a strong password for your account.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="New password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Min. 8 chars, 1 uppercase, 1 number"
          autoComplete="new-password"
          required
        />

        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" loading={loading} className="w-full">
          Reset password
        </Button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="rounded-xl border border-border bg-card p-8 shadow-sm">
      <Suspense fallback={<div className="h-48 animate-pulse rounded-lg bg-muted" />}>
        <ResetPasswordContent />
      </Suspense>
    </div>
  );
}
