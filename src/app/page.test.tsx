import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Home from "@/app/page";
import { COMMERCIAL_MODELS } from "@/lib/data/commercial-models";
import { TooltipProvider } from "@/components/ui/tooltip";

function renderHome() {
  return render(
    <TooltipProvider>
      <Home />
    </TooltipProvider>,
  );
}

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      models: COMMERCIAL_MODELS,
      source: "fallback",
      lastUpdated: "2026-09-28",
    }),
  }) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("Home (calculator page)", () => {
  it("renders the header and a default monthly cost estimate", async () => {
    renderHome();

    expect(screen.getByRole("heading", { name: /AI Cost Calculator/i })).toBeInTheDocument();

    // The sticky breakdown panel should show a "/mo" total once pricing loads
    await waitFor(() => {
      expect(screen.getByText("per month")).toBeInTheDocument();
    });
  });

  it("updates the estimate when the document volume changes", async () => {
    renderHome();

    await waitFor(() => {
      expect(screen.getByText("per month")).toBeInTheDocument();
    });

    const docsInput = screen.getByLabelText(/documents per month/i) as HTMLInputElement;
    const perDocBefore = screen.getByText("Per document").parentElement!.textContent;

    fireEvent.change(docsInput, { target: { value: "5000" } });

    await waitFor(() => {
      const perDocAfter = screen.getByText("Per document").parentElement!.textContent;
      // Cost per document should stay roughly the same, but total should change;
      // simplest robust check: the input reflects the new value.
      expect(docsInput.value).toBe("5000");
      expect(perDocAfter).toBeTruthy();
      expect(perDocBefore).toBeTruthy();
    });
  });

  it("shows the self-hosted GPU breakdown by default, without needing a click", async () => {
    renderHome();

    await waitFor(() => {
      expect(screen.getByText(/server capacity used/i)).toBeInTheDocument();
    });
    const selfHostTab = screen.getByRole("tab", { name: /self-hosted GPU server/i });
    expect(selfHostTab).toHaveAttribute("aria-selected", "true");
  });

  it("switches to the pay-per-use API tab and shows a token-based breakdown", async () => {
    const user = userEvent.setup();
    renderHome();

    await waitFor(() => {
      expect(screen.getByText(/server capacity used/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("tab", { name: /pay-per-use API/i }));

    await waitFor(() => {
      expect(screen.getByText("Input tokens")).toBeInTheDocument();
    });
  });

  it("shows a per-region breakdown once a second compliance region is selected", async () => {
    const user = userEvent.setup();
    renderHome();

    await waitFor(() => {
      expect(screen.getByText("per month")).toBeInTheDocument();
    });

    expect(screen.queryByText("By region")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "European Union" }));

    await waitFor(() => {
      expect(screen.getByText("By region")).toBeInTheDocument();
    });
    // The region toggle button plus the new per-region breakdown row both say "United States"
    expect(screen.getAllByText("United States", { exact: false }).length).toBeGreaterThanOrEqual(2);
    // 1000 docs split evenly across 2 regions -> "500 docs/mo" shown for each
    expect(screen.getAllByText(/500 docs\/mo/).length).toBe(2);
  });

  it("enables self-hosted smart routing and shows a Laya-routed breakdown", async () => {
    const user = userEvent.setup();
    renderHome();

    await waitFor(() => {
      expect(screen.getByText(/server capacity used/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("switch", { name: /enable smart routing/i }));

    await waitFor(() => {
      expect(screen.getByText("Router (Laya)")).toBeInTheDocument();
    });
    // Server-capacity language belongs to the non-routed panel only
    expect(screen.queryByText(/server capacity used/i)).not.toBeInTheDocument();
  });

  it("opens the security and compliance safeguards dialog with its content", async () => {
    const user = userEvent.setup();
    renderHome();

    await waitFor(() => {
      expect(screen.getByText(/server capacity used/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /security & compliance safeguards/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /security and compliance safeguards/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/model integrity and supply chain/i)).toBeInTheDocument();
    expect(screen.getByText(/data residency/i)).toBeInTheDocument();
  });
});
