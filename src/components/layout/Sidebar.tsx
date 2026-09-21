import React, { useState } from "react";
import { X, ShieldCheck, ChevronDown } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useRouter } from "../../lib/router";
import { visibleNavItems } from "../../lib/permissions";

type Section = "Platform" | "AI Control Center" | "CRM" | "Onboarding" | "Workspaces" | "Products" | "CMS" | "Commercial" | "Client Portal";

const SECTIONS: Section[] = ["Platform", "AI Control Center", "CRM", "Onboarding", "Workspaces", "Products", "CMS", "Commercial", "Client Portal"];

/** Presentation state only, like the theme preference — safe to persist client-side. */
const COLLAPSED_STORAGE_KEY = "artify_cc_sidebar_collapsed";

function loadCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export const Sidebar: React.FC<{ mobileOpen: boolean; onCloseMobile: () => void }> = ({ mobileOpen, onCloseMobile }) => {
  const { user } = useAuth();
  const { path, navigate } = useRouter();
  const items = visibleNavItems(user?.role.permissions);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed);

  const toggleSection = (section: Section) => {
    setCollapsed((prev) => {
      const next = { ...prev, [section]: !prev[section] };
      try {
        localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Best-effort persistence — a private-mode browser just won't remember it.
      }
      return next;
    });
  };

  const content = (
    <>
      <div className="flex items-center gap-2 px-4 h-14 shrink-0 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "var(--accent)" }}>
          <ShieldCheck className="w-4 h-4 text-white" />
        </div>
        <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
          Control Center
        </span>
        <button onClick={onCloseMobile} className="ml-auto md:hidden" aria-label="Close menu" style={{ color: "var(--text-muted)" }}>
          <X className="w-4 h-4" />
        </button>
      </div>
      <nav className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1" aria-label="Primary">
        {SECTIONS.map((section) => {
          const sectionItems = items.filter((item) => item.section === section);
          if (sectionItems.length === 0) return null;

          const hasActiveItem = sectionItems.some((item) => path === item.path);
          const isCollapsed = Boolean(collapsed[section]) && !hasActiveItem;

          return (
            <div key={section} className="space-y-0.5">
              <button
                type="button"
                onClick={() => toggleSection(section)}
                aria-expanded={!isCollapsed}
                className="w-full flex items-center justify-between gap-2 px-3 pt-1 pb-1 text-[10px] font-bold uppercase tracking-wide"
                style={{ color: "var(--text-muted)" }}
              >
                <span>{section}</span>
                <ChevronDown
                  className="w-3 h-3 shrink-0 transition-transform duration-150"
                  style={{ transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
                />
              </button>
              {!isCollapsed &&
                sectionItems.map((item) => {
                  const active = path === item.path;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        navigate(item.path);
                        onCloseMobile();
                      }}
                      aria-current={active ? "page" : undefined}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition text-left"
                      style={
                        active
                          ? { background: "var(--accent-soft)", color: "var(--accent)" }
                          : { color: "var(--text-secondary)" }
                      }
                    >
                      <Icon className="w-4 h-4" />
                      {item.label}
                    </button>
                  );
                })}
            </div>
          );
        })}
      </nav>
    </>
  );

  return (
    <>
      <aside
        className="hidden md:flex md:flex-col w-56 shrink-0 border-r h-screen sticky top-0 overflow-hidden"
        style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
      >
        {content}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0" style={{ background: "rgba(2,6,23,0.6)" }} onClick={onCloseMobile} />
          <aside
            className="absolute left-0 top-0 h-full w-64 flex flex-col shadow-2xl overflow-hidden"
            style={{ background: "var(--bg-surface)" }}
          >
            {content}
          </aside>
        </div>
      )}
    </>
  );
};
