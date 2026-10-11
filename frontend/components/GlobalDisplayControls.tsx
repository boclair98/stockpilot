"use client";
import { usePathname } from "next/navigation";
import WorkspaceControls from "./WorkspaceControls";
export default function GlobalDisplayControls() {
  const path = usePathname();
  return path === "/" ? null : (
    <div className="global-display-controls">
      <WorkspaceControls />
    </div>
  );
}
