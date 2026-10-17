import { type KeyboardEvent, type ReactNode, useRef } from "react";
import { tabStep } from "./nav";
import "./ui.css";

export interface TabInfo<T extends string> {
  id: T;
  label: ReactNode;
  /** Spoken when the label is only an icon */
  name?: string;
}

interface TabsProps<T extends string> {
  tabs: readonly TabInfo<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}

/**
 * Tabs (plan F7) in the landing page's segmented pill: arrows move between them (and choose, as tabs
 * do), Home and End jump to the ends; a sheet's gamepad shoulders call `tabStep` too
 */
export function Tabs<T extends string>({ tabs, value, onChange, label }: TabsProps<T>) {
  const list = useRef<HTMLDivElement>(null);
  const go = (id: T) => {
    onChange(id);
    list.current?.querySelector<HTMLElement>(`[data-tab="${id}"]`)?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step) go(tabStep(tabs, value, step));
    else if (event.key === "Home") go(tabs[0].id);
    else if (event.key === "End") go(tabs[tabs.length - 1].id);
    else return;
    event.preventDefault();
  };
  return (
    <div ref={list} className="segmented ui-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          data-tab={tab.id}
          aria-selected={tab.id === value}
          aria-label={tab.name}
          tabIndex={tab.id === value ? 0 : -1}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
