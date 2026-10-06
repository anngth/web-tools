import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App";

describe("App tool registry integration", () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });
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
    expect(window.location.pathname).toBe("/url-shortener");
  });

  it("restores the URL Shortener tab from the address after refresh", () => {
    window.history.replaceState(null, "", "/url-shortener");
    render(<App />);

    expect(
      screen.getByRole("heading", { level: 1, name: "URL Shortener" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { level: 1, name: "TOTP Generator" }),
    ).not.toBeInTheDocument();
  });

  it("updates title and canonical link per tool", async () => {
    const user = userEvent.setup();
    render(<App />);
    const canonical = () =>
      document.head.querySelector('link[rel="canonical"]')?.getAttribute("href");

    const origin = window.location.origin;
    expect(canonical()).toBe(`${origin}/totp`);
    expect(document.title).toMatch(/^TOTP Generator/);

    await user.click(screen.getByRole("button", { name: "URL Shortener" }));

    expect(canonical()).toBe(`${origin}/url-shortener`);
    expect(document.title).toMatch(/^URL Shortener/);
  });

  it("canonicalizes a trailing slash and unknown paths without extra history", () => {
    const initialLength = window.history.length;
    window.history.replaceState(null, "", "/url-shortener/");
    const { unmount } = render(<App />);
    expect(window.location.pathname).toBe("/url-shortener");
    unmount();

    window.history.replaceState(null, "", "/bogus");
    render(<App />);
    expect(window.location.pathname).toBe("/totp");
    expect(window.history.length).toBe(initialLength);
  });

  it("serves TOTP at its own path and opens it from the home path", () => {
    window.history.replaceState(null, "", "/totp");
    const { unmount } = render(<App />);
    expect(
      screen.getByRole("heading", { level: 1, name: "TOTP Generator" }),
    ).toBeVisible();
    unmount();

    window.history.replaceState(null, "", "/");
    render(<App />);
    expect(
      screen.getByRole("heading", { level: 1, name: "TOTP Generator" }),
    ).toBeVisible();
    expect(window.location.pathname).toBe("/totp");
  });

  it("returns to TOTP when the address goes back", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "URL Shortener" }));

    window.history.back();

    expect(
      await screen.findByRole("heading", { level: 1, name: "TOTP Generator" }),
    ).toBeVisible();
    expect(window.location.pathname).toBe("/totp");
  });
});
