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

describe("theme toggle", () => {
  afterEach(() => {
    cleanup();
    setViewportWidth(1024);
  });

  it("places the theme button beside the sidebar title when expanded", () => {
    setViewportWidth(1200);
    render(<App />);

    const button = screen.getByRole("button", { name: "Switch to dark mode" });
    expect(button.closest(".sidebarBrand")).not.toBeNull();
    expect(button.closest(".sidebarFooter")).toBeNull();
    expect(button.querySelector("span")).toBeNull();
  });

  it("keeps the drawer theme button with the brand, not flush against close", () => {
    setViewportWidth(500);
    render(<App />);

    const buttons = screen.getAllByRole("button", { name: "Switch to dark mode" });
    expect(buttons).toHaveLength(1);
    const theme = buttons[0];
    const close = screen.getByRole("button", { name: "Close sidebar" });
    expect(theme.closest(".sidebarBrand")).not.toBeNull();
    expect(close.closest(".sidebarBrand")).toBeNull();
  });

  it("places a compact theme button in the sidebar footer when collapsed to rail", () => {
    setViewportWidth(800);
    render(<App />);

    const button = screen.getByRole("button", { name: "Switch to dark mode" });
    expect(document.getElementById("sidebar")).toHaveClass("collapsed");
    expect(button.closest(".sidebarFooter")).not.toBeNull();
    expect(button.closest(".sidebarHeader")).toBeNull();
  });

  it("switches the page between dark and light from that button", async () => {
    const user = userEvent.setup();
    setViewportWidth(1200);
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Switch to dark mode" }));

    expect(screen.getByRole("main")).toHaveClass("dark");
    await user.click(screen.getByRole("button", { name: "Switch to light mode" }));
    expect(screen.getByRole("main")).not.toHaveClass("dark");
  });
});
