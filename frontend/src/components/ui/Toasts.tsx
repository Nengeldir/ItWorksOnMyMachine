import { useSyncExternalStore } from "react";
import { STRINGS } from "./strings";
import { toasts } from "./toastQueue";
import "./ui.css";

/**
 * Shows the page's toast queue (`toasts.push`, plan F7): soft glass pills over the bottom centre, above
 * the hotbar zone, at most three; a repeat counts up. Taps dismiss; nothing else takes the pointer
 */
export function ToastHost() {
  const shown = useSyncExternalStore(toasts.subscribe, toasts.get);
  if (!shown.length) return null;
  return (
    <div className="ui-toasts" role="status" aria-live="polite">
      {shown.map((toast) => (
        <button key={toast.id} className={`ui-toast glass tone-${toast.tone}`} onClick={() => toasts.dismiss(toast.id)} aria-label={`${toast.text}. ${STRINGS.dismiss}`}>
          <span className="ui-toast-dot" aria-hidden="true" />
          {toast.text}
          {toast.count > 1 && <b>×{toast.count}</b>}
        </button>
      ))}
    </div>
  );
}
