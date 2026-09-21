import React, { useState } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { AccessDenied } from "../common/AccessDenied";
import { useAuth } from "../../context/AuthContext";
import { useRouter } from "../../lib/router";
import { NAV_ITEMS, hasPermission, visibleNavItems } from "../../lib/permissions";

export const AppShell: React.FC = () => {
  const { user } = useAuth();
  const { path, navigate } = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const item = NAV_ITEMS.find((i) => i.path === path);

  React.useEffect(() => {
    if (!item && path !== "/" ) return; // unknown path handled below without redirect loop
    if (path === "/") navigate("/dashboard");
  }, [path, item, navigate]);

  let content: React.ReactNode;
  if (!item) {
    content =
      path === "/" ? null : (
        <div className="p-6 text-sm" style={{ color: "var(--text-muted)" }}>
          Page not found.
        </div>
      );
  } else if (item.requiresAnyPermission && !item.requiresAnyPermission.some((p) => hasPermission(user?.role.permissions, p))) {
    content = <AccessDenied requiredPermission={item.requiresAnyPermission[0]} />;
  } else {
    const Page = item.component;
    content = <Page />;
  }

  // A user with zero visible modules (shouldn't happen given every system
  // role gets at least users.read/audit.read via the seed, but handled
  // honestly rather than rendering a blank shell) still sees Dashboard,
  // which requires no permission.
  void visibleNavItems(user?.role.permissions);

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg-app)" }}>
      <Sidebar mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header onOpenMobileMenu={() => setMobileOpen(true)} />
        <main className="flex-1 p-4 sm:p-6 max-w-[1400px] w-full mx-auto">{content}</main>
      </div>
    </div>
  );
};
