import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });
}

describe("sidebar layout bands", () => {
  afterEach(() => {
    cleanup();
    setViewportWidth(1024);
  });

  it("keeps a collapsed sidebar on screen from 640px through 959px", () => {
    for (const width of [640, 800, 959]) {
      setViewportWidth(width);
      const { unmount } = render(<App />);

      expect(screen.getByRole("main")).toHaveClass("layout-rail");
      expect(document.getElementById("sidebar")).toHaveClass("collapsed");
      expect(
        screen.queryByRole("button", { name: "Open sidebar" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("Web Tools")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "URL Shortener" }),
      ).not.toHaveTextContent("URL Shortener");

      unmount();
    }
  });

  it("shows the labeled sidebar from 960px without a menu button", () => {
    setViewportWidth(960);
    render(<App />);

    expect(screen.getByRole("main")).toHaveClass("layout-expanded");
    expect(document.getElementById("sidebar")).not.toHaveClass("collapsed");
    expect(screen.getByText("Web Tools")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open sidebar" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Collapse sidebar" }),
    ).toBeInTheDocument();
  });

  it("opens a labeled drawer from the menu button below 640px", async () => {
    const user = userEvent.setup();
    setViewportWidth(639);
    render(<App />);

    expect(screen.getByRole("main")).toHaveClass("layout-drawer");
    expect(document.getElementById("sidebar")).not.toHaveClass("open");
    expect(
      screen.queryByRole("button", { name: "Collapse sidebar" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open sidebar" }));

    expect(document.getElementById("sidebar")).toHaveClass("open");
    expect(screen.getByText("Web Tools")).toBeVisible();
  });

  it("restores a manual collapse after the window leaves the rail", async () => {
    const user = userEvent.setup();
    setViewportWidth(1200);
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.queryByText("Web Tools")).not.toBeInTheDocument();

    setViewportWidth(800);
    expect(screen.getByRole("main")).toHaveClass("layout-rail");
    expect(screen.queryByText("Web Tools")).not.toBeInTheDocument();

    setViewportWidth(1200);
    expect(screen.getByRole("main")).toHaveClass("layout-expanded");
    expect(document.getElementById("sidebar")).toHaveClass("collapsed");
    expect(screen.queryByText("Web Tools")).not.toBeInTheDocument();
  });

  it("expands again above 960px when the sidebar was not collapsed by hand", () => {
    setViewportWidth(1200);
    render(<App />);
    expect(screen.getByText("Web Tools")).toBeInTheDocument();

    setViewportWidth(800);
    expect(screen.queryByText("Web Tools")).not.toBeInTheDocument();

    setViewportWidth(1200);
    expect(screen.getByText("Web Tools")).toBeInTheDocument();
    expect(document.getElementById("sidebar")).not.toHaveClass("collapsed");
  });
});
