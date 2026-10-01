import { gather } from "./github.js";
import { draft } from "./draft.js";
import { save, history } from "./store.js";
import { PAGE } from "./page.js";
import { userIdFrom } from "./auth.js";

type FunctionUrlEvent = {
  requestContext?: { http?: { method: string; path: string } };
  rawQueryString?: string;
  headers?: Record<string, string | undefined>;
  body?: string;
};

type ScheduledEvent = { scheduled?: true; username?: string; days?: number };

export async function handler(event: FunctionUrlEvent & ScheduledEvent) {
  if (!event.requestContext?.http) return runScheduled(event);

  const { method, path } = event.requestContext.http;

  if (method === "GET" && (path === "/" || path === "")) {
    return { statusCode: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: PAGE };
  }

  if (path.startsWith("/api/")) {
    const userId = await userIdFrom(event.headers?.authorization);
    if (!userId) {
      return json(401, { error: "Sign in required." }, { "www-authenticate": "Bearer" });
    }
  }

  if (method === "POST" && path === "/api/draft") {
    try {
      const { username, days } = JSON.parse(event.body ?? "{}");
      if (typeof username !== "string" || !/^[A-Za-z0-9-]{1,39}$/.test(username)) {
        return json(400, { error: "Enter a valid GitHub username." });
      }
      const window = [7, 14, 30].includes(days) ? days : 7;
      const wrap = await generate(username, window, "web");
      return json(200, wrap);
    } catch (err) {
      return json(502, { error: (err as Error).message });
    }
  }

  if (method === "GET" && path === "/api/history") {
    const username = new URLSearchParams(event.rawQueryString ?? "").get("username");
    if (!username) return json(400, { error: "username query parameter is required." });
    return json(200, { items: await history(username) });
  }

  return json(404, { error: "Not found." });
}

async function generate(username: string, days: number, trigger: "web" | "schedule") {
  const activity = await gather(username, days);
  const markdown = await draft(activity);
  const wrap = {
    username: username.toLowerCase(),
    createdAt: new Date().toISOString(),
    markdown,
    eventCount: activity.lines.length,
    repos: activity.repos,
    trigger,
  };
  await save(wrap);
  return wrap;
}

async function runScheduled(event: ScheduledEvent) {
  const username = event.username ?? process.env.DEFAULT_USERNAME;
  if (!username) {
    console.log("No username configured for the scheduled run, skipping.");
    return { ok: false };
  }
  const wrap = await generate(username, event.days ?? 7, "schedule");
  console.log(`Weekly wrap stored for ${wrap.username}: ${wrap.eventCount} events, ${wrap.repos.length} repos.`);
  console.log(wrap.markdown);
  return { ok: true, username: wrap.username, eventCount: wrap.eventCount };
}

function json(statusCode: number, body: unknown, headers: Record<string, string> = {}) {
  return { statusCode, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) };
}
