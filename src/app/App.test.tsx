import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App";

describe("App tool registry integration", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(cleanup);

  it("switches from TOTP to the registered URL Shortener page", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(
      screen.getByRole("heading", { level: 1, name: "TOTP Generator" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "URL Shortener" }));

    expect(
      screen.getByRole("heading", { level: 1, name: "URL Shortener" }),
    ).toBeVisible();
    expect(
      screen.getByRole("form", { name: "Create short link" }),
    ).toBeVisible();
  });
});
