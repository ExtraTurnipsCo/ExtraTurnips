const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { geocodeAll } = require('./geocode');
const { summarizeAll } = require('./summarize');

const SITE_URL = 'https://extraturnips.com';

// Cloudflare Web Analytics beacon token (Web Analytics > your site > "token"
// in the JS snippet). Set it as a Netlify environment variable named
// CF_ANALYTICS_TOKEN (Site settings > Environment variables) so it isn't
// committed; the constant below is only a local fallback. While the token is
// unset/placeholder, no beacon is emitted. The beacon is injected into the SPA
// shell (public/index.html, via the __CF_BEACON__ placeholder) and into every
// generated permalink page (via pageShell), so all pages are counted.
const CF_ANALYTICS_TOKEN = process.env.CF_ANALYTICS_TOKEN || 'PASTE_CLOUDFLARE_TOKEN_HERE';
const cfBeacon = CF_ANALYTICS_TOKEN && CF_ANALYTICS_TOKEN !== 'PASTE_CLOUDFLARE_TOKEN_HERE'
  ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${CF_ANALYTICS_TOKEN}"}'></script>`
  : '';

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---([\s\S]*)$/);
  if (!match) return null;
  const data = yaml.load(match[1]);
  data._body = match[2].trim();
  return data;
}

function loadCollection(folder) {
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const data = parseFrontmatter(fs.readFileSync(path.join(folder, f), 'utf8'));
      if (data) data.slug = path.basename(f, '.md');
      return data;
    })
    .filter(Boolean);
}

function total(r) { return (r.taste || 0) + (r.value || 0) + (r.experience || 0); }

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

async function build() {

const allRatings = loadCollection('content/ratings');
const geoCache = await geocodeAll(allRatings);
allRatings.forEach(r => {
  const coords = r.location ? geoCache[r.location] : null;
  if (coords) { r.lat = coords.lat; r.lng = coords.lng; }
  r.comments = loadCollection(`content/comments/${r.slug}`)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
});
await summarizeAll(allRatings);
const adminRatings = allRatings.filter(r => !r.submitter);
const communityRatings = allRatings.filter(r => r.submitter);
const posts = loadCollection('content/posts');
posts.forEach(p => {
  p.comments = loadCollection(`content/comments/${p.slug}`)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
});

const template = fs.readFileSync('public/index.html', 'utf8');
const sharedStyle = (template.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];

const permalinkExtraCSS = `
  .permalink-nav { padding: 1.75rem 0 1.5rem; border-bottom: 1px solid var(--border); }
  .permalink-nav a { font-family: 'Lora', serif; font-size: 1.4rem; color: var(--text); text-decoration: none; }
  .permalink-back { display: inline-block; margin-top: 2rem; font-size: 0.8rem; color: var(--muted); text-decoration: none; }
  .permalink-back:hover { color: var(--text); }
`;

function formatCommentDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function commentsSectionHTML(p) {
  const comments = p.comments || [];
  const commentHTML = c => `
        <div class="comment">
          <div class="comment-head"><span class="comment-name">${esc(c.name)}</span><span class="comment-date">${esc(formatCommentDate(c.date))}</span></div>
          <p class="comment-body">${esc(c._body)}</p>
        </div>`;

  return `
      <div class="comments-section">
        <h2>Comments <span class="comments-count">(${comments.length})</span></h2>
        <div class="comments-list" id="commentsList">
          ${comments.map(commentHTML).join('')}
        </div>
        <p class="empty-state comments-empty" id="commentsEmpty" style="padding:0.6rem 0;${comments.length ? 'display:none;' : ''}">No comments yet. Be the first.</p>
        <form class="comment-form" id="commentForm">
          <div class="form-row">
            <label>Your Name</label>
            <input type="text" name="name" required maxlength="80" placeholder="e.g. Alex T." />
          </div>
          <div class="form-row">
            <label>Comment</label>
            <textarea name="comment" required maxlength="2000" placeholder="Say something..."></textarea>
          </div>
          <input type="text" name="botField" class="hp-field" tabindex="-1" autocomplete="off" />
          <button type="submit" class="form-submit">Post Comment</button>
        </form>
      </div>
      <script>
        (function () {
          var form = document.getElementById('commentForm');
          var list = document.getElementById('commentsList');
          var empty = document.getElementById('commentsEmpty');
          var countEl = document.querySelector('.comments-count');
          var postSlug = ${JSON.stringify(p.slug)};
          form.addEventListener('submit', async function (e) {
            e.preventDefault();
            var btn = form.querySelector('.form-submit');
            var fd = new FormData(form);
            if (fd.get('botField')) return;
            var name = String(fd.get('name') || '').trim();
            var comment = String(fd.get('comment') || '').trim();
            if (!name || !comment) return;
            btn.disabled = true; btn.textContent = 'Posting...';
            try {
              var res = await fetch('/.netlify/functions/comment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ postSlug: postSlug, name: name, comment: comment })
              });
              if (!res.ok) throw new Error('Request failed');
              var div = document.createElement('div');
              div.className = 'comment';
              var head = document.createElement('div');
              head.className = 'comment-head';
              var nameEl = document.createElement('span');
              nameEl.className = 'comment-name';
              nameEl.textContent = name;
              var dateEl = document.createElement('span');
              dateEl.className = 'comment-date';
              dateEl.textContent = 'Just now';
              head.appendChild(nameEl); head.appendChild(dateEl);
              var body = document.createElement('p');
              body.className = 'comment-body';
              body.textContent = comment;
              div.appendChild(head); div.appendChild(body);
              list.appendChild(div);
              empty.style.display = 'none';
              if (countEl) countEl.textContent = '(' + (list.children.length) + ')';
              form.reset();
            } catch (err) {
              alert('Something went wrong, please try again.');
            } finally {
              btn.disabled = false; btn.textContent = 'Post Comment';
            }
          });
        })();
      </script>`;
}

function pageShell({ title, description, ogImage, url, ogType, bodyHTML }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${url}" />
  <meta property="og:type" content="${ogType}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:image" content="${esc(ogImage)}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:site_name" content="Extra Turnips" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(description)}" />
  <meta name="twitter:image" content="${esc(ogImage)}" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;1,400&family=DM+Sans:wght@300;400&display=swap" rel="stylesheet" />
  <style>${sharedStyle}${permalinkExtraCSS}</style>
</head>
<body>
  <div class="container">
    <div class="permalink-nav"><a href="/">Extra Turnips</a></div>
    <div class="page active" style="padding-top:2rem;">
      ${bodyHTML}
    </div>
  </div>
  ${cfBeacon}
</body>
</html>`;
}

function ratingPageHTML(r) {
  const score = Math.round(total(r) * 10) / 10;
  const photos = Array.isArray(r.photos) ? r.photos : (r.photo_url ? [r.photo_url] : []);
  const ogImage = photos[0] || `${SITE_URL}/ExtraTurnipsLogo.png`;
  const description = truncate(r.note, 180);
  const url = `${SITE_URL}/ratings/${r.slug}.html`;
  const tags = Array.isArray(r.tags) ? r.tags : [];
  const typeLabel = r.type ? r.type.charAt(0).toUpperCase() + r.type.slice(1) : '';

  const bodyHTML = `
      <div class="rating-card visible" style="cursor:default;border-top:1px solid var(--border);">
        <div class="card-header">
          <div class="card-header-left">
            <div class="card-name">${esc(r.name)}</div>
            <div class="card-meta">${esc(r.location)} &middot; ${esc(r.date)}${typeLabel ? ' &middot; ' + esc(typeLabel) : ''}</div>
          </div>
          <div class="card-header-right">
            <span class="card-score${score >= 80 ? ' top' : ''}">${score} <span class="card-denom">/100</span></span>
          </div>
        </div>
        <div class="card-detail" style="padding-bottom:1.5rem;">
          ${r.submitter ? `<div class="community-submitter">Submitted by ${esc(r.submitter)}</div>` : ''}
          <p class="card-note">${esc(r.note)}</p>
          <div class="card-subscores">
            <div class="subscore-row">
              <span class="subscore-lbl">Taste <span class="subscore-lbl-max">/50</span></span>
              <div class="subscore-track"><div class="subscore-fill" style="width:${(r.taste / 50) * 100}%"></div></div>
              <span class="subscore-val">${r.taste}</span>
            </div>
            <div class="subscore-row">
              <span class="subscore-lbl">Value <span class="subscore-lbl-max">/25</span></span>
              <div class="subscore-track"><div class="subscore-fill" style="width:${(r.value / 25) * 100}%"></div></div>
              <span class="subscore-val">${r.value}</span>
            </div>
            <div class="subscore-row">
              <span class="subscore-lbl">Experience <span class="subscore-lbl-max">/25</span></span>
              <div class="subscore-track"><div class="subscore-fill" style="width:${(r.experience / 25) * 100}%"></div></div>
              <span class="subscore-val">${r.experience}</span>
            </div>
          </div>
          ${tags.length ? `<div class="card-tags">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
          ${photos.length ? `<div class="photo-strip">${photos.map(src => `<img src="${esc(src)}" alt="${esc(r.name)}" loading="lazy" />`).join('')}</div>` : ''}
        </div>
      </div>
      <a class="permalink-back" href="/">&larr; All ratings</a>
      ${commentsSectionHTML(r)}`;

  return pageShell({
    title: `${r.name} — Extra Turnips`,
    description,
    ogImage,
    url,
    ogType: 'article',
    bodyHTML
  });
}

function postPageHTML(p) {
  const description = truncate(p.preamble, 180);
  const url = `${SITE_URL}/posts/${p.slug}.html`;
  const ogImage = `${SITE_URL}/ExtraTurnipsLogo.png`;
  const bodyText = p.post || p._body || '';
  const paragraphs = bodyText.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);

  const bodyHTML = `
      <div class="post-full">
        <h1>${esc(p.title)}</h1>
        <div class="post-meta">${esc(p.date)} &middot; ${esc(p.read)} <span class="tag" style="margin-top:0">${esc(p.tag)}</span></div>
        ${paragraphs.map(par => `<p>${esc(par)}</p>`).join('\n        ')}
        <a class="permalink-back" href="/">&larr; Back to blog</a>
      </div>
      ${commentsSectionHTML(p)}`;

  return pageShell({
    title: `${p.title} — Extra Turnips`,
    description,
    ogImage,
    url,
    ogType: 'article',
    bodyHTML
  });
}

const output = template
  .replace('__RATINGS_DATA__', JSON.stringify(adminRatings))
  .replace('__COMMUNITY_DATA__', JSON.stringify(communityRatings))
  .replace('__POSTS_DATA__', JSON.stringify(posts))
  .replace('__CF_BEACON__', cfBeacon);

fs.writeFileSync('public/index.html', output);

for (const dir of ['public/ratings', 'public/posts']) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}
allRatings.forEach(r => fs.writeFileSync(path.join('public/ratings', `${r.slug}.html`), ratingPageHTML(r)));
posts.forEach(p => fs.writeFileSync(path.join('public/posts', `${p.slug}.html`), postPageHTML(p)));

const sitemapUrls = [
  SITE_URL + '/',
  ...allRatings.map(r => `${SITE_URL}/ratings/${r.slug}.html`),
  ...posts.map(p => `${SITE_URL}/posts/${p.slug}.html`)
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map(u => `  <url><loc>${esc(u)}</loc></url>`).join('\n')}
</urlset>
`;
fs.writeFileSync('public/sitemap.xml', sitemap);

console.log(`Built with ${adminRatings.length} ratings, ${communityRatings.length} community, ${posts.length} posts`);
console.log(`Generated ${allRatings.length} rating permalinks, ${posts.length} post permalinks`);
console.log(`Generated sitemap.xml with ${sitemapUrls.length} URLs`);

}

build();
