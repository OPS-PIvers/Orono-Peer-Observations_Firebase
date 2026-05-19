import {
  BookOpen,
  Building2,
  CalendarDays,
  FileText,
  History,
  LayoutDashboard,
  Mail,
  Palette,
  Shield,
  SlidersHorizontal,
  Users,
} from 'lucide-react';

export interface AdminNavItem {
  to: string;
  label: string;
  icon: React.ElementType;
}

export const ADMIN_NAV: readonly AdminNavItem[] = [
  { to: '/admin/staff', label: 'Staff', icon: Users },
  { to: '/admin/roles', label: 'Roles', icon: Shield },
  { to: '/admin/buildings', label: 'Buildings', icon: Building2 },
  { to: '/admin/rubrics', label: 'Rubrics', icon: BookOpen },
  { to: '/admin/role-year-mappings', label: 'Role/Year', icon: CalendarDays },
  { to: '/admin/work-product', label: 'Work Product', icon: FileText },
  { to: '/admin/email-templates', label: 'Email Templates', icon: Mail },
  { to: '/admin/branding', label: 'Branding', icon: Palette },
  { to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/admin/settings', label: 'Settings', icon: SlidersHorizontal },
  { to: '/admin/audit-log', label: 'Audit Log', icon: History },
] as const;
