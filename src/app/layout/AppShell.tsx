import type { ReactNode } from "react";
import type { ToolDefinition, ToolId } from "../toolRegistry";
import { PageHeader } from "./PageHeader";
import { Sidebar } from "./Sidebar";
import type { SidebarBand } from "./useSidebarBand";

interface AppShellProps {
  activeTool: ToolDefinition;
  children: ReactNode;
  darkMode: boolean;
  layoutBand: SidebarBand;
  sidebarCollapsed: boolean;
  sidebarOpen: boolean;
  tools: ToolDefinition[];
  onCloseSidebar: () => void;
  onOpenSidebar: () => void;
  onSelectTool: (toolId: ToolId) => void;
  onToggleDarkMode: () => void;
  onToggleSidebarCollapsed: () => void;
}

export function AppShell({
  activeTool,
  children,
  darkMode,
  layoutBand,
  sidebarCollapsed,
  sidebarOpen,
  tools,
  onCloseSidebar,
  onOpenSidebar,
  onSelectTool,
  onToggleDarkMode,
  onToggleSidebarCollapsed,
}: AppShellProps) {
  const isCollapsed =
    layoutBand === "rail" || (layoutBand === "expanded" && sidebarCollapsed);
  const className = [
    "app",
    darkMode ? "dark" : "",
    `layout-${layoutBand}`,
    layoutBand === "expanded" && sidebarCollapsed ? "sidebarCollapsed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className={className}>
      <Sidebar
        activeToolId={activeTool.id}
        darkMode={darkMode}
        isCollapsed={isCollapsed}
        isOpen={sidebarOpen}
        showCollapseButton={layoutBand === "expanded"}
        tools={tools}
        onClose={onCloseSidebar}
        onSelectTool={onSelectTool}
        onToggleCollapsed={onToggleSidebarCollapsed}
        onToggleDarkMode={onToggleDarkMode}
      />

      <section className="shell" aria-labelledby="page-title">
        <PageHeader
          activeTool={activeTool}
          isSidebarOpen={sidebarOpen}
          showMenuButton={layoutBand === "drawer"}
          onOpenSidebar={onOpenSidebar}
        />
        {children}
      </section>
    </main>
  );
}
