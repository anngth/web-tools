import { useEffect, useState } from "react";
import { AppShell } from "./layout/AppShell";
import { useSidebarBand } from "./layout/useSidebarBand";
import {
  canonicalPathname,
  pathnameForTool,
  toolIdFromPathname,
} from "./toolRoute";
import { type ToolId, tools } from "./toolRegistry";
import { applyToolSeo } from "./toolSeo";

export function App() {
  const [activeToolId, setActiveToolId] = useState<ToolId>(() =>
    toolIdFromPathname(window.location.pathname),
  );
  const [darkMode, setDarkMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const layoutBand = useSidebarBand();

  const activeTool = tools.find((tool) => tool.id === activeToolId) ?? tools[0];
  const ActivePage = activeTool.Page;

  useEffect(() => {
    applyToolSeo(activeTool.id);
  }, [activeTool.id]);

  useEffect(() => {
    // Canonicalize unknown paths and trailing slashes without adding history.
    const canonical = canonicalPathname(window.location.pathname);
    if (window.location.pathname !== canonical) {
      const { search, hash } = window.location;
      window.history.replaceState(null, "", `${canonical}${search}${hash}`);
    }

    function syncToolFromAddress() {
      setActiveToolId(toolIdFromPathname(window.location.pathname));
    }

    window.addEventListener("popstate", syncToolFromAddress);
    return () => window.removeEventListener("popstate", syncToolFromAddress);
  }, []);

  function selectTool(toolId: ToolId) {
    setActiveToolId(toolId);
    setSidebarOpen(false);
    const nextPath = pathnameForTool(toolId);
    if (window.location.pathname === nextPath) return;

    window.history.pushState(null, "", nextPath);
  }

  return (
    <AppShell
      activeTool={activeTool}
      darkMode={darkMode}
      layoutBand={layoutBand}
      sidebarCollapsed={sidebarCollapsed}
      sidebarOpen={sidebarOpen}
      tools={tools}
      onCloseSidebar={() => setSidebarOpen(false)}
      onOpenSidebar={() => setSidebarOpen(true)}
      onSelectTool={selectTool}
      onToggleDarkMode={() => setDarkMode((value) => !value)}
      onToggleSidebarCollapsed={() => setSidebarCollapsed((value) => !value)}
    >
      <ActivePage />
    </AppShell>
  );
}
