import { useEffect, useState } from "react";

/** An open/closed toggle that starts open where the media query matches, and follows it when the screen changes */
export function useMediaToggle(query: string): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => matchMedia(query).matches);

  useEffect(() => {
    const list = matchMedia(query);
    const onChange = () => setOpen(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return [open, setOpen];
}
