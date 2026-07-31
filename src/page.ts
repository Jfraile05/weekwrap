export const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WeekWrap</title>
<style>
  :root { color-scheme: light dark; --bg:#0f1115; --card:#171a21; --fg:#e8eaed; --mut:#9aa4b2; --acc:#ff9900; --line:#252a34; }
  @media (prefers-color-scheme: light) { :root { --bg:#f6f7f9; --card:#fff; --fg:#12151a; --mut:#5b6572; --line:#e3e6eb; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 40px 20px 80px; }
  h1 { font-size: 28px; margin: 0 0 6px; }
  h1 span { color: var(--acc); }
  .sub { color: var(--mut); margin: 0 0 28px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 20px; }
  label { display:block; font-size: 13px; color: var(--mut); margin-bottom: 6px; }
  .row { display: flex; gap: 12px; flex-wrap: wrap; }
  .row > div:first-child { flex: 1 1 260px; }
  input, select { width:100%; padding: 11px 12px; border-radius: 8px; border:1px solid var(--line); background: var(--bg); color: var(--fg); font-size: 15px; }
  button { margin-top: 16px; width: 100%; padding: 12px; border:0; border-radius: 8px; background: var(--acc); color:#111; font-weight:600; font-size:15px; cursor:pointer; }
  button[disabled] { opacity:.6; cursor: wait; }
  .out { margin-top: 24px; display:none; }
  .out.on { display:block; }
  .meta { color: var(--mut); font-size: 13px; margin-bottom: 10px; }
  pre { white-space: pre-wrap; word-wrap: break-word; background: var(--card); border:1px solid var(--line); border-radius:12px; padding:20px; margin:0; font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace; overflow-x:auto; }
  .copy { margin-top:10px; background: transparent; color: var(--fg); border:1px solid var(--line); }
  .err { color:#ff6b6b; margin-top:16px; }
  footer { color: var(--mut); font-size: 13px; margin-top: 36px; text-align:center; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Week<span>Wrap</span></h1>
  <p class="sub">Writing the weekly update is the chore. Your commits already say what you did. Type a GitHub username and get the update, drafted.</p>

  <div class="card">
    <div class="row">
      <div>
        <label for="u">GitHub username</label>
        <input id="u" placeholder="Jfraile05" autocomplete="off">
      </div>
      <div>
        <label for="d">Window</label>
        <select id="d">
          <option value="7" selected>Last 7 days</option>
          <option value="14">Last 14 days</option>
          <option value="30">Last 30 days</option>
        </select>
      </div>
    </div>
    <button id="go">Draft my update</button>
    <div id="err" class="err"></div>
  </div>

  <div id="out" class="out">
    <div class="meta" id="meta"></div>
    <pre id="md"></pre>
    <button class="copy" id="copy">Copy markdown</button>
  </div>

  <footer>Runs on AWS Lambda, Amazon Bedrock (Nova Lite) and DynamoDB. Also drafts itself every Friday on an EventBridge schedule.</footer>
</div>
<script>
const $ = (id) => document.getElementById(id);
async function run() {
  const username = $('u').value.trim();
  if (!username) { $('err').textContent = 'Enter a GitHub username.'; return; }
  $('err').textContent = ''; $('go').disabled = true; $('go').textContent = 'Reading your week...';
  try {
    const res = await fetch('/api/draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, days: Number($('d').value) })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    $('md').textContent = data.markdown;
    $('meta').textContent = data.eventCount + ' events across ' + data.repos.length + ' repo(s), summarized by Nova Lite';
    $('out').classList.add('on');
  } catch (e) {
    $('err').textContent = e.message;
  } finally {
    $('go').disabled = false; $('go').textContent = 'Draft my update';
  }
}
$('go').addEventListener('click', run);
$('u').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
$('copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('md').textContent);
  $('copy').textContent = 'Copied';
  setTimeout(() => $('copy').textContent = 'Copy markdown', 1500);
});
</script>
</body>
</html>`;
