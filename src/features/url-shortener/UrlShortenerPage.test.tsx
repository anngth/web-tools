import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "../../shared/clipboard";
import {
  UrlShortenerApiError,
  checkShortLinkService,
  createShortLink,
  getShortLinkStats,
} from "./url-shortener.api";
import { CREATED_LINKS_STORAGE_KEY } from "./url-shortener.storage";
import { UrlShortenerPage } from "./UrlShortenerPage";

vi.mock("./url-shortener.api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./url-shortener.api")>();
  return {
    ...original,
    checkShortLinkService: vi.fn(),
    createShortLink: vi.fn(),
    getShortLinkStats: vi.fn(),
  };
});

vi.mock("../../shared/clipboard", () => ({
  copyTextToClipboard: vi.fn(),
}));

const createdLink = {
  slug: "docs-42",
  destinationUrl: "https://example.com/reference?section=durability",
  createdAt: "2026-07-12T10:00:00.000Z",
  expiresAt: "2026-08-11T10:00:00.000Z",
  clickCount: 0,
  lastClickedAt: null,
  shortUrl: "https://short.example/s/docs-42",
};

const secondCreatedLink = {
  ...createdLink,
  slug: "guide-84",
  destinationUrl: "https://example.com/guide",
  shortUrl: "https://short.example/s/guide-84",
};

const serviceMock = vi.mocked(checkShortLinkService);
const createMock = vi.mocked(createShortLink);
const statsMock = vi.mocked(getShortLinkStats);
const copyMock = vi.mocked(copyTextToClipboard);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function createALink(alias?: string) {
  const user = userEvent.setup();
  createMock.mockResolvedValueOnce(createdLink);
  render(<UrlShortenerPage />);
  await screen.findByRole("textbox", { name: "Destination URL" });
  await user.type(
    screen.getByRole("textbox", { name: "Destination URL" }),
    createdLink.destinationUrl,
  );
  if (alias) {
    await user.type(
      screen.getByRole("textbox", { name: "Custom alias (optional)" }),
      alias,
    );
  }
  await user.click(screen.getByRole("button", { name: "Create short link" }));
  await screen.findByText(createdLink.shortUrl);
  return user;
}

describe("UrlShortenerPage", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    serviceMock.mockResolvedValue(undefined);
    copyMock.mockResolvedValue(true);
  });

  afterEach(cleanup);

  it("hides the form until the short-link service answers", async () => {
    const pending = deferred<void>();
    serviceMock.mockReturnValueOnce(pending.promise);
    render(<UrlShortenerPage />);

    expect(screen.getByText("Checking the short-link service…")).toBeVisible();
    expect(
      screen.queryByRole("textbox", { name: "Destination URL" }),
    ).not.toBeInTheDocument();

    pending.resolve();
    expect(
      await screen.findByRole("textbox", { name: "Destination URL" }),
    ).toBeVisible();
  });

  it("replaces the form when the short-link service is unreachable", async () => {
    sessionStorage.setItem(CREATED_LINKS_STORAGE_KEY, JSON.stringify([createdLink]));
    serviceMock.mockRejectedValueOnce(
      new UrlShortenerApiError(
        "network_error",
        "Could not reach the short-link service. Check your connection and try again.",
      ),
    );

    render(<UrlShortenerPage />);

    expect(
      await screen.findByText("The short-link service is not running."),
    ).toBeVisible();
    expect(
      screen.queryByRole("textbox", { name: "Destination URL" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(createdLink.shortUrl)).toBeVisible();
    expect(screen.getByRole("button", { name: "Refresh statistics" })).toBeDisabled();
    expect(statsMock).not.toHaveBeenCalled();
  });

  it("shows the form after retry reaches the service", async () => {
    const user = userEvent.setup();
    serviceMock
      .mockRejectedValueOnce(
        new UrlShortenerApiError(
          "network_error",
          "Could not reach the short-link service. Check your connection and try again.",
        ),
      )
      .mockResolvedValueOnce(undefined);
    render(<UrlShortenerPage />);

    await user.click(await screen.findByRole("button", { name: "Retry" }));

    expect(
      await screen.findByRole("textbox", { name: "Destination URL" }),
    ).toBeVisible();
    expect(
      screen.queryByText("The short-link service is not running."),
    ).not.toBeInTheDocument();
  });

  it("creates a link with the destination and optional alias on Enter", async () => {
    const user = userEvent.setup();
    createMock.mockResolvedValueOnce(createdLink);
    render(<UrlShortenerPage />);
    await screen.findByRole("textbox", { name: "Destination URL" });

    await user.type(
      screen.getByRole("textbox", { name: "Destination URL" }),
      createdLink.destinationUrl,
    );
    await user.type(
      screen.getByRole("textbox", { name: "Custom alias (optional)" }),
      "docs-42{Enter}",
    );

    expect(createMock).toHaveBeenCalledWith({
      destinationUrl: createdLink.destinationUrl,
      customAlias: "docs-42",
    });
    expect(await screen.findByText(createdLink.shortUrl)).toBeVisible();
    expect(screen.getByText(createdLink.destinationUrl)).toBeVisible();
    expect(screen.getByText("0")).toBeVisible();
    expect(screen.getByText("Never")).toBeVisible();
    expect(
      screen.getByText("Expires").parentElement?.querySelector("time"),
    ).toHaveAttribute("datetime", createdLink.expiresAt);
  });

  it("omits a blank alias and stores only the returned public link", async () => {
    await createALink();

    expect(createMock).toHaveBeenCalledWith({
      destinationUrl: createdLink.destinationUrl,
    });
    expect(JSON.parse(sessionStorage.getItem(CREATED_LINKS_STORAGE_KEY)!)).toEqual([
      createdLink,
    ]);
  });

  it("opens the short URL and destination from the link text", async () => {
    await createALink();

    const shortLink = screen.getByRole("link", { name: createdLink.shortUrl });
    expect(shortLink).toHaveAttribute("href", createdLink.shortUrl);
    expect(shortLink).toHaveAttribute("target", "_blank");
    expect(shortLink).toHaveAttribute("rel", "noopener noreferrer");

    const destinationLink = screen.getByRole("link", {
      name: createdLink.destinationUrl,
    });
    expect(destinationLink).toHaveAttribute("href", createdLink.destinationUrl);
    expect(destinationLink).toHaveAttribute("target", "_blank");
    expect(destinationLink).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("copies only from the button beside each link", async () => {
    const user = await createALink();

    await user.click(screen.getByRole("link", { name: createdLink.shortUrl }));
    await user.click(
      screen.getByRole("link", { name: createdLink.destinationUrl }),
    );
    expect(copyMock).not.toHaveBeenCalled();

    const shortCopy = screen.getByRole("button", {
      name: `Copy ${createdLink.shortUrl}`,
    });
    const destinationCopy = screen.getByRole("button", {
      name: `Copy ${createdLink.destinationUrl}`,
    });
    expect(shortCopy).toHaveTextContent("Copy");
    expect(destinationCopy).toHaveTextContent("Copy");

    await user.click(shortCopy);
    expect(copyMock).toHaveBeenCalledTimes(1);
    expect(copyMock).toHaveBeenCalledWith(createdLink.shortUrl);
    expect(shortCopy).toHaveTextContent("Copied");
  });

  it("copies the dominant short route and exposes active copy feedback", async () => {
    const user = await createALink();

    await user.click(
      screen.getByRole("button", { name: `Copy ${createdLink.shortUrl}` }),
    );

    expect(copyMock).toHaveBeenCalledWith(createdLink.shortUrl);
    expect(
      screen.getByRole("button", { name: `Copied ${createdLink.shortUrl}` }),
    ).toBeVisible();
  });

  it("shows the destination above the short link", async () => {
    await createALink();
    const article = screen.getByRole("article", { name: "Short link docs-42" });
    const text = article.textContent ?? "";

    expect(text.indexOf(createdLink.destinationUrl)).toBeLessThan(
      text.indexOf(createdLink.shortUrl),
    );
  });

  it("restores the copy control after the confirmation", async () => {
    await createALink();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const copyButton = screen.getByRole("button", {
        name: `Copy ${createdLink.shortUrl}`,
      });
      await act(async () => {
        copyButton.click();
      });
      expect(
        screen.getByRole("button", { name: `Copied ${createdLink.shortUrl}` }),
      ).toBeVisible();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });

      expect(
        screen.getByRole("button", { name: `Copy ${createdLink.shortUrl}` }),
      ).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears form fields without removing created links", async () => {
    const user = await createALink("docs-42");

    await user.click(screen.getByRole("button", { name: "Clear form" }));

    expect(screen.getByRole("textbox", { name: "Destination URL" })).toHaveValue("");
    expect(
      screen.getByRole("textbox", { name: "Custom alias (optional)" }),
    ).toHaveValue("");
    expect(screen.getByText(createdLink.shortUrl)).toBeVisible();
  });

  it("shows create and refresh loading states", async () => {
    const user = userEvent.setup();
    const creation = deferred<typeof createdLink>();
    createMock.mockReturnValueOnce(creation.promise);
    render(<UrlShortenerPage />);
    await screen.findByRole("textbox", { name: "Destination URL" });
    await user.type(
      screen.getByRole("textbox", { name: "Destination URL" }),
      createdLink.destinationUrl,
    );
    await user.click(screen.getByRole("button", { name: "Create short link" }));
    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
    creation.resolve(createdLink);
    await screen.findByText(createdLink.shortUrl);

    const refresh = deferred<Omit<typeof createdLink, "shortUrl">>();
    statsMock.mockReturnValueOnce(refresh.promise);
    await user.click(screen.getByRole("button", { name: "Refresh statistics" }));
    expect(screen.getByRole("button", { name: "Refreshing…" })).toBeDisabled();
    const { shortUrl: _shortUrl, ...stats } = createdLink;
    refresh.resolve({ ...stats, clickCount: 4 });
    expect(await screen.findByText("4")).toBeVisible();
  });

  it("rehydrates a session link and refreshes its statistics", async () => {
    sessionStorage.setItem(CREATED_LINKS_STORAGE_KEY, JSON.stringify([createdLink]));
    const { shortUrl: _shortUrl, ...stats } = createdLink;
    statsMock.mockResolvedValueOnce({
      ...stats,
      clickCount: 7,
      lastClickedAt: "2026-07-13T11:30:00.000Z",
    });

    render(<UrlShortenerPage />);

    expect(screen.getByText(createdLink.shortUrl)).toBeVisible();
    await waitFor(() => expect(statsMock).toHaveBeenCalledWith("docs-42"));
    expect(await screen.findByText("7")).toBeVisible();
    expect(JSON.parse(sessionStorage.getItem(CREATED_LINKS_STORAGE_KEY)!)[0]).toMatchObject({
      clickCount: 7,
      shortUrl: createdLink.shortUrl,
    });
  });

  it("tracks concurrent manual statistics refreshes independently", async () => {
    const user = userEvent.setup();
    sessionStorage.setItem(
      CREATED_LINKS_STORAGE_KEY,
      JSON.stringify([createdLink, secondCreatedLink]),
    );
    const { shortUrl: _firstShortUrl, ...firstStats } = createdLink;
    const { shortUrl: _secondShortUrl, ...secondStats } = secondCreatedLink;
    statsMock
      .mockResolvedValueOnce(firstStats)
      .mockResolvedValueOnce(secondStats);
    render(<UrlShortenerPage />);
    await waitFor(() => {
      expect(statsMock).toHaveBeenCalledTimes(2);
      expect(
        screen.getAllByRole("button", { name: "Refresh statistics" }),
      ).toHaveLength(2);
    });

    const firstRefresh = deferred<typeof firstStats>();
    const secondRefresh = deferred<typeof secondStats>();
    statsMock.mockImplementation((slug) =>
      slug === createdLink.slug ? firstRefresh.promise : secondRefresh.promise,
    );
    const firstResult = screen.getByRole("article", {
      name: `Short link ${createdLink.slug}`,
    });
    const secondResult = screen.getByRole("article", {
      name: `Short link ${secondCreatedLink.slug}`,
    });

    await user.click(
      within(firstResult).getByRole("button", { name: "Refresh statistics" }),
    );
    await user.click(
      within(secondResult).getByRole("button", { name: "Refresh statistics" }),
    );
    expect(
      within(firstResult).getByRole("button", { name: "Refreshing…" }),
    ).toBeDisabled();
    expect(
      within(secondResult).getByRole("button", { name: "Refreshing…" }),
    ).toBeDisabled();

    firstRefresh.resolve({ ...firstStats, clickCount: 11 });
    await waitFor(() =>
      expect(
        within(firstResult).getByRole("button", {
          name: "Refresh statistics",
        }),
      ).toBeEnabled(),
    );
    expect(
      within(secondResult).getByRole("button", { name: "Refreshing…" }),
    ).toBeDisabled();

    secondRefresh.resolve({ ...secondStats, clickCount: 12 });
    await waitFor(() =>
      expect(
        within(secondResult).getByRole("button", {
          name: "Refresh statistics",
        }),
      ).toBeEnabled(),
    );
  });

  it("tracks automatic rehydration refreshes and blocks duplicate requests", async () => {
    const user = userEvent.setup();
    sessionStorage.setItem(
      CREATED_LINKS_STORAGE_KEY,
      JSON.stringify([createdLink, secondCreatedLink]),
    );
    const { shortUrl: _firstShortUrl, ...firstStats } = createdLink;
    const { shortUrl: _secondShortUrl, ...secondStats } = secondCreatedLink;
    const firstRefresh = deferred<typeof firstStats>();
    const secondRefresh = deferred<typeof secondStats>();
    statsMock.mockImplementation((slug) =>
      slug === createdLink.slug ? firstRefresh.promise : secondRefresh.promise,
    );

    render(<UrlShortenerPage />);
    const refreshingButtons = await screen.findAllByRole("button", {
      name: "Refreshing…",
    });
    expect(refreshingButtons).toHaveLength(2);
    expect(refreshingButtons.every((button) => button.hasAttribute("disabled"))).toBe(
      true,
    );
    await user.click(refreshingButtons[0]);
    expect(statsMock).toHaveBeenCalledTimes(2);

    firstRefresh.resolve(firstStats);
    const firstResult = screen.getByRole("article", {
      name: `Short link ${createdLink.slug}`,
    });
    const secondResult = screen.getByRole("article", {
      name: `Short link ${secondCreatedLink.slug}`,
    });
    await waitFor(() =>
      expect(
        within(firstResult).getByRole("button", {
          name: "Refresh statistics",
        }),
      ).toBeEnabled(),
    );
    expect(
      within(secondResult).getByRole("button", { name: "Refreshing…" }),
    ).toBeDisabled();

    secondRefresh.resolve(secondStats);
    await waitFor(() =>
      expect(
        within(secondResult).getByRole("button", {
          name: "Refresh statistics",
        }),
      ).toBeEnabled(),
    );
  });

  it("removes a rehydrated link when statistics report it missing or expired", async () => {
    sessionStorage.setItem(CREATED_LINKS_STORAGE_KEY, JSON.stringify([createdLink]));
    statsMock.mockRejectedValueOnce(
      new UrlShortenerApiError(
        "not_found",
        "This short link is missing or has expired.",
        404,
      ),
    );

    render(<UrlShortenerPage />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "The saved short link expired or no longer exists. Create a new one.",
      );
    });
    expect(screen.queryByText(createdLink.shortUrl)).not.toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem(CREATED_LINKS_STORAGE_KEY)!)).toEqual([]);
  });

  it("preserves a recreated alias when the old record's refresh returns 404", async () => {
    const user = userEvent.setup();
    const oldRefresh = deferred<Omit<typeof createdLink, "shortUrl">>();
    const recreatedLink = {
      ...createdLink,
      destinationUrl: "https://example.com/recreated",
      createdAt: "2026-07-12T10:01:00.000Z",
      expiresAt: "2026-08-11T10:01:00.000Z",
    };
    sessionStorage.setItem(CREATED_LINKS_STORAGE_KEY, JSON.stringify([createdLink]));
    statsMock.mockReturnValueOnce(oldRefresh.promise);
    createMock.mockResolvedValueOnce(recreatedLink);
    render(<UrlShortenerPage />);
    await screen.findByRole("textbox", { name: "Destination URL" });

    await user.clear(screen.getByRole("textbox", { name: "Destination URL" }));
    await user.type(
      screen.getByRole("textbox", { name: "Destination URL" }),
      recreatedLink.destinationUrl,
    );
    await user.click(screen.getByRole("button", { name: "Create short link" }));
    expect(await screen.findByText(recreatedLink.destinationUrl)).toBeVisible();

    oldRefresh.reject(
      new UrlShortenerApiError(
        "not_found",
        "This short link is missing or has expired.",
        404,
      ),
    );
    await waitFor(() => expect(statsMock).toHaveBeenCalledTimes(1));

    expect(screen.getByText(recreatedLink.destinationUrl)).toBeVisible();
    expect(screen.queryByText(createdLink.destinationUrl)).not.toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem(CREATED_LINKS_STORAGE_KEY)!)).toEqual([
      recreatedLink,
    ]);
  });

  it("preserves a recreated alias when the old record's refresh succeeds late", async () => {
    const user = userEvent.setup();
    const oldRefresh = deferred<Omit<typeof createdLink, "shortUrl">>();
    const recreatedLink = {
      ...createdLink,
      destinationUrl: "https://example.com/recreated-success",
      createdAt: "2026-07-12T10:02:00.000Z",
      expiresAt: "2026-08-11T10:02:00.000Z",
      clickCount: 0,
    };
    const { shortUrl: _shortUrl, ...oldStats } = createdLink;
    sessionStorage.setItem(CREATED_LINKS_STORAGE_KEY, JSON.stringify([createdLink]));
    statsMock.mockReturnValueOnce(oldRefresh.promise);
    createMock.mockResolvedValueOnce(recreatedLink);
    render(<UrlShortenerPage />);
    await screen.findByRole("textbox", { name: "Destination URL" });

    await user.clear(screen.getByRole("textbox", { name: "Destination URL" }));
    await user.type(
      screen.getByRole("textbox", { name: "Destination URL" }),
      recreatedLink.destinationUrl,
    );
    await user.click(screen.getByRole("button", { name: "Create short link" }));
    expect(await screen.findByText(recreatedLink.destinationUrl)).toBeVisible();

    oldRefresh.resolve({ ...oldStats, clickCount: 99 });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Refresh statistics" }),
      ).toBeEnabled(),
    );

    expect(screen.getByText(recreatedLink.destinationUrl)).toBeVisible();
    expect(screen.queryByText("99")).not.toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem(CREATED_LINKS_STORAGE_KEY)!)).toEqual([
      recreatedLink,
    ]);
  });

  it("shows actionable create and clipboard errors", async () => {
    const user = userEvent.setup();
    createMock.mockRejectedValueOnce(
      new UrlShortenerApiError(
        "alias_collision",
        "That custom alias is already in use. Choose another alias.",
        409,
      ),
    );
    render(<UrlShortenerPage />);
    await screen.findByRole("textbox", { name: "Destination URL" });
    await user.type(
      screen.getByRole("textbox", { name: "Destination URL" }),
      createdLink.destinationUrl,
    );
    await user.click(screen.getByRole("button", { name: "Create short link" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "That custom alias is already in use. Choose another alias.",
      );
    });

    createMock.mockResolvedValueOnce(createdLink);
    await user.click(screen.getByRole("button", { name: "Create short link" }));
    await screen.findByText(createdLink.shortUrl);
    copyMock.mockResolvedValueOnce(false);
    await user.click(
      screen.getByRole("button", { name: `Copy ${createdLink.shortUrl}` }),
    );
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Could not copy the short URL. Check clipboard permission and try again.",
      );
    });
  });

  it("shows a session placeholder until the first link is created", async () => {
    const user = userEvent.setup();
    createMock.mockResolvedValueOnce(createdLink);
    render(<UrlShortenerPage />);

    expect(
      await screen.findByText("Links you create in this session show up here."),
    ).toBeVisible();

    await user.type(
      screen.getByRole("textbox", { name: "Destination URL" }),
      createdLink.destinationUrl,
    );
    await user.click(screen.getByRole("button", { name: "Create short link" }));

    expect(await screen.findByText(createdLink.shortUrl)).toBeVisible();
    expect(
      screen.queryByText("Links you create in this session show up here."),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Created this session" })).toBeVisible();
  });

  it("lists expiry, alias, and click-stat rules with the form", async () => {
    render(<UrlShortenerPage />);
    await screen.findByRole("textbox", { name: "Destination URL" });

    expect(screen.getByText("Links expire automatically.")).toBeVisible();
    expect(
      screen.getByText(
        "Use 3–48 lowercase letters, numbers, or hyphens for an alias.",
      ),
    ).toBeVisible();
    expect(screen.getByText("Click statistics stay with each link.")).toBeVisible();
  });

  it("copies the destination when that link is clicked", async () => {
    const user = await createALink();

    await user.click(
      screen.getByRole("button", { name: `Copy ${createdLink.destinationUrl}` }),
    );

    expect(copyMock).toHaveBeenCalledWith(createdLink.destinationUrl);
    expect(
      screen.getByRole("button", { name: `Copied ${createdLink.destinationUrl}` }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: `Copy ${createdLink.shortUrl}` }),
    ).toBeVisible();
  });

  it("limits result controls to copy and refresh", async () => {
    await createALink();
    const result = screen.getByRole("article", { name: "Short link docs-42" });

    expect(
      within(result).getByRole("button", { name: `Copy ${createdLink.destinationUrl}` }),
    ).toBeVisible();
    expect(
      within(result).getByRole("button", { name: `Copy ${createdLink.shortUrl}` }),
    ).toBeVisible();
    expect(
      within(result).getByRole("button", { name: "Refresh statistics" }),
    ).toBeVisible();
    expect(
      within(result).getByRole("link", { name: createdLink.destinationUrl }),
    ).toHaveAttribute("href", createdLink.destinationUrl);
    expect(
      within(result).getByRole("link", { name: createdLink.shortUrl }),
    ).toHaveAttribute("href", createdLink.shortUrl);
    expect(within(result).getAllByRole("button")).toHaveLength(3);
    expect(within(result).getAllByRole("link")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /delete|edit/i })).not.toBeInTheDocument();
  });
});
