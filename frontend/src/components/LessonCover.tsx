import { useEffect, useRef } from "react";
import { IconArrowBackUp, IconArrowForwardUp, IconArrowLeft, IconBold, IconCloudCheck, IconFolder, IconItalic, IconLink,
  IconList, IconMessage, IconPaint, IconPhoto, IconPrinter, IconStar, IconTextColor, IconUnderline } from "@tabler/icons-react";
import { holdGame } from "../game/hold";
import "./LessonCover.css";

// Lesson mode: the lesson key (Settings, off by default) covers everything
// with an empty document editor, and the game holds still underneath. The
// page is a real (local, unsaved) editable page, so a glance over the
// shoulder sees a blank document; the back arrow, Escape or the key again
// returns to the game. A generic look: no real product's name or logo.

const MENUS = ["File", "Edit", "View", "Insert", "Format", "Tools", "Extensions", "Help"];

export default function LessonCover({ onBack }: { onBack: () => void }) {
  const page = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const release = holdGame();
    const title = document.title;
    document.title = "Untitled document";
    page.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onBack();
    };
    window.addEventListener("keydown", escape, true);
    return () => {
      release();
      document.title = title;
      window.removeEventListener("keydown", escape, true);
    };
  }, [onBack]);
  return (
    <div className="lesson-cover" role="dialog" aria-label="Untitled document">
      <header className="docs-top">
        <button className="lesson-back" onClick={onBack} aria-label="Back to the game" title="Back to the game"><IconArrowLeft size={20} /></button>
        <svg className="docs-icon" viewBox="0 0 24 32" aria-hidden="true"><path d="M2 0h14l8 8v22a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2z" fill="#4b7ee0" /><path d="M16 0l8 8h-6a2 2 0 0 1-2-2z" fill="#a9c4f2" /><path d="M5 14h14v2H5zm0 4h14v2H5zm0 4h10v2H5z" fill="#fff" /></svg>
        <div className="docs-titles">
          <div className="docs-title-row"><span className="docs-title" contentEditable suppressContentEditableWarning spellCheck={false}>Untitled document</span>
            <IconStar size={16} /><IconFolder size={16} /><IconCloudCheck size={16} /></div>
          <nav className="docs-menus">{MENUS.map((menu) => <span key={menu}>{menu}</span>)}</nav>
        </div>
        <div className="docs-end">
          <IconMessage size={20} />
          <span className="docs-share">Share</span>
          <span className="docs-avatar" aria-hidden="true">S</span>
        </div>
      </header>
      <div className="docs-toolbar" aria-hidden="true">
        <IconArrowBackUp size={18} /><IconArrowForwardUp size={18} /><IconPrinter size={18} /><IconPaint size={18} />
        <span className="sep" /><span className="pill">100%</span><span className="sep" /><span className="pill wide">Normal text</span>
        <span className="sep" /><span className="pill wide">Arial</span><span className="sep" /><span className="pill">− 11 +</span><span className="sep" />
        <IconBold size={18} /><IconItalic size={18} /><IconUnderline size={18} /><IconTextColor size={18} />
        <span className="sep" /><IconLink size={18} /><IconPhoto size={18} /><IconList size={18} />
      </div>
      <div className="docs-ruler" aria-hidden="true" />
      <main className="docs-canvas">
        <div className="docs-page" ref={page} contentEditable suppressContentEditableWarning spellCheck aria-label="Document" />
      </main>
    </div>
  );
}
