import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const layoutCss = readFileSync(resolve("src/styles/layout.css"), "utf8");

describe("tool column", () => {
  beforeEach(() => {
    const style = document.createElement("style");
    style.textContent = layoutCss;
    document.head.append(style);
  });

  afterEach(() => {
    document.head.querySelectorAll("style").forEach((style) => style.remove());
    document.body.replaceChildren();
  });

  it("anchors a wider column to the top of the page", () => {
    const app = document.createElement("main");
    app.className = "app";
    const shell = document.createElement("section");
    shell.className = "shell";
    app.append(shell);
    document.body.append(app);

    expect(getComputedStyle(app).alignItems).toBe("flex-start");
    expect(getComputedStyle(shell).maxWidth).toBe("720px");
  });
});
