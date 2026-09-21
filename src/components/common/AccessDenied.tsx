import React from "react";
import { ShieldOff } from "lucide-react";

export const AccessDenied: React.FC<{ requiredPermission?: string }> = ({ requiredPermission }) => (
  <div className="flex flex-col items-center justify-center gap-3 py-24 text-center px-4">
    <ShieldOff className="w-10 h-10 text-rose-500" />
    <h2 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
      Access denied
    </h2>
    <p className="text-sm max-w-sm" style={{ color: "var(--text-muted)" }}>
      {requiredPermission
        ? `Your account does not have the "${requiredPermission}" permission required to view this page.`
        : "Your account does not have permission to view this page."}
    </p>
  </div>
);
