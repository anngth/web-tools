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

  it("keeps a single theme button in the page header at every width", () => {
    for (const width of [1200, 800, 500]) {
      setViewportWidth(width);
      const { unmount } = render(<App />);

      const buttons = screen.getAllByRole("button", { name: "Switch to dark mode" });
      expect(buttons).toHaveLength(1);
      expect(buttons[0].closest("header")).not.toBeNull();
      expect(document.getElementById("sidebar")?.contains(buttons[0])).toBe(false);

      unmount();
    }
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
