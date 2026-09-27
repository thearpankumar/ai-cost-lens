// Lookup maps from a commercial model's `provider` (or an open-source model's
// `family`) to the public path of that company's/brand's logo, used to render
// a small identifying icon on the model catalog cards.
import type { Provider } from "@/lib/types";

/** Commercial API provider -> logo path, keyed against the real `Provider` union
 * so TypeScript catches any missing/renamed entries. */
export const providerLogos: Record<Provider, string> = {
  Anthropic: "/logos/anthropic.svg",
  OpenAI: "/logos/openai.svg",
  Google: "/logos/google.svg",
  Amazon: "/logos/amazon.svg",
  Mistral: "/logos/mistral.svg",
  xAI: "/logos/xai.svg",
  Cohere: "/logos/cohere.svg",
};

/** Open-source model `family` -> logo path. `family` is a freeform string in
 * the data, so this is a plain lookup (not exhaustively typed) - fall back to
 * no logo for any family not listed here. */
export const familyLogos: Record<string, string> = {
  "Meta Llama": "/logos/meta.svg",
  Mistral: "/logos/mistral.svg",
  "Alibaba Qwen": "/logos/qwen.svg",
  DeepSeek: "/logos/deepseek.svg",
  "Google Gemma": "/logos/google.svg",
  "Microsoft Phi": "/logos/microsoft.svg",
  "OpenAI GPT-OSS": "/logos/openai.svg",
  "NVIDIA Nemotron": "/logos/nvidia.svg",
};
