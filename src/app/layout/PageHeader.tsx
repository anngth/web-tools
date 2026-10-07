import { Menu, Moon, Sun } from "lucide-react";
import type { ToolDefinition } from "../toolRegistry";

interface PageHeaderProps {
  activeTool: ToolDefinition;
  darkMode: boolean;
  isSidebarOpen: boolean;
  showMenuButton: boolean;
  onOpenSidebar: () => void;
  onToggleDarkMode: () => void;
}

export function PageHeader({
  activeTool,
  darkMode,
  isSidebarOpen,
  showMenuButton,
  onOpenSidebar,
  onToggleDarkMode,
}: PageHeaderProps) {
  const { Icon } = activeTool;

  return (
    <header className="topbar">
      <div className="brand">
        {showMenuButton && (
          <button
            className="menuButton"
            type="button"
            onClick={onOpenSidebar}
            aria-label="Open sidebar"
            aria-controls="sidebar"
            aria-expanded={isSidebarOpen}
          >
            <Menu size={24} />
          </button>
        )}
        <span className="brandIcon" aria-hidden="true">
          <Icon size={24} />
        </span>
        <div>
          <h1 id="page-title">{activeTool.label}</h1>
          <p>{activeTool.description}</p>
        </div>
      </div>
      <button
        className="themeToggle"
        type="button"
        onClick={onToggleDarkMode}
        aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
        title={darkMode ? "Light mode" : "Dark mode"}
      >
        {darkMode ? <Sun size={20} /> : <Moon size={20} />}
      </button>
    </header>
  );
}
