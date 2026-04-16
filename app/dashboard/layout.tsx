import Sidebar from '@/components/Dashboard/Sidebar';
import Topbar from '@/components/Dashboard/Topbar';
import FloatingButton from '@/components/Dashboard/FloatingButton';
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
        <Sidebar />
        <div className="flex flex-col h-screen overflow-hidden bg-gray-50 overflow-x-hidden w-full">
          <Topbar />
          <main className="flex-1 min-h-0 p-3 sm:p-4 md:p-3 overflow-y-auto overflow-x-hidden">
            {children}
          </main>
        </div>
        <FloatingButton />
      </DashboardSearchProvider>
    </SidebarProvider>
  );
}
