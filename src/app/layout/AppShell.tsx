import type { ReactNode } from "react";
import { Moon, Sun } from "lucide-react";
import type { ToolDefinition, ToolId } from "../toolRegistry";
import { PageHeader } from "./PageHeader";
import { Sidebar } from "./Sidebar";

interface AppShellProps {
  activeTool: ToolDefinition;
  children: ReactNode;
  darkMode: boolean;
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
  sidebarCollapsed,
  sidebarOpen,
  tools,
  onCloseSidebar,
  onOpenSidebar,
  onSelectTool,
  onToggleDarkMode,
  onToggleSidebarCollapsed,
}: AppShellProps) {
  return (
    <main
      className={`app ${darkMode ? "dark" : ""} ${sidebarCollapsed ? "sidebarCollapsed" : ""}`}
    >
      <Sidebar
        activeToolId={activeTool.id}
        darkMode={darkMode}
        isCollapsed={sidebarCollapsed}
        isOpen={sidebarOpen}
        tools={tools}
        onClose={onCloseSidebar}
        onSelectTool={onSelectTool}
        onToggleCollapsed={onToggleSidebarCollapsed}
        onToggleDarkMode={onToggleDarkMode}
      />

      <button
        className="fixedThemeToggle mobileOnly"
        type="button"
        onClick={onToggleDarkMode}
        aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
        title={darkMode ? "Light mode" : "Dark mode"}
      >
        {darkMode ? <Sun size={20} /> : <Moon size={20} />}
      </button>

      <section className="shell" aria-labelledby="page-title">
        <PageHeader
          activeTool={activeTool}
          isSidebarOpen={sidebarOpen}
          onOpenSidebar={onOpenSidebar}
        />
        {children}
      </section>
    </main>
  );
}
