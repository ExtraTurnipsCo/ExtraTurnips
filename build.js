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

// Best-effort conversion of our human dates ("May 2026", "2026-05-01") to an
// ISO 8601 date for schema.org datePublished and sitemap <lastmod>. Returns
// null when unparseable so callers can omit the field rather than emit garbage.
function isoDate(s) {
  if (!s) return null;
  s = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // "May 2026" -> prepend a day so it parses to the first of the month.
  const d = new Date(/^[A-Za-z]+\s+\d{4}$/.test(s) ? '1 ' + s : s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

// ISO date for a rating/post, falling back to the epoch-ms timestamp many slugs
// end with (e.g. "...-1782728799451") when the human date is too vague to parse
// (a bare "June" with no year).
function entryDate(x) {
  const iso = isoDate(x.date);
  if (iso) return iso;
  const m = String(x.slug || '').match(/(\d{13})$/);
  return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : null;
}

// Serialize a schema.org object into a JSON-LD script tag. Escaping "<" keeps
// review text or titles containing "</script>" from breaking out of the tag.
function jsonLdScript(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
}

// A Review of a Restaurant. Restaurant is a LocalBusiness subtype, so the
// reviewRating makes the page eligible for star rich results. Scores are /100,
// so bestRating/worstRating pin the scale (Google assumes /5 otherwise).
function ratingJsonLd(r, { url, score, photos }) {
  const restaurant = { '@type': 'Restaurant', name: r.name, servesCuisine: 'Shawarma' };
  if (r.location) {
    restaurant.address = {
      '@type': 'PostalAddress',
      streetAddress: r.location,
      addressLocality: 'Toronto',
      addressRegion: 'ON',
      addressCountry: 'CA'
    };
  }
  if (r.lat != null && r.lng != null) {
    restaurant.geo = { '@type': 'GeoCoordinates', latitude: r.lat, longitude: r.lng };
  }
  if (photos.length) restaurant.image = photos;

  const review = {
    '@context': 'https://schema.org',
    '@type': 'Review',
    name: `${r.name} — Extra Turnips review`,
    url,
    itemReviewed: restaurant,
    reviewRating: { '@type': 'Rating', ratingValue: score, bestRating: 100, worstRating: 0 },
    author: r.submitter
      ? { '@type': 'Person', name: r.submitter }
      : { '@type': 'Organization', name: 'Extra Turnips' },
    publisher: { '@type': 'Organization', name: 'Extra Turnips' },
    reviewBody: r.note
  };
  const iso = entryDate(r);
  if (iso) review.datePublished = iso;
  return jsonLdScript(review);
}

function postJsonLd(p, { url, ogImage }) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: p.title,
    description: truncate(p.preamble, 180),
    image: ogImage,
    url,
    mainEntityOfPage: url,
    author: { '@type': 'Organization', name: 'Extra Turnips' },
    publisher: {
      '@type': 'Organization',
      name: 'Extra Turnips',
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/ExtraTurnipsLogo.png` }
    }
  };
  const iso = entryDate(p);
  if (iso) data.datePublished = iso;
  return jsonLdScript(data);
}

function homeJsonLd() {
  return jsonLdScript({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        name: 'Extra Turnips',
        url: `${SITE_URL}/`,
        description: 'Reviews of the best authentic shawarma spots across Toronto.'
      },
      {
        '@type': 'Organization',
        name: 'Extra Turnips',
        url: `${SITE_URL}/`,
        logo: `${SITE_URL}/ExtraTurnipsLogo.png`,
        sameAs: ['https://www.instagram.com/ExtraTurnips']
      }
    ]
  });
}

// Server-rendered, static version of a homepage rating card. The SPA overwrites
// #ratingCards / #communityCards on load, so this exists purely so crawlers (and
// no-JS visitors) see real content and real links to every permalink instead of
// an empty shell. Keep it interactivity-free: no comment forms, no duplicate IDs.
function homeCardHTML(r) {
  const score = Math.round(total(r) * 10) / 10;
  const isTop = score >= 80;
  const typeLabel = r.type ? r.type.charAt(0).toUpperCase() + r.type.slice(1) : '';
  const points = Array.isArray(r.summary) ? r.summary.filter(Boolean) : [];
  const noteHTML = points.length
    ? `<ul class="card-summary">${points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>`
    : `<p>${esc(truncate(r.note, 220))}</p>`;
  const photos = Array.isArray(r.photos) ? r.photos : (r.photo_url ? [r.photo_url] : []);
  const photoHTML = photos.length ? `<div class="photo-strip">${photos.map(src => `<img src="${esc(src)}" alt="Shawarma at ${esc(r.name)}, Toronto" loading="lazy" />`).join('')}</div>` : '';
  return `
        <div class="rating-card">
          <div class="card-header">
            <div class="card-header-left">
              <div class="card-name"><a href="/ratings/${r.slug}.html" style="color:inherit;text-decoration:none;">${esc(r.name)}</a></div>
              <div class="card-meta">${esc(r.location)} &middot; ${esc(r.date)}${typeLabel ? ' &middot; ' + esc(typeLabel) : ''}</div>
            </div>
            <div class="card-header-right">
              <span class="card-score${isTop ? ' top' : ''}">${score} <span class="card-denom">/100</span></span>
            </div>
          </div>
          <div class="card-detail" style="padding-bottom:1rem;">
            ${r.submitter ? `<div class="community-submitter">Submitted by ${esc(r.submitter)}</div>` : ''}
            <div class="card-note">${noteHTML}</div>
            ${photoHTML}
            <a class="card-permalink" href="/ratings/${r.slug}.html">Read full review &rarr;</a>
          </div>
        </div>`;
}

// Recency of a rating as epoch-ms, for ranking the hero. The slug's creation
// timestamp (e.g. "...-1784400368287") is the most reliable signal of when a
// review was posted and is finer-grained than our month-level `date:` field, so
// prefer it; fall back to the parsed `date:` for older hand-slugged entries.
// Both land on the same ms scale, so they compare consistently.
function recencyMs(x) {
  const m = String(x.slug || '').match(/(\d{13})$/);
  if (m) return Number(m[1]);
  const iso = isoDate(x.date);
  return iso ? new Date(iso).getTime() : 0;
}

// Picks the review to spotlight in the homepage hero: an explicitly flagged
// `featured: true` rating if any (curated "Review of the Week"), otherwise the
// most recently posted. Restricted to admin ratings by the caller.
function pickFeatured(ratings) {
  const flagged = ratings.filter(r => r.featured);
  const pool = flagged.length ? flagged : ratings;
  return [...pool].sort((a, b) => recencyMs(b) - recencyMs(a))[0] || null;
}

// Server-rendered highlight card at the top of the homepage. Static (the SPA
// never touches #featuredHero), so crawlers and no-JS visitors get it too. The
// whole block links to the permalink; text sits over the photo behind a scrim.
function heroHTML(r) {
  if (!r) return '';
  const score = Math.round(total(r) * 10) / 10;
  const photos = Array.isArray(r.photos) ? r.photos : (r.photo_url ? [r.photo_url] : []);
  const photo = photos[0];
  const typeLabel = r.type ? r.type.charAt(0).toUpperCase() + r.type.slice(1) : '';
  const label = r.featured ? 'Review of the Week' : 'Latest Review';
  const points = Array.isArray(r.summary) ? r.summary.filter(Boolean) : [];
  const summaryText = points.length ? points[0] : truncate(r.note, 150);
  const url = `/ratings/${r.slug}.html`;
  const metaLine = [r.location, r.date].filter(Boolean).map(esc).join(' &middot; ');

  // No photo → fall back to a text card so the hero still reads well; a
  // pictureless review shouldn't render an empty grey box.
  if (!photo) {
    return `
      <a class="featured-hero" href="${url}" aria-label="Read our review of ${esc(r.name)}">
        <div class="featured-eyebrow">${label}</div>
        <div class="rating-card visible" style="cursor:pointer;border-top:1px solid var(--border);border-bottom:1px solid var(--border);">
          <div class="card-header">
            <div class="card-header-left">
              <div class="card-name">${esc(r.name)}</div>
              <div class="card-meta">${metaLine}${typeLabel ? ' &middot; ' + esc(typeLabel) : ''}</div>
            </div>
            <div class="card-header-right">
              <span class="card-score${score >= 80 ? ' top' : ''}">${score} <span class="card-denom">/100</span></span>
            </div>
          </div>
        </div>
        <p class="featured-summary">${esc(summaryText)}</p>
        <span class="featured-cta">Read the full review &rarr;</span>
      </a>`;
  }

  return `
      <a class="featured-hero" href="${url}" aria-label="Read our review of ${esc(r.name)}">
        <div class="featured-eyebrow">${label}</div>
        <div class="featured-media">
          <img src="${esc(photo)}" alt="Shawarma at ${esc(r.name)}, Toronto" />
          <div class="featured-scrim"></div>
          <div class="featured-overlay">
            <div class="featured-overlay-text">
              <div class="featured-name">${esc(r.name)}</div>
              <div class="featured-meta-line">${metaLine}</div>
            </div>
            <span class="featured-score-badge${score >= 80 ? ' top' : ''}">${score}<span class="featured-denom">/100</span></span>
          </div>
        </div>
        <p class="featured-summary">${esc(summaryText)}</p>
        <span class="featured-cta">Read the full review &rarr;</span>
      </a>`;
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
  .permalink-nav a { font-family: var(--display); font-weight: 600; font-size: 1.5rem; letter-spacing: -0.015em; color: var(--text); text-decoration: none; }
  .permalink-back { display: inline-block; margin-top: 2rem; font-family: var(--mono); font-size: 0.7rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); text-decoration: none; }
  .permalink-back:hover { color: var(--accent); }
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

function pageShell({ title, description, ogImage, url, ogType, bodyHTML, jsonLd }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  ${jsonLd || ''}
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
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Archivo:wght@300;400;500;600&family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,400&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>${sharedStyle}${permalinkExtraCSS}</style>
</head>
<body>
  <div class="container tiers">
    <div class="permalink-nav wide"><a href="/">Extra Turnips</a></div>
    <div class="page active tiers bleed" style="padding-top:2rem;">
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
          ${photos.length ? `<div class="photo-strip">${photos.map(src => `<img src="${esc(src)}" alt="Shawarma at ${esc(r.name)}, Toronto" loading="lazy" />`).join('')}</div>` : ''}
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
    bodyHTML,
    jsonLd: ratingJsonLd(r, { url, score, photos })
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
        <div class="post-meta">${esc(p.date)} &middot; ${esc(p.read)} <span class="post-tag">${esc(p.tag)}</span></div>
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
    bodyHTML,
    jsonLd: postJsonLd(p, { url, ogImage })
  });
}

// Server-rendered card lists so the homepage isn't an empty shell to crawlers.
// The SPA replaces these containers' innerHTML on load; sort here to match the
// default client sort (by total score, descending).
const byScore = (a, b) => total(b) - total(a);
const ssrRatings = [...adminRatings].sort(byScore).map(homeCardHTML).join('');
const ssrCommunity = [...communityRatings].sort(byScore).map(homeCardHTML).join('');
const ssrHero = heroHTML(pickFeatured(adminRatings));

// Fills an empty container in the template with server-rendered markup,
// keeping whatever attributes it carries. Matching the tag literally meant
// that adding a class to the div in the template silently produced an empty
// container and a homepage with no hero, so a miss throws instead.
function injectInto(html, id, content) {
  const re = new RegExp(`(<div id="${id}"[^>]*>)</div>`);
  if (!re.test(html)) {
    throw new Error(`build: no empty <div id="${id}"> found in the template to inject into`);
  }
  return html.replace(re, (_, openTag) => `${openTag}${content}</div>`);
}

// Function replacements below so `$` in JSON/HTML isn't treated as a $-pattern.
let output = template
  .replace('__RATINGS_DATA__', () => JSON.stringify(adminRatings))
  .replace('__COMMUNITY_DATA__', () => JSON.stringify(communityRatings))
  .replace('__POSTS_DATA__', () => JSON.stringify(posts))
  .replace('__CF_BEACON__', () => cfBeacon)
  .replace('</head>', () => `  ${homeJsonLd()}\n</head>`);

output = injectInto(output, 'featuredHero', ssrHero);
output = injectInto(output, 'ratingCards', ssrRatings);
output = injectInto(output, 'communityCards', ssrCommunity);

fs.writeFileSync('public/index.html', output);

for (const dir of ['public/ratings', 'public/posts']) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}
allRatings.forEach(r => fs.writeFileSync(path.join('public/ratings', `${r.slug}.html`), ratingPageHTML(r)));
posts.forEach(p => fs.writeFileSync(path.join('public/posts', `${p.slug}.html`), postPageHTML(p)));

const today = new Date().toISOString().slice(0, 10);
// Homepage changes whenever any rating/post does, so stamp it with the newest.
const newestDate = [...allRatings, ...posts]
  .map(x => entryDate(x))
  .filter(Boolean)
  .sort()
  .pop() || today;
const sitemapUrls = [
  { loc: SITE_URL + '/', lastmod: newestDate },
  ...allRatings.map(r => ({ loc: `${SITE_URL}/ratings/${r.slug}.html`, lastmod: entryDate(r) })),
  ...posts.map(p => ({ loc: `${SITE_URL}/posts/${p.slug}.html`, lastmod: entryDate(p) }))
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map(u => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
fs.writeFileSync('public/sitemap.xml', sitemap);

console.log(`Built with ${adminRatings.length} ratings, ${communityRatings.length} community, ${posts.length} posts`);
console.log(`Generated ${allRatings.length} rating permalinks, ${posts.length} post permalinks`);
console.log(`Generated sitemap.xml with ${sitemapUrls.length} URLs`);

}

build();
