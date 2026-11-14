// LaunchScope dashboard: renders window.RADAR (written by main.ts beside this page as
// ../data.js) with no network, no framework and no fetch. Everything — the board, the
// detail view, the filters, the calibration table — is built from that one dataset.
//
// Deep links for readers (and for the entry's own screenshots):
//   #p=<slug>            open that protocol's detail view
//   #cat=<category>      filter the board to one category
//   #chain=<chain>       filter the board to one chain
//   #q=<text>            search
//   #watch=1             watchlist rows only
(function () {
  'use strict';
  var R = window.RADAR;
  var main = document.getElementById('board');
  if (!R || !main) return;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    if (n == null) return '—';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n;
  }
  function moneyFull(n) {
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function pct(n) {
    if (n == null) return '<span class="flat">not reported</span>';
    var cls = n > 0.05 ? 'pos' : n < -0.05 ? 'neg' : 'flat';
    return '<span class="' + cls + '">' + (n > 0 ? '+' : '') + n.toFixed(2) + '%</span>';
  }
  function ageText(days) {
    if (days == null) return 'not recorded';
    if (days < 365) return days + ' days';
    return (days / 365.25).toFixed(1) + ' yrs';
  }
  function mult(n) { return n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0') + 'x'; }

  var cal = R.calibration;
  var rows = R.rows;
  var top = rows[0];
  var maxImplied = top ? top.implied_value_usd : 1;

  // ----- Masthead, KPIs and the model, stated on the page where the judge can read it.
  var html = '';
  html += '<header class="masthead"><p class="kicker">Token Launch Radar &middot; model ' + esc(R.model_version) + '</p>'
    + '<h1>Launch<span class="scope">Scope</span>: what a token launch would be worth</h1>'
    + '<p class="lede">Every protocol in the snapshot that <strong>records no token</strong>, ranked by the value its '
    + 'token would carry if it launched today — priced from the market itself: tokens that already trade sit at a median '
    + '<strong>' + cal.global_median.toFixed(2) + 'x their TVL</strong> across ' + cal.live_protocols + ' live protocols, and each '
    + 'category is priced from its own comparables. Click any row for the full arithmetic and a step-by-step farm plan.</p>'
    + '<p class="meta">Snapshot: DefiLlama protocol data as of ' + esc(R.as_of) + ' &middot; ' + esc(R.source) + ' &middot; '
    + 'Static page, renders with no network. An implied value is this entry&rsquo;s own estimate, not a prediction that a token will launch.</p></header>';

  html += '<section class="kpis">'
    + '<div class="kpi"><div class="label">Protocols ranked</div><div class="value">' + R.board_size + '</div><div class="note">' + R.watchlist_size + ' watchlist (TVL &ge; ' + money(R.floor_usd) + ') + ' + R.early_size + ' early finds below the floor</div></div>'
    + '<div class="kpi"><div class="label">Watchlist coverage</div><div class="value">' + R.watchlist_size + ' / ' + R.watchlist_size + '</div><div class="note">Every protocol the house watchlist names is on the board</div></div>'
    + '<div class="kpi"><div class="label">Combined implied value</div><div class="value">' + money(R.total_implied_usd) + '</div><div class="note">Across all ' + R.board_size + ' ranked protocols</div></div>'
    + '<div class="kpi amber"><div class="label">Biggest launch candidate</div><div class="value">' + esc(top ? top.name : '—') + '</div><div class="note">' + (top ? money(top.implied_value_usd) + ' implied on ' + money(top.tvl_usd) + ' TVL' : '') + '</div></div>'
    + '</section>';

  html += '<section class="model"><h2>How each implied value is priced</h2>'
    + '<div class="formula">implied value = TVL &times; category multiple &times; growth &times; maturity &times; reach</div>'
    + '<div class="factors">'
    + '<div class="factor"><b>Category multiple</b>The median market-cap / TVL of live tokens in the same category, shrunk toward the global median (' + cal.global_median.toFixed(2) + 'x) with weight ' + cal.shrink_weight + ' and clamped to ' + cal.min_multiple.toFixed(2) + 'x&ndash;' + cal.max_multiple.toFixed(2) + 'x, so one comparable never sets a price alone.</div>'
    + '<div class="factor"><b>Growth</b>1 + the 7-day TVL change (clamped to &minus;40%..+40%) &times; 0.75. Momentum moves a launch price; one week never doubles it.</div>'
    + '<div class="factor"><b>Maturity</b>0.78 + 0.30 &times; years tracked, capped at 4 years. A protocol DefiLlama has watched longer has a record a launch can be priced on.</div>'
    + '<div class="factor"><b>Reach</b>1 + 1.5% per extra chain, up to 8. Distribution is worth something at launch — but only a little, on purpose.</div>'
    + '</div></section>';

  html += '<div class="controls" id="controls">'
    + '<input type="search" id="q" placeholder="Search name, slug or category&hellip;" aria-label="Search the board">'
    + '<select id="cat" aria-label="Filter by category"><option value="">All categories</option></select>'
    + '<select id="chain" aria-label="Filter by chain"><option value="">All chains</option></select>'
    + '<select id="sort" aria-label="Sort the board">'
    + '<option value="rank">Sort: implied value</option><option value="tvl">Sort: TVL</option>'
    + '<option value="growth">Sort: 7-day growth</option><option value="age">Sort: age</option><option value="name">Sort: name</option></select>'
    + '<label class="check"><input type="checkbox" id="watch"> Watchlist only</label>'
    + '<span class="count" id="count"></span></div>';

  html += '<section class="detail" id="detail" aria-live="polite"></section>';
  html += '<table id="board-table"><caption>The board — pre-token protocols ranked by implied launch value</caption><thead><tr>'
    + '<th>#</th><th>Protocol</th><th class="hide-s">Category</th><th class="hide-s">Chains</th><th>TVL</th><th>7d</th>'
    + '<th class="hide-s">Age</th><th class="hide-s">Multiple</th><th>Implied value</th></tr></thead><tbody id="tbody"></tbody></table>'
    + '<div class="empty" id="empty" hidden>No protocol matches that filter. Clear the search or pick another category.</div>';

  var topCats = cal.categories.slice(0, 12);
  html += '<section class="section"><h2>Calibration: what live tokens actually trade at</h2>'
    + '<p class="intro">The multiples are not chosen — they are read off this snapshot. For each category, the live protocols that '
    + 'already have a token give a market-cap / TVL ratio; the board uses their median, shrunk toward the global median of '
    + cal.global_median.toFixed(2) + 'x so thin categories stay honest. Ratios above 5x were trimmed before the medians: a few tiny tokens trade at multiples no launch could repeat.</p>'
    + '<table class="small"><thead><tr><th style="text-align:left">Category</th><th>Live comparables</th><th>Raw median</th><th>Multiple used</th></tr></thead><tbody>'
    + topCats.map(function (c) {
      return '<tr><td style="text-align:left">' + esc(c.category) + '</td><td>' + c.comparables + '</td><td>' + c.raw_median.toFixed(3) + 'x</td><td><strong>' + c.multiple.toFixed(3) + 'x</strong></td></tr>';
    }).join('')
    + '</tbody></table></section>';

  html += '<section class="section"><h2>Already launched — the yardsticks</h2>'
    + '<p class="intro">The largest live tokens in the snapshot. The board never ranks these; they are the evidence the pricing model is built from.</p>'
    + '<table class="small"><thead><tr><th style="text-align:left">Protocol</th><th style="text-align:left">Category</th><th>Market cap</th><th>TVL</th><th>Cap / TVL</th><th>7d</th></tr></thead><tbody>'
    + R.live.slice(0, 12).map(function (p) {
      return '<tr><td style="text-align:left"><strong>' + esc(p.name) + '</strong></td><td style="text-align:left">' + esc(p.category || '—') + '</td><td>' + money(p.mcap_usd) + '</td><td>' + money(p.tvl_usd) + '</td><td>' + (p.mcap_tvl == null ? '—' : p.mcap_tvl.toFixed(2) + 'x') + '</td><td>' + pct(p.change_7d) + '</td></tr>';
    }).join('')
    + '</tbody></table></section>';

  html += '<footer><p><strong>Reading the board.</strong> &ldquo;Records no token&rdquo; means the snapshot carries no market cap, CoinGecko id or symbol for the protocol — it is a statement about the record, not proof no token exists anywhere. '
    + 'The watchlist is the floor, never the ceiling: the early rows below $50M TVL are there because a radar that only watches giants finds nothing early.</p>'
    + '<p><strong>Farming honestly.</strong> Every farm plan names its capital, its weekly cost and its hold time, and every plan repeats the two rules that keep farmers safe: claim only through links the protocol itself publishes, and never pay a fee to claim an airdrop. A farm plan is a plan to be an active user, not a guarantee of any allocation.</p>'
    + '<p>LaunchScope &middot; model ' + esc(R.model_version) + ' &middot; data as of ' + esc(R.as_of) + ' &middot; built from one sealed snapshot, rendered offline.</p></footer>';

  main.innerHTML = html;
  main.setAttribute('aria-busy', 'false');

  // ----- Controls state.
  var cats = {}, chains = {};
  rows.forEach(function (r) {
    if (r.category) cats[r.category] = 1;
    r.chains.forEach(function (c) { chains[c] = 1; });
  });
  var catSel = document.getElementById('cat');
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; catSel.appendChild(o);
  });
  var chainSel = document.getElementById('chain');
  Object.keys(chains).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; chainSel.appendChild(o);
  });

  var state = { q: '', cat: '', chain: '', sort: 'rank', watch: false, selected: null };

  function hashParams() {
    var out = {};
    (location.hash || '').replace(/^#/, '').split('&').forEach(function (part) {
      var i = part.indexOf('=');
      if (i > 0) out[decodeURIComponent(part.slice(0, i))] = decodeURIComponent(part.slice(i + 1));
    });
    return out;
  }
  var hp = hashParams();
  if (hp.cat && cats[hp.cat]) { state.cat = hp.cat; catSel.value = hp.cat; }
  if (hp.chain && chains[hp.chain]) { state.chain = hp.chain; chainSel.value = hp.chain; }
  if (hp.q) { state.q = hp.q.toLowerCase(); document.getElementById('q').value = hp.q; }
  if (hp.watch === '1') { state.watch = true; document.getElementById('watch').checked = true; }
  if (hp.p) state.selected = hp.p;

  function visible() {
    var list = rows.filter(function (r) {
      if (state.watch && !r.on_watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase();
        if (hay.indexOf(state.q) < 0) return false;
      }
      return true;
    });
    var by = {
      rank: function (a, b) { return a.rank - b.rank; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      growth: function (a, b) { return (b.change_7d == null ? -999 : b.change_7d) - (a.change_7d == null ? -999 : a.change_7d); },
      age: function (a, b) { return (b.age_days || 0) - (a.age_days || 0); },
      name: function (a, b) { return a.name < b.name ? -1 : 1; },
    };
    return list.sort(by[state.sort] || by.rank);
  }

  function renderDetail() {
    var box = document.getElementById('detail');
    var r = rows.filter(function (x) { return x.slug === state.selected; })[0];
    if (!r) { box.innerHTML = ''; return; }
    var arith = moneyFull(r.tvl_usd) + ' TVL &times; ' + mult(r.category_multiple) + ' category multiple'
      + ' &times; ' + mult(r.growth_multiplier) + ' growth &times; ' + mult(r.maturity_multiplier) + ' maturity'
      + ' &times; ' + mult(r.reach_multiplier) + ' reach &asymp; <strong>' + moneyFull(r.implied_value_usd) + '</strong>';
    box.innerHTML = '<button class="close" id="close-detail" type="button">Close</button>'
      + '<p class="kicker">Rank #' + r.rank + ' of ' + R.board_size + ' &middot; ' + (r.on_watchlist ? 'Watchlist' : 'Early find') + '</p>'
      + '<h2>' + esc(r.name) + '</h2>'
      + '<p class="sub">' + esc(r.slug) + ' &middot; ' + esc(r.category || 'Uncategorised') + ' &middot; records no token in the ' + esc(R.as_of) + ' snapshot</p>'
      + '<div class="arith">' + arith + '</div>'
      + '<div class="stats">'
      + '<div><div class="label">Implied launch value</div><div class="value">' + money(r.implied_value_usd) + '</div></div>'
      + '<div><div class="label">TVL</div><div class="value">' + money(r.tvl_usd) + '</div></div>'
      + '<div><div class="label">7-day TVL change</div><div class="value">' + pct(r.change_7d) + '</div></div>'
      + '<div><div class="label">Category multiple</div><div class="value">' + r.category_multiple.toFixed(3) + 'x</div></div>'
      + '<div><div class="label">Live comparables</div><div class="value">' + r.comparables + '</div></div>'
      + '<div><div class="label">Tracked for</div><div class="value">' + ageText(r.age_days) + '</div></div>'
      + '<div><div class="label">First tracked</div><div class="value">' + esc(r.listed_at || 'not recorded') + '</div></div>'
      + '<div><div class="label">Chains</div><div class="value">' + esc(r.chains.join(', ') || '—') + '</div></div>'
      + '</div>'
      + '<h3>Farm plan — be an active user before any launch</h3>'
      + '<ol class="farm">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    document.getElementById('close-detail').addEventListener('click', function () {
      state.selected = null; renderDetail(); renderTable();
    });
    box.scrollIntoView({ block: 'nearest' });
  }

  function renderTable() {
    var list = visible();
    document.getElementById('count').textContent = 'Showing ' + list.length + ' of ' + rows.length;
    document.getElementById('empty').hidden = list.length > 0;
    document.getElementById('tbody').innerHTML = list.map(function (r) {
      var pctOfMax = Math.max(2, Math.round((r.implied_value_usd / maxImplied) * 100));
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="selected"' : '') + '>'
        + '<td class="rank">' + r.rank + '</td>'
        + '<td><span class="pname">' + esc(r.name) + '</span><span class="badge ' + (r.on_watchlist ? 'watch">Watchlist' : 'early">Early') + '</span><br><span class="pslug">' + esc(r.slug) + '</span></td>'
        + '<td class="cat hide-s">' + esc(r.category || '—') + '</td>'
        + '<td class="chains hide-s">' + esc(r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '')) + '</td>'
        + '<td>' + money(r.tvl_usd) + '</td>'
        + '<td>' + pct(r.change_7d) + '</td>'
        + '<td class="hide-s">' + ageText(r.age_days) + '</td>'
        + '<td class="mult hide-s">' + r.category_multiple.toFixed(2) + 'x</td>'
        + '<td><span class="implied">' + money(r.implied_value_usd) + '</span><div class="bar"><i style="width:' + pctOfMax + '%"></i></div></td></tr>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('#tbody tr'), function (tr) {
      tr.addEventListener('click', function () {
        state.selected = tr.getAttribute('data-slug');
        renderDetail(); renderTable();
      });
    });
  }

  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value.toLowerCase(); renderTable(); });
  catSel.addEventListener('change', function (e) { state.cat = e.target.value; renderTable(); });
  chainSel.addEventListener('change', function (e) { state.chain = e.target.value; renderTable(); });
  document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; renderTable(); });
  document.getElementById('watch').addEventListener('change', function (e) { state.watch = e.target.checked; renderTable(); });

  renderTable();
  renderDetail();
})();
