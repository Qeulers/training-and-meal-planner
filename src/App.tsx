import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/data/queryClient';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { ThemeToggle } from '@/components/ThemeToggle';
import { SyncStatus } from '@/components/SyncStatus';
import { AuthProvider, useAuth } from '@/data/AuthProvider';
import { SyncProvider } from '@/data/sync/SyncProvider';
import { BottomNav } from '@/components/BottomNav';
import { SideNav } from '@/components/SideNav';
import { SignIn } from '@/features/auth/SignIn';
import { TodayPage } from '@/features/today/TodayPage';
import { CalendarPage } from '@/features/calendar/CalendarPage';
import { PlanPage } from '@/features/plan/PlanPage';
import { MovesPage } from '@/features/moves/MovesPage';
import { FoodPage } from '@/features/food/FoodPage';
import { StatsPage } from '@/features/stats/StatsPage';
import { Preview } from '@/features/dev/Preview';

function ProtectedShell() {
  return (
    <div className="min-h-screen bg-bg">
      <SideNav />
      {/* Mobile / tablet-portrait top bar (the sidebar carries brand + theme at ≥lg). */}
      <header className="sticky top-0 z-10 border-b border-border bg-bg/90 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-content items-center justify-between gap-3 px-4 py-2">
          <div className="min-w-0">
            <span className="block truncate font-display text-body-sm font-bold uppercase tracking-label text-text-dim">
              Training &amp; Meal Planner
            </span>
            <SyncStatus />
          </div>
          <ThemeToggle />
        </div>
      </header>
      <Routes>
        <Route path="/today" element={<TodayPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/moves" element={<MovesPage />} />
        <Route path="/food" element={<FoodPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="*" element={<Navigate to="/today" replace />} />
      </Routes>
      <BottomNav />
    </div>
  );
}

function Gate() {
  const { session, loading } = useAuth();
  // DEV-only visual harness for screenshotting components without auth.
  if (import.meta.env.DEV && window.location.pathname === '/preview') {
    return <Preview />;
  }
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg text-text-dim">
        Loading…
      </div>
    );
  }
  return session ? <ProtectedShell /> : <SignIn />;
}

export function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            {/* Inside AuthProvider: the outbox stamps and filters by owner. */}
            <SyncProvider>
              <Gate />
            </SyncProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
