import { ChevronLeft, ChevronRight, Wrench, X } from "lucide-react";
import type { ToolDefinition, ToolId } from "../toolRegistry";

interface SidebarProps {
  activeToolId: ToolId;
  isCollapsed: boolean;
  isOpen: boolean;
  showCollapseButton: boolean;
  tools: ToolDefinition[];
  onClose: () => void;
  onSelectTool: (toolId: ToolId) => void;
  onToggleCollapsed: () => void;
}

export function Sidebar({
  activeToolId,
  isCollapsed,
  isOpen,
  showCollapseButton,
  tools,
  onClose,
  onSelectTool,
  onToggleCollapsed,
}: SidebarProps) {
  return (
    <>
      {isOpen && (
        <div className="sidebarOverlay" onClick={onClose} aria-hidden="true" />
      )}

      <aside
        id="sidebar"
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
            className="sidebarCloseButton"
            type="button"
            onClick={onClose}
            aria-label="Close sidebar"
          >
            <X size={20} />
          </button>

          {showCollapseButton && (
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
          )}
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
                aria-label={tool.label}
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
