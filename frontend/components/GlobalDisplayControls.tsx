"use client";
import { usePathname } from "next/navigation";
import WorkspaceControls from "./WorkspaceControls";
export default function GlobalDisplayControls() {
  const path = usePathname();
  return ["/", "/guide", "/compare", "/notifications", "/account-tools", "/support", "/operations/personal"].includes(path) ? null : (
    <div className="global-display-controls">
      <WorkspaceControls />
    </div>
  );
}
