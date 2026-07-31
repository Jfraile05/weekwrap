# Weekend Challenge: Turn One Annoying Task Into an App: WeekWrap

**Tags:** apps, productivity, aws-free-tier, challenge

**Live app:** https://wvbubfuvrik4kphcey4uskxvru0eypfj.lambda-url.us-east-1.on.aws/
**Source:** https://github.com/Jfraile05/weekwrap

## Vision and what the app does

Every Friday I have to answer the same question: what did you get done this week? I am a solo developer, so the audience changes (a client, a collaborator, my own notes), but the chore does not. I sit down, scroll back through my commits, try to remember which of them mattered, and translate a pile of messages like "fix build" and "wip" into something a human wants to read. It takes twenty minutes and it produces nothing new. My repositories already contain the answer. I am just the one doing the transcription.

WeekWrap does the transcription. You open the app, type a GitHub username, pick a window (7, 14 or 30 days), and press one button. It reads that person's public GitHub activity for the window, groups the raw commits into outcomes, and gives you back a markdown update with three sections: Shipped, In progress, and Next week. You copy it and you are done.

From the user's side that is the whole product. One input, one button, one output you can paste into Slack or an email. The Next week section is explicitly labelled as a suggestion, because it is inferred from unfinished threads in the activity rather than from anything I actually promised.

There is a second way in. The app also runs itself. An Amazon EventBridge rule fires every Friday at 21:00 UTC, invokes the same Lambda with a scheduled payload instead of an HTTP request, drafts the update for a configured username, and stores it. So the update exists before I remember I need it.

## How I built it

I started with the assumption that the GitHub public events feed had everything I needed. One unauthenticated call to `/users/{user}/events/public` returns up to 100 recent events, including PushEvents, and the documented payload for a PushEvent includes a `commits` array. I wrote the gather step around that, deployed nothing yet, ran it locally against my own username, and got back an honest but useless result: zero events, nothing to report.

That was the interesting bug of the weekend. The filter was fine and the request returned 200. When I dumped the raw payloads I found that in this particular feed the PushEvent payloads carry `push_id`, `ref`, `head` and `before`, and no `commits` array at all. The most important event type was contributing nothing, and because my formatter returned null for events it could not describe, the failure was silent rather than loud.

The fix turned gathering into two passes. The events feed is still the entry point, because it is the only cheap way to learn which repositories were touched and it carries pull request, issue and release activity. Then, for each repository in the window, WeekWrap calls `/repos/{owner}/{repo}/commits?author=&since=` to get the real commit messages. That is roughly one to seven unauthenticated requests per draft, comfortably inside GitHub's 60 per hour limit, and it means there are still no GitHub tokens anywhere in the system.

The other decisions were about staying small. I did not want an API Gateway, a static site bucket and a CloudFront distribution for what is one page and one endpoint. So a single Lambda behind a Function URL serves both: a GET on `/` returns the HTML, a POST on `/api/draft` does the work. The UI is one inlined HTML string with no build step and no framework. Nothing to keep in sync, one URL to share.

For the model I used Amazon Bedrock with Nova Lite through the Converse API. The prompt is strict on purpose: three fixed sections, group related commits into outcomes, never list raw commit messages one by one, one sentence per bullet, no hype, and say so honestly when the week was thin. A weekly update that pads three commits into a paragraph of achievement language is worse than no update.

Every draft is written to DynamoDB with the username as the partition key, the timestamp as the sort key, a record of whether it came from the web or the schedule, and a 90 day TTL so the table cleans up after itself.

## AWS services used and architecture overview

```
Browser ──POST /api/draft──┐
                           │
EventBridge (Fri 21:00 UTC)┤──► AWS Lambda (Node 22, arm64, Function URL)
                           │      1. gather()  GitHub public API, two passes
                           │      2. draft()   Amazon Bedrock, Nova Lite
                           │      3. save()    Amazon DynamoDB, 90 day TTL
                           │
                           └──► markdown update returned to the browser
```

- **AWS Lambda with a Function URL**: runs the whole app and serves the UI at a public HTTPS URL. No API Gateway.
- **Amazon Bedrock (Nova Lite)**: turns raw commits into a readable update, via one Converse call.
- **Amazon DynamoDB**: stores every wrap, on demand or scheduled, with TTL cleanup.
- **Amazon EventBridge**: the weekly trigger, a scheduled rule that invokes the Lambda with `{"scheduled": true}`.
- **AWS SAM and AWS CloudFormation**: the whole stack is one `template.yaml`, deployed with `sam build && sam deploy`.
- **Amazon CloudWatch Logs**: where the scheduled runs print their output.

The Lambda distinguishes the two triggers by looking for `requestContext.http` on the event. If it is there, the invocation is an HTTP request and gets routed. If it is not, it is the scheduled run and it drafts for the configured default username.

Costs sit inside the free tier: 1M free Lambda requests per month against a handful of runs, no charge for scheduled EventBridge rules, 25 GB of free DynamoDB storage against records of a few kilobytes, and about 1,500 input tokens per Bedrock draft.

## What I learned

Three things stuck.

First, verify the shape of an API response before you build on it. I lost time to a documented field that was simply not present in that feed, and my own code hid the problem by skipping events it could not describe. Now the gather step is explicit about where each line came from.

Second, a Lambda Function URL is an underrated way to ship a small app. For a one page tool, the combination of API Gateway plus S3 plus CloudFront is three services of ceremony around one function. One Lambda, one URL, one CloudFormation stack, and the thing is on the internet.

Third, the prompt is product design. My first version produced upbeat filler for a quiet week. Adding one rule, be honest when the activity is thin, made the output something I would actually send to a client.

## Link to app and repo

- Live app: https://wvbubfuvrik4kphcey4uskxvru0eypfj.lambda-url.us-east-1.on.aws/
- Public repo: https://github.com/Jfraile05/weekwrap

Try it with any GitHub username, including mine (`Jfraile05`). It reads only public activity.
