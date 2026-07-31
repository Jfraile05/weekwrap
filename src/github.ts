export type Activity = {
  username: string;
  since: string;
  until: string;
  repos: string[];
  lines: string[];
};

type GhEvent = {
  type: string;
  created_at: string;
  repo: { name: string };
  payload: Record<string, any>;
};

type GhCommit = {
  commit: { message: string; author: { date: string } };
};

const UA = "weekwrap (AWS Builder Center weekend challenge)";
const MAX_REPOS = 6;

/**
 * Two-step gather. The public events feed says which repos were touched and
 * carries PR, issue and release activity, but it strips commit messages from
 * PushEvents, so commits are pulled per repo from the commits endpoint.
 */
export async function gather(username: string, days: number): Promise<Activity> {
  const until = new Date();
  const since = new Date(until.getTime() - days * 86400_000);

  const events = await gh<GhEvent[]>(`/users/${encodeURIComponent(username)}/events/public?per_page=100`);
  const recent = events.filter((e) => new Date(e.created_at) >= since);

  const lines: string[] = [];
  const repos = new Set<string>();

  for (const e of recent) {
    repos.add(e.repo.name);
    const line = describe(e);
    if (line) lines.push(`${e.created_at.slice(0, 10)} ${e.repo.name}: ${line}`);
  }

  const repoList = [...repos].slice(0, MAX_REPOS);
  const commitSets = await Promise.all(
    repoList.map((repo) => commitsFor(repo, username, since.toISOString())),
  );
  for (const set of commitSets) lines.push(...set);

  lines.sort();

  return { username, since: since.toISOString(), until: until.toISOString(), repos: [...repos], lines };
}

async function commitsFor(repo: string, username: string, sinceIso: string): Promise<string[]> {
  try {
    const commits = await gh<GhCommit[]>(
      `/repos/${repo}/commits?author=${encodeURIComponent(username)}&since=${sinceIso}&per_page=50`,
    );
    return commits.map(
      (c) => `${c.commit.author.date.slice(0, 10)} ${repo}: commit - ${c.commit.message.split("\n")[0]}`,
    );
  } catch {
    // A repo can be empty, renamed or made private between the two calls. The
    // event feed already recorded that something happened there, so skip it.
    return [];
  }
}

async function gh<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { "User-Agent": UA, Accept: "application/vnd.github+json" },
  });
  if (res.status === 404) throw new Error(`GitHub returned 404 for ${path.split("?")[0]}.`);
  if (res.status === 403 || res.status === 429) throw new Error("GitHub rate limit hit. Try again in a few minutes.");
  if (!res.ok) throw new Error(`GitHub returned ${res.status}.`);
  return (await res.json()) as T;
}

function describe(e: GhEvent): string | null {
  switch (e.type) {
    case "PullRequestEvent":
      return `${e.payload.action} PR #${e.payload.number}: ${e.payload.pull_request?.title ?? ""}`;
    case "IssuesEvent":
      return `${e.payload.action} issue #${e.payload.issue?.number}: ${e.payload.issue?.title ?? ""}`;
    case "IssueCommentEvent":
      return `commented on #${e.payload.issue?.number}: ${e.payload.issue?.title ?? ""}`;
    case "ReleaseEvent":
      return `released ${e.payload.release?.tag_name ?? ""}`;
    case "CreateEvent":
      return `created ${e.payload.ref_type}${e.payload.ref ? ` ${e.payload.ref}` : ""}`;
    default:
      return null;
  }
}
