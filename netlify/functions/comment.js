const yaml = require('js-yaml');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = 'ExtraTurnipsCo/ExtraTurnips';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function resolveBranch(event) {
  const headers = event.headers || {};
  if (headers['x-nf-deploy-context'] === 'branch-deploy') {
    const suffix = `--${process.env.SITE_NAME}.netlify.app`;
    const host = headers['host'] || '';
    if (host.endsWith(suffix)) return host.slice(0, -suffix.length);
  }
  return 'main';
}

async function githubPutFile(path, content, message, branch) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'ExtraTurnips-Comment'
    },
    body: JSON.stringify({
      message,
      content: Buffer.from(content).toString('base64'),
      branch
    })
  });
  if (!res.ok) throw new Error(`GitHub error ${res.status}: ${await res.text()}`);
  return res.json();
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  // Honeypot — bots that fill this in get a fake success with nothing written.
  if (body.botField) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
  }

  const postSlug = String(body.postSlug || '');
  const name = String(body.name || '').trim().slice(0, 80);
  const comment = String(body.comment || '').trim().slice(0, 2000);

  if (!/^[a-z0-9-]{1,80}$/.test(postSlug)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid post' }) };
  }
  if (!name || !comment) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Name and comment are required' }) };
  }

  const branch = resolveBranch(event);
  const date = new Date().toISOString();
  const md = `---\n${yaml.dump({ name, date })}---\n${comment}\n`;
  const file = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.md`;

  try {
    await githubPutFile(`content/comments/${postSlug}/${file}`, md, `Add comment on ${postSlug}`, branch);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, name, date, comment }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Could not save comment' }) };
  }
};
