import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { HostingSelector, type SelfHostConfig } from "@/components/calculator/hosting-selector";
import { GPU_INSTANCES } from "@/lib/data/gpu-instances";
import { OPEN_SOURCE_MODELS } from "@/lib/data/opensource-models";
import { TooltipProvider } from "@/components/ui/tooltip";

function Harness({ initial }: { initial: SelfHostConfig }) {
  const [config, setConfig] = useState(initial);
  return (
    <TooltipProvider>
      <HostingSelector config={config} onChange={setConfig} model={OPEN_SOURCE_MODELS[0]} />
      <div data-testid="gpu-instance-id">{config.gpuInstanceId}</div>
    </TooltipProvider>
  );
}

describe("HostingSelector - cloud switch GPU preservation (regression)", () => {
  it("keeps the same GPU type when switching cloud provider, instead of silently changing hardware", async () => {
    const user = userEvent.setup();
    const startInstance = GPU_INSTANCES.find((i) => i.id === "aws-p5-48xlarge")!; // AWS H100-80GB
    render(
      <Harness
        initial={{
          location: "cloud",
          cloudProvider: "AWS",
          gpuInstanceId: startInstance.id,
          useReservedPricing: false,
          ownedGpuType: "H100-80GB",
          hoursPerDay: 24,
          depreciationYears: 3,
          opsOverheadPct: 0.25,
        }}
      />,
    );

    await user.click(screen.getByRole("radio", { name: "Azure" }));

    const resultingId = screen.getByTestId("gpu-instance-id").textContent;
    const resultingInstance = GPU_INSTANCES.find((i) => i.id === resultingId);

    expect(resultingInstance?.cloud).toBe("Azure");
    // Must preserve H100-80GB, not fall back to Azure's first-listed GPU type (A100-80GB)
    expect(resultingInstance?.gpuType).toBe("H100-80GB");
  });

  it("falls back to the first available instance when the current GPU type doesn't exist on the new cloud", async () => {
    const user = userEvent.setup();
    // AWS's L4 instance has no Azure equivalent in the catalog
    const startInstance = GPU_INSTANCES.find((i) => i.id === "aws-g6-xlarge")!; // AWS L4
    render(
      <Harness
        initial={{
          location: "cloud",
          cloudProvider: "AWS",
          gpuInstanceId: startInstance.id,
          useReservedPricing: false,
          ownedGpuType: "L4",
          hoursPerDay: 24,
          depreciationYears: 3,
          opsOverheadPct: 0.25,
        }}
      />,
    );

    await user.click(screen.getByRole("radio", { name: "Azure" }));

    const resultingId = screen.getByTestId("gpu-instance-id").textContent;
    const resultingInstance = GPU_INSTANCES.find((i) => i.id === resultingId);

    expect(resultingInstance?.cloud).toBe("Azure");
    expect(resultingInstance).toBeDefined();
  });
});
