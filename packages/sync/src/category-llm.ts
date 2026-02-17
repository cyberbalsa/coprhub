import OpenAI from "openai";

import { CATEGORIES } from "./category-mapping.js";

export const VALID_SLUGS = CATEGORIES.map((c) => c.slug);

const SYSTEM_PROMPT = `You are a Linux package classifier. Given a COPR package's metadata, classify it into exactly ONE category. Respond with JSON matching this schema: {"category": "<slug>", "confidence": "high"|"medium"|"low"}

Categories:
${CATEGORIES.map((c) => `- ${c.slug}: ${c.name}`).join("\n")}`;

interface ClassificationInput {
  name: string;
  description: string | null;
  upstreamLanguage: string | null;
  upstreamTopics: string[] | null;
  homepage: string | null;
}

export interface ClassificationResult {
  category: string;
  confidence: "high" | "medium" | "low";
}

export function buildClassificationPrompt(input: ClassificationInput): string {
  const lines = [`Name: ${input.name}`];
  if (input.description) lines.push(`Description: ${input.description}`);
  if (input.upstreamLanguage)
    lines.push(`Language: ${input.upstreamLanguage}`);
  if (input.upstreamTopics?.length)
    lines.push(`Topics: ${input.upstreamTopics.join(", ")}`);
  if (input.homepage) lines.push(`Homepage: ${input.homepage}`);
  return lines.join("\n");
}

export function createLlmClassifier(
  apiUrl: string,
  apiKey: string,
  model: string,
): { classify: (input: ClassificationInput) => Promise<ClassificationResult> } {
  const client = new OpenAI({
    baseURL: apiUrl.replace(/\/chat\/completions$/, ""),
    apiKey,
  });

  let rateLimitRemaining = Infinity;
  let rateLimitResetMs = 0;

  async function classify(
    input: ClassificationInput,
  ): Promise<ClassificationResult> {
    if (rateLimitRemaining < 100) {
      const waitMs = Math.max(0, rateLimitResetMs - Date.now());
      if (waitMs > 0) {
        console.log(`Rate limited, waiting ${(waitMs / 1000).toFixed(1)}s...`);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildClassificationPrompt(input) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "classification",
          schema: {
            type: "object",
            properties: {
              category: { type: "string", enum: VALID_SLUGS },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
            },
            required: ["category", "confidence"],
          },
        },
      },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("No content in LLM response");

    const parsed: ClassificationResult = JSON.parse(content);

    if (!VALID_SLUGS.includes(parsed.category)) {
      parsed.category = "utilities";
      parsed.confidence = "low";
    }

    return parsed;
  }

  return { classify };
}
