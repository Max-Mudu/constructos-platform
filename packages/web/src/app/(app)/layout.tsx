import { Sidebar } from '@/components/sidebar/Sidebar';
import { AuthBootstrap } from '@/components/AuthBootstrap';
import { AuthGuard } from '@/components/AuthGuard';
import { SSEProvider } from '@/providers/SSEProvider';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <AuthBootstrap />
      <AuthGuard>
        <SSEProvider>
          <Sidebar />
          <div className="flex flex-1 flex-col min-w-0 pt-14 md:pt-0">
            <main className="flex-1">
              {children}
            </main>
          </div>
        </SSEProvider>
      </AuthGuard>
    </div>
  );
}
