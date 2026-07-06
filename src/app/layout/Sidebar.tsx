import {
  ChevronLeft,
  ChevronRight,
  Moon,
  Sun,
  Wrench,
  X,
} from "lucide-react";
import type { ToolDefinition, ToolId } from "../toolRegistry";

interface SidebarProps {
  activeToolId: ToolId;
  darkMode: boolean;
  isCollapsed: boolean;
  isOpen: boolean;
  tools: ToolDefinition[];
  onClose: () => void;
  onSelectTool: (toolId: ToolId) => void;
  onToggleCollapsed: () => void;
  onToggleDarkMode: () => void;
}

export function Sidebar({
  activeToolId,
  darkMode,
  isCollapsed,
  isOpen,
  tools,
  onClose,
  onSelectTool,
  onToggleCollapsed,
  onToggleDarkMode,
}: SidebarProps) {
  return (
    <>
      {isOpen && (
        <div className="sidebarOverlay" onClick={onClose} aria-hidden="true" />
      )}

      <aside
        className={`sidebar ${isOpen ? "open" : ""} ${isCollapsed ? "collapsed" : ""}`}
      >
        <div className="sidebarHeader">
          <div className="sidebarBrand">
            <span className="sidebarBrandIcon" aria-hidden="true">
              <Wrench size={20} />
            </span>
            {!isCollapsed && <span className="sidebarBrandText">Web Tools</span>}
          </div>

          <button
            className="sidebarThemeToggle"
            type="button"
            onClick={onToggleDarkMode}
            aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            title={darkMode ? "Light mode" : "Dark mode"}
          >
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          <button
            className="sidebarCloseButton"
            type="button"
            onClick={onClose}
            aria-label="Close sidebar"
          >
            <X size={20} />
          </button>

          <button
            className="sidebarCollapseButton"
            type="button"
            onClick={onToggleCollapsed}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? (
              <ChevronRight size={18} />
            ) : (
              <ChevronLeft size={18} />
            )}
          </button>
        </div>

        <nav className="sidebarNav" aria-label="Main navigation">
          {tools.map((tool) => {
            const { Icon } = tool;
            const isActive = tool.id === activeToolId;

            return (
              <button
                key={tool.id}
                className={isActive ? "sidebarNavItem active" : "sidebarNavItem"}
                type="button"
                title={isCollapsed ? tool.label : undefined}
                aria-current={isActive ? "page" : undefined}
                onClick={() => onSelectTool(tool.id)}
              >
                <Icon size={20} />
                {!isCollapsed && <span>{tool.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="sidebarFooter" />
      </aside>
    </>
  );
}
