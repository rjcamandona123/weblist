(function () {
  'use strict';

  var NS = 'weblist:';

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function safeRead(key, fallback) {
    try { var r = localStorage.getItem(NS + key); return r ? JSON.parse(r) : fallback; }
    catch (e) { return fallback; }
  }
  function safeWrite(key, val) {
    try { localStorage.setItem(NS + key, JSON.stringify(val)); return true; }
    catch (e) { return false; }
  }

  function isToday(ts) {
    var d = new Date(ts);
    var n = new Date();
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  }

  function msUntilMidnight() {
    var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1).getTime() - n.getTime();
  }

  function relativeTime(ts) {
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    var m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  function getDeviceId() {
    var s = safeRead('deviceId', null);
    if (s) return s;
    var r = navigator.userAgent + '|' + screen.width + 'x' + screen.height + '|' + new Date().getTimezoneOffset() + '|' + navigator.language;
    for (var h = 0, i = 0; i < r.length; i++) { h = ((h << 5) - h) + r.charCodeAt(i); h |= 0; }
    var id = 'dev_' + Math.abs(h).toString(36) + uid().slice(0, 4);
    safeWrite('deviceId', id);
    return id;
  }

  // ── State ──
  var state = {
    uploads: safeRead('uploads', []),
    recentlyViewed: safeRead('recentlyViewed', []),
    voting: safeRead('voting', {}),
    offenses: safeRead('offenses', {}),
    deletionQueue: safeRead('deletionQueue', []),
    activeIframes: {},
    appealModalId: null,
    search: '',
    searchResults: null,
    openMenuId: null,
    urlInput: '',
    tagInput: '',
    submitterInput: ''
  };

  function persist(k) { safeWrite(k, state[k]); }

  // ── Helpers ──
  function el(tag, attrs) {
    for (var _len = arguments.length, kids = Array(_len > 2 ? _len - 2 : 0), _key = 2; _key < _len; _key++) kids[_key - 2] = arguments[_key];
    var e = document.createElement(tag);
    if (attrs) for (var a in attrs) {
      if (a === 'className') e.className = attrs[a];
      else if (a === 'style' && typeof attrs[a] === 'object') for (var s in attrs[a]) e.style[s] = attrs[a][s];
      else if (a === 'dataset') for (var d in attrs[a]) e.dataset[d] = attrs[a][d];
      else e.setAttribute(a, attrs[a]);
    }
    kids.forEach(function (k) { if (k != null) e.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); });
    return e;
  }

  function html(str) { var d = document.createElement('div'); d.innerHTML = str; return d.firstElementChild || d; }

  // ── Core Logic ──
  function getVoteRecord(id) { return state.voting[id] || { vote: 0, notVote: 0, offense: 0, queueTimestamp: null, type: 'deletion' }; }

  function isAppealed(id) { return state.voting[id] && state.voting[id].appealTimestamp; }

  function hiddenIds() {
    var s = new Set();
    (state.deletionQueue || []).forEach(function (e) { s.add(e.itemId); });
    return s;
  }

  function handleUpload() {
    var url = state.urlInput.trim();
    if (!url) return;
    var tags = state.tagInput.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
    var item = { id: uid(), timestamp: Date.now(), url: url, tags: tags, submitterId: state.submitterInput.trim() || 'anonymous', deviceId: getDeviceId() };
    state.uploads.push(item);
    state.voting[item.id] = { vote: 0, notVote: 0, offense: 0, queueTimestamp: null, appealTimestamp: null };
    state.urlInput = ''; state.tagInput = ''; state.submitterInput = '';
    persist('uploads'); persist('voting');
    render();
  }

  function trackTagClick(tag, itemId) {
    var v = safeRead('recentlyViewed', []).filter(function (x) { return isToday(x.timestamp); });
    v.unshift({ tag: tag, itemId: itemId, timestamp: Date.now() });
    state.recentlyViewed = v;
    safeWrite('recentlyViewed', v);
    render();
  }

  function trackUrlClick(itemId) {
    state.activeIframes[itemId] = !state.activeIframes[itemId];
    var v = safeRead('recentlyViewed', []).filter(function (x) { return isToday(x.timestamp); });
    v.unshift({ tag: 'clicked', itemId: itemId, timestamp: Date.now() });
    state.recentlyViewed = v;
    safeWrite('recentlyViewed', v);
    render();
  }

  function doSearch() {
    var q = state.search.trim().toLowerCase();
    if (!q) { state.searchResults = null; render(); return; }
    var matched = state.uploads.filter(function (u) {
      return u.url.toLowerCase().indexOf(q) !== -1 || u.tags.some(function (t) { return t.toLowerCase().indexOf(q) !== -1; });
    });
    var groups = {};
    matched.forEach(function (u) {
      if (!groups[u.url]) groups[u.url] = { ids: [], tags: [], timestamp: 0, submitterId: '', deviceId: '' };
      var g = groups[u.url];
      g.ids.push(u.id);
      u.tags.forEach(function (t) { if (g.tags.indexOf(t) === -1) g.tags.push(t); });
      if (u.timestamp > g.timestamp) { g.timestamp = u.timestamp; g.submitterId = u.submitterId; g.deviceId = u.deviceId; }
    });
    state.searchResults = Object.keys(groups).map(function (url) {
      var g = groups[url];
      return { id: g.ids[0], url: url, tags: g.tags, timestamp: g.timestamp, submitterId: g.submitterId, deviceId: g.deviceId, _groupIds: g.ids };
    });
    render();
  }

  function handleVote(itemId, dir) {
    var v = Object.assign({}, state.voting);
    if (!v[itemId]) v[itemId] = { vote: 0, notVote: 0, offense: 0, type: 'deletion', pendingUntil: null };
    if (dir === 'agree') v[itemId].vote = (v[itemId].vote || 0) + 1;
    else v[itemId].notVote = (v[itemId].notVote || 0) + 1;
    var rec = v[itemId];
    if (rec.type === 'tag') {
      if (rec.vote > rec.notVote) {
        state.uploads = state.uploads.map(function (u) {
          if (u.id === itemId && rec.suggestedTag && u.tags.indexOf(rec.suggestedTag) === -1) u.tags.push(rec.suggestedTag);
          return u;
        });
        persist('uploads');
      }
    } else {
      if (rec.vote > rec.notVote) {
        if (!rec.pendingUntil) rec.pendingUntil = Date.now() + 86400000;
      } else {
        rec.pendingUntil = null;
      }
    }
    state.voting = v;
    persist('voting');
    render();
  }

  function openAppealModal(itemId) {
    state.appealModalId = itemId;
    state.openMenuId = null;
    render();
  }

  function submitAppeal(type) {
    var itemId = state.appealModalId;
    if (!itemId) return;
    var tag = type === 'tag' ? prompt('Enter suggested tag:') : null;
    if (type === 'tag' && (!tag || !tag.trim())) { state.appealModalId = null; render(); return; }
    var v = Object.assign({}, state.voting);
    if (!v[itemId]) v[itemId] = { vote: 0, notVote: 0, offense: 0, queueTimestamp: null, type: type };
    v[itemId].appealTimestamp = Date.now();
    v[itemId].type = type;
    if (tag) v[itemId].suggestedTag = tag.trim();
    state.voting = v;
    state.appealModalId = null;
    persist('voting');
    render();
  }

  function handleOwnerDelete(itemId) {
    state.uploads = state.uploads.filter(function (u) { return u.id !== itemId; });
    state.openMenuId = null;
    persist('uploads');
    render();
  }

  function handleOwnerTag(itemId) {
    var tag = prompt('Enter a tag to add:');
    if (!tag || !tag.trim()) { state.openMenuId = null; render(); return; }
    state.uploads = state.uploads.map(function (u) {
      if (u.id === itemId && u.tags.indexOf(tag.trim()) === -1) u.tags.push(tag.trim());
      return u;
    });
    state.openMenuId = null;
    persist('uploads');
    render();
  }

  // ── Render ──
  function render() {
    // Process expired pending deletions
    var now = Date.now();
    for (var pid in state.voting) {
      var r = state.voting[pid];
      if (r.type !== 'tag' && r.pendingUntil && now >= r.pendingUntil && r.vote > r.notVote) {
        r.pendingUntil = null;
        var o = Object.assign({}, state.offenses);
        var cur = o[pid] || 0;
        o[pid] = cur + 1;
        state.offenses = o;
        persist('offenses');
        if (cur + 1 >= 2) {
          state.uploads = state.uploads.filter(function (u) { return u.id !== pid; });
          state.recentlyViewed = state.recentlyViewed.filter(function (v) { return v.itemId !== pid; });
          persist('uploads');
          persist('recentlyViewed');
        }
      }
    }
    persist('voting');

    var viewed = state.recentlyViewed.filter(function (x) { return isToday(x.timestamp); });
    var hidden = hiddenIds();
    var visibleActivity = state.uploads.filter(function (u) { return isAppealed(u.id) && !hidden.has(u.id); });
    var did = getDeviceId();

    var root = document.getElementById('root');

    // ── helpers ──
    function itemMeta(str) { return el('div', { className: 'item-meta' }, str); }

    function kebab(id) {
      var item = state.uploads.find(function (u) { return u.id === id; });
      var isOwner = item && item.deviceId === did;
      var wrap = el('span', { className: 'kebab-wrap' },
        el('button', { className: 'kebab-btn', dataset: { action: 'kebab-toggle', id: id } }, '\u22EE')
      );
      if (state.openMenuId === id) {
        var menu = el('div', { className: 'kebab-menu' });
        if (isOwner) {
          menu.appendChild(el('button', { dataset: { action: 'owner-delete', id: id } }, 'Delete'));
          menu.appendChild(el('button', { dataset: { action: 'owner-tag', id: id } }, 'Tag'));
        } else {
          menu.appendChild(el('button', { dataset: { action: 'appeal', id: id } }, 'Appeal for Vote'));
        }
        wrap.appendChild(menu);
      }
      return wrap;
    }

    function itemIframe(id, url) {
      var active = state.activeIframes[id];
      if (!active) return el('div', { className: 'item-iframe', style: { display: 'none' } });
      var imgExt = url.match(/\.(png|jpg|jpeg|gif|svg|webp|bmp|ico)(\?|#|$)/i);
      if (imgExt) return el('img', { className: 'item-iframe', src: url, style: { objectFit: 'contain', background: '#FFF', display: 'block' } });
      return el('iframe', { className: 'item-iframe', src: url, sandbox: 'allow-scripts allow-same-origin allow-forms', style: { display: 'block' } });
    }

    function renderItems(arr, fn) {
      if (arr.length === 0) return el('div', { className: 'empty-state' }, el('p', null, 'Nothing here yet.'));
      var scroll = el('div', { className: 'card-scroll' });
      arr.forEach(function (x) {
        var row = fn(x);
        if (row) scroll.appendChild(row);
      });
      return scroll;
    }

    function sec(title, count, content) {
      return el('div', { className: 'card' },
        el('div', { className: 'card-header' },
          el('span', { className: 'card-title' }, title),
          el('span', { className: 'card-count' }, count + ' item' + (count > 1 ? 's' : ''))
        ),
        content
      );
    }

    // ── Build DOM ──
    var parts = [];

    // header
    parts.push(el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 } },
      el('span', { style: { fontSize: 24, fontWeight: 'bold', color: '#000080' } }, 'Weblist')
    ));

    // search
    parts.push(el('div', { className: 'search-box' },
      el('input', { id: 'search-input', placeholder: 'Search activities...', value: state.search }),
      el('button', { id: 'search-btn' }, '\uD83D\uDD0D Search')
    ));

    // form
    parts.push(el('div', { className: 'card' },
      el('div', { className: 'card-header', style: { borderBottom: 'none', paddingBottom: 0, marginBottom: 16 } },
        el('span', { className: 'card-title' }, '\uD83D\uDD17 Submit New Link')
      ),
      el('div', { className: 'form-grid' },
        el('div', { className: 'form-group' },
          el('label', null, 'URL *'),
          el('input', { id: 'url-input', placeholder: 'https://example.com', value: state.urlInput })
        ),
        el('div', { className: 'form-group' },
          el('label', null, 'Tag'),
          el('input', { id: 'tag-input', placeholder: 'e.g., tutorial, news', value: state.tagInput })
        ),
        el('div', { className: 'form-group', style: { minWidth: 160, flex: '0 1 auto' } },
          el('label', null, 'Your name'),
          el('input', { id: 'submitter-input', placeholder: '(optional)', value: state.submitterInput })
        )
      ),
      el('button', { id: 'submit-btn', className: 'btn-submit' }, '\u2728 Analyze & Submit')
    ));

    // Search Results
    if (state.searchResults !== null) {
      parts.push(sec('Search Results', state.searchResults.length,
        renderItems(state.searchResults, function (item) {
          return el('div', { className: 'item-row' },
            el('div', null, el('span', { className: 'url-link', dataset: { action: 'url-click', id: item.id } }, item.url)),
            el('div', { className: 'item-meta' },
              relativeTime(item.timestamp),
              item._groupIds && item._groupIds.length > 1 ? ' (merged from ' + item._groupIds.length + ' entries)' : ''
            ),
            el('div', { style: { marginTop: 6, display: 'flex', alignItems: 'center', flexWrap: 'wrap' } },
              (function () {
                var frag = document.createDocumentFragment();
                (item.tags || []).forEach(function (tag) {
                  frag.appendChild(el('span', { style: { display: 'inline-block', padding: '2px 8px', margin: '3px 3px 0 0', border: '2px outset #C0C0C0', background: '#E0E0E0', color: '#000', fontSize: 12, fontWeight: 'bold', fontFamily: "'Times New Roman', Times, Georgia, serif" } }, tag));
                });
                frag.appendChild(el('span', { className: 'kebab-wrap' },
                  el('button', { className: 'kebab-btn', dataset: { action: 'kebab-toggle', id: item.id } }, '\u22EE'),
                  state.openMenuId === item.id
                    ? el('div', { className: 'kebab-menu' },
                        item.deviceId === did
                          ? el('div', null,
                              el('button', { dataset: { action: 'owner-delete', id: item.id } }, 'Delete'),
                              el('button', { dataset: { action: 'owner-tag', id: item.id } }, 'Tag')
                            )
                          : el('button', { dataset: { action: 'appeal', id: item.id } }, 'Appeal for Vote')
                      )
                    : null
                ));
                return frag;
              })()
            ),
            itemIframe(item.id, item.url)
          );
        })
      ));
    }

    // Recent Activity
    parts.push(sec('Recent Activity', visibleActivity.length,
      renderItems(visibleActivity, function (item) {
        var rec = getVoteRecord(item.id);
        return el('div', { className: 'item-row' },
          el('div', null, el('span', { className: 'url-link', dataset: { action: 'url-click', id: item.id } }, item.url)),
          el('div', { className: 'item-meta' },
            'Appealed ' + (rec.appealTimestamp ? relativeTime(rec.appealTimestamp) : 'recently'),
            ' \u2022 ' + (rec.type === 'tag' ? 'Tag suggestion' : 'Deletion'),
            rec.suggestedTag ? ' \u2192 "' + rec.suggestedTag + '"' : '',
            rec.pendingUntil ? ' \u23F3 Fact checking' : rec.vote + rec.notVote > 0 ? ' \u2705 Fact checked' : ' \uD83D\uDD0D Awaiting fact check'
          ),
          el('div', { style: { marginTop: 8, display: 'flex', alignItems: 'center' } },
            el('button', { className: 'vote-btn', dataset: { action: 'vote', id: item.id, dir: 'agree' } }, 'Agree (\u2191)'),
            el('span', { className: 'vote-count' }, (rec.vote || 0) + ' / ' + (rec.notVote || 0)),
            el('button', { className: 'vote-btn', dataset: { action: 'vote', id: item.id, dir: 'disagree' } }, 'Disagree (\u2193)'),
            kebab(item.id)
          ),
          itemIframe(item.id, item.url),
          rec.type === 'tag' && rec.suggestedTag && rec.vote > rec.notVote
            ? el('div', { style: { marginTop: 4 } }, el('span', { className: 'approved-tag' }, 'Tag "' + rec.suggestedTag + '" approved'))
            : null
        );
      })
    ));

    // Recent Uploads
    parts.push(sec('Recent Uploads', state.uploads.length,
      renderItems(state.uploads, function (item) {
        if (hidden.has(item.id)) return null;
        return el('div', { className: 'item-row' },
          el('div', null, el('span', { className: 'url-link', dataset: { action: 'url-click', id: item.id } }, item.url)),
          el('div', { className: 'item-meta' },
            relativeTime(item.timestamp),
            item.submitterId && item.submitterId !== 'anonymous' ? ' by ' + item.submitterId : ''
          ),
          el('div', { style: { marginTop: 6, display: 'flex', alignItems: 'center', flexWrap: 'wrap' } },
            (function () {
              var frag = document.createDocumentFragment();
              item.tags.forEach(function (tag, i) {
                frag.appendChild(el('button', { className: 'tag-btn', dataset: { action: 'tag-click', tag: tag, id: item.id } }, tag));
              });
              frag.appendChild(kebab(item.id));
              return frag;
            })()
          ),
          itemIframe(item.id, item.url)
        );
      })
    ));

    // Recently Viewed
    parts.push(sec('Recently Viewed', viewed.length,
      renderItems(viewed, function (entry) {
        var item = state.uploads.find(function (u) { return u.id === entry.itemId; });
        if (!item) return null;
        return el('div', { className: 'item-row' },
          el('div', null, el('span', { className: 'url-link', dataset: { action: 'url-click', id: item.id } }, item.url)),
          el('div', { style: { marginTop: 4 } }, kebab(item.id)),
          itemIframe(item.id, item.url)
        );
      })
    ));

    // Appeal modal
    if (state.appealModalId) {
      parts.push(el('div', { className: 'modal-overlay', dataset: { action: 'close-appeal' } },
        el('div', { className: 'modal-box', style: { cursor: 'default' } },
          el('h4', null, 'Appeal for Vote'),
          el('p', null, 'Choose the type of appeal:'),
          el('button', { className: 'modal-opt', dataset: { action: 'appeal-tag' } }, '\uD83C\uDFF7 Tag suggestion'),
          el('button', { className: 'modal-opt', dataset: { action: 'appeal-del' } }, '\uD83D\uDEA8 Deletion'),
          el('button', { className: 'modal-cancel', dataset: { action: 'close-appeal' } }, 'Cancel')
        )
      ));
    }

    // Replace DOM
    root.innerHTML = '';
    parts.forEach(function (p) { root.appendChild(p); });
  }

  // ── Event Delegation ──
  document.addEventListener('click', function (e) {
    var t = e.target;
    var act = t.dataset && t.dataset.action;
    var id = t.dataset && t.dataset.id;
    if (!act) return;

    if (act === 'url-click') { trackUrlClick(id); e.preventDefault(); }
    else if (act === 'tag-click') { trackTagClick(t.dataset.tag, id); }
    else if (act === 'kebab-toggle') {
      state.openMenuId = state.openMenuId === id ? null : id;
      render();
    }
    else if (act === 'appeal') { openAppealModal(id); }
    else if (act === 'appeal-tag') { submitAppeal('tag'); }
    else if (act === 'appeal-del') { submitAppeal('deletion'); }
    else if (act === 'close-appeal') { state.appealModalId = null; render(); }
    else if (act === 'owner-delete') { handleOwnerDelete(id); }
    else if (act === 'owner-tag') { handleOwnerTag(id); }
    else if (act === 'vote') {
      handleVote(id, t.dataset.dir);
    }
    else if (act === 'modal-close') {
      render();
    }
  });

  // ── Input handling (search, form) ──
  document.addEventListener('input', function (e) {
    var id = e.target.id;
    if (id === 'search-input') { state.search = e.target.value; }
    else if (id === 'url-input') { state.urlInput = e.target.value; }
    else if (id === 'tag-input') { state.tagInput = e.target.value; }
    else if (id === 'submitter-input') { state.submitterInput = e.target.value; }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.id === 'search-input') { doSearch(); }
  });

  // ── Close kebab on outside click ──
  document.addEventListener('mousedown', function (e) {
    if (state.openMenuId && !e.target.closest('.kebab-wrap')) {
      state.openMenuId = null;
      render();
    }
  });

  // ── Form submit via button ──
  document.addEventListener('click', function (e) {
    if (e.target.id === 'submit-btn') handleUpload();
    if (e.target.id === 'search-btn') doSearch();
  });

  // ── Auto-expiry: midnight ──
  setTimeout(function tick() {
    var v = safeRead('recentlyViewed', []).filter(function (x) { return isToday(x.timestamp); });
    state.recentlyViewed = v;
    safeWrite('recentlyViewed', v);
    render();
    setTimeout(tick, msUntilMidnight());
  }, msUntilMidnight());

  // ── Deletion queue ──
  (function () {
    var q = safeRead('deletionQueue', []);
    var now = Date.now();
    var rem = [];
    for (var i = 0; i < q.length; i++) {
      if (q[i].queueTimestamp && now - q[i].queueTimestamp >= 86400000) {
        var u = safeRead('uploads', []).filter(function (x) { return x.id !== q[i].itemId; });
        safeWrite('uploads', u);
      } else { rem.push(q[i]); }
    }
    safeWrite('deletionQueue', rem);
    state.deletionQueue = rem;
  })();

  // ── Initial render ──
  render();
})();
