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

const ratings = loadCollection('content/ratings');
const posts = loadCollection('content/posts');

const template = fs.readFileSync('public/index.html', 'utf8');

const output = template
  .replace('__RATINGS_DATA__', JSON.stringify(ratings))
  .replace('__POSTS_DATA__', JSON.stringify(posts));

fs.writeFileSync('public/index.html', output);
console.log(`Built with ${ratings.length} ratings and ${posts.length} posts`);
