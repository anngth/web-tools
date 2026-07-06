import { useMemo, useState } from "react";
import { AppShell } from "./layout/AppShell";
import { type ToolId, tools } from "./toolRegistry";

export function App() {
  const [activeToolId, setActiveToolId] = useState<ToolId>("totp");
  const [darkMode, setDarkMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const activeTool = useMemo(() => {
    return tools.find((tool) => tool.id === activeToolId) ?? tools[0];
  }, [activeToolId]);
  const ActivePage = activeTool.Page;

  function selectTool(toolId: ToolId) {
    setActiveToolId(toolId);
    setSidebarOpen(false);
  }

  return (
    <AppShell
      activeTool={activeTool}
      darkMode={darkMode}
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
