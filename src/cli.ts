import { gather } from "./github.js";
import { draft } from "./draft.js";

const username = process.argv[2];
const days = Number(process.argv[3] ?? 7);

if (!username) {
  console.error("usage: npm run local -- <github-username> [days]");
  process.exit(1);
}

const activity = await gather(username, days);
console.error(`${activity.lines.length} events across ${activity.repos.length} repo(s)`);
console.log(await draft(activity));
