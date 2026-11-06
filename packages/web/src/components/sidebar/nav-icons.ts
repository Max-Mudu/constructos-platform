import type { ComponentType } from 'react';
import {
  LayoutDashboard, Building2, HardHat, ClipboardCheck, ClipboardList, Target,
  Truck, UserCheck, FileStack, PieChart, Receipt, Lock,
  ScrollText, Settings, Bell, Layers, Package, CalendarDays,
  BarChart2, ClipboardPen, Users,
} from 'lucide-react';

/**
 * Icons a nav item may name in nav-config.ts (`icon` field). A name missing
 * here renders no icon, so nav-config.test.ts checks every item against it.
 */
export const NAV_ICON_MAP: Record<string, ComponentType<{ className?: string }>> = {
  LayoutDashboard, Building2, HardHat, ClipboardCheck, ClipboardList, Target,
  Truck, UserCheck, FileStack, PieChart, Receipt, Lock,
  ScrollText, Settings, Bell, Layers, Package, CalendarDays, BarChart2, ClipboardPen,
  Users,
};
