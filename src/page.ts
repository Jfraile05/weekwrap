import { createHash } from "node:crypto";

// The whole front end is one framework-free bundle served by the same Lambda.
// STYLE and SCRIPT are plain strings (no backticks or dollar-brace inside) so
// their hashes can go in the Content-Security-Policy instead of 'unsafe-inline'.
const STYLE = `
  :root { color-scheme: light dark; --bg:#0f1115; --card:#171a21; --fg:#e8eaed; --mut:#9aa4b2; --acc:#ff9900; --line:#252a34; }
  @media (prefers-color-scheme: light) { :root { --bg:#f6f7f9; --card:#fff; --fg:#12151a; --mut:#5b6572; --line:#e3e6eb; } }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 24px 20px 80px; }
  .top { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:32px; }
  .brand { font-size: 22px; font-weight: 700; margin: 0; }
  .brand span { color: var(--acc); }
  .nav { display:flex; align-items:center; gap:16px; flex-wrap:wrap; font-size:14px; }
  .nav a { color: var(--mut); text-decoration:none; padding:4px 0; border-bottom:2px solid transparent; }
  .nav a.on { color: var(--fg); border-bottom-color: var(--acc); }
  .nav .who { color: var(--mut); }
  h1 { font-size: 28px; margin: 0 0 6px; }
  h2 { font-size: 18px; margin: 32px 0 12px; }
  .sub { color: var(--mut); margin: 0 0 28px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 20px; }
  label { display:block; font-size: 13px; color: var(--mut); margin-bottom: 6px; }
  .row { display: flex; gap: 12px; flex-wrap: wrap; align-items:flex-end; }
  .row > div:first-child { flex: 1 1 260px; }
  input, select { width:100%; padding: 11px 12px; border-radius: 8px; border:1px solid var(--line); background: var(--bg); color: var(--fg); font-size: 15px; }
  button { margin-top: 16px; width: 100%; padding: 12px; border:0; border-radius: 8px; background: var(--acc); color:#111; font-weight:600; font-size:15px; cursor:pointer; }
  button[disabled] { opacity:.6; cursor: wait; }
  button.secondary { background: transparent; color: var(--fg); border:1px solid var(--line); }
  button.link { width:auto; margin:0; padding:4px 0; background:none; color: var(--mut); border:0; font-weight:400; font-size:14px; }
  .meta { color: var(--mut); font-size: 13px; margin-bottom: 10px; }
  pre { white-space: pre-wrap; word-wrap: break-word; background: var(--card); border:1px solid var(--line); border-radius:12px; padding:20px; margin:0; font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace; overflow-x:auto; }
  .out { margin-top: 24px; }
  .err { color:#ff6b6b; margin-top:16px; }
  .ok { color:#3fb950; margin-top:16px; }
  .note { color: var(--mut); background: var(--card); border:1px solid var(--line); border-radius:12px; padding:12px 16px; margin: 0 0 20px; font-size:14px; }
  .item { background: var(--card); border:1px solid var(--line); border-radius:12px; padding:0 16px; margin-bottom:10px; }
  .item summary { cursor:pointer; padding:14px 0; display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .item summary .when { font-weight:600; }
  .item summary .what { color: var(--mut); font-size:13px; }
  .item pre { border:0; border-top:1px solid var(--line); border-radius:0; padding:16px 0; background:none; }
  .item button { margin: 0 0 16px; width:auto; padding:8px 14px; }
  footer { color: var(--mut); font-size: 13px; margin-top: 36px; text-align:center; }
`;

const SCRIPT = `
const $ = (id) => document.getElementById(id);
const CFG = JSON.parse($('cfg').textContent);
const REDIRECT = location.origin + '/';
const SESSION_KEY = 'weekwrap.session';
const PKCE_KEY = 'weekwrap.pkce';

function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; }
}
let session = loadSession();
let notice = '';
let signInError = '';
let renderId = 0;
let refreshing = null;

function persist() {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch (e) {}
}

function el(tag, attrs, kids) {
  const n = document.createElement(tag);
  Object.keys(attrs || {}).forEach((k) => {
    if (k === 'text') n.textContent = attrs[k];
    else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
    else n.setAttribute(k, attrs[k]);
  });
  (kids || []).forEach((c) => { if (c) n.appendChild(c); });
  return n;
}

function when(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

async function copy(btn, text) {
  try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; } catch (e) { btn.textContent = 'Copy failed'; }
  setTimeout(() => { btn.textContent = 'Copy markdown'; }, 1500);
}

// ---- Cognito hosted UI, authorization code flow with PKCE ----

function b64url(bytes) {
  return btoa(String.fromCharCode.apply(null, new Uint8Array(bytes))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
}
function randomString(n) { return b64url(crypto.getRandomValues(new Uint8Array(n))); }

async function signIn() {
  const verifier = randomString(48);
  const state = randomString(16);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier: verifier, state: state }));
  const q = new URLSearchParams({
    response_type: 'code', client_id: CFG.clientId, redirect_uri: REDIRECT, scope: 'openid email',
    state: state, code_challenge: challenge, code_challenge_method: 'S256'
  });
  location.assign(CFG.authBase + '/oauth2/authorize?' + q);
}

async function tokenRequest(params) {
  const res = await fetch(CFG.authBase + '/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.assign({ client_id: CFG.clientId }, params))
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || 'Sign-in failed.');
  return data;
}

function emailFrom(idToken) {
  try { return JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email || ''; } catch (e) { return ''; }
}

// Returns an error message, or '' when there was nothing to handle or it worked.
async function handleCallback() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return '';
  history.replaceState(null, '', REDIRECT);
  if (q.has('error')) return q.get('error_description') || q.get('error');
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(PKCE_KEY)); sessionStorage.removeItem(PKCE_KEY); } catch (e) {}
  if (!saved || saved.state !== q.get('state')) return 'Sign-in could not be verified. Try again.';
  try {
    const t = await tokenRequest({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: REDIRECT, code_verifier: saved.verifier });
    session = { access: t.access_token, refresh: t.refresh_token, exp: Date.now() + t.expires_in * 1000, email: emailFrom(t.id_token) };
    persist();
    return '';
  } catch (e) { return e.message; }
}

function refreshOnce() {
  if (!session || !session.refresh) return Promise.resolve(false);
  if (!refreshing) {
    const started = session;
    refreshing = tokenRequest({ grant_type: 'refresh_token', refresh_token: session.refresh })
      .then((t) => {
        // The user may have signed out, or the session may have been dropped, while this was in flight.
        if (session !== started) return false;
        session = Object.assign({}, session, { access: t.access_token, exp: Date.now() + t.expires_in * 1000 });
        persist();
        return true;
      })
      .catch(() => false)
      .then((ok) => { refreshing = null; return ok; });
  }
  return refreshing;
}

async function signOut() {
  const s = session;
  session = null;
  persist();
  if (s && s.refresh) {
    await fetch(CFG.authBase + '/oauth2/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: s.refresh, client_id: CFG.clientId })
    }).catch(() => {});
  }
  location.assign(CFG.authBase + '/logout?' + new URLSearchParams({ client_id: CFG.clientId, logout_uri: REDIRECT }));
}

function send(path, opts) {
  const headers = { authorization: 'Bearer ' + session.access };
  if (opts.body) headers['content-type'] = 'application/json';
  return fetch(path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
}

async function api(path, opts) {
  opts = opts || {};
  if (!session) throw new Error('Sign in required.');
  if (session.exp - Date.now() < 60000) await refreshOnce();
  let res = await send(path, opts);
  if (res.status === 401 && (await refreshOnce())) res = await send(path, opts);
  if (res.status === 401) {
    session = null;
    persist();
    notice = 'Your session ended. Sign in again.';
    route();
    throw new Error(notice);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

// ---- views ----

function header() {
  const onSettings = location.hash === '#/settings';
  const kids = [el('h1', { class: 'brand' }, [document.createTextNode('Week'), el('span', { text: 'Wrap' })])];
  if (session) {
    kids.push(el('nav', { class: 'nav' }, [
      el('a', { href: '#/', class: onSettings ? '' : 'on', text: 'Dashboard' }),
      el('a', { href: '#/settings', class: onSettings ? 'on' : '', text: 'Settings' }),
      session.email ? el('span', { class: 'who', text: session.email }) : null,
      el('button', { class: 'link', type: 'button', text: 'Sign out', onclick: signOut })
    ]));
  }
  return el('div', { class: 'top' }, kids);
}

function noticeBox() {
  if (!notice) return null;
  const n = el('p', { class: 'note', role: 'status', text: notice });
  notice = '';
  return n;
}

function signedOut(error) {
  const btn = el('button', { type: 'button', text: 'Sign in' });
  const err = el('div', { class: 'err', role: 'alert', text: error || '' });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try { await signIn(); } catch (e) { err.textContent = 'Sign-in is not available in this browser.'; btn.disabled = false; }
  });
  return [
    el('h1', { text: 'Your week, already written' }),
    el('p', { class: 'sub', text: 'Writing the weekly update is the chore. Your commits already say what you did. Sign in, link your GitHub username once, and get the update drafted.' }),
    noticeBox(),
    el('div', { class: 'card' }, [
      btn,
      err,
      el('p', { class: 'meta', text: 'Access is by invitation. If you need an account, ask whoever runs your cohort to add your email.' })
    ])
  ];
}

function historyItem(w) {
  const copyBtn = el('button', { class: 'secondary', type: 'button', text: 'Copy markdown' });
  copyBtn.addEventListener('click', () => copy(copyBtn, w.markdown));
  return el('details', { class: 'item' }, [
    el('summary', {}, [
      el('span', { class: 'when', text: when(w.createdAt) }),
      el('span', { class: 'what', text: w.eventCount + ' events, ' + w.repos.length + ' repo(s)' })
    ]),
    el('pre', { text: w.markdown }),
    copyBtn
  ]);
}

async function loadHistory(box) {
  try {
    const items = (await api('/api/history')).items;
    box.textContent = '';
    if (!items.length) box.appendChild(el('p', { class: 'meta', text: 'No drafts yet. Your first one will show up here.' }));
    items.forEach((w) => box.appendChild(historyItem(w)));
  } catch (e) { box.textContent = ''; box.appendChild(el('div', { class: 'err', role: 'alert', text: e.message })); }
}

async function dashboard(view, id) {
  const profile = (await api('/api/profile')).profile;
  if (id !== renderId) return;
  if (!profile) { notice = 'Link your GitHub username to get started.'; location.replace('#/settings'); return; }

  const days = el('select', { id: 'd' }, [
    el('option', { value: '7', text: 'Last 7 days', selected: 'selected' }),
    el('option', { value: '14', text: 'Last 14 days' }),
    el('option', { value: '30', text: 'Last 30 days' })
  ]);
  const go = el('button', { type: 'button', text: 'Draft my update' });
  const err = el('div', { class: 'err', role: 'alert' });
  const out = el('div', { class: 'out', hidden: 'hidden' });
  const list = el('div', {}, [el('p', { class: 'meta', text: 'Loading...' })]);

  go.addEventListener('click', async () => {
    err.textContent = '';
    go.disabled = true;
    go.textContent = 'Reading your week...';
    try {
      const w = await api('/api/draft', { method: 'POST', body: { days: Number(days.value) } });
      const copyBtn = el('button', { class: 'secondary', type: 'button', text: 'Copy markdown' });
      copyBtn.addEventListener('click', () => copy(copyBtn, w.markdown));
      out.textContent = '';
      out.appendChild(el('div', { class: 'meta', text: w.eventCount + ' events across ' + w.repos.length + ' repo(s), summarized by Nova Lite' }));
      out.appendChild(el('pre', { text: w.markdown }));
      out.appendChild(copyBtn);
      out.hidden = false;
      loadHistory(list);
    } catch (e) { err.textContent = e.message; }
    go.disabled = false;
    go.textContent = 'Draft my update';
  });

  view.replaceChildren(
    ...[noticeBox(),
      el('div', { class: 'card' }, [
        el('div', { class: 'row' }, [
          el('div', {}, [
            el('label', { text: 'GitHub account' }),
            el('p', { class: 'who', text: '@' + profile.githubUsername + ' (change in Settings)' })
          ]),
          el('div', {}, [el('label', { for: 'd', text: 'Window' }), days])
        ]),
        go, err
      ]),
      out,
      el('h2', { text: 'Past drafts' }),
      list
    ].filter(Boolean)
  );
  loadHistory(list);
}

async function settings(view, id) {
  const profile = (await api('/api/profile')).profile;
  if (id !== renderId) return;
  const input = el('input', { id: 'u', placeholder: 'octocat', autocomplete: 'off', maxlength: '39' });
  input.value = profile ? profile.githubUsername : '';
  const save = el('button', { type: 'button', text: 'Save' });
  const msg = el('div', { role: 'status' });

  async function submit() {
    msg.className = ''; msg.textContent = '';
    save.disabled = true;
    try {
      const saved = (await api('/api/profile', { method: 'PUT', body: { githubUsername: input.value.trim() } })).profile;
      if (!profile) { location.replace('#/'); return; }
      msg.className = 'ok';
      msg.textContent = 'Saved. Drafts will use @' + saved.githubUsername + '.';
    } catch (e) { msg.className = 'err'; msg.textContent = e.message; }
    save.disabled = false;
  }
  save.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  view.replaceChildren(
    ...[el('h1', { text: 'Settings' }),
      el('p', { class: 'sub', text: 'Link the GitHub account whose public activity WeekWrap should summarize. Only you can see your drafts.' }),
      noticeBox(),
      el('div', { class: 'card' }, [
        el('label', { for: 'u', text: 'GitHub username' }),
        input, save, msg,
        profile ? el('p', { class: 'meta', text: 'Linked since ' + when(profile.createdAt) }) : null
      ])
    ].filter(Boolean)
  );
  input.focus();
}

async function route() {
  const id = ++renderId;
  const view = $('view');
  $('top').replaceChildren(header());
  if (!session) { view.replaceChildren(...signedOut(signInError).filter(Boolean)); signInError = ''; return; }
  try {
    await (location.hash === '#/settings' ? settings : dashboard)(view, id);
  } catch (e) {
    if (id === renderId && session) view.replaceChildren(el('div', { class: 'err', role: 'alert', text: e.message }));
  }
}

window.addEventListener('hashchange', route);
// Coming back from the hosted UI with Back can restore this page from the browser cache, stale.
window.addEventListener('pageshow', (e) => { if (e.persisted) { session = loadSession(); route(); } });
handleCallback().then((error) => { signInError = error; route(); });
`;

const STYLE_HASH = createHash("sha256").update(STYLE).digest("base64");
const SCRIPT_HASH = createHash("sha256").update(SCRIPT).digest("base64");

export type PageConfig = { authBase: string; clientId: string };

export function renderPage(cfg: PageConfig) {
  // Keep "<" out of the JSON block so config values can never close the tag.
  const data = JSON.stringify(cfg).replace(/</g, "\\u003c");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WeekWrap</title>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
  <div id="top" class="top"></div>
  <main id="view"></main>
  <footer>Runs on AWS Lambda, Amazon Cognito, Amazon Bedrock (Nova Lite) and DynamoDB. Also drafts itself every Friday on an EventBridge schedule.</footer>
</div>
<script id="cfg" type="application/json">${data}</script>
<script>${SCRIPT}</script>
</body>
</html>`;
  const csp = [
    "default-src 'none'",
    `script-src 'sha256-${SCRIPT_HASH}'`,
    `style-src 'sha256-${STYLE_HASH}'`,
    `connect-src 'self' ${cfg.authBase}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  return { html, csp };
}
