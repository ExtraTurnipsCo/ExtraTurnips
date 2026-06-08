const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

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
    .map(f => parseFrontmatter(fs.readFileSync(path.join(folder, f), 'utf8')))
    .filter(Boolean);
}

const allRatings = loadCollection('content/ratings');
const adminRatings = allRatings.filter(r => !r.submitter);
const communityRatings = allRatings.filter(r => r.submitter);
const posts = loadCollection('content/posts');

const template = fs.readFileSync('public/index.html', 'utf8');

const output = template
  .replace('__RATINGS_DATA__', JSON.stringify(adminRatings))
  .replace('__COMMUNITY_DATA__', JSON.stringify(communityRatings))
  .replace('__POSTS_DATA__', JSON.stringify(posts));

fs.writeFileSync('public/index.html', output);
console.log(`Built with ${adminRatings.length} ratings, ${communityRatings.length} community, ${posts.length} posts`);
