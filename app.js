'use strict';

// ── Logger ──
const log = (...args) => console.log('[Weblist]', ...args);
const warn = (...args) => console.warn('[Weblist]', ...args);
const error = (...args) => console.error('[Weblist]', ...args);

// ── Storage ──
const NS = 'weblist:';

function safeGet(key, fallback) {
  try {
    const raw = localStorage.getItem(NS + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (e) {
    warn('read error for', key, e.message);
    return fallback;
  }
}

function safeSet(key, val) {
  try {
    localStorage.setItem(NS + key, JSON.stringify(val));
    return true;
  } catch (e) {
    error('write error for', key, e.message);
    return false;
  }
}

function safeGetLines(key) {
  try {
    const raw = localStorage.getItem(NS + key);
    if (!raw) return [];
    return raw.split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch (e) {
    warn('readLines error for', key, e.message);
    return [];
  }
}

function safeSetLines(key, arr) {
  try {
    localStorage.setItem(NS + key, arr.map(x => JSON.stringify(x)).join('\n'));
    return true;
  } catch (e) {
    error('writeLines error for', key, e.message);
    return false;
  }
}

// ── Utilities ──
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function getPendingDuration(n) {
  if (n === 0) return 18000000;
  if (n === 1) return 7200000;
  return 3600000;
}

function isToday(ts) {
  const d = new Date(ts);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate();
}

function msUntilMidnight() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1).getTime() - n.getTime();
}

function relativeTime(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

function timeRemaining(ts) {
  const diff = ts - Date.now();
  if (diff <= 0) return 'any moment';
  const s = Math.floor(diff / 1000);
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm left';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h left';
  return Math.floor(h / 24) + 'd left';
}

function getDeviceId() {
  const stored = safeGet('deviceId', null);
  if (stored) return stored;

  const fp = navigator.userAgent + '|' +
    screen.width + 'x' + screen.height + '|' +
    new Date().getTimezoneOffset() + '|' +
    navigator.language;

  let hash = 0;
  for (let i = 0; i < fp.length; i++) {
    hash = ((hash << 5) - hash) + fp.charCodeAt(i);
    hash |= 0;
  }

  const id = 'dev_' + Math.abs(hash).toString(36) + uid().slice(0, 4);
  safeSet('deviceId', id);
  return id;
}

// ── DOM Helper ──
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const attr in attrs) {
      if (attr === 'className') e.className = attrs[attr];
      else if (attr === 'style' && typeof attrs[attr] === 'object') {
        for (const p in attrs[attr]) e.style[p] = attrs[attr][p];
      } else if (attr === 'dataset') {
        for (const k in attrs[attr]) e.dataset[k] = attrs[attr][k];
      } else {
        e.setAttribute(attr, attrs[attr]);
      }
    }
  }
  kids.forEach(child => {
    if (child != null) e.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  });
  return e;
}

// ── State ──
let state = {
  uploads: safeGetLines('uploads'),
  recentlyViewed: safeGetLines('recentlyViewed'),
  voting: safeGet('voting', {}),
  offenses: safeGet('offenses', {}),
  activeIframes: {},
  appealModalId: null,
  search: '',
  searchResults: null,
  resultsPage: 1,
  openMenuId: null,
  urlInput: '',
  tagInput: '',
  submitterInput: '',
  passwordInput: '',
  expandedSections: {},
};

function persist(key) {
  return key === 'uploads' || key === 'recentlyViewed'
    ? safeSetLines(key, state[key])
    : safeSet(key, state[key]);
}

// ── Business Logic ──
function getVote(id) {
  return state.voting[id] || { vote: 0, notVote: 0, offense: 0, type: 'deletion' };
}

function isAppealed(id) {
  return state.voting[id] && state.voting[id].appealTimestamp;
}

const currentDeviceId = getDeviceId();

function handleUpload() {
  const url = state.urlInput.trim();
  if (!url) return;

  const rawTags = state.tagInput.split(',').map(t => t.trim()).filter(Boolean);
  const tagsToAdd = rawTags.filter(t => t[0] !== '-');

  const item = {
    id: uid(),
    timestamp: Date.now(),
    url,
    tags: tagsToAdd,
    submitterId: state.submitterInput.trim() || 'anonymous',
    deviceId: currentDeviceId,
  };

  state.uploads.push(item);
  state.voting[item.id] = { vote: 0, notVote: 0, offense: 0, userVote: null, appealTimestamp: null };
  state.urlInput = '';
  state.tagInput = '';
  state.submitterInput = '';
  persist('uploads');
  persist('voting');
  render();
}

function trackTagClick(tag, itemId) {
  const today = state.recentlyViewed.filter(x => isToday(x.timestamp));
  today.unshift({ tag, itemId, timestamp: Date.now() });
  state.recentlyViewed = today;
  persist('recentlyViewed');
  render();
}

function trackUrlClick(itemId) {
  state.activeIframes[itemId] = !state.activeIframes[itemId];
  const today = state.recentlyViewed.filter(x => isToday(x.timestamp));
  today.unshift({ tag: 'clicked', itemId, timestamp: Date.now() });
  state.recentlyViewed = today;
  persist('recentlyViewed');
  render();
}

const RESULTS_PER_PAGE = 20;

function navigate(base, page) {
  location.hash = page && page > 1 ? base + '/' + page : base;
  handleRoute();
}

function handleRoute() {
  const raw = location.hash.slice(1) || '/';
  const segs = raw.split('/');
  const base = '/' + segs[1] || '/';

  if (base === '/results') {
    state.resultsPage = parseInt(segs[2], 10) || 1;
    if (!state.searchResults && state.search.trim()) {
      doSearch();
    } else {
      render();
    }
  } else {
    state.resultsPage = 1;
    state.searchResults = null;
    render();
  }
}

function doSearch() {
  const q = state.search.trim().toLowerCase();
  if (!q) { state.resultsPage = 1; navigate(''); return; }

  const matched = state.uploads.filter(u =>
    u.url.toLowerCase().includes(q) || u.tags.some(t => t.toLowerCase().includes(q))
  );

  const groups = {};
  matched.forEach(u => {
    if (!groups[u.url]) groups[u.url] = { ids: [], tags: [], timestamp: 0, submitterId: '', deviceId: '' };
    const g = groups[u.url];
    g.ids.push(u.id);
    u.tags.forEach(t => { if (!g.tags.includes(t)) g.tags.push(t); });
    if (u.timestamp > g.timestamp) {
      g.timestamp = u.timestamp; g.submitterId = u.submitterId; g.deviceId = u.deviceId;
    }
  });

  state.searchResults = Object.keys(groups).map(url => {
    const g = groups[url];
    return { id: g.ids[0], url, tags: g.tags, timestamp: g.timestamp, submitterId: g.submitterId, deviceId: g.deviceId, _groupIds: g.ids };
  });

  navigate('/results', 1);
}

function handleVote(itemId, dir) {
  const voting = { ...state.voting };
  if (!voting[itemId]) voting[itemId] = { vote: 0, notVote: 0, offense: 0, type: 'deletion', pendingUntil: null };
  const r = voting[itemId];

  if (r.userVote === dir) dir = null;
  else if (r.userVote === 'agree' && dir === 'disagree') {
    r.vote = Math.max(0, (r.vote || 0) - 1);
    r.notVote = (r.notVote || 0) + 1;
    r.userVote = 'disagree';
  } else if (r.userVote === 'disagree' && dir === 'agree') {
    r.notVote = Math.max(0, (r.notVote || 0) - 1);
    r.vote = (r.vote || 0) + 1;
    r.userVote = 'agree';
  } else if (dir === 'agree') { r.vote = (r.vote || 0) + 1; r.userVote = 'agree'; }
  else if (dir === 'disagree') { r.notVote = (r.notVote || 0) + 1; r.userVote = 'disagree'; }

  if (r.type === 'tag') {
    if (r.vote > r.notVote) {
      state.uploads = state.uploads.map(u => {
        if (u.id === itemId && r.suggestedTag && !u.tags.includes(r.suggestedTag)) return { ...u, tags: [...u.tags, r.suggestedTag] };
        return u;
      });
      persist('uploads');
    }
  } else {
    r.pendingUntil = r.vote > r.notVote ? Date.now() + getPendingDuration(state.offenses[itemId] || 0) : null;
  }

  state.voting = voting;
  persist('voting');
  render();
}

function openAppealModal(id) { state.appealModalId = id; state.openMenuId = null; render(); }

function submitAppeal(type) {
  const id = state.appealModalId;
  if (!id) return;

  let suggestedTag = null;
  if (type === 'tag') {
    suggestedTag = prompt('Enter suggested tag:');
    if (!suggestedTag || !suggestedTag.trim()) { state.appealModalId = null; render(); return; }
  }

  const voting = { ...state.voting };
  if (!voting[id]) voting[id] = { vote: 0, notVote: 0, offense: 0, userVote: null, type };
  voting[id].appealTimestamp = Date.now();
  voting[id].type = type;
  if (suggestedTag) voting[id].suggestedTag = suggestedTag.trim();

  state.voting = voting;
  state.appealModalId = null;
  persist('voting');
  render();
}

function handleInstantDelete(itemId) {
  const password = prompt('Enter password to instantly delete this item:');
  if (!password || !password.trim()) { alert('Delete canceled. Password is required.'); return; }
  const upload = state.uploads.find(u => u.id === itemId);
  if (upload && password !== upload.submitterId + ':' + upload.id.slice(0, 6)) {
    alert('Incorrect password. Delete canceled.');
    return;
  }
  state.uploads = state.uploads.filter(u => u.id !== itemId);
  state.recentlyViewed = state.recentlyViewed.filter(v => v.itemId !== itemId);
  state.openMenuId = null;
  state.passwordInput = '';
  persist('uploads');
  persist('recentlyViewed');
  render();
}

function handleReportDeletion(itemId) {
  const voting = { ...state.voting };
  if (!voting[itemId]) voting[itemId] = { vote: 0, notVote: 0, offense: 0, userVote: null, type: 'deletion', appealTimestamp: Date.now(), pendingUntil: null };
  else {
    voting[itemId].appealTimestamp = Date.now();
    voting[itemId].type = 'deletion';
  }
  state.voting = voting;
  state.openMenuId = null;
  persist('voting');
  render();
}

function handleOwnerTag(itemId) {
  const tag = prompt('Enter a tag to add:');
  if (!tag || !tag.trim()) { state.openMenuId = null; render(); return; }
  state.uploads = state.uploads.map(u => {
    if (u.id === itemId && !u.tags.includes(tag.trim())) return { ...u, tags: [...u.tags, tag.trim()] };
    return u;
  });
  state.openMenuId = null;
  persist('uploads');
  render();
}

// ── Component Builders ──
const VISIBLE_LIMIT = 5;
const SCREENSHOT_API = 'https://pageshot.site/v1/screenshot';

function isImageUrl(url) {
  return /\.(png|jpg|jpeg|gif|svg|webp|bmp|ico)(\?|#|$)/i.test(url);
}

function screenshotUrl(url) {
  return SCREENSHOT_API + '?url=' + encodeURIComponent(url);
}

function buildKebab(id) {
  const upload = state.uploads.find(u => u.id === id);
  const isOwner = upload && upload.deviceId === currentDeviceId;
  const v = state.voting[id];
  const wrap = el('span', { className: 'kebab-wrap' },
    el('button', { className: 'kebab-btn', dataset: { action: 'kebab-toggle', id } }, '\u22EE'),
  );

  if (state.openMenuId === id) {
    const menu = el('div', { className: 'kebab-menu' });
    if (v && v.pendingUntil) {
      const h = Math.round(getPendingDuration(state.offenses[id] || 0) / 3600000);
      menu.appendChild(el('div', { style: { padding: '6px 10px', fontSize: 12, color: '#800000', borderBottom: '1px solid #C0C0C0' } },
        'Deletion: ' + timeRemaining(v.pendingUntil) + ' (interval ' + h + 'h)',
      ));
    }
    menu.appendChild(el('button', { dataset: { action: 'report-del', id } }, '\uD83D\uDCA5 Report Deletion'));
    menu.appendChild(el('button', { dataset: { action: 'instant-delete', id } }, '\uD83D\uDD11 Delete (Instant)'));
    if (isOwner) menu.appendChild(el('button', { dataset: { action: 'owner-tag', id } }, 'Modification'));
    wrap.appendChild(menu);
  }
  return wrap;
}

function buildPreview(id, url) {
  if (!state.activeIframes[id]) return el('div', { className: 'item-iframe', style: { display: 'none' } });
  const img = isImageUrl(url);
  return el('img', {
    className: 'item-iframe',
    src: img ? url : screenshotUrl(url),
    style: { objectFit: img ? 'contain' : 'cover', background: img ? '#FFF' : '#EEE', display: 'block' },
  });
}

function buildAutoPreview(url) {
  const img = isImageUrl(url);
  return el('img', {
    className: 'item-iframe',
    src: img ? url : screenshotUrl(url),
    style: { objectFit: img ? 'contain' : 'cover', background: '#EEE', display: 'block' },
  });
}

function renderList(items, fn, sectionKey) {
  if (!items.length) return el('div', { className: 'empty-state' }, el('p', null, 'Nothing here yet.'));
  const showAll = sectionKey && state.expandedSections[sectionKey];
  const visible = showAll ? items : items.slice(0, VISIBLE_LIMIT);
  const container = el('div', { className: 'card-scroll' });
  visible.forEach(i => { const r = fn(i); if (r) container.appendChild(r); });
  if (sectionKey && items.length > VISIBLE_LIMIT && !showAll) {
    container.appendChild(el('button', {
      className: 'tag-btn', style: { marginTop: 8, width: '100%', textAlign: 'center' },
      dataset: { action: 'show-more', section: sectionKey },
    }, 'Show more (' + (items.length - VISIBLE_LIMIT) + ' remaining)'));
  }
  return container;
}

function section(title, count, content) {
  return el('div', { className: 'card' },
    el('div', { className: 'card-header' },
      el('span', { className: 'card-title' }, title),
      el('span', { className: 'card-count' }, count + ' item' + (count > 1 ? 's' : '')),
    ),
    content,
  );
}

// ── Main Render ──
let renderCount = 0;

function render() {
  renderCount++;
  const now = Date.now();

  // Governance
  for (const id in state.voting) {
    const r = state.voting[id];
    if (r.type !== 'tag' && r.pendingUntil && now >= r.pendingUntil && r.vote > r.notVote) {
      r.pendingUntil = null;
      const count = (state.offenses[id] || 0) + 1;
      state.offenses = { ...state.offenses, [id]: count };
      persist('offenses');
      if (count >= 2) {
        state.uploads = state.uploads.filter(u => u.id !== id);
        state.recentlyViewed = state.recentlyViewed.filter(v => v.itemId !== id);
        persist('uploads');
        persist('recentlyViewed');
      }
    }
  }
  persist('voting');

  // Clean orphaned views
  const valid = {};
  state.uploads.forEach(u => valid[u.id] = true);
  state.recentlyViewed = state.recentlyViewed.filter(e => valid[e.itemId]);

  const todayViewed = state.recentlyViewed.filter(x => isToday(x.timestamp));
  const appealedItems = state.uploads.filter(u => isAppealed(u.id));
  const showingSearch = state.searchResults !== null;

  const root = document.getElementById('root');
  if (!root) return;
  const parts = [];

  // Header
  parts.push(el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 } },
    el('span', { style: { fontSize: 24, fontWeight: 'bold', color: '#000080' } }, showingSearch ? 'Search Results' : 'Weblist'),
    showingSearch ? el('button', { id: 'clear-search', className: 'btn-submit', style: { marginTop: 0 } }, '\u2716 Clear') : null,
  ));

  // Search bar
  parts.push(el('div', { className: 'search-box' },
    el('input', { id: 'search-input', placeholder: 'Search activities...', value: state.search }),
    el('button', { id: 'search-btn' }, '\uD83D\uDD0D Search'),
  ));

  if (showingSearch) {
    // Related tags
    const seed = [];
    const relTags = [];
    state.searchResults.forEach(r => (r.tags || []).forEach(t => { if (!seed.includes(t) && !relTags.includes(t)) { seed.push(t); relTags.push(t); } }));
    state.uploads.forEach(u => { if (u.tags.some(t => seed.includes(t))) u.tags.forEach(t => { if (!relTags.includes(t)) relTags.push(t); }); });

    if (relTags.length) {
      const frag = document.createDocumentFragment();
      relTags.forEach(t => frag.appendChild(el('button', { className: 'tag-btn', dataset: { action: 'tag-search', tag: t } }, t)));
      parts.push(section('Related Tags', relTags.length, el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } }, frag)));
    }

    // Results
    const total = state.searchResults.length;
    const pages = Math.ceil(total / RESULTS_PER_PAGE) || 1;
    const cur = Math.min(state.resultsPage, pages);
    const start = (cur - 1) * RESULTS_PER_PAGE;
    const pageItems = state.searchResults.slice(start, start + RESULTS_PER_PAGE);

    parts.push(section('Search Results ' + cur + '/' + pages, total,
      renderList(pageItems, item => el('div', { className: 'item-row' },
        el('div', null, el('span', { className: 'url-link', dataset: { action: 'url-click', id: item.id } }, item.url)),
        el('div', { className: 'item-meta' },
          relativeTime(item.timestamp),
          item._groupIds && item._groupIds.length > 1 ? ' (merged from ' + item._groupIds.length + ' entries)' : '',
        ),
        el('div', { style: { marginTop: 6, display: 'flex', alignItems: 'center', flexWrap: 'wrap' } },
          (() => { const f = document.createDocumentFragment(); (item.tags || []).forEach(t => f.appendChild(el('button', { className: 'tag-btn', dataset: { action: 'tag-search', tag: t } }, t))); f.appendChild(buildKebab(item.id)); return f; })(),
        ),
        buildAutoPreview(item.url),
      )),
    ));

    if (pages > 1) {
      const nav = el('div', { style: { display: 'flex', justifyContent: 'center', gap: 6, marginTop: 12 } });
      for (let p = 1; p <= pages; p++) nav.appendChild(el('button', { className: 'tag-btn', style: p === cur ? { background: '#000080', color: '#FFF', borderColor: '#000080' } : {}, dataset: { action: 'go-page', page: p } }, '' + p));
      parts.push(nav);
    }
  } else {
    // Submit form
    parts.push(el('div', { className: 'card' },
      el('div', { className: 'card-header', style: { borderBottom: 'none', paddingBottom: 0, marginBottom: 16 } },
        el('span', { className: 'card-title' }, '\uD83D\uDD17 Submit New Link'),
      ),
      el('div', { className: 'form-grid' },
        el('div', { className: 'form-group' }, el('label', null, 'URL *'), el('input', { id: 'url-input', placeholder: 'https://example.com', value: state.urlInput })),
        el('div', { className: 'form-group' },
          el('label', null, 'Tag'),
          el('input', { id: 'tag-input', placeholder: 'e.g., tutorial, news', value: state.tagInput }),
          el('div', { style: { fontSize: 12, color: '#808080', marginTop: 4 } }, 'Tags can only be modified through tag suggestion appeals'),
        ),
        el('div', { className: 'form-group', style: { minWidth: 160, flex: '0 1 auto' } }, el('label', null, 'Your name'), el('input', { id: 'submitter-input', placeholder: '(optional)', value: state.submitterInput })),
        el('div', { className: 'form-group', style: { minWidth: 160, flex: '0 1 auto' } }, el('label', null, 'Password'), el('input', { id: 'password-input', type: 'password', placeholder: 'optional; delete asks for password', value: state.passwordInput })),
      ),
      el('button', { id: 'submit-btn', className: 'btn-submit' }, '\u2728 Analyze & Submit'),
    ));

    // Activity
    parts.push(section('Recent Activity', appealedItems.length,
      renderList(appealedItems, item => {
        const v = getVote(item.id);
        return el('div', { className: 'item-row' },
          el('div', null, el('span', { className: 'url-link', dataset: { action: 'url-click', id: item.id } }, item.url)),
          el('div', { className: 'item-meta' },
            'Appealed ' + (v.appealTimestamp ? relativeTime(v.appealTimestamp) : 'recently') +
            ' \u2022 ' + (v.type === 'tag' ? 'Tag suggestion' : 'Deletion') +
            (v.suggestedTag ? ' \u2192 "' + v.suggestedTag + '"' : ''),
          ),
          el('div', { style: { marginTop: 8, display: 'flex', alignItems: 'center' } },
            el('button', { className: 'vote-btn' + (v.userVote === 'agree' ? ' vote-btn-active' : ''), dataset: { action: 'vote', id: item.id, dir: 'agree' } }, 'Agree (\u2191)' + (v.userVote === 'agree' ? ' \u2713' : '')),
            el('span', { className: 'vote-count' }, (v.vote || 0) + ' / ' + (v.notVote || 0)),
            el('button', { className: 'vote-btn' + (v.userVote === 'disagree' ? ' vote-btn-active' : ''), dataset: { action: 'vote', id: item.id, dir: 'disagree' } }, 'Disagree (\u2193)' + (v.userVote === 'disagree' ? ' \u2713' : '')),
            buildKebab(item.id),
          ),
          buildPreview(item.id, item.url),
          v.type === 'tag' && v.suggestedTag && v.vote > v.notVote
            ? el('div', { style: { marginTop: 4 } }, el('span', { className: 'approved-tag' }, 'Tag "' + v.suggestedTag + '" approved'))
            : null,
        );
      }, 'activity'),
    ));

    // Uploads
    parts.push(section('Recent Uploads', state.uploads.length,
      renderList(state.uploads, item => {
        const vr = state.voting[item.id];
        const pending = vr && vr.pendingUntil;
        return el('div', { className: 'item-row' },
          el('div', null, el('span', { className: 'url-link', dataset: { action: 'url-click', id: item.id } }, item.url)),
          el('div', { className: 'item-meta' },
            relativeTime(item.timestamp) +
            (item.submitterId !== 'anonymous' ? ' by ' + item.submitterId : '') +
            (pending ? ' \u2022 ' + timeRemaining(pending) : ''),
          ),
          el('div', { style: { marginTop: 6, display: 'flex', alignItems: 'center', flexWrap: 'wrap' } },
            (() => { const f = document.createDocumentFragment(); item.tags.forEach(t => f.appendChild(el('button', { className: 'tag-btn', dataset: { action: 'tag-click', tag: t, id: item.id } }, t))); f.appendChild(buildKebab(item.id)); return f; })(),
          ),
          buildPreview(item.id, item.url),
        );
      }, 'uploads'),
    ));

    // Viewed
    parts.push(section('Recently Viewed', todayViewed.length,
      renderList(todayViewed, entry => {
        const linked = state.uploads.find(u => u.id === entry.itemId);
        if (!linked) return null;
        return el('div', { className: 'item-row' },
          el('div', null, el('span', { className: 'url-link', dataset: { action: 'url-click', id: linked.id } }, linked.url)),
          el('div', { style: { marginTop: 4 } }, buildKebab(linked.id)),
          buildPreview(linked.id, linked.url),
        );
      }, 'viewed'),
    ));
  }

  // Appeal modal
  if (state.appealModalId) {
    parts.push(el('div', { className: 'modal-overlay', dataset: { action: 'close-appeal' } },
      el('div', { className: 'modal-box', style: { cursor: 'default' } },
        el('h4', null, 'Appeal for Vote'),
        el('p', null, 'Choose the type of appeal:'),
        el('button', { className: 'modal-opt', dataset: { action: 'appeal-tag' } }, '\uD83C\uDFF7 Modification'),
        el('button', { className: 'modal-opt', dataset: { action: 'appeal-del' } }, '\uD83D\uDEA8 Deletion'),
        el('button', { className: 'modal-cancel', dataset: { action: 'close-appeal' } }, 'Cancel'),
      ),
    ));
  }

  root.innerHTML = '';
  parts.forEach(p => root.appendChild(p));
}

// ── Events ──
document.addEventListener('click', e => {
  const t = e.target;
  const ds = t.dataset;
  const action = ds && ds.action;
  const id = ds && ds.id;

  switch (action) {
    case 'url-click': e.preventDefault(); trackUrlClick(id); break;
    case 'tag-click': trackTagClick(t.dataset.tag, id); break;
    case 'tag-search': state.search = t.dataset.tag; state.resultsPage = 1; doSearch(); break;
    case 'kebab-toggle': state.openMenuId = state.openMenuId === id ? null : id; render(); break;
    case 'appeal': openAppealModal(id); break;
    case 'appeal-tag': submitAppeal('tag'); break;
    case 'appeal-del': submitAppeal('deletion'); break;
    case 'instant-delete': handleInstantDelete(id); break;
    case 'report-del': handleReportDeletion(id); break;
    case 'close-appeal': state.appealModalId = null; render(); break;
    case 'owner-delete': handleOwnerDelete(id); break;
    case 'owner-tag': handleOwnerTag(id); break;
    case 'vote': handleVote(id, t.dataset.dir); break;
    case 'show-more': state.expandedSections[t.dataset.section] = true; render(); break;
    case 'go-page': state.resultsPage = parseInt(t.dataset.page, 10); navigate('/results', state.resultsPage); break;
  }

  if (t.id === 'submit-btn') handleUpload();
  else if (t.id === 'search-btn') doSearch();
  else if (t.id === 'clear-search') { state.searchResults = null; state.search = ''; navigate(''); }
});

document.addEventListener('input', e => {
  const v = e.target.value;
  switch (e.target.id) {
    case 'search-input': state.search = v; break;
    case 'url-input': state.urlInput = v; break;
    case 'tag-input': state.tagInput = v; break;
    case 'submitter-input': state.submitterInput = v; break;
    case 'password-input': state.passwordInput = v; break;
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'search-input') doSearch();
});

document.addEventListener('mousedown', e => {
  if (state.openMenuId && !e.target.closest('.kebab-wrap')) { state.openMenuId = null; render(); }
});

// ── Midnight expiry ──
setTimeout(function tick() {
  state.recentlyViewed = state.recentlyViewed.filter(x => isToday(x.timestamp));
  persist('recentlyViewed');
  render();
  setTimeout(tick, msUntilMidnight());
}, msUntilMidnight());

// ── Routing & Boot ──
window.addEventListener('hashchange', handleRoute);
handleRoute();
