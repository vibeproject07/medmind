import Sidebar from '@/components/Dashboard/Sidebar';
import Topbar from '@/components/Dashboard/Topbar';
import FloatingButton from '@/components/Dashboard/FloatingButton';
import MobileBottomNav from '@/components/Dashboard/MobileBottomNav';
import { SidebarProvider } from '@/contexts/SidebarContext';
import { DashboardSearchProvider } from '@/contexts/DashboardSearchContext';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <DashboardSearchProvider>
        {/*
          Outer wrapper: bg-gray-900 fills the screen.
          On mobile the inner content card has rounded-b-[2.5rem],
          revealing the dark background as the bottom nav area.
          On desktop (md+) the content fills everything and there is no bottom nav.
        */}
        <div className="flex flex-col h-screen overflow-hidden bg-gray-900">
          {/* Content card */}
          <div className="flex flex-1 min-h-0 overflow-hidden rounded-b-[2.5rem] md:rounded-none bg-gray-50">
            <Sidebar />
            <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
              <Topbar />
              <main className="flex-1 min-h-0 p-3 sm:p-4 md:p-3 overflow-y-auto overflow-x-hidden">
                {children}
              </main>
            </div>
          </div>

          {/* Mobile bottom navigation */}
          <MobileBottomNav />
        </div>

        <FloatingButton />
      </DashboardSearchProvider>
    </SidebarProvider>
  );
}
