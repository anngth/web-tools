import { useEffect, useState } from "react";

export type SidebarBand = "drawer" | "rail" | "expanded";

export function sidebarBand(viewportWidth: number): SidebarBand {
  if (viewportWidth < 640) return "drawer";
  if (viewportWidth < 960) return "rail";
  return "expanded";
}

export function useSidebarBand(): SidebarBand {
  const [width, setWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    function syncWidth() {
      setWidth(window.innerWidth);
    }

    window.addEventListener("resize", syncWidth);
    return () => window.removeEventListener("resize", syncWidth);
  }, []);

  return sidebarBand(width);
}
