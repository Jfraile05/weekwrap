import { gather } from "./github.js";
import { draft } from "./draft.js";
import { save, history, getProfile, putProfile } from "./store.js";
import { renderPage } from "./page.js";
import { userIdFrom } from "./auth.js";

type FunctionUrlEvent = {
  requestContext?: { http?: { method: string; path: string } };
  rawQueryString?: string;
  headers?: Record<string, string | undefined>;
  body?: string;
};

const GITHUB_USERNAME = /^[A-Za-z0-9-]{1,39}$/;

type ScheduledEvent = { scheduled?: true; username?: string; days?: number };

export async function handler(event: FunctionUrlEvent & ScheduledEvent) {
  if (!event.requestContext?.http) return runScheduled(event);

  const { method, path } = event.requestContext.http;

  if (method === "GET" && (path === "/" || path === "")) {
    const { html, csp } = renderPage({ authBase: process.env.COGNITO_URL!, clientId: process.env.USER_POOL_CLIENT_ID! });
    return {
      statusCode: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": csp,
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      },
      body: html,
    };
  }

  let userId = "";
  if (path.startsWith("/api/")) {
    const verified = await userIdFrom(event.headers?.authorization);
    if (!verified) {
      return json(401, { error: "Sign in required." }, { "www-authenticate": "Bearer" });
    }
    userId = verified;
  }

  if (method === "GET" && path === "/api/profile") {
    return json(200, { profile: await getProfile(userId) });
  }

  if (method === "PUT" && path === "/api/profile") {
    let githubUsername: unknown;
    try {
      githubUsername = JSON.parse(event.body ?? "{}").githubUsername;
    } catch {
      return json(400, { error: "Body must be JSON." });
    }
    if (typeof githubUsername !== "string" || !GITHUB_USERNAME.test(githubUsername)) {
      return json(400, { error: "Enter a valid GitHub username." });
    }
    return json(200, { profile: await putProfile(userId, githubUsername) });
  }

  if (method === "POST" && path === "/api/draft") {
    try {
      const { days } = JSON.parse(event.body ?? "{}");
      const profile = await getProfile(userId);
      if (!profile) return json(409, { error: "Link your GitHub username in settings first." });
      const window = [7, 14, 30].includes(days) ? days : 7;
      const wrap = await generate(profile.githubUsername, window, "web", userId);
      return json(200, wrap);
    } catch (err) {
      return json(502, { error: (err as Error).message });
    }
  }

  if (method === "GET" && path === "/api/history") {
    return json(200, { items: await history(userId) });
  }

  return json(404, { error: "Not found." });
}

async function generate(username: string, days: number, trigger: "web" | "schedule", userId?: string) {
  const activity = await gather(username, days);
  const markdown = await draft(activity);
  const wrap = {
    username: username.toLowerCase(),
    createdAt: new Date().toISOString(),
    markdown,
    eventCount: activity.lines.length,
    repos: activity.repos,
    trigger,
    ...(userId ? { userId } : {}),
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
