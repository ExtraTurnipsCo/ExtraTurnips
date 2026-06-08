const yaml = require('js-yaml');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const NETLIFY_TOKEN = process.env.NETLIFY_ACCESS_TOKEN;
const NETLIFY_SITE_ID = '6e3a0085-c939-4ec4-83ea-2120851e940e';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const REPO = 'ExtraTurnipsCo/ExtraTurnips';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

function checkAuth(event) {
  const auth = (event.headers['authorization'] || '').replace('Bearer ', '');
  return auth === ADMIN_PASSWORD;
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function currentDate() {
  return new Date().toLocaleDateString('en-CA', { month: 'short', year: 'numeric' });
}

async function githubCreateFile(path, content, message) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'ExtraTurnips-Admin'
    },
    body: JSON.stringify({
      message,
      content: Buffer.from(content).toString('base64'),
      branch: 'main'
    })
  });
  if (!res.ok) throw new Error(`GitHub error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getSubmissions() {
  const res = await fetch(
    `https://api.netlify.com/api/v1/sites/${NETLIFY_SITE_ID}/submissions?form_name=community-rating&per_page=100`,
    { headers: { 'Authorization': `Bearer ${NETLIFY_TOKEN}` } }
  );
  if (!res.ok) throw new Error(`Netlify Forms error ${res.status}`);
  return res.json();
}

async function deleteSubmission(id) {
  const res = await fetch(`https://api.netlify.com/api/v1/submissions/${id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${NETLIFY_TOKEN}` }
  });
  if (!res.ok) throw new Error(`Delete error ${res.status}`);
}

function buildRatingMarkdown(data) {
  const fm = {
    name: data.name,
    location: data.location,
    date: data.date || currentDate(),
    type: data.type || 'chicken',
    note: data.note,
    taste: parseFloat(data.taste),
    value: parseFloat(data.value),
    experience: parseFloat(data.experience)
  };
  if (data.submitter) fm.submitter = data.submitter;
  if (data.photo_url) fm.photo_url = data.photo_url;
  if (data.tags && String(data.tags).trim()) {
    fm.tags = String(data.tags).split(',').map(t => t.trim()).filter(Boolean);
  }
  return `---\n${yaml.dump(fm)}---\n`;
}

function buildPostMarkdown(data) {
  const fm = {
    title: data.title,
    date: data.date || currentDate(),
    read: data.read || '3 min read',
    tag: data.tag || 'general',
    preamble: data.preamble
  };
  return `---\n${yaml.dump(fm)}---\n${data.post || ''}\n`;
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  if (!checkAuth(event)) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    if (event.httpMethod === 'GET') {
      const submissions = await getSubmissions();
      return { statusCode: 200, headers: CORS, body: JSON.stringify(submissions) };
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');

      if (body.action === 'create-rating') {
        const md = buildRatingMarkdown(body);
        const file = `${slugify(body.name)}-${Date.now()}.md`;
        await githubCreateFile(`content/ratings/${file}`, md, `Add rating: ${body.name}`);
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
      }

      if (body.action === 'approve') {
        const md = buildRatingMarkdown(body);
        const file = `${slugify(body.name)}-${Date.now()}.md`;
        await githubCreateFile(`content/ratings/${file}`, md, `Approve community rating: ${body.name}`);
        if (body.submissionId) await deleteSubmission(body.submissionId);
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
      }

      if (body.action === 'reject') {
        if (body.submissionId) await deleteSubmission(body.submissionId);
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
      }

      if (body.action === 'create-post') {
        const md = buildPostMarkdown(body);
        const file = `${slugify(body.title)}-${Date.now()}.md`;
        await githubCreateFile(`content/posts/${file}`, md, `Add post: ${body.title}`);
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
      }
    }

    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid request' }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
