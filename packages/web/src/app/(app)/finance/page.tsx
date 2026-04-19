'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Separator } from '@/components/ui/Separator';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/Alert';
import { Lock, TrendingUp, TrendingDown, Activity } from 'lucide-react';

const STATS = [
  { label: 'Total Inflow',  value: '—', sub: 'All sources',        Icon: TrendingUp  },
  { label: 'Total Spend',   value: '—', sub: 'Budget actual',      Icon: TrendingDown },
  { label: 'Net Position',  value: '—', sub: 'Inflow minus spend', Icon: Activity    },
] as const;

/**
 * Private finance page.
 * Guard layers:
 *   1. Sidebar hides the link unless canViewFinance=true
 *   2. This page redirects to /dashboard on the client
 *   3. API enforces it independently on the server
 */
export default function FinancePage() {
  const { user, isBootstrapping } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (!isBootstrapping && user && !user.canViewFinance) {
      router.replace('/dashboard');
    }
  }, [user, isBootstrapping, router]);

  if (isBootstrapping || !user) return null;
  if (!user.canViewFinance)      return null;

  return (
    <div className="px-6 py-8 space-y-8 animate-fade-in">

      {/* Header */}
      <PageHeader
        title="Client Finance"
        subtitle="Visible only to authorised finance users."
        action={<Badge variant="private">Private</Badge>}
      />

      {/* Access reminder */}
      <Alert variant="warning">
        <Lock className="h-4 w-4" />
        <AlertTitle>Restricted area</AlertTitle>
        <AlertDescription>
          Data in this section is confidential. Do not share screenshots or exports
          with unauthorised personnel.
        </AlertDescription>
      </Alert>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {STATS.map(({ label, value, sub, Icon }) => (
          <Card key={label} className="border-amber-500/30">
            <CardContent className="flex items-start gap-4 pt-5 pb-5">
              <div className="rounded-lg bg-amber-500/10 p-2.5">
                <Icon className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="text-2xl font-semibold tracking-tight text-foreground">{value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Cash Inflows */}
      <Card className="border-amber-500/30">
        <CardHeader>
          <CardTitle>Cash Inflows</CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">
            Inflow records (sales, investments, loans) will appear here in Day 10.
          </p>
        </CardContent>
      </Card>

      {/* Expenditure */}
      <Card className="border-amber-500/30">
        <CardHeader>
          <CardTitle>Expenditure Summary</CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">
            Budget vs actual spend breakdown will appear here in Day 10.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
