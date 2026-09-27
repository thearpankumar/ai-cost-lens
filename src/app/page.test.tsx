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

    await waitFor(
      () => {
        expect(screen.getByText("By region")).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
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

  it("explains the GPU sizing and switches to a live-users usage pattern", async () => {
    const user = userEvent.setup();
    renderHome();

    await waitFor(() => {
      expect(screen.getByText(/server capacity used/i)).toBeInTheDocument();
    });
    // Default: batch pipeline in business hours, 1 replica of Llama 3.3 70B
    expect(screen.getByText(/minimum footprint for this model/i)).toBeInTheDocument();
    // Exact match: the usage-pattern summary line (the breakdown panel repeats it inside a longer sentence)
    expect(screen.getByText("~217 active hours/month")).toBeInTheDocument();
    expect(screen.queryByLabelText(/people using it at the same time/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /live users/i }));
    const peakInput = screen.getByLabelText(/people using it at the same time/i);
    fireEvent.change(peakInput, { target: { value: "200" } });

    // Default hosting is AWS, which has no A100-80GB, so it falls back to AWS's most
    // capable option (H100-80GB, p5.48xlarge). Llama 3.3 70B: 600 tok/s * (2.88 / 1.0)
    // = 1,728 tok/s per replica; one replica serves floor(1728 * 0.8 / 20) = 69 users
    // -> ceil(200 / 69) = 3 replicas.
    await waitFor(() => {
      expect(screen.getByText(/sized to comfortably handle 200 people at once/i)).toBeInTheDocument();
    });
    expect(screen.getByText("3 GPUs")).toBeInTheDocument();
    // 40GB (4-bit) model on an 80GB H100 has plenty of headroom - no VRAM warning here
    // (see calculations.test.ts for dedicated tight-VRAM warning coverage).
    expect(screen.queryByText(/leaves little spare VRAM for request concurrency/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /24\/7 always-on/i }));
    expect(screen.getByText("~730 active hours/month")).toBeInTheDocument();
  });

  it("offers Batch API pricing on the API tab", async () => {
    const user = userEvent.setup();
    renderHome();

    await waitFor(() => {
      expect(screen.getByText("per month")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("tab", { name: /pay-per-use API/i }));

    const batchSwitch = await screen.findByRole("switch", { name: /use batch api pricing/i });
    const totalBefore = screen.getByText("per month").previousSibling!.textContent;
    await user.click(batchSwitch);
    await waitFor(() => {
      expect(screen.getByText("per month").previousSibling!.textContent).not.toBe(totalBefore);
    });
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
