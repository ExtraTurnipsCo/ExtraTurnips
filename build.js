const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const SITE_URL = 'https://extraturnips.com';

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---([\s\S]*)$/);
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

const allRatings = loadCollection('content/ratings');
const adminRatings = allRatings.filter(r => !r.submitter);
const communityRatings = allRatings.filter(r => r.submitter);
const posts = loadCollection('content/posts');

const template = fs.readFileSync('public/index.html', 'utf8');
const sharedStyle = (template.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];

const permalinkExtraCSS = `
  .permalink-nav { padding: 1.75rem 0 1.5rem; border-bottom: 1px solid var(--border); }
  .permalink-nav a { font-family: 'Lora', serif; font-size: 1.4rem; color: var(--text); text-decoration: none; }
  .permalink-back { display: inline-block; margin-top: 2rem; font-size: 0.8rem; color: var(--muted); text-decoration: none; }
  .permalink-back:hover { color: var(--text); }
`;

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
      <a class="permalink-back" href="/">&larr; All ratings</a>`;

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
      </div>`;

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
  .replace('__POSTS_DATA__', JSON.stringify(posts));

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
