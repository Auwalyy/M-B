import { type AuthUserDto, PERMISSIONS, type Permission } from '@mb/shared';
import {
  ArrowLeftRight, Boxes, Building2, ClipboardCheck, FolderTree, History, LayoutDashboard, type LucideIcon, MessageSquare,
  Bike, CalendarClock, CreditCard, Package, Percent, Receipt, ScrollText, Settings, ShieldCheck, SlidersHorizontal, Tag, Truck, UserRound, Users,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Shown when the user holds any of these. Omit to show to every staff member. */
  anyOf?: Permission[];
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

const P = PERMISSIONS;

/** Admin navigation. Only modules that are built appear here. */
export const ADMIN_NAV: NavSection[] = [
  { items: [{ label: 'Dashboard', href: '/admin', icon: LayoutDashboard }] },
  {
    title: 'Sales',
    items: [
      { label: 'Orders', href: '/admin/orders', icon: Receipt, anyOf: [P.ORDERS_READ] },
      { label: 'Reservations', href: '/admin/reservations', icon: CalendarClock, anyOf: [P.RESERVATIONS_READ] },
      { label: 'Payments', href: '/admin/payments', icon: CreditCard, anyOf: [P.PAYMENTS_READ] },
      { label: 'Deliveries', href: '/admin/deliveries', icon: Bike, anyOf: [P.DELIVERY_READ] },
      { label: 'Promotions', href: '/admin/promotions', icon: Percent, anyOf: [P.PROMOTIONS_MANAGE] },
      { label: 'Delivery areas', href: '/admin/delivery-zones', icon: Truck, anyOf: [P.DELIVERY_ZONES_MANAGE] },
    ],
  },
  {
    title: 'Catalogue',
    items: [
      { label: 'Products', href: '/admin/catalog/products', icon: Package, anyOf: [P.PRODUCTS_READ] },
      { label: 'Categories', href: '/admin/catalog/categories', icon: FolderTree, anyOf: [P.CATEGORIES_WRITE] },
      { label: 'Brands', href: '/admin/catalog/brands', icon: Tag, anyOf: [P.BRANDS_WRITE] },
    ],
  },
  {
    title: 'Inventory',
    items: [
      { label: 'Stock levels', href: '/admin/inventory', icon: Boxes, anyOf: [P.INVENTORY_READ] },
      { label: 'Transfers', href: '/admin/inventory/transfers', icon: ArrowLeftRight, anyOf: [P.INVENTORY_READ] },
      { label: 'Adjustments', href: '/admin/inventory/adjustments', icon: ClipboardCheck, anyOf: [P.INVENTORY_READ] },
      { label: 'Stock history', href: '/admin/inventory/movements', icon: ScrollText, anyOf: [P.INVENTORY_READ] },
    ],
  },
  {
    title: 'Customers',
    items: [
      { label: 'Customers', href: '/admin/customers', icon: UserRound, anyOf: [P.CUSTOMERS_READ] },
      { label: 'Enquiries', href: '/admin/enquiries', icon: MessageSquare, anyOf: [P.ENQUIRIES_READ] },
      { label: 'Segments', href: '/admin/customers/segments', icon: SlidersHorizontal, anyOf: [P.CUSTOMERS_SEGMENTS] },
    ],
  },
  {
    title: 'Organisation',
    items: [
      { label: 'Branches', href: '/admin/branches', icon: Building2, anyOf: [P.BRANCHES_READ] },
      { label: 'Staff', href: '/admin/staff', icon: Users, anyOf: [P.USERS_READ] },
      { label: 'Roles & permissions', href: '/admin/roles', icon: ShieldCheck, anyOf: [P.ROLES_READ] },
    ],
  },
  {
    title: 'Administration',
    items: [
      { label: 'Activity log', href: '/admin/audit', icon: History, anyOf: [P.AUDIT_READ, P.AUDIT_READ_LOGINS] },
      { label: 'Company settings', href: '/admin/settings', icon: Settings, anyOf: [P.SETTINGS_READ] },
    ],
  },
];

export function visibleNav(user: Pick<AuthUserDto, 'permissions'> | null, nav: NavSection[] = ADMIN_NAV): NavSection[] {
  const perms = new Set(user?.permissions ?? []);
  return nav
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.anyOf || i.anyOf.some((p) => perms.has(p))) }))
    .filter((s) => s.items.length > 0);
}

/** Longest matching nav href for the current path (so /admin does not stay active on sub-pages). */
export function activeHref(pathname: string, nav: NavSection[]): string | null {
  const hrefs = nav.flatMap((s) => s.items.map((i) => i.href));
  return hrefs.filter((h) => pathname === h || pathname.startsWith(`${h}/`)).sort((a, b) => b.length - a.length)[0] ?? null;
}
