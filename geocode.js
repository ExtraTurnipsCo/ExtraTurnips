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

// Nominatim's parser can choke on certain accented letters even when the
// rest of the address is fine (e.g. Danish "Nørre Voldgade" finds nothing,
// but "Norre Voldgade" does). Used as a fallback, not primary, since the
// un-transliterated form is more likely to match when it works.
const ASCII_MAP = { 'ø': 'o', 'Ø': 'O', 'å': 'a', 'Å': 'A', 'æ': 'ae', 'Æ': 'AE', 'ß': 'ss' };
function toAsciiApprox(s) {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[øØåÅæÆß]/g, ch => ASCII_MAP[ch]);
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

// A location is only treated as a GTA street address if it starts with a
// house number — every real rating so far follows that pattern. Anything
// else (a bare place name like "Stockholm", or an explicit non-GTA address
// like "401 E 57th St, New York, NY") is searched freeform with no Ontario
// bias, since structured GTA search can otherwise return a false-positive
// match against an unrelated Canadian street that happens to share the name.
function isGtaStreetAddress(base) {
  if (!/^\d/.test(base)) return false;
  const mentionsGTA = new RegExp(`\\b(${GTA_PLACES})\\b`, 'i').test(base);
  return !base.includes(',') || mentionsGTA;
}

async function geocodeLocation(location) {
  const base = location.split(' - ')[0].trim();

  if (!isGtaStreetAddress(base)) {
    let coords = await geocodeFreeform(base);
    if (!coords) {
      const ascii = toAsciiApprox(base);
      if (ascii !== base) {
        await sleep(1100);
        coords = await geocodeFreeform(ascii);
      }
    }
    return coords;
  }

  let coords = await geocodeStructured(cleanStreet(base));
  if (!coords) {
    await sleep(1100);
    coords = await geocodeFreeform(base);
  }
  return coords;
}

async function fetchReverse(coords, zoom) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&accept-language=en&zoom=${zoom}&lat=${coords.lat}&lon=${coords.lng}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) return null;
  return (await res.json()).address || null;
}

// Looks up which city, region and country a coordinate is in, so the review's
// structured data names the real place instead of assuming Toronto. Zoom 8
// answers with the metro ("Toronto" for Scarborough, "Greater London" for a
// borough); where that level has no city (Markham, Budapest), zoom 10 does.
async function reversePlace(coords) {
  let addr = await fetchReverse(coords, 8);
  if (!addr) return null;
  let city = addr.city;
  if (!city) {
    await sleep(1100);
    const fine = await fetchReverse(coords, 10);
    if (fine) addr = fine;
    city = addr.city || addr.town || addr.village || addr.municipality || addr.county;
  }
  // Canada and the US write the region as a code (ON, NY); elsewhere the name.
  const iso = addr['ISO3166-2-lvl4'] || '';
  const country = (addr.country_code || '').toUpperCase();
  return {
    city: (city || '').replace(/^Greater /, ''),
    region: (country === 'CA' || country === 'US') && iso ? iso.split('-')[1] : (addr.state || ''),
    country
  };
}

// Geocodes any rating locations missing from the cache and returns the full
// location -> {lat,lng,city,region,country}|null map. Nominatim's usage policy caps requests at
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

  // Entries cached before place lookups existed only hold coordinates.
  for (const [location, entry] of Object.entries(cache)) {
    if (!entry || entry.country !== undefined) continue;
    const place = await reversePlace(entry);
    if (place) {
      console.log(`Located: ${location} -> ${place.city}, ${place.country}`);
      Object.assign(entry, place);
      saveCache(cache);
    }
    await sleep(1100);
  }

  return cache;
}

module.exports = { geocodeAll };
