// Am I Overpaying? Runs entirely in the browser: the price someone enters is
// never sent anywhere unless they choose to submit the separate city form.
(function () {
  var DATA = window.SHAWARMA_INDEX;
  var CITIES = DATA.cities.slice().sort(function (a, b) { return a.usd - b.usd; });
  var OTHER = '__other';
  var SYMBOL = { GBP: '£', USD: 'US$', CAD: 'C$', EUR: '€', CHF: 'CHF ', AED: 'AED ', EGP: 'EGP ' };
  var NEARBY = { Vancouver: 'Vancouver', Halifax: 'Halifax', Waterloo: 'Waterloo' };
  var DISCOUNTED = { Dubai: 1, Cairo: 1 };
  var CAIRO = DATA.cities.filter(function (c) { return c.city === 'Cairo'; })[0];

  // One rate per currency, read from the Index rows so it matches the video.
  var RATE = {};
  DATA.cities.forEach(function (c) { if (!RATE[c.currency]) RATE[c.currency] = c.usdPerUnit; });

  var $ = function (id) { return document.getElementById(id); };
  var form = $('opForm'), citySel = $('opCity'), curSel = $('opCurrency'), curRow = $('opCurrencyRow');
  var paidInput = $('opPaid'), errorEl = $('opError'), resultEl = $('opResult'), symbolEl = $('opSymbol');
  var last = null;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function money(n, currency) { return SYMBOL[currency] + n.toFixed(2); }
  function usdText(n) { return '$' + n.toFixed(2); }
  // Index cities show the same rounding as the video's cards.
  function indexUsdText(n) { return '$' + (Math.round(n * 10) / 10).toFixed(2); }
  function listNames(names) {
    if (names.length < 2) return names.join('');
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  function verdictFor(pct) {
    if (pct <= -15) return 'Steal';
    if (pct < -5) return 'Good deal';
    if (pct <= 5) return 'Bang on';
    if (pct <= 20) return 'Slightly overpaying';
    return 'Overpaying';
  }

  // Everything shown on the page and on the share card comes from this.
  function compute(q) {
    var currency = q.city ? q.city.currency : q.currency;
    var paidUsd = q.paid * RATE[currency];
    var others = CITIES.filter(function (c) { return !q.city || c.city !== q.city.city; });
    var r = {
      city: q.city, currency: currency, paid: q.paid, paidUsd: paidUsd,
      pricierThan: others.filter(function (c) { return c.usd < paidUsd; }).map(function (c) { return c.city; }),
      cheaperThan: others.filter(function (c) { return c.usd >= paidUsd; }).map(function (c) { return c.city; }),
      fun: null, unlikely: false
    };
    if (q.city) {
      r.diff = q.paid - q.city.median;
      r.pct = (r.diff / q.city.median) * 100;
      r.verdict = verdictFor(r.pct);
      r.unlikely = q.paid < q.city.median * 0.2 || q.paid > q.city.median * 5;
    } else {
      var hi = CITIES[CITIES.length - 1];
      r.unlikely = paidUsd < CITIES[0].usd * 0.2 || paidUsd > hi.usd * 5;
    }
    if (currency !== 'EGP') {
      var wraps = paidUsd / CAIRO.usd;
      r.fun = wraps >= 1 ? 'That would buy ' + wraps.toFixed(1) + ' wraps in Cairo.' : "That wouldn't even buy one wrap in Cairo.";
    }
    return r;
  }

  function diffLine(r) {
    var rounded = Math.round(Math.abs(r.diff) * 100) / 100;
    if (rounded === 0) return 'Exactly the ' + r.city.city + ' median.';
    return money(rounded, r.currency) + ' (' + Math.abs(r.pct).toFixed(1) + '%) ' +
      (r.diff > 0 ? 'over' : 'under') + ' the ' + r.city.city + ' median.';
  }

  function detailLines(r) {
    var c = r.city;
    var lines = [];
    lines.push('Median: ' + money(c.median, r.currency) + (c.taxPct > 0 ? ' with tax (' + money(c.menuMedian, r.currency) + ' on the menu)' : '') + '.');
    lines.push('Typical range: ' + money(c.q1, r.currency) + ' to ' + money(c.q3, r.currency) + ', based on ' + c.shops + ' shops.');
    if (NEARBY[c.city]) lines.push(c.city + ' includes nearby cities.');
    if (DISCOUNTED[c.city]) lines.push(c.city + ' apps often discount below list price, so real prices can be lower.');
    return lines;
  }

  function ladderHTML(r) {
    var rows = CITIES.map(function (c) {
      return { name: c.city, usd: c.usd, text: indexUsdText(c.usd), home: r.city && c.city === r.city.city };
    });
    rows.push({ name: 'You', usd: r.paidUsd, text: usdText(r.paidUsd), you: true });
    rows.sort(function (a, b) { return a.usd - b.usd; });
    var max = Math.max.apply(null, rows.map(function (x) { return x.usd; }));
    return rows.map(function (x) {
      return '<li class="op-row' + (x.you ? ' you' : '') + (x.home ? ' home' : '') + '">' +
        '<span>' + esc(x.name) + '</span>' +
        '<span class="op-track"><span class="op-bar" style="width:' + (x.usd / max * 72).toFixed(2) + '%"></span>' +
        '<span class="op-val">' + x.text + '</span></span></li>';
    }).join('');
  }

  function render(r) {
    var html = '';
    if (r.city) {
      html += '<div class="op-eyebrow">' + esc(money(r.paid, r.currency)) + ' in ' + esc(r.city.city) + '</div>';
      html += '<div class="op-verdict">' + esc(r.verdict) + '</div>';
      html += '<div class="op-diff">' + esc(diffLine(r)) + '</div>';
      html += detailLines(r).map(function (l) { return '<div class="op-detail">' + esc(l) + '</div>'; }).join('');
    } else {
      html += '<div class="op-eyebrow">' + esc(money(r.paid, r.currency)) + '</div>';
      html += '<div class="op-verdict">About ' + esc(usdText(r.paidUsd)) + ' US</div>';
      html += '<div class="op-diff">We have no median for your city yet, so here is how it sits against the 15 we checked.</div>';
    }
    if (r.unlikely) html += '<div class="op-check">That\'s far from what we found. Did it include sides or more than one wrap?</div>';
    if (r.fun) html += '<div class="op-fun">' + esc(r.fun) + '</div>';
    html += '<div class="op-ladder-title">You against the world</div>';
    html += '<div class="op-compare">Median chicken wrap in USD. ';
    if (r.pricierThan.length) html += 'You paid more than ' + esc(listNames(r.pricierThan)) + '. ';
    if (r.cheaperThan.length) html += 'You paid less than ' + esc(listNames(r.cheaperThan)) + '.';
    html += '</div><ol class="op-ladder">' + ladderHTML(r) + '</ol>';
    html += '<div class="op-share"><button type="button" class="form-submit" id="opShare">Share my result</button>' +
      '<div class="op-share-status" id="opShareStatus" role="status"></div></div>';
    resultEl.innerHTML = html;
    resultEl.hidden = false;
    $('opShare').addEventListener('click', share);
    last = r;
  }

  function resultUrl(q) {
    var p = new URLSearchParams();
    if (q.city) p.set('city', q.city.city); else p.set('currency', q.currency);
    p.set('paid', q.paid.toFixed(2));
    return location.pathname + '?' + p.toString();
  }

  function readQuery() {
    var isOther = citySel.value === OTHER;
    return {
      city: isOther ? null : DATA.cities.filter(function (c) { return c.city === citySel.value; })[0],
      currency: isOther ? curSel.value : null,
      paid: parseFloat(paidInput.value)
    };
  }

  function syncInputs() {
    var isOther = citySel.value === OTHER;
    curRow.hidden = !isOther;
    var q = readQuery();
    symbolEl.textContent = (q.city ? SYMBOL[q.city.currency] : SYMBOL[q.currency]).trim();
  }

  function submit() {
    var q = readQuery();
    if (!(q.paid > 0) || q.paid > 1000000) {
      errorEl.textContent = 'Enter what you paid as a number above zero.';
      errorEl.hidden = false;
      resultEl.hidden = true;
      last = null;
      return false;
    }
    errorEl.hidden = true;
    render(compute(q));
    history.replaceState(null, '', resultUrl(q));
    return true;
  }

  // ── Share card ──
  function fitFont(ctx, text, weightFamily, size, maxWidth) {
    ctx.font = weightFamily.replace('%', size + 'px');
    while (ctx.measureText(text).width > maxWidth && size > 24) {
      size -= 4;
      ctx.font = weightFamily.replace('%', size + 'px');
    }
    return size;
  }
  function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    var line = '';
    text.split(' ').forEach(function (word) {
      var next = line ? line + ' ' + word : word;
      if (ctx.measureText(next).width > maxWidth && line) {
        ctx.fillText(line, x, y);
        y += lineHeight;
        line = word;
      } else line = next;
    });
    ctx.fillText(line, x, y);
    return y + lineHeight;
  }
  function loadImage(src) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  async function drawCard(r) {
    await Promise.all([
      document.fonts.load('600 80px Fraunces'),
      document.fonts.load('italic 400 50px Fraunces'),
      document.fonts.load('500 40px Archivo'),
      document.fonts.load('400 30px "IBM Plex Mono"')
    ]).catch(function () {});
    var logo = await loadImage('/ExtraTurnipsLogo.png');
    var canvas = document.createElement('canvas');
    canvas.width = 1080; canvas.height = 1920;
    var ctx = canvas.getContext('2d');
    var INK = '#17120F', SECOND = '#574C43', ACCENT = '#B02460', RULE = '#E0D6C6';
    var L = 80, W = 840;
    ctx.fillStyle = '#F2ECE0';
    ctx.fillRect(0, 0, 1080, 1920);
    ctx.textBaseline = 'alphabetic';
    // Sits the block lower so it clears TikTok's top bar and balances the page.
    ctx.translate(0, 130);

    var logoW = 0;
    if (logo) {
      var h = 110;
      logoW = h * logo.width / logo.height;
      ctx.drawImage(logo, L, 190, logoW, h);
    }
    ctx.fillStyle = INK;
    ctx.font = '600 52px Fraunces, Georgia, serif';
    ctx.fillText('Extra Turnips', L + logoW + 24, 264);
    ctx.fillStyle = INK;
    ctx.font = '600 64px Fraunces, Georgia, serif';
    ctx.fillText('Am I overpaying?', L, 400);

    ctx.fillStyle = SECOND;
    var where = money(r.paid, r.currency) + (r.city ? ' in ' + r.city.city : '');
    fitFont(ctx, where, '500 % Archivo, sans-serif', 52, W);
    ctx.fillText(where, L, 500);

    var head = r.city ? r.verdict : 'About ' + usdText(r.paidUsd) + ' US';
    ctx.fillStyle = ACCENT;
    var size = fitFont(ctx, head, '600 % Fraunces, Georgia, serif', 150, W);
    ctx.fillText(head, L, 530 + size);
    var y = 530 + size + 90;

    ctx.fillStyle = INK;
    ctx.font = '500 44px Archivo, sans-serif';
    if (r.city) {
      y = wrapText(ctx, diffLine(r), L, y, W, 58);
      ctx.fillStyle = SECOND;
      ctx.font = '400 36px Archivo, sans-serif';
      y = wrapText(ctx, 'Median ' + money(r.city.median, r.currency) + ' across ' + r.city.shops + ' shops', L, y + 4, W, 48);
    }
    y += 34;
    ctx.fillStyle = RULE;
    ctx.fillRect(L, y, W, 3);
    y += 90;

    if (r.fun) {
      ctx.fillStyle = INK;
      ctx.font = 'italic 400 54px Fraunces, Georgia, serif';
      y = wrapText(ctx, r.fun, L, y, W, 70) + 24;
    }
    ctx.fillStyle = SECOND;
    ctx.font = '400 38px Archivo, sans-serif';
    y = wrapText(ctx, 'Pricier than ' + r.pricierThan.length + ' of the cities we checked, cheaper than ' + r.cheaperThan.length + '.', L, y, W, 52);

    ctx.fillStyle = ACCENT;
    ctx.font = '500 38px "IBM Plex Mono", monospace';
    ctx.fillText('extraturnips.com/overpaying', L, 1430);
    return canvas;
  }

  async function share() {
    var status = $('opShareStatus');
    if (!last) return;
    status.textContent = 'Making your card...';
    var link = location.href;
    try {
      var canvas = await drawCard(last);
      var blob = await new Promise(function (res) { canvas.toBlob(res, 'image/png'); });
      var file = new File([blob], 'am-i-overpaying.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Am I overpaying for shawarma?', text: link });
          status.textContent = '';
        } catch (err) {
          status.textContent = err && err.name === 'AbortError' ? '' : "Sharing didn't work. Try again?";
        }
        return;
      }
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      var copied = false;
      try { await navigator.clipboard.writeText(link); copied = true; } catch (e) {}
      status.textContent = copied ? 'Card downloaded and link copied.' : 'Card downloaded.';
    } catch (err) {
      status.textContent = "Couldn't make the card. Your result link still works.";
    }
  }

  // ── Next-city form, posted to Netlify Forms like the community review form ──
  var reqForm = $('opRequest');
  reqForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    var status = $('opRequestStatus');
    var btn = reqForm.querySelector('.form-submit');
    var fd = new FormData(reqForm);
    if (!String(fd.get('city') || '').trim()) { status.textContent = 'Tell us which city.'; return; }
    btn.disabled = true;
    status.textContent = 'Sending...';
    try {
      var res = await fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fd).toString()
      });
      if (!res.ok) throw new Error('Request failed');
      reqForm.reset();
      status.textContent = 'Got it, thanks.';
    } catch (err) {
      status.textContent = 'Something went wrong. Please try again.';
    } finally {
      btn.disabled = false;
    }
  });

  // ── Setup ──
  var byName = DATA.cities.slice().sort(function (a, b) { return a.city.localeCompare(b.city); });
  citySel.innerHTML = byName.map(function (c) {
    return '<option value="' + esc(c.city) + '">' + esc(c.city) + '</option>';
  }).join('') + '<option value="' + OTHER + '">My city isn\'t here</option>';
  citySel.value = 'Toronto';
  curSel.innerHTML = Object.keys(RATE).sort().map(function (c) {
    return '<option value="' + c + '">' + c + '</option>';
  }).join('');
  curSel.value = 'USD';

  citySel.addEventListener('change', syncInputs);
  curSel.addEventListener('change', syncInputs);
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (submit()) resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // A shared link opens straight on its result.
  var params = new URLSearchParams(location.search);
  var known = DATA.cities.some(function (c) { return c.city === params.get('city'); });
  if (known) citySel.value = params.get('city');
  else if (RATE[params.get('currency')]) { citySel.value = OTHER; curSel.value = params.get('currency'); }
  curRow.hidden = citySel.value !== OTHER;
  var q0 = readQuery();
  symbolEl.textContent = (q0.city ? SYMBOL[q0.city.currency] : SYMBOL[q0.currency]).trim();
  var paidParam = parseFloat(params.get('paid'));
  if (paidParam > 0) {
    paidInput.value = paidParam;
    submit();
  }
})();
