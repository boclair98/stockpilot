"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { BookmarkPlus, Check, X } from "lucide-react";
import { addDirectoryPreset, directoryPresetLabel, DIRECTORY_PRESETS_KEY, encodeDirectoryPresets, MAX_DIRECTORY_PRESETS, PRESETS_UNAVAILABLE, presetKey, readDirectoryPresets } from "@/lib/directory-presets";
import type { DirectoryCriteria } from "@/lib/stock-directory";

const CHANGE = "stockpilot:directory-presets-change";
function read() {
  try { return window.localStorage.getItem(DIRECTORY_PRESETS_KEY) || ""; }
  catch { return PRESETS_UNAVAILABLE; }
}
function subscribe(callback: () => void) {
  const onStorage = (event: StorageEvent) => { if (!event.key || event.key === DIRECTORY_PRESETS_KEY) callback(); };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE, callback);
  return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(CHANGE, callback); };
}
const serverRead = () => "";

export default function DirectoryPresets({criteria, onApply}: {criteria: DirectoryCriteria; onApply: (value: DirectoryCriteria) => void}) {
  const raw = useSyncExternalStore(subscribe, read, serverRead);
  const items = readDirectoryPresets(raw);
  const [notice, setNotice] = useState("");
  const [removed, setRemoved] = useState<DirectoryCriteria | null>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const saved = items.some(item => presetKey(item) === presetKey(criteria));
  function persist(next: DirectoryCriteria[]) {
    try {
      window.localStorage.setItem(DIRECTORY_PRESETS_KEY, encodeDirectoryPresets(next));
      window.dispatchEvent(new Event(CHANGE));
      return true;
    } catch { setNotice("이 브라우저에 조건을 저장하지 못했어요. 검색은 계속 사용할 수 있어요."); return false; }
  }
  function save(value: DirectoryCriteria, restoring = false) {
    if (read() === PRESETS_UNAVAILABLE) { setNotice("이 브라우저에서 저장 공간을 사용할 수 없어요. 검색은 계속 사용할 수 있어요."); return; }
    const next = addDirectoryPreset(readDirectoryPresets(read()), value);
    if (next.status === "full") { setNotice(`조건은 ${MAX_DIRECTORY_PRESETS}개까지 저장할 수 있어요. 필요 없는 조건을 먼저 지워 주세요.`); return; }
    if (next.status === "duplicate") { setNotice("이미 저장된 조건이에요."); if (restoring) { saveButton.current?.focus(); setRemoved(null); } return; }
    if (persist(next.items)) { setNotice(restoring ? "삭제한 조건을 복원했어요." : "현재 검색 조건을 이 브라우저에 저장했어요."); if (restoring) saveButton.current?.focus(); setRemoved(null); }
  }
  function remove(value: DirectoryCriteria) {
    const next = readDirectoryPresets(read()).filter(item => presetKey(item) !== presetKey(value));
    if (persist(next)) { setRemoved(value); setNotice("저장 조건을 삭제했어요."); saveButton.current?.focus(); }
  }
  return <section className="directory-presets" aria-label="저장한 검색 조건">
    <div className="directory-presets-heading"><span>자주 찾는 조건 <small>이 브라우저에만 저장 · {items.length}/{MAX_DIRECTORY_PRESETS}</small></span><button type="button" ref={saveButton} onClick={() => save(criteria)} aria-label="현재 검색 조건 저장">{saved ? <Check size={16} aria-hidden="true"/> : <BookmarkPlus size={16} aria-hidden="true"/>}{saved ? "저장됨" : "조건 저장"}</button></div>
    {items.length ? <ul>{items.map(item => {
      const label = directoryPresetLabel(item);
      return <li key={presetKey(item)}><button className="directory-preset-apply" type="button" aria-pressed={presetKey(item) === presetKey(criteria)} onClick={() => { onApply(item); setNotice("저장한 조건의 첫 페이지를 열었어요."); }} aria-label={`${label} 조건 열기`}>{label}</button><button className="directory-preset-remove" type="button" aria-label={`${label} 저장 삭제`} onClick={() => remove(item)}><X size={16} aria-hidden="true"/></button></li>;
    })}</ul> : null}
    <div className="directory-preset-feedback"><p role="status">{notice || (raw === PRESETS_UNAVAILABLE ? "브라우저 저장 공간을 사용할 수 없어요. 검색 기능에는 영향이 없어요." : "")}</p>{removed ? <button type="button" onClick={() => save(removed, true)}>삭제 취소</button> : null}</div>
  </section>;
}
