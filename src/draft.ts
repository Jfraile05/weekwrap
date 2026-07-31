import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import type { Activity } from "./github.js";

const client = new BedrockRuntimeClient({});
const MODEL_ID = process.env.MODEL_ID ?? "us.amazon.nova-lite-v1:0";

const SYSTEM = `You write weekly engineering updates. You are given raw GitHub activity for one person.

Rules:
- Output plain markdown with exactly three sections: "## Shipped", "## In progress", "## Next week".
- Group related commits into outcomes. Never list raw commit messages one by one.
- Each bullet is one sentence, plain language, no hype, no emoji.
- Name the repository the work happened in.
- "Next week" is at most three bullets, inferred from unfinished threads in the activity. Mark it as a suggestion.
- If the activity is thin, say so honestly instead of padding.
- Never use em dashes or en dashes.`;

export async function draft(activity: Activity): Promise<string> {
  if (activity.lines.length === 0) {
    return `## Shipped\n\nNo public GitHub activity for ${activity.username} in this window.\n\n## In progress\n\nNothing to report.\n\n## Next week\n\nSuggestion: nothing to infer without activity.`;
  }

  const days = Math.round((Date.parse(activity.until) - Date.parse(activity.since)) / 86400_000);
  const prompt = [
    `Person: ${activity.username}`,
    `Window: last ${days} days (${activity.since.slice(0, 10)} to ${activity.until.slice(0, 10)})`,
    `Repositories touched: ${activity.repos.join(", ")}`,
    "",
    "Raw activity:",
    ...activity.lines,
  ].join("\n");

  const out = await client.send(
    new ConverseCommand({
      modelId: MODEL_ID,
      system: [{ text: SYSTEM }],
      messages: [{ role: "user", content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: 900, temperature: 0.2 },
    }),
  );

  const text = out.output?.message?.content?.[0]?.text;
  if (!text) throw new Error("Bedrock returned an empty response.");
  return text.trim();
}
