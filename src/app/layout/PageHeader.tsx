import { Menu } from "lucide-react";
import type { ToolDefinition } from "../toolRegistry";

interface PageHeaderProps {
  activeTool: ToolDefinition;
  isSidebarOpen: boolean;
  showMenuButton: boolean;
  onOpenSidebar: () => void;
}

export function PageHeader({
  activeTool,
  isSidebarOpen,
  showMenuButton,
  onOpenSidebar,
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
    </header>
  );
}
