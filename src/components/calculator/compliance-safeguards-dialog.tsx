"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  ShieldCheck,
  Filter,
  EyeOff,
  FileLock2,
  Activity,
  Globe2,
  type LucideIcon,
} from "lucide-react";

interface SafeguardSection {
  icon: LucideIcon;
  title: string;
  points: string[];
}

const SECTIONS: SafeguardSection[] = [
  {
    icon: Filter,
    title: "Traffic and tool control",
    points: [
      "A filtered proxy sits in front of every model call, controlling and monitoring LLM traffic, tool calling, and file access.",
      "Agents may only use explicitly authorized tools - strictly approved tool access, not an open-ended toolset.",
      "The LLM host itself has no direct internet access.",
    ],
  },
  {
    icon: EyeOff,
    title: "Decision and data safety",
    points: [
      "Decision-based filtering reviews important or high-risk decisions before they take effect.",
      "Sensitive data is masked before it reaches the model.",
    ],
  },
  {
    icon: FileLock2,
    title: "Model integrity and supply chain",
    points: [
      "Only the safe .safetensors model format is used - never pickle-based formats.",
      "Each model file is pinned by its cryptographic hash, so it cannot be silently replaced or modified.",
      "Model signatures are verified (OpenSSF Model Signing) and models are scanned before deployment.",
      "An AI-BOM (AI Bill of Materials) is maintained, listing every model, dependency, and component in use.",
    ],
  },
  {
    icon: Activity,
    title: "Observability and auditability",
    points: [
      "Self-hosted tracing and monitoring - LangSmith, Comet Opik, Langfuse, or equivalent - for full auditability of model behavior.",
    ],
  },
  {
    icon: ShieldCheck,
    title: "Model selection and jurisdiction",
    points: [
      "Supported model families include NVIDIA Nemotron, Llama, GPT-OSS, Mistral, and Gemma 4.",
      "Llama is excluded for EU deployments; GPT-OSS is the option already used by US defense.",
      "For US Government clients, models of Chinese origin are excluded for security and compliance reasons.",
    ],
  },
  {
    icon: Globe2,
    title: "Data residency",
    points: [
      "Data stays within the deployment region, and the model itself is hosted in that same region - nothing crosses the border to be processed.",
    ],
  },
];

export function ComplianceSafeguardsDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs">
          <ShieldCheck className="h-3.5 w-3.5" />
          Security &amp; compliance safeguards
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-3xl lg:max-w-6xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Security and compliance safeguards</DialogTitle>
          <DialogDescription>
            The baseline controls this deployment model is built around, for teams that need to
            answer a security or procurement review before adopting AI.
          </DialogDescription>
        </DialogHeader>

        {/* Only this body scrolls, so the header and the close button (an
            absolutely-positioned child of DialogContent) stay put instead of
            scrolling out of view on short mobile viewports. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {SECTIONS.map((section) => (
              <div key={section.title} className="rounded-lg border p-4 space-y-2">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <section.icon className="h-4 w-4" />
                  </div>
                  <h3 className="text-sm font-semibold">{section.title}</h3>
                </div>
                <ul className="space-y-1.5">
                  {section.points.map((point) => (
                    <li key={point} className="text-sm text-muted-foreground leading-snug">
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
