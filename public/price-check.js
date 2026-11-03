// Shawarma Price Check. Runs entirely in the browser: the price someone enters
// is never sent anywhere unless they choose to submit the separate city form.
// It's a gauge, not a verdict: portion sizes vary, so it only says where a
// price sits among the shops we checked, never whether someone overpaid.
(function () {
  var DATA = window.SHAWARMA_INDEX;
  var CITIES = DATA.cities.slice().sort(function (a, b) { return a.usd - b.usd; });
  var OTHER = '__other';
  var SYMBOL = { GBP: '£', USD: 'US$', CAD: 'C$', EUR: '€' };
  var NEARBY = { Montreal: 'Laval and the West Island' };

  // USD per unit of each currency, read from the Index rows. Everything is
  // shown in Canadian dollars, so these are only used to convert into CAD.
  var RATE = { USD: 1 };
  DATA.cities.forEach(function (c) { if (!RATE[c.currency]) RATE[c.currency] = c.usdPerUnit; });
  function toCad(amount, currency) { return amount * RATE[currency] / RATE.CAD; }

  var $ = function (id) { return document.getElementById(id); };
  var form = $('opForm'), citySel = $('opCity'), curSel = $('opCurrency'), curRow = $('opCurrencyRow');
  var paidInput = $('opPaid'), errorEl = $('opError'), resultEl = $('opResult'), symbolEl = $('opSymbol');
  var last = null;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function money(n, currency) { return (SYMBOL[currency] || currency + ' ') + n.toFixed(2); }
  function cad(n) { return money(n, 'CAD'); }
  // Local amount, with its C$ equivalent when the city isn't Canadian.
  function localWithCad(n, currency) { return money(n, currency) + (currency === 'CAD' ? '' : ' (' + cad(toCad(n, currency)) + ')'); }

  // Everything shown on the page and on the share card comes from this.
  function compute(q) {
    var currency = q.city ? q.city.currency : q.currency;
    var r = { city: q.city, currency: currency, paid: q.paid, paidCad: toCad(q.paid, currency), unlikely: false };
    r.cityMediansBelow = CITIES.filter(function (c) { return toCad(c.median, c.currency) < r.paidCad - 0.005; }).length;
    if (q.city) {
      r.diff = q.paid - q.city.median;
      r.pct = (r.diff / q.city.median) * 100;
      r.unlikely = q.paid < q.city.median * 0.2 || q.paid > q.city.median * 5;
    } else {
      var lo = toCad(CITIES[0].median, CITIES[0].currency), hi = toCad(CITIES[CITIES.length - 1].median, CITIES[CITIES.length - 1].currency);
      r.unlikely = r.paidCad < lo * 0.2 || r.paidCad > hi * 5;
    }
    return r;
  }

  // Just above or below the city's average (its median shop price). Within
  // 2.5% either way reads as "About average", so a few cents don't flip it.
  function headline(r) {
    if (Math.abs(r.pct) <= 2.5) return 'About average';
    return r.diff > 0 ? 'Above average' : 'Below average';
  }

  function diffLine(r) {
    var c = r.city;
    var rounded = Math.round(Math.abs(r.diff) * 100) / 100;
    var avg = 'the ' + c.city + ' average of ' + localWithCad(c.median, r.currency) + (c.taxPct > 0 ? ' with tax' : '');
    if (rounded === 0) return 'Exactly ' + avg + '.';
    return money(rounded, r.currency) + ' (' + Math.abs(r.pct).toFixed(1) + '%) ' + (r.diff > 0 ? 'above ' : 'below ') + avg + '.';
  }

  function detailLines(r) {
    var c = r.city;
    var lines = [];
    if (c.taxPct > 0) lines.push('That average is ' + money(c.menuMedian, r.currency) + ' on the menu, plus ' + c.taxPct.toFixed(c.taxPct % 1 ? 1 : 0) + '% tax.');
    var range = money(c.q1, r.currency) + ' to ' + money(c.q3, r.currency);
    if (r.currency !== 'CAD') range += ' (' + cad(toCad(c.q1, r.currency)) + ' to ' + cad(toCad(c.q3, r.currency)) + ')';
    lines.push('Typical range: ' + range + '.');
    if (NEARBY[c.city]) lines.push(c.city + ' includes a few shops in ' + NEARBY[c.city] + '.');
    return lines;
  }

  // One strip: a dot per shop, a tick for the median, and you.
  function gaugeHTML(r) {
    var c = r.city, prices = c.prices;
    var lo = Math.min(prices[0], r.paid), hi = Math.max(prices[prices.length - 1], r.paid);
    var pad = (hi - lo) * 0.04 || 1;
    lo -= pad; hi += pad;
    var pct = function (v) { return (v - lo) / (hi - lo) * 100; };
    var pos = function (v) { return pct(v).toFixed(2) + '%'; };
    // Labels near either end anchor inwards so they don't run off a phone screen.
    var tagStyle = function (v) {
      var x = pct(v);
      return 'left:' + pos(v) + (x > 82 ? ';transform:translateX(-100%)' : x < 18 ? ';transform:none' : '');
    };
    var html = '<div class="op-gauge" role="img" aria-label="' + esc('Your price of ' + money(r.paid, r.currency) + ' against shop prices in ' + c.city + ', average ' + money(c.median, r.currency)) + '">';
    // One bar from the lowest to the highest shop price; no per-shop marks.
    var first = prices[0], lastP = prices[prices.length - 1];
    html += '<div class="op-gauge-line"></div>';
    html += '<span class="op-gauge-range" style="left:' + pos(first) + ';width:' + (pct(lastP) - pct(first)).toFixed(2) + '%"></span>';
    html += '<span class="op-gauge-mid" style="left:' + pos(c.median) + '" title="Average ' + esc(money(c.median, r.currency)) + '"></span>';
    html += '<span class="op-gauge-tag mid" style="' + tagStyle(c.median) + '">average ' + esc(money(c.median, r.currency)) + '</span>';
    html += '<span class="op-gauge-you" style="left:' + pos(r.paid) + '" title="You paid ' + esc(money(r.paid, r.currency)) + '"></span>';
    html += '<span class="op-gauge-tag you" style="' + tagStyle(r.paid) + '">you ' + esc(money(r.paid, r.currency)) + '</span>';
    html += '</div>';
    html += '<div class="op-gauge-ends"><span>lowest ' + esc(money(prices[0], r.currency)) + '</span><span>highest ' + esc(money(prices[prices.length - 1], r.currency)) + '</span></div>';
    return html;
  }

  function ladderHTML(r) {
    var rows = CITIES.map(function (c) {
      return { name: c.city, cad: toCad(c.median, c.currency), home: r.city && c.city === r.city.city };
    });
    rows.push({ name: 'You', cad: r.paidCad, you: true });
    rows.sort(function (a, b) { return a.cad - b.cad; });
    var max = Math.max.apply(null, rows.map(function (x) { return x.cad; }));
    return rows.map(function (x) {
      return '<li class="op-row' + (x.you ? ' you' : '') + (x.home ? ' home' : '') + '">' +
        '<span>' + esc(x.name) + '</span>' +
        '<span class="op-track"><span class="op-bar" style="width:' + (x.cad / max * 72).toFixed(2) + '%"></span>' +
        '<span class="op-val">' + cad(x.cad) + '</span></span></li>';
    }).join('');
  }

  function render(r) {
    var html = '';
    if (r.city) {
      html += '<div class="op-eyebrow">' + esc(localWithCad(r.paid, r.currency)) + ' in ' + esc(r.city.city) + '</div>';
      html += '<div class="op-head">' + esc(headline(r)) + '</div>';
      html += gaugeHTML(r);
      html += '<div class="op-diff">' + esc(diffLine(r)) + '</div>';
      html += detailLines(r).map(function (l) { return '<div class="op-detail">' + esc(l) + '</div>'; }).join('');
    } else {
      html += '<div class="op-eyebrow">' + esc(money(r.paid, r.currency)) + '</div>';
      html += '<div class="op-head">About ' + esc(cad(r.paidCad)) + '</div>';
      html += '<div class="op-diff">We haven\'t checked shops in your city yet, so here is how it sits against the ' + CITIES.length + ' cities we have.</div>';
    }
    html += '<div class="op-caveat">Portion sizes vary from shop to shop, so treat this as a rough guide, not a verdict.</div>';
    if (r.unlikely) html += '<div class="op-check">That\'s far from what we found. Did it include sides or more than one wrap?</div>';
    html += '<div class="op-ladder-title">Across our cities</div>';
    html += '<div class="op-compare">Average chicken wrap in each city, in Canadian dollars with tax.</div>';
    html += '<ol class="op-ladder">' + ladderHTML(r) + '</ol>';
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
    ctx.font = '600 64px Fraunces, Georgia, serif';
    ctx.fillText('Shawarma Price Check', L, 400);

    ctx.fillStyle = SECOND;
    var where = money(r.paid, r.currency) + (r.city ? ' in ' + r.city.city : '');
    fitFont(ctx, where, '500 % Archivo, sans-serif', 52, W);
    ctx.fillText(where, L, 500);

    ctx.fillStyle = ACCENT;
    ctx.font = '600 88px Fraunces, Georgia, serif';
    var y = wrapText(ctx, r.city ? headline(r) : 'About ' + cad(r.paidCad), L, 630, W, 100) + 30;

    ctx.fillStyle = INK;
    ctx.font = '500 42px Archivo, sans-serif';
    if (r.city) y = wrapText(ctx, diffLine(r), L, y, W, 56);
    y += 34;
    ctx.fillStyle = RULE;
    ctx.fillRect(L, y, W, 3);
    y += 90;

    ctx.fillStyle = SECOND;
    ctx.font = '400 38px Archivo, sans-serif';
    var n = CITIES.length, k = r.cityMediansBelow;
    var across = k === n ? 'Higher than all ' + n + ' city averages we checked' :
      k === 0 ? 'Lower than all ' + n + ' city averages we checked' :
      'Higher than ' + k + ' of the ' + n + ' city averages we checked';
    var lead = r.currency === 'CAD' ? '' : 'That is ' + cad(r.paidCad) + '. ';
    y = wrapText(ctx, lead + across + ', in Canadian dollars.', L, y, W, 52);
    ctx.font = 'italic 400 34px Archivo, sans-serif';
    wrapText(ctx, 'Portion sizes vary, so it is a rough guide.', L, y + 20, W, 48);

    ctx.fillStyle = ACCENT;
    ctx.font = '500 38px "IBM Plex Mono", monospace';
    ctx.fillText('extraturnips.com/price-check', L, 1430);
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
      var file = new File([blob], 'shawarma-price-check.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Shawarma Price Check', text: link });
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
  curSel.value = 'CAD';

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
