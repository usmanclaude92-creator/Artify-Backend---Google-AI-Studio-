/**
 * Frontend permission helper + extensible navigation config (Phase 4 §7/§27).
 *
 * IMPORTANT: this is UX only. Hiding a nav item or button never substitutes
 * for backend authorization — every action below still calls a route
 * protected by `requirePermission`/`requireRole` server-side (§28). This
 * module exists so the UI doesn't show entry points a user's own token
 * would be rejected for, not to be the source of truth for what's allowed.
 */
import type { ComponentType } from "react";
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  KeyRound,
  Building2,
  ScrollText,
  MonitorSmartphone,
  Settings,
  TrendingUp,
  Contact2,
  Briefcase,
  ClipboardCheck,
  Hourglass,
  Layers,
  UsersRound,
  Package,
  Boxes,
  FileText,
  Newspaper,
  FolderTree,
  UserSquare2,
  Image as ImageIcon,
  FileSignature,
  Repeat,
  Receipt,
  Wallet,
  UserCircle,
} from "lucide-react";
import { DashboardPage } from "../components/modules/DashboardPage";
import { UsersPage } from "../components/modules/UsersPage";
import { RolesPage } from "../components/modules/RolesPage";
import { PermissionsPage } from "../components/modules/PermissionsPage";
import { OrganizationsPage } from "../components/modules/OrganizationsPage";
import { AuditLogPage } from "../components/modules/AuditLogPage";
import { SecurityPage } from "../components/modules/SecurityPage";
import { SettingsPage } from "../components/modules/SettingsPage";
import { CrmDashboardPage } from "../components/modules/CrmDashboardPage";
import { LeadsPage } from "../components/modules/LeadsPage";
import { ClientsPage } from "../components/modules/ClientsPage";
import { ContactsPage } from "../components/modules/ContactsPage";
import { OnboardingPage } from "../components/modules/OnboardingPage";
import { WorkspacesPage } from "../components/modules/WorkspacesPage";
import { ProductsPage } from "../components/modules/ProductsPage";
import { PagesPage } from "../components/modules/PagesPage";
import { PostsPage } from "../components/modules/PostsPage";
import { CmsTaxonomyPage } from "../components/modules/CmsTaxonomyPage";
import { AuthorsPage } from "../components/modules/AuthorsPage";
import { MediaLibraryPage } from "../components/modules/MediaLibraryPage";
import { ContractsPage } from "../components/modules/ContractsPage";
import { SubscriptionsPage } from "../components/modules/SubscriptionsPage";
import { InvoicesPage } from "../components/modules/InvoicesPage";
import { PaymentsPage } from "../components/modules/PaymentsPage";
import { ClientPortalPage } from "../components/modules/ClientPortalPage";
import { AiControlCenterPage } from "../components/modules/AiControlCenterPage";
import { AiCopilotPage } from "../components/modules/AiCopilotPage";
import { Sparkles, Bot } from "lucide-react";

export function hasPermission(permissions: readonly string[] | undefined, key: string): boolean {
  return !!permissions?.includes(key);
}

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: ComponentType<{ className?: string }>;
  /** Any one of these permissions is enough to show the item; empty means always visible to an authenticated user. */
  requiresAnyPermission?: string[];
  component: ComponentType;
  /** Groups items under a heading in the sidebar (§22/§31) — purely presentational. */
  section: "Platform" | "AI Control Center" | "CRM" | "Onboarding" | "Workspaces" | "Products" | "CMS" | "Commercial" | "Client Portal";
}

/**
 * Extensible by design (§6): future product modules (Products, CMS, Media,
 * Subscriptions, Billing, Reports, AI) register here the same way — a nav
 * entry + a permission gate + a lazily-mounted page. Phase 5 adds the CRM
 * section (docs/CRM_ARCHITECTURE.md); none of the still-future modules are
 * built yet.
 */
export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", path: "/dashboard", icon: LayoutDashboard, component: DashboardPage, section: "Platform" },
  {
    id: "ai-control-center",
    label: "AI Control Center",
    path: "/ai",
    icon: Sparkles,
    requiresAnyPermission: ["ai.read"],
    component: AiControlCenterPage,
    section: "AI Control Center",
  },
  {
    id: "ai-copilot",
    label: "AI Copilot",
    path: "/copilot",
    icon: Bot,
    requiresAnyPermission: ["copilot.read", "copilot.use"],
    component: AiCopilotPage,
    section: "AI Control Center",
  },
  {
    id: "users",
    label: "Users",
    path: "/users",
    icon: Users,
    requiresAnyPermission: ["users.read"],
    component: UsersPage,
    section: "Platform",
  },
  {
    id: "roles",
    label: "Roles",
    path: "/roles",
    icon: ShieldCheck,
    requiresAnyPermission: ["roles.read"],
    component: RolesPage,
    section: "Platform",
  },
  {
    id: "permissions",
    label: "Permissions",
    path: "/permissions",
    icon: KeyRound,
    requiresAnyPermission: ["roles.read"],
    component: PermissionsPage,
    section: "Platform",
  },
  {
    id: "organizations",
    label: "Organizations",
    path: "/organizations",
    icon: Building2,
    requiresAnyPermission: ["organizations.read"],
    component: OrganizationsPage,
    section: "Platform",
  },
  {
    id: "audit-log",
    label: "Audit Log",
    path: "/audit-log",
    icon: ScrollText,
    requiresAnyPermission: ["audit.read"],
    component: AuditLogPage,
    section: "Platform",
  },
  { id: "security", label: "Security", path: "/security", icon: MonitorSmartphone, component: SecurityPage, section: "Platform" },
  {
    id: "settings",
    label: "Settings",
    path: "/settings",
    icon: Settings,
    requiresAnyPermission: ["settings.read"],
    component: SettingsPage,
    section: "Platform",
  },
  {
    id: "crm-dashboard",
    label: "CRM Dashboard",
    path: "/crm",
    icon: TrendingUp,
    component: CrmDashboardPage,
    section: "CRM",
  },
  {
    id: "crm-leads",
    label: "Leads",
    path: "/crm/leads",
    icon: Briefcase,
    requiresAnyPermission: ["leads.read"],
    component: LeadsPage,
    section: "CRM",
  },
  {
    id: "crm-clients",
    label: "Clients",
    path: "/crm/clients",
    icon: Building2,
    requiresAnyPermission: ["clients.read"],
    component: ClientsPage,
    section: "CRM",
  },
  {
    id: "crm-contacts",
    label: "Contacts",
    path: "/crm/contacts",
    icon: Contact2,
    requiresAnyPermission: ["contacts.read"],
    component: ContactsPage,
    section: "CRM",
  },
  {
    id: "onboarding-overview",
    label: "Overview",
    path: "/onboarding",
    icon: ClipboardCheck,
    requiresAnyPermission: ["onboarding.read"],
    component: OnboardingPage,
    section: "Onboarding",
  },
  {
    id: "onboarding-pending",
    label: "Pending Onboarding",
    path: "/onboarding/pending",
    icon: Hourglass,
    requiresAnyPermission: ["onboarding.read"],
    component: OnboardingPage,
    section: "Onboarding",
  },
  {
    id: "workspaces-all",
    label: "All Workspaces",
    path: "/workspaces",
    icon: Layers,
    requiresAnyPermission: ["workspaces.read"],
    component: WorkspacesPage,
    section: "Workspaces",
  },
  {
    id: "workspaces-members",
    label: "Members",
    path: "/workspaces/members",
    icon: UsersRound,
    requiresAnyPermission: ["workspaces.read"],
    component: WorkspacesPage,
    section: "Workspaces",
  },
  {
    id: "products-all",
    label: "All Products",
    path: "/products",
    icon: Package,
    requiresAnyPermission: ["products.read"],
    component: ProductsPage,
    section: "Products",
  },
  {
    id: "products-modules",
    label: "Product Modules",
    path: "/products/modules",
    icon: Boxes,
    requiresAnyPermission: ["product_modules.read"],
    component: ProductsPage,
    section: "Products",
  },
  {
    id: "cms-pages",
    label: "Pages",
    path: "/cms/pages",
    icon: FileText,
    requiresAnyPermission: ["content.read"],
    component: PagesPage,
    section: "CMS",
  },
  {
    id: "cms-posts",
    label: "Blog Posts",
    path: "/cms/posts",
    icon: Newspaper,
    requiresAnyPermission: ["content.read"],
    component: PostsPage,
    section: "CMS",
  },
  {
    id: "cms-taxonomy",
    label: "Categories & Tags",
    path: "/cms/taxonomy",
    icon: FolderTree,
    requiresAnyPermission: ["content.read"],
    component: CmsTaxonomyPage,
    section: "CMS",
  },
  {
    id: "cms-authors",
    label: "Authors",
    path: "/cms/authors",
    icon: UserSquare2,
    requiresAnyPermission: ["authors.read"],
    component: AuthorsPage,
    section: "CMS",
  },
  {
    id: "cms-media",
    label: "Media Library",
    path: "/cms/media",
    icon: ImageIcon,
    requiresAnyPermission: ["media.read"],
    component: MediaLibraryPage,
    section: "CMS",
  },
  {
    id: "commercial-contracts",
    label: "Contracts",
    path: "/commercial/contracts",
    icon: FileSignature,
    requiresAnyPermission: ["contracts.read"],
    component: ContractsPage,
    section: "Commercial",
  },
  {
    id: "commercial-subscriptions",
    label: "Subscriptions",
    path: "/commercial/subscriptions",
    icon: Repeat,
    requiresAnyPermission: ["subscriptions.read"],
    component: SubscriptionsPage,
    section: "Commercial",
  },
  {
    id: "commercial-invoices",
    label: "Invoices",
    path: "/commercial/invoices",
    icon: Receipt,
    requiresAnyPermission: ["invoices.read"],
    component: InvoicesPage,
    section: "Commercial",
  },
  {
    id: "commercial-payments",
    label: "Payments",
    path: "/commercial/payments",
    icon: Wallet,
    requiresAnyPermission: ["payments.read"],
    component: PaymentsPage,
    section: "Commercial",
  },
  {
    id: "client-portal",
    label: "Your Account",
    path: "/portal",
    icon: UserCircle,
    requiresAnyPermission: ["portal.dashboard.read"],
    component: ClientPortalPage,
    section: "Client Portal",
  },
];

export function visibleNavItems(permissions: readonly string[] | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.requiresAnyPermission || item.requiresAnyPermission.some((p) => hasPermission(permissions, p)));
}
