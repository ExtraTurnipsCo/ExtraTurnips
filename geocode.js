const fs = require('fs');
const path = require('path');

const CACHE_PATH = path.join(__dirname, 'content', '.geocode-cache.json');
const USER_AGENT = 'ExtraTurnips-Build/1.0 (https://extraturnips.com)';
const GTA_PLACES = 'toronto|markham|mississauga|vaughan|scarborough|etobicoke|north york|brampton|richmond hill|pickering|ajax|oshawa|ontario|canada';

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchGeocode(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) return null;
  const results = await res.json();
  if (!results.length) return null;
  return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
}

// Structured search (separate street/state/country fields, no city) lets
// Nominatim's own address interpolation pick the right GTA municipality —
// forcing city=Toronto into a freeform query breaks addresses that are
// actually in Markham, Etobicoke, etc.
function geocodeStructured(street) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&country=Canada&state=Ontario&street=${encodeURIComponent(street)}`;
  return fetchGeocode(url);
}

function geocodeFreeform(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  return fetchGeocode(url);
}

// Strips the parts of a raw location string that confuse Nominatim's street
// parser: unit-number prefixes ("1103-145 X" -> "145 X"), unit suffixes
// ("X #3" / "X Unit 3"), and any trailing city/province/postal/country text
// ratings sometimes include (structured search already supplies those).
function cleanStreet(base) {
  return base
    .replace(/^\d+-(?=\d)/, '')
    .replace(/\s*#\s*\d+\w*\s*$/, '')
    .replace(/\s+(unit|suite|apt)\.?\s*\d+\w*\s*$/i, '')
    .replace(new RegExp(`\\b(${GTA_PLACES})\\b.*$`, 'i'), '')
    .replace(/\s+[A-Z]\d[A-Z]\s*\d[A-Z]\d\b.*$/i, '')
    .trim()
    .replace(/,\s*$/, '');
}

// Ratings are almost all bare GTA street addresses (e.g. "21 Davisville
// Avenue"); a handful explicitly name a place elsewhere (e.g. "Haarlem,
// Netherlands"). The latter are searched freeform as typed; everything else
// goes through structured GTA search first, falling back to a freeform
// search of the original string if that turns up nothing.
async function geocodeLocation(location) {
  const base = location.split(' - ')[0].trim();
  const looksInternational = base.includes(',') && !new RegExp(`\\b(${GTA_PLACES})\\b`, 'i').test(base);

  if (looksInternational) {
    return geocodeFreeform(base);
  }

  let coords = await geocodeStructured(cleanStreet(base));
  if (!coords) {
    await sleep(1100);
    coords = await geocodeFreeform(base);
  }
  return coords;
}

// Geocodes any rating locations missing from the cache and returns the full
// location -> {lat,lng}|null map. Nominatim's usage policy caps requests at
// 1/sec, so lookups are done serially with a delay and persisted after each
// one, so an interrupted build doesn't lose progress or re-query on retry.
async function geocodeAll(ratings) {
  const cache = loadCache();
  const uncached = ratings.filter(r => r.location && !(r.location in cache));

  for (const r of uncached) {
    console.log(`Geocoding: ${r.location}`);
    cache[r.location] = await geocodeLocation(r.location);
    saveCache(cache);
    await sleep(1100);
  }

  return cache;
}

module.exports = { geocodeAll };
