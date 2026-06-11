import {
  AudioLines,
  BookOpen,
  Building2,
  CalendarClock,
  CalendarDays,
  FileText,
  History,
  LayoutDashboard,
  ListChecks,
  Mail,
  Palette,
  Shapes,
  Shield,
  SlidersHorizontal,
  Users,
} from 'lucide-react';

export interface AdminNavItem {
  to: string;
  label: string;
  icon: React.ElementType;
}

export interface AdminNavSection {
  /** Section heading shown above the group in the expanded sidebar. */
  label: string;
  items: readonly AdminNavItem[];
}

/**
 * Admin side-nav grouped into labeled sections so the (long) page list scans
 * more easily. The flat `ADMIN_NAV` below is derived from these for any
 * consumer that just needs the full ordered list.
 */
export const ADMIN_NAV_SECTIONS: readonly AdminNavSection[] = [
  {
    label: 'People & Org',
    items: [
      { to: '/admin/staff', label: 'Staff', icon: Users },
      { to: '/admin/roles', label: 'Roles', icon: Shield },
      { to: '/admin/buildings', label: 'Buildings', icon: Building2 },
      { to: '/admin/modules', label: 'Modules', icon: Shapes },
    ],
  },
  {
    label: 'Evaluation Setup',
    items: [
      { to: '/admin/rubrics', label: 'Rubrics', icon: BookOpen },
      { to: '/admin/work-product', label: 'Work Product', icon: FileText },
      { to: '/admin/role-year-mappings', label: 'Role/Year', icon: CalendarDays },
    ],
  },
  {
    label: 'Scheduling',
    items: [
      { to: '/admin/scheduling-settings', label: 'Scheduling', icon: CalendarClock },
      { to: '/admin/signup-fields', label: 'Sign-up Fields', icon: ListChecks },
    ],
  },
  {
    label: 'Communications & Appearance',
    items: [
      { to: '/admin/email-templates', label: 'Email Templates', icon: Mail },
      { to: '/admin/branding', label: 'Branding', icon: Palette },
      { to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/admin/settings', label: 'Settings', icon: SlidersHorizontal },
      { to: '/admin/audit-log', label: 'Audit Log', icon: History },
      { to: '/admin/transcription-jobs', label: 'Transcription Jobs', icon: AudioLines },
    ],
  },
] as const;

/** Flat, ordered list of every admin nav item (derived from the sections). */
export const ADMIN_NAV: readonly AdminNavItem[] = ADMIN_NAV_SECTIONS.flatMap((s) => s.items);
