"use client";
import { useEffect, useSyncExternalStore } from "react";
import { Moon, Sun, Rows3, PanelTop, Eye, EyeOff } from "lucide-react";
const defaultSnapshot = '{"dark":false,"compact":false,"privateMode":false}';
function read() {
  try {
    return localStorage.getItem("stockpilot:display:v1") || defaultSnapshot;
  } catch {
    return defaultSnapshot;
  }
}
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("stockpilot:display", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("stockpilot:display", callback);
  };
}
export default function WorkspaceControls() {
  const snapshot = useSyncExternalStore(subscribe, read, () => defaultSnapshot);
  let prefs;
  try {
    prefs = JSON.parse(snapshot);
  } catch {
    prefs = JSON.parse(defaultSnapshot);
  }
  const dark = prefs.dark === true,
    compact = prefs.compact === true,
    privateMode = prefs.privateMode === true;
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.dataset.density = compact
      ? "compact"
      : "comfortable";
    document.documentElement.dataset.private = privateMode ? "true" : "false";
  }, [dark, compact, privateMode]);
  function save(next: {
    dark: boolean;
    compact: boolean;
    privateMode: boolean;
  }) {
    try {
      localStorage.setItem("stockpilot:display:v1", JSON.stringify(next));
      window.dispatchEvent(new Event("stockpilot:display"));
    } catch {
      /* Preference storage may be unavailable; account data remains untouched. */
    }
  }
  return (
    <div className="workspace-controls" aria-label="화면 설정">
      <button
        type="button"
        title="금액 가리기"
        aria-label="금액 가리기"
        aria-pressed={privateMode}
        onClick={() => save({ dark, compact, privateMode: !privateMode })}
      >
        {privateMode ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
      <button
        type="button"
        title="촘촘한 목록"
        aria-label="촘촘한 목록"
        aria-pressed={compact}
        onClick={() => save({ dark, compact: !compact, privateMode })}
      >
        {compact ? <Rows3 size={18} /> : <PanelTop size={18} />}
      </button>
      <button
        type="button"
        title="다크 모드"
        aria-label="다크 모드"
        aria-pressed={dark}
        onClick={() => save({ dark: !dark, compact, privateMode })}
      >
        {dark ? <Sun size={18} /> : <Moon size={18} />}
      </button>
    </div>
  );
}
