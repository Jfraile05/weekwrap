# WeekWrap

Writing the weekly update is the chore. Your commits already say what you did.

WeekWrap reads a week of your public GitHub activity and drafts the update for
you: what shipped, what is in progress, what is probably next. Type a username,
get a markdown update you can paste into Slack, email or a status doc.

**Live app:** https://wvbubfuvrik4kphcey4uskxvru0eypfj.lambda-url.us-east-1.on.aws/

Built for the AWS Builder Center Weekend Challenge (Turn One Annoying Task Into an App).

## Architecture

```
Browser ──sign in──► Cognito hosted UI ──► access token (PKCE)
   │
   └─POST /api/draft, Bearer token─┐
                                   │
EventBridge (Fri 21:00 UTC)────────┤──►  AWS Lambda (Node 22, arm64)
                                   │       0. verify the Cognito token, get the user id
                                   │       1. gather()  GitHub public API
                                   │       2. draft()   Amazon Bedrock, Nova Lite
                                   │       3. save()    DynamoDB (90 day TTL)
                                   │
                                   └──►  markdown update back to the browser
```

One Lambda behind a Function URL serves both the page and the API, so there is
no API Gateway and no static hosting bucket to keep in sync.

| AWS service | Role |
|---|---|
| AWS Lambda + Function URL | Runs the app and serves the UI at a public HTTPS URL |
| Amazon Bedrock (Nova Lite) | Turns raw commits into a readable update |
| Amazon Cognito | Sign-in (hosted UI). Accounts are created by an admin, there is no self sign-up |
| Amazon DynamoDB | Stores every wrap (90 day TTL, indexed by user) and each person's linked GitHub username |
| Amazon EventBridge | Fires the weekly run every Friday without being asked |
| AWS CloudFormation / SAM | Defines and deploys the whole stack |
| Amazon CloudWatch Logs | Output of the scheduled runs |

## How the activity is gathered

The public events feed (`/users/{user}/events/public`) says which repos were
touched and carries PR, issue and release activity, but it strips commit
messages out of PushEvents. So WeekWrap makes a second pass: for each repo in
the window it calls `/repos/{repo}/commits?author=&since=` to get the real
commit messages. Everything is unauthenticated, so there are no GitHub tokens
to manage.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | The app (public page, no data) |
| GET | `/api/profile` | The signed-in user's profile, or `null` |
| PUT | `/api/profile` | `{"githubUsername":"..."}` links or changes the GitHub username |
| POST | `/api/draft` | `{"days":7\|14\|30}` drafts from the linked username and stores it |
| GET | `/api/history` | The signed-in user's last five stored wraps |

Every `/api/*` route needs `Authorization: Bearer <Cognito access token>` and
returns 401 without it. The user id always comes from the verified token, never
from the request. The Friday scheduled run writes wraps with no user id, so they
do not appear on anyone's dashboard.

## Local development

```bash
npm install
npm run typecheck
npx tsx src/cli.ts <github-username> [days]   # needs AWS creds for Bedrock
```

## Deploy

Requires the AWS SAM CLI, esbuild on PATH, and Bedrock model access for
`amazon.nova-lite-v1:0` in your region.

```bash
sam build
sam deploy --stack-name weekwrap --resolve-s3 --capabilities CAPABILITY_IAM \
  --parameter-overrides DefaultUsername=<your-github-username>
```

Cognito redirects back to the app after sign-in, and the app URL only exists
after the first deploy. So deploy twice: copy the `AppUrl` output (it ends with
a slash), then redeploy with `AppUrl=<that url>` added to `--parameter-overrides`.

Add people in the Cognito console (user pool `weekwrap`, Users, Create user).
They get a temporary password by email and set their own on first sign-in.

Stack parameters: `DefaultUsername` (used by the weekly run, empty disables it),
`ModelId`, `ScheduleExpression`, `AppUrl`.

## Free tier notes

- Lambda: 1M free requests/month. This uses a handful.
- DynamoDB on demand: 25 GB free storage, and a wrap is a few KB.
- EventBridge scheduled rules: no charge.
- Bedrock Nova Lite: about 1,500 input tokens per draft, fractions of a cent.

## Project layout

```
src/github.ts   gather(): events feed + per repo commits
src/draft.ts    draft():  the single Bedrock Converse call
src/auth.ts     verifies the Cognito access token, returns the user id
src/store.ts    DynamoDB: wraps (put, query by user) and profiles
src/page.ts     the UI: one framework-free bundle with a hash-based CSP
src/handler.ts  Lambda entry: routes Function URL requests and scheduled events
src/cli.ts      local runner
template.yaml   SAM infrastructure
```
