'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authApi, ApiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { AlertCircle } from 'lucide-react';

const CURRENCIES = [
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'GBP', label: 'GBP — British Pound' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'KES', label: 'KES — Kenyan Shilling' },
  { value: 'NGN', label: 'NGN — Nigerian Naira' },
  { value: 'ZAR', label: 'ZAR — South African Rand' },
  { value: 'GHS', label: 'GHS — Ghanaian Cedi' },
];

export default function RegisterPage() {
  const router = useRouter();
  const { setAuth } = useAuthStore();

  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '',
    password: '', companyName: '', currency: 'USD',
  });
  const [errors, setErrors]           = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [loading, setLoading]         = useState(false);

  function setField(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: '' }));
  }

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!form.firstName.trim())              e.firstName   = 'Required';
    if (!form.lastName.trim())               e.lastName    = 'Required';
    if (!form.email.includes('@'))           e.email       = 'Enter a valid email';
    if (form.password.length < 8)            e.password    = 'Minimum 8 characters';
    else if (!/[A-Z]/.test(form.password))   e.password    = 'Must include an uppercase letter';
    else if (!/[0-9]/.test(form.password))   e.password    = 'Must include a number';
    if (form.companyName.trim().length < 2)  e.companyName = 'Enter your company name';
    return e;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError('');
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setLoading(true);
    try {
      const data = await authApi.register(form);
      setAuth(data.user, data.accessToken);
      router.push('/dashboard');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.details) {
          const fe: Record<string, string> = {};
          for (const [k, v] of Object.entries(err.details)) fe[k] = Array.isArray(v) ? v[0] : String(v);
          setErrors(fe);
        } else {
          setServerError(err.message);
        }
      } else {
        setServerError('Something went wrong. Try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-8 shadow-sm">
      <div className="mb-6">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          Register your company
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Set up your workspace in under a minute.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="First name"
            value={form.firstName}
            onChange={(e) => setField('firstName', e.target.value)}
            error={errors.firstName}
            autoComplete="given-name"
          />
          <Input
            label="Last name"
            value={form.lastName}
            onChange={(e) => setField('lastName', e.target.value)}
            error={errors.lastName}
            autoComplete="family-name"
          />
        </div>
        <Input
          label="Company name"
          value={form.companyName}
          onChange={(e) => setField('companyName', e.target.value)}
          error={errors.companyName}
          placeholder="Acme Construction Ltd"
        />
        <Input
          label="Work email"
          type="email"
          value={form.email}
          onChange={(e) => setField('email', e.target.value)}
          error={errors.email}
          placeholder="you@company.com"
          autoComplete="email"
        />
        <Input
          label="Password"
          type="password"
          value={form.password}
          onChange={(e) => setField('password', e.target.value)}
          error={errors.password}
          placeholder="Min. 8 chars, 1 uppercase, 1 number"
          autoComplete="new-password"
        />
        <Select
          label="Currency"
          value={form.currency}
          onChange={(e) => setField('currency', e.target.value)}
        >
          {CURRENCIES.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>

        {serverError && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" loading={loading} className="w-full">
          Create account
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}
