import React, { useState } from "react";
import { Menu, Sun, Moon, ChevronDown, LogOut, LogOutIcon, KeyRound, Building2, Check } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { useToast } from "../../context/ToastContext";
import { useRouter } from "../../lib/router";
import { ChangePasswordModal } from "../modules/ChangePasswordModal";

export const Header: React.FC<{ onOpenMobileMenu: () => void }> = ({ onOpenMobileMenu }) => {
  const { user, organizations, logout, logoutAll, switchOrganization } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { notify } = useToast();
  const { navigate } = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  const currentOrg = organizations.find((o) => o.isCurrent);

  const handleSwitchOrg = async (organizationId: string) => {
    setOrgMenuOpen(false);
    try {
      await switchOrganization(organizationId);
      notify("Switched organization.", "success");
    } catch {
      notify("Could not switch organization.", "error");
    }
  };

  return (
    <header
      className="h-14 flex items-center gap-3 px-4 border-b sticky top-0 z-30"
      style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
    >
      <button onClick={onOpenMobileMenu} className="md:hidden" aria-label="Open menu" style={{ color: "var(--text-secondary)" }}>
        <Menu className="w-5 h-5" />
      </button>

      <div className="relative">
        <button
          onClick={() => setOrgMenuOpen((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg"
          style={{ color: "var(--text-secondary)", background: "var(--bg-hover)" }}
        >
          <Building2 className="w-3.5 h-3.5" />
          {currentOrg?.organizationName ?? "Organization"}
          {organizations.length > 1 && <ChevronDown className="w-3 h-3" />}
        </button>
        {orgMenuOpen && organizations.length > 1 && (
          <div
            className="absolute left-0 mt-1 w-64 rounded-xl shadow-lg py-1 z-40"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
          >
            {organizations.map((org) => (
              <button
                key={org.organizationId}
                onClick={() => handleSwitchOrg(org.organizationId)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs text-left hover:opacity-80"
                style={{ color: "var(--text-primary)" }}
              >
                <span>
                  {org.organizationName}
                  <span className="block text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {org.roleName}
                  </span>
                </span>
                {org.isCurrent && <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="p-2 rounded-lg"
          style={{ color: "var(--text-secondary)" }}
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        <div className="relative">
          <button onClick={() => setMenuOpen((v) => !v)} className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg" style={{ background: "var(--bg-hover)" }}>
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
              style={{ background: "var(--accent)" }}
            >
              {user?.firstName?.charAt(0) ?? "U"}
            </div>
            <span className="text-xs font-semibold hidden sm:block" style={{ color: "var(--text-primary)" }}>
              {user?.displayName ?? `${user?.firstName} ${user?.lastName}`}
            </span>
            <ChevronDown className="w-3 h-3" style={{ color: "var(--text-muted)" }} />
          </button>

          {menuOpen && (
            <div
              className="absolute right-0 mt-1 w-56 rounded-xl shadow-lg py-1 z-40 text-xs"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
            >
              <div className="px-3 py-2 border-b" style={{ borderColor: "var(--border)" }}>
                <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
                  {user?.email}
                </p>
                <p style={{ color: "var(--text-muted)" }}>{user?.role.name}</p>
              </div>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setChangePasswordOpen(true);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:opacity-80"
                style={{ color: "var(--text-primary)" }}
              >
                <KeyRound className="w-3.5 h-3.5" /> Change password
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  navigate("/security");
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:opacity-80"
                style={{ color: "var(--text-primary)" }}
              >
                <Building2 className="w-3.5 h-3.5" /> Sessions &amp; security
              </button>
              <button
                onClick={() => void logout()}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:opacity-80"
                style={{ color: "var(--text-primary)" }}
              >
                <LogOut className="w-3.5 h-3.5" /> Sign out
              </button>
              <button
                onClick={() => void logoutAll()}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:opacity-80 text-rose-500"
              >
                <LogOutIcon className="w-3.5 h-3.5" /> Sign out everywhere
              </button>
            </div>
          )}
        </div>
      </div>

      <ChangePasswordModal open={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />
    </header>
  );
};
