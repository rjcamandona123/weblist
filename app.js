document.addEventListener('alpine:init', () => {
  Alpine.data('weblist', () => ({
    uploads: [],
    recentlyViewed: [],
    voting: {},
    offenses: {},
    search: '',
    searchResults: null,
    resultsPage: 1,
    openMenuUid: null,
    kebabPos: null,
    contextTarget: null,
    tagMenuPos: null,
    tagLongPressTimer: null,
    longPressFired: false,
    appealModalId: null,
    urlInput: '',
    tagInput: '',
    passwordInput: '',
    expandedSections: {},
    loading: false,
    tick: 0,
    deviceId: '',
    VISIBLE_LIMIT: 5,
    RESULTS_PER_PAGE: 20,
    searchMode: 'all',
    searchLayout: 'list',

    NS: 'weblist:',
    page: '',
    videos: [],
    videoUrl: '',
    videoTitle: '',
    videoTags: '',
    videoPassword: '',
    videoVoting: {},
    videoOffenses: {},
    videoRecentlyViewed: [],
    videoExpandedSections: {},
    videoFrameCache: {},
    videoFrameLoading: {},
    watchId: null,
    watchPlaying: false,
    watchMuted: false,
    watchLooped: false,
    watchCurrentTime: 0,
    watchDuration: 0,
    watchProgress: 0,
    watchViews: {},
    watchFetchedData: null,
    watchFetchLoading: false,
    watchVideoSrc: null,
    watchVideoLoading: false,
    watchFetchInfo: null,
    watchVolume: 1,
    watchProgressBytes: { loaded: 0, total: 0, percent: 0 },
    _watchMS: null,
    _watchSB: null,
    _watchAbort: null,
    _plyr: null,
    searchContentType: 'all',

    init() {
      this.loadState();
      this.deviceId = this.getDeviceId();
      window.addEventListener('hashchange', () => this.handleRoute());
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) { this.tick++; this.processGovernance(); this.videoGovernance(); }
      });
      this.handleRoute();
      this.startMidnightTimer();
      setInterval(() => { this.tick++; this.processGovernance(); this.videoGovernance(); }, 1000);
    },

    safeGet(key, fallback) {
      try {
        const raw = localStorage.getItem(this.NS + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch { return fallback; }
    },
    safeSet(key, val) {
      try { localStorage.setItem(this.NS + key, JSON.stringify(val)); return true; } catch { return false; }
    },
    safeGetLines(key) {
      try {
        const raw = localStorage.getItem(this.NS + key);
        if (!raw) return [];
        return raw.split('\n').filter(Boolean).map(l => JSON.parse(l));
      } catch { return []; }
    },
    safeSetLines(key, arr) {
      try { localStorage.setItem(this.NS + key, arr.map(x => JSON.stringify(x)).join('\n')); return true; } catch { return false; }
    },

    loadState() {
      this.uploads = this.safeGetLines('uploads');
      this.recentlyViewed = this.safeGetLines('recentlyViewed');
      this.voting = this.safeGet('voting', {});
      this.offenses = this.safeGet('offenses', {});
      this.videos = this.safeGetLines('videos');
      this.videoVoting = this.safeGet('videoVoting', {});
      this.videoOffenses = this.safeGet('videoOffenses', {});
      this.videoRecentlyViewed = this.safeGetLines('videoRecentlyViewed');
      this.watchViews = this.safeGet('watchViews', {});
      this.watchViews = this.safeGet('watchViews', {});
    },
    persist(key) {
      if (key === 'uploads' || key === 'recentlyViewed' || key === 'videos' || key === 'videoRecentlyViewed') this.safeSetLines(key, this[key]);
      else this.safeSet(key, this[key]);
    },

    uid() {
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    },
    TOTAL_PENDING: 18000000,
    getPendingDuration(offenseCount) {
      return this.TOTAL_PENDING / Math.pow(2, offenseCount || 0);
    },
    isToday(ts) {
      const d = new Date(ts), n = new Date();
      return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
    },
    msUntilMidnight() {
      const n = new Date();
      return new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1).getTime() - n.getTime();
    },
    relativeTime(ts) {
      const s = Math.floor((Date.now() - ts) / 1000);
      if (s < 60) return 'just now';
      const m = Math.floor(s / 60);
      if (m < 60) return m + 'm ago';
      const h = Math.floor(m / 60);
      if (h < 24) return h + 'h ago';
      return Math.floor(h / 24) + 'd ago';
    },
    timeRemaining(ts, _tick) {
      const diff = ts - Date.now();
      if (diff <= 0) return '00:00:00';
      const s = Math.floor(diff / 1000);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
    },
    countdownProgress(ts, dur) {
      if (!ts || !dur) return 0;
      const diff = ts - Date.now();
      if (diff <= 0) return 100;
      return Math.min(100, Math.round(((dur - diff) / dur) * 100));
    },
    getDeviceId() {
      const stored = this.safeGet('deviceId', null);
      if (stored) return stored;
      const fp = navigator.userAgent + '|' + screen.width + 'x' + screen.height + '|' + new Date().getTimezoneOffset() + '|' + navigator.language;
      let hash = 0;
      for (let i = 0; i < fp.length; i++) { hash = ((hash << 5) - hash) + fp.charCodeAt(i); hash |= 0; }
      const id = 'dev_' + Math.abs(hash).toString(36) + this.uid().slice(0, 4);
      this.safeSet('deviceId', id);
      return id;
    },

    get showingSearch() { return this.searchResults !== null; },
    get appealedItems() { return this.uploads.filter(u => this.voting[u.id] && this.voting[u.id].appealTimestamp); },
    get todayViewed() { return this.recentlyViewed.filter(x => this.isToday(x.timestamp)); },
    get totalResults() { return this.searchResults ? this.searchResults.length : 0; },
    get totalPages() { return Math.ceil(this.totalResults / this.RESULTS_PER_PAGE) || 1; },
    get currentPage() { return Math.min(this.resultsPage, this.totalPages); },
    get pageResults() {
      if (!this.searchResults) return [];
      const start = (this.currentPage - 1) * this.RESULTS_PER_PAGE;
      return this.searchResults.slice(start, start + this.RESULTS_PER_PAGE);
    },
    get relatedTags() {
      if (!this.searchResults) return [];
      const seed = [];
      const tags = [];
      this.searchResults.forEach(r => (r.tags || []).forEach(t => { if (!seed.includes(t) && !tags.includes(t)) { seed.push(t); tags.push(t); } }));
      this.uploads.forEach(u => { if (u.tags.some(t => seed.includes(t))) u.tags.forEach(t => { if (!tags.includes(t)) tags.push(t); }); });
      return tags;
    },
    limited(items, key) {
      if (!items.length) return [];
      if (key && this.expandedSections[key]) return items;
      return items.slice(0, this.VISIBLE_LIMIT);
    },
    get limitedAppealed() { return this.limited(this.appealedItems, 'activity'); },
    get limitedUploads() { return this.limited(this.uploads, 'uploads'); },
    get limitedViewed() { return this.limited(this.todayViewed, 'viewed'); },

    get videoAppealedItems() { return this.videos.filter(v => this.videoVoting[v.id] && this.videoVoting[v.id].appealTimestamp); },
    get videoTodayViewed() { return this.videoRecentlyViewed.filter(x => this.isToday(x.timestamp)); },
    get videoLimitedAppealed() { return this.limited(this.videoAppealedItems, 'videoActivity'); },
    get videoLimitedUploads() { return this.limited(this.videos, 'videoUploads'); },
    get videoLimitedViewed() { return this.limited(this.videoTodayViewed, 'videoViewed'); },

    isOwner(id) {
      const u = this.uploads.find(x => x.id === id);
      return u && u.deviceId === this.deviceId;
    },
    linkedUrl(entry) {
      if (entry.url) return entry.url;
      const u = this.uploads.find(x => x.id === entry.itemId);
      return u ? u.url : '';
    },
    isVideoOwner(id) {
      const v = this.videos.find(x => x.id === id);
      return v && v.deviceId === this.deviceId;
    },
    videoLinkedUrl(entry) {
      if (entry.url) return entry.url;
      const v = this.videos.find(x => x.id === entry.itemId);
      return v ? v.url : '';
    },
    videoAppealMeta(item) {
      const v = this.videoVoting[item.id] || {};
      let s = 'Appealed ' + (v.appealTimestamp ? this.relativeTime(v.appealTimestamp) : 'recently');
      s += ' \u2022 ' + (v.type === 'tag' ? 'Tag suggestion' : 'Deletion');
      if (v.suggestedTag) s += ' \u2192 "' + v.suggestedTag + '"';
      return s;
    },
    appealMeta(item) {
      const v = this.voting[item.id] || {};
      let s = 'Appealed ' + (v.appealTimestamp ? this.relativeTime(v.appealTimestamp) : 'recently');
      s += ' \u2022 ' + (v.type === 'tag' ? 'Tag suggestion' : 'Deletion');
      if (v.suggestedTag) s += ' \u2192 "' + v.suggestedTag + '"';
      return s;
    },
    normalizeUrl(str) {
      try {
        const u = new URL(str);
        u.hostname = u.hostname.replace(/^www\./, '').toLowerCase();
        u.pathname = u.pathname.replace(/\/+$/, '') || '/';
        return u.href.toLowerCase();
      } catch (e) {
        return str.toLowerCase().replace(/\/+$/, '').replace(/^www\./, '');
      }
    },
    getUrlTitle(url) {
      try {
        const u = new URL(url);
        let host = u.hostname.replace(/^www\d*\./, '');
        const parts = host.split('.');
        let name = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
        return name.charAt(0).toUpperCase() + name.slice(1);
      } catch { return url; }
    },
    handleUpload() {
      const url = this.urlInput.trim();
      if (!url) { alert('URL is required.'); return; }
      const norm = this.normalizeUrl(url);
      if (this.uploads.some(u => this.normalizeUrl(u.url) === norm)) { alert('URL already exists.'); return; }
      const tags = this.tagInput.split(',').map(t => t.trim()).filter(Boolean);
      const pwd = this.passwordInput.trim();
      const item = { id: this.uid(), timestamp: Date.now(), url, tags, password: pwd, submitterId: 'anonymous', deviceId: this.deviceId };
      this.uploads = [...this.uploads, item];
      this.voting[item.id] = { vote: 0, notVote: 0, offense: 0, userVote: null, appealTimestamp: null };
      this.urlInput = '';
      this.tagInput = '';
      this.persist('uploads');
      this.persist('voting');
      this.processGovernance();
    },

    trackTagClick(tag, itemId) {
      const today = this.recentlyViewed.filter(x => this.isToday(x.timestamp));
      today.unshift({ tag, itemId, timestamp: Date.now() });
      this.recentlyViewed = today;
      this.persist('recentlyViewed');
    },

    trackUrlClick(itemId, url) {
      window.open(url, '_blank');
      const today = this.recentlyViewed.filter(x => this.isToday(x.timestamp) && x.url !== url);
      today.unshift({ tag: 'clicked', itemId, url, timestamp: Date.now() });
      this.recentlyViewed = today;
      this.persist('recentlyViewed');
    },

    doSearch() {
      if (!this.search.trim()) return;
      this.resultsPage = 1;
      const raw = this.search.trim();
      const textQ = raw.replace(/\/tag:\s*(\S+)/gi, '').trim();
      const exactTag = raw.match(/\/tag:\s*(\S+)/i);
      const tagExact = exactTag ? exactTag[1].toLowerCase() : null;

      let sourceList = [];
      if (this.searchContentType === 'video') {
        sourceList = this.videos.slice();
      } else if (this.searchContentType === 'link') {
        sourceList = this.uploads.slice();
      } else {
        sourceList = this.uploads.concat(this.videos.map(v => ({ ...v, _isVideo: true })));
      }

      let matched = sourceList;
      if (tagExact) {
        matched = matched.filter(u => u.tags.some(t => t.toLowerCase() === tagExact));
      }
      if (textQ) {
        const q = textQ.toLowerCase();
        if (this.searchMode === 'url') matched = matched.filter(u => u.url.toLowerCase().includes(q));
        else if (this.searchMode === 'tags') matched = matched.filter(u => u.tags.some(t => t.toLowerCase().includes(q)));
        else if (this.searchMode === 'title') matched = matched.filter(u => (this.getUrlTitle(u.url) || '').toLowerCase().includes(q));
        else matched = matched.filter(u => u.url.toLowerCase().includes(q) || u.tags.some(t => t.toLowerCase().includes(q)));
      }
      const groups = {};
      matched.forEach(u => {
        if (!groups[u.url]) {
          const isVid = this.searchContentType !== 'link' && (u._isVideo || this.videos.some(v => v.id === u.id));
          groups[u.url] = { ids: [], tags: [], timestamp: 0, submitterId: '', deviceId: '', _isVideo: isVid };
        }
        const g = groups[u.url];
        g.ids.push(u.id);
        u.tags.forEach(t => { if (!g.tags.includes(t)) g.tags.push(t); });
        if (u.timestamp > g.timestamp) { g.timestamp = u.timestamp; g.submitterId = u.submitterId; g.deviceId = u.deviceId; }
      });
      this.searchResults = Object.keys(groups).map(url => {
        const g = groups[url];
        return { id: g.ids[0], url, tags: g.tags, timestamp: g.timestamp, submitterId: g.submitterId, deviceId: g.deviceId, _groupIds: g.ids, _isVideo: g._isVideo };
      });
      this.navigate('/results', 1);
    },

    searchTag(tag) { this.search = tag; this.resultsPage = 1; this.doSearch(); },
    clearSearch() { this.searchResults = null; this.search = ''; this.navigate(''); },

    goVideo() { this.navigate('/video'); },
    submitVideo() {
      const url = this.videoUrl.trim();
      if (!url) { alert('Video URL is required.'); return; }
      const tags = this.videoTags.split(',').map(t => t.trim()).filter(Boolean);
      const pwd = this.videoPassword.trim();
      const title = this.videoTitle.trim() || '';
      const item = { id: this.uid(), timestamp: Date.now(), url, tags, password: pwd, title, submitterId: 'anonymous', deviceId: this.deviceId };
      this.videos = [...this.videos, item];
      this.videoVoting[item.id] = { vote: 0, notVote: 0, offense: 0, userVote: null, appealTimestamp: null };
      this.videoUrl = '';
      this.videoTitle = '';
      this.videoTags = '';
      this.persist('videos');
      this.persist('videoVoting');
      this.videoGovernance();
    },

    handleVote(itemId, dir) {
      const voting = { ...this.voting };
      if (!voting[itemId]) voting[itemId] = { vote: 0, notVote: 0, offense: 0, type: 'deletion', pendingUntil: null };
      const r = voting[itemId];
      if (r.userVote === dir) dir = null;
      else if (r.userVote === 'agree' && dir === 'disagree') { r.vote = Math.max(0, (r.vote || 0) - 1); r.notVote = (r.notVote || 0) + 1; r.userVote = 'disagree'; }
      else if (r.userVote === 'disagree' && dir === 'agree') { r.notVote = Math.max(0, (r.notVote || 0) - 1); r.vote = (r.vote || 0) + 1; r.userVote = 'agree'; }
      else if (dir === 'agree') { r.vote = (r.vote || 0) + 1; r.userVote = 'agree'; }
      else if (dir === 'disagree') { r.notVote = (r.notVote || 0) + 1; r.userVote = 'disagree'; }
      if (r.type === 'tag') {
        if (r.vote > r.notVote) {
          this.uploads = this.uploads.map(u => {
            if (u.id !== itemId) return u;
            let tags = [...u.tags];
            if (r.removeTags) r.removeTags.forEach(t => { tags = tags.filter(x => x !== t); });
            if (r.suggestedTags) r.suggestedTags.forEach(t => { if (!tags.includes(t)) tags.push(t); });
            return { ...u, tags };
          });
          this.persist('uploads');
        }
      } else {
        if (r.vote > r.notVote) {
          const dur = this.getPendingDuration(this.offenses[itemId] || 0);
          r.pendingUntil = Date.now() + dur;
          r.pendingDuration = dur;
        } else {
          r.pendingUntil = null;
          r.pendingDuration = null;
        }
      }
      this.voting = voting;
      this.persist('voting');
      this.processGovernance();
    },

    videoVote(itemId, dir) {
      const voting = { ...this.videoVoting };
      if (!voting[itemId]) voting[itemId] = { vote: 0, notVote: 0, offense: 0, type: 'deletion', pendingUntil: null };
      const r = voting[itemId];
      if (r.userVote === dir) dir = null;
      else if (r.userVote === 'agree' && dir === 'disagree') { r.vote = Math.max(0, (r.vote || 0) - 1); r.notVote = (r.notVote || 0) + 1; r.userVote = 'disagree'; }
      else if (r.userVote === 'disagree' && dir === 'agree') { r.notVote = Math.max(0, (r.notVote || 0) - 1); r.vote = (r.vote || 0) + 1; r.userVote = 'agree'; }
      else if (dir === 'agree') { r.vote = (r.vote || 0) + 1; r.userVote = 'agree'; }
      else if (dir === 'disagree') { r.notVote = (r.notVote || 0) + 1; r.userVote = 'disagree'; }
      if (r.vote > r.notVote) {
        const dur = this.getPendingDuration(this.videoOffenses[itemId] || 0);
        r.pendingUntil = Date.now() + dur;
        r.pendingDuration = dur;
      } else {
        r.pendingUntil = null;
        r.pendingDuration = null;
      }
      this.videoVoting = voting;
      this.persist('videoVoting');
      this.videoGovernance();
    },

    videoInstantDelete(itemId) {
      const password = prompt('Enter password to instantly delete this video:');
      if (!password || !password.trim()) { alert('Delete canceled. Password is required.'); return; }
      const video = this.videos.find(v => v.id === itemId);
      if (video && password !== video.password) { alert('Incorrect password. Delete canceled.'); return; }
      this.videos = this.videos.filter(v => v.id !== itemId);
      this.videoRecentlyViewed = this.videoRecentlyViewed.filter(e => e.itemId !== itemId);
      this.openMenuUid = null; this.kebabPos = null;
      this.persist('videos');
      this.persist('videoRecentlyViewed');
      this.videoGovernance();
    },

    videoReportDeletion(itemId) {
      const voting = { ...this.videoVoting };
      if (!voting[itemId]) voting[itemId] = { vote: 0, notVote: 0, offense: 0, userVote: null, type: 'deletion', appealTimestamp: Date.now(), pendingUntil: null };
      else { voting[itemId].appealTimestamp = Date.now(); voting[itemId].type = 'deletion'; }
      this.videoVoting = voting;
      this.openMenuUid = null; this.kebabPos = null;
      this.persist('videoVoting');
      this.videoGovernance();
    },

    videoOwnerTag(itemId) {
      const tag = prompt('Enter a tag to add:');
      if (!tag || !tag.trim()) { this.openMenuUid = null; this.kebabPos = null; return; }
      this.videos = this.videos.map(v => {
        if (v.id === itemId && !v.tags.includes(tag.trim())) return { ...v, tags: [...v.tags, tag.trim()] };
        return v;
      });
      this.openMenuUid = null; this.kebabPos = null;
      this.persist('videos');
      this.videoGovernance();
    },

    videoGovernance() {
      const now = Date.now();
      for (const id in this.videoVoting) {
        const r = this.videoVoting[id];
        if (r.pendingUntil && now >= r.pendingUntil && r.vote > r.notVote) {
          r.pendingUntil = null;
          this.videos = this.videos.filter(v => v.id !== id);
          this.videoRecentlyViewed = this.videoRecentlyViewed.filter(e => e.itemId !== id);
          this.persist('videos');
          this.persist('videoRecentlyViewed');
        }
      }
      this.persist('videoVoting');
    },

    instantDelete(itemId) {
      const password = prompt('Enter password to instantly delete this item:');
      if (!password || !password.trim()) { alert('Delete canceled. Password is required.'); return; }
      const upload = this.uploads.find(u => u.id === itemId);
      if (upload && password !== upload.password) { alert('Incorrect password. Delete canceled.'); return; }
      this.uploads = this.uploads.filter(u => u.id !== itemId);
      this.recentlyViewed = this.recentlyViewed.filter(v => v.itemId !== itemId);
      this.openMenuUid = null; this.kebabPos = null;
      this.passwordInput = '';
      this.persist('uploads');
      this.persist('recentlyViewed');
      this.processGovernance();
    },

    reportDeletion(itemId) {
      const voting = { ...this.voting };
      if (!voting[itemId]) voting[itemId] = { vote: 0, notVote: 0, offense: 0, userVote: null, type: 'deletion', appealTimestamp: Date.now(), pendingUntil: null };
      else { voting[itemId].appealTimestamp = Date.now(); voting[itemId].type = 'deletion'; }
      this.voting = voting;
      this.openMenuUid = null; this.kebabPos = null;
      this.persist('voting');
      this.processGovernance();
    },

    ownerTag(itemId) {
      const tag = prompt('Enter a tag to add:');
      if (!tag || !tag.trim()) { this.openMenuUid = null; this.kebabPos = null; return; }
      this.uploads = this.uploads.map(u => {
        if (u.id === itemId && !u.tags.includes(tag.trim())) return { ...u, tags: [...u.tags, tag.trim()] };
        return u;
      });
      this.openMenuUid = null; this.kebabPos = null;
      this.persist('uploads');
      this.processGovernance();
    },

    submitAppeal(type) {
      const id = this.appealModalId;
      if (!id) return;
      if (type === 'tag') {
        const item = this.uploads.find(u => u.id === id);
        const currentTags = item?.tags?.length ? 'Existing tags: ' + item.tags.join(', ') : '';
        const addInput = prompt('Enter tags to add or prefix with - to remove (comma-separated):\n' + currentTags);
        const addTags = [];
        const removeTags = [];
        (addInput || '').split(',').map(t => t.trim()).filter(Boolean).forEach(t => {
          if (t[0] === '-') removeTags.push(t.slice(1));
          else addTags.push(t);
        });
        if (!addTags.length && !removeTags.length) { this.appealModalId = null; return; }
        this.uploads = this.uploads.map(u => {
          if (u.id !== id) return u;
          let tags = [...u.tags];
          removeTags.forEach(t => { tags = tags.filter(x => x !== t); });
          addTags.forEach(t => { if (!tags.includes(t)) tags.push(t); });
          return { ...u, tags };
        });
        this.persist('uploads');
      } else {
        const voting = { ...this.voting };
        if (!voting[id]) voting[id] = { vote: 0, notVote: 0, offense: 0, userVote: null, type };
        voting[id].appealTimestamp = Date.now();
        voting[id].type = type;
        this.voting = voting;
      }
      this.appealModalId = null;
      this.persist('voting');
      this.processGovernance();
    },

    toggleKebab(id, event, source) {
      const key = source + '|' + id;
      this.openMenuUid = this.openMenuUid === key ? null : key;
      if (this.openMenuUid && event) {
        const rect = event.target.getBoundingClientRect();
        this.kebabPos = { left: rect.left + 'px', top: (rect.bottom + 2) + 'px' };
      } else {
        this.kebabPos = null;
      }
    },
    closeKebab(source) {
      if (this.openMenuUid && this.openMenuUid.startsWith(source + '|')) { this.openMenuUid = null; this.kebabPos = null; }
    },

    openTagContext(itemId, tag, event) {
      event.preventDefault();
      this.contextTarget = { itemId, tag };
      const rect = event.target.getBoundingClientRect();
      this.tagMenuPos = { left: rect.left + 'px', top: (rect.bottom + 2) + 'px' };
    },
    closeTagContext() {
      this.contextTarget = null;
      this.tagMenuPos = null;
    },
    removeTagFromContext() {
      if (!this.contextTarget) return;
      const { itemId, tag } = this.contextTarget;
      this.uploads = this.uploads.map(u => {
        if (u.id === itemId) return { ...u, tags: u.tags.filter(t => t !== tag) };
        return u;
      });
      this.closeTagContext();
      this.persist('uploads');
    },
    startTagLongPress(itemId, tag, event) {
      this.contextTarget = { itemId, tag };
      const touch = event.touches ? event.touches[0] : event;
      this.tagLongPressTimer = setTimeout(() => {
        this.longPressFired = true;
        this.tagMenuPos = { left: touch.clientX + 'px', top: (touch.clientY + 2) + 'px' };
        this.tagLongPressTimer = null;
      }, 500);
    },
    endTagLongPress() {
      if (this.tagLongPressTimer) {
        clearTimeout(this.tagLongPressTimer);
        this.tagLongPressTimer = null;
        this.contextTarget = null;
      }
    },
    cancelTagLongPress() {
      if (this.tagLongPressTimer) {
        clearTimeout(this.tagLongPressTimer);
        this.tagLongPressTimer = null;
      }
      this.contextTarget = null;
      this.longPressFired = false;
    },
    handleTagClick(tag, itemId) {
      if (this.longPressFired) { this.longPressFired = false; return; }
      this.searchTag(tag);
    },
    handleSearchTagClick(tag) {
      if (this.longPressFired) { this.longPressFired = false; return; }
      this.searchTag(tag);
    },

    goToPage(p) { this.resultsPage = p; this.navigate('/results', p); },

    navigate(base, page) {
      location.hash = page && page > 1 ? base + '/' + page : base;
    },
    handleRoute() {
      const raw = location.hash.slice(1) || '/';
      const segs = raw.split('/');
      const base = segs[1] || '';
      if (base === 'results') {
        this.page = 'results';
        this.resultsPage = parseInt(segs[2], 10) || 1;
        if (!this.searchResults && this.search.trim()) this.doSearch();
      } else if (base === 'watch') {
        this.page = 'watch';
        this.watchId = segs[2] || null;
        if (this.watchId) {
          const views = { ...this.watchViews };
          views[this.watchId] = (views[this.watchId] || 0) + 1;
          this.watchViews = views;
          this.safeSet('watchViews', views);
          const item = this.watchItem;
          if (item) {
            const today = this.recentlyViewed.filter(x => this.isToday(x.timestamp) && x.url !== item.url);
            today.unshift({ tag: 'clicked', itemId: this.watchId, url: item.url, timestamp: Date.now() });
            this.recentlyViewed = today;
            this.persist('recentlyViewed');
          }
        }
        this.watchPlaying = false;
        this.watchMuted = false;
        this.watchLooped = false;
        this.watchCurrentTime = 0;
        this.watchDuration = 0;
        this.watchProgress = 0;
        if (this.watchId && this.watchItem) {
          this.fetchWatchPageData(this.watchItem.url);
        }
      } else if (['uploads', 'activity', 'viewed', 'video', 'video-uploads', 'video-activity', 'video-viewed'].includes(base)) {
        this.page = base;
        this.searchResults = null;
      } else {
        this.page = '';
        this.searchResults = null;
      }
      this.processGovernance();
      this.videoGovernance();
    },

    processGovernance() {
      const now = Date.now();
      for (const id in this.voting) {
        const r = this.voting[id];
        if (r.type !== 'tag' && r.pendingUntil && now >= r.pendingUntil && r.vote > r.notVote) {
          r.pendingUntil = null;
          this.uploads = this.uploads.filter(u => u.id !== id);
          this.recentlyViewed = this.recentlyViewed.filter(v => v.itemId !== id);
          this.persist('uploads');
          this.persist('recentlyViewed');
        }
      }
      this.persist('voting');
      this.cleanOrphans();
    },
    cleanOrphans() {
      const valid = {};
      this.uploads.forEach(u => valid[u.id] = true);
      this.recentlyViewed = this.recentlyViewed.filter(e => valid[e.itemId]);
    },

    getVideoInfo(url) {
      const m = (p) => { const r = url.match(p); return r ? r[1] : null; };
      let id;
      id = m(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
      if (id) return { type: 'youtube', videoId: id, embedUrl: 'https://www.youtube.com/embed/' + id, thumbnailUrl: 'https://img.youtube.com/vi/' + id + '/mqdefault.jpg' };
      id = m(/vimeo\.com\/(\d+)/);
      if (id) return { type: 'vimeo', videoId: id, embedUrl: 'https://player.vimeo.com/video/' + id, thumbnailUrl: null };
      id = m(/dailymotion\.com\/video\/([a-zA-Z0-9]+)/) || m(/dai\.ly\/([a-zA-Z0-9]+)/);
      if (id) return { type: 'dailymotion', videoId: id, embedUrl: 'https://www.dailymotion.com/embed/video/' + id, thumbnailUrl: 'https://www.dailymotion.com/thumbnail/video/' + id };
      id = m(/twitch\.tv\/videos\/(\d+)/);
      if (id) return { type: 'twitch', videoId: id, embedUrl: 'https://player.twitch.tv/?video=' + id, thumbnailUrl: null };
      id = m(/twitch\.tv\/([a-zA-Z0-9_]+)(?:\/|$)/);
      if (id) return { type: 'twitch', videoId: id, embedUrl: 'https://player.twitch.tv/?channel=' + id, thumbnailUrl: null };
      id = m(/facebook\.com\/watch\/?\?v=(\d+)/) || m(/fb\.watch\/([a-zA-Z0-9_-]+)/);
      if (id) return { type: 'facebook', videoId: id, embedUrl: 'https://www.facebook.com/plugins/video.php?href=' + encodeURIComponent(url), thumbnailUrl: null };
      id = m(/tiktok\.com\/@[\w.-]+\/video\/(\d+)/);
      if (id) return { type: 'tiktok', videoId: id, embedUrl: 'https://www.tiktok.com/embed/v2/' + id, thumbnailUrl: null };
      id = m(/instagram\.com\/(?:p|reel)\/([a-zA-Z0-9_-]+)/);
      if (id) return { type: 'instagram', videoId: id, embedUrl: 'https://www.instagram.com/p/' + id + '/embed/', thumbnailUrl: null };
      id = m(/bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/);
      if (id) return { type: 'bilibili', videoId: id, embedUrl: 'https://player.bilibili.com/player.html?bvid=' + id, thumbnailUrl: null };
      id = m(/vk\.com\/video(-?\d+_\d+)/);
      if (id) return { type: 'vk', videoId: id, embedUrl: 'https://vk.com/video_ext.php?' + id.replace('_', '&id=').replace(/^(-?\d+)/, 'oid=$1'), thumbnailUrl: null };
      id = m(/rumble\.com\/v([a-zA-Z0-9_]+)/);
      if (id) return { type: 'rumble', videoId: id, embedUrl: 'https://rumble.com/embed/' + id, thumbnailUrl: null };
      if (url.match(/\.(mp4|webm|ogg)(\?|#|$)/i)) return { type: 'file', videoId: null, embedUrl: url, thumbnailUrl: null };
      if (url.match(/^https?:\/\/(localhost|127\.0\.0\.1)/i)) return { type: 'file', videoId: null, embedUrl: url, thumbnailUrl: null };
      return { type: null, videoId: null, embedUrl: null, thumbnailUrl: null };
    },
    isVideoUrl(url) {
      return this.getVideoInfo(url).type !== null;
    },
    getVideoEmbedUrl(url) {
      return this.getVideoInfo(url).embedUrl;
    },
    captureVideoFrame(url) {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.preload = 'metadata';
      video.muted = true;
      video.src = url;
      const timeout = setTimeout(() => {
        video.remove();
        this.videoFrameLoading = { ...this.videoFrameLoading, [url]: false };
        this.videoFrameCache = { ...this.videoFrameCache, [url]: null };
      }, 10000);
      const cleanup = () => { clearTimeout(timeout); video.remove(); };
      video.addEventListener('loadedmetadata', () => {
        video.currentTime = Math.min(1, video.duration * 0.1);
      });
      video.addEventListener('seeked', () => {
        try {
          const canvas = document.createElement('canvas');
          const w = video.videoWidth || 320, h = video.videoHeight || 240;
          canvas.width = Math.min(w, 320);
          canvas.height = Math.round(canvas.width * (h / w));
          canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
          this.videoFrameCache = { ...this.videoFrameCache, [url]: canvas.toDataURL('image/jpeg', 0.6) };
        } catch {
          this.videoFrameCache = { ...this.videoFrameCache, [url]: null };
        }
        this.videoFrameLoading = { ...this.videoFrameLoading, [url]: false };
        cleanup();
      });
      video.addEventListener('error', () => {
        this.videoFrameCache = { ...this.videoFrameCache, [url]: null };
        this.videoFrameLoading = { ...this.videoFrameLoading, [url]: false };
        cleanup();
      });
      video.load();
    },
    getVideoFrame(url) {
      const info = this.getVideoInfo(url);
      if (info.thumbnailUrl) return info.thumbnailUrl;
      if (info.type === 'file') {
        if (!this.videoFrameCache[url] && !this.videoFrameLoading[url]) {
          this.videoFrameLoading = { ...this.videoFrameLoading, [url]: true };
          setTimeout(() => this.captureVideoFrame(url), 50);
        }
        return this.videoFrameCache[url] || null;
      }
      return null;
    },
    getEmbedCode(url) {
      const info = this.getVideoInfo(url);
      if (!info.type) return '';
      if (info.type === 'file') return '<video controls width="560"><source src="' + url + '"></video>';
      return '<iframe src="' + info.embedUrl + '" width="560" height="315" frameborder="0" allowfullscreen></iframe>';
    },
    copyEmbed(url) {
      const code = this.getEmbedCode(url);
      if (!code) return;
      navigator.clipboard.writeText(code).then(() => {
        alert('Embed code copied!');
      }).catch(() => {
        alert('Failed to copy. Select and copy manually:\n\n' + code);
      });
    },

    get watchItem() {
      if (!this.watchId) return null;
      return this.uploads.find(u => u.id === this.watchId) || this.videos.find(v => v.id === this.watchId) || null;
    },
    get watchVideoInfo() {
      if (!this.watchItem) return null;
      return this.getVideoInfo(this.watchItem.url);
    },
    get watchViewCount() {
      return this.watchViews[this.watchId] || 0;
    },
    get watchBufferedPercent() {
      const el = this.$refs?.watchVideo;
      if (!el || !el.buffered || !el.buffered.length || !el.duration) return 0;
      return (el.buffered.end(el.buffered.length - 1) / el.duration) * 100;
    },
    get watchEmbedUrl() {
      if (!this.watchItem) return '';
      const info = this.getVideoInfo(this.watchItem.url);
      if (!info || !info.embedUrl) return '';
      let url = info.embedUrl;
      const sep = url.includes('?') ? '&' : '?';
      const params = [];
      if (this.watchMuted) {
        if (info.type === 'youtube' || info.type === 'dailymotion') params.push('mute=1');
        else if (info.type === 'vimeo') params.push('muted=1');
      }
      if (this.watchLooped) {
        if (info.type === 'youtube') { params.push('loop=1'); params.push('playlist=' + info.videoId); }
        else if (info.type === 'vimeo') params.push('loop=1');
      }
      if (params.length) url += sep + params.join('&');
      return url;
    },

    openWatch(id, url) {
      this.cleanupWatchVideo();
      this.watchId = id;
      this.watchPlaying = false;
      this.watchMuted = false;
      this.watchLooped = false;
      this.watchCurrentTime = 0;
      this.watchDuration = 0;
      this.watchProgress = 0;
      this.watchVideoSrc = null;
      this.watchVideoLoading = true;
      this.watchFetchInfo = null;
      this.watchProgressBytes = { loaded: 0, total: 0, percent: 0 };
      this.navigate('/watch/' + id);
    },
    watchTogglePlay() {
      const el = this.$refs.watchVideo;
      if (!el) return;
      if (el.paused) { el.play(); this.watchPlaying = true; }
      else { el.pause(); this.watchPlaying = false; }
    },
    watchToggleMute() {
      this.watchMuted = !this.watchMuted;
      const el = this.$refs.watchVideo;
      if (el) el.muted = this.watchMuted;
    },
    watchToggleLoop() {
      this.watchLooped = !this.watchLooped;
      const el = this.$refs.watchVideo;
      if (el) el.loop = this.watchLooped;
    },
    watchSeek(event) {
      const el = this.$refs.watchVideo;
      if (!el || !el.duration) return;
      const rect = event.currentTarget.getBoundingClientRect();
      el.currentTime = ((event.clientX - rect.left) / rect.width) * el.duration;
    },
    cleanupWatchVideo() {
      if (this._plyr) { try { this._plyr.destroy(); } catch (e) { /* ignore */ } this._plyr = null; }
      if (this._watchAbort) { this._watchAbort.abort(); this._watchAbort = null; }
      if (this._watchSB) {
        try { if (this._watchMS && this._watchMS.readyState === 'open') this._watchMS.removeSourceBuffer(this._watchSB); } catch (e) { /* ignore */ }
        this._watchSB = null;
      }
      if (this._watchMS) {
        try { if (this._watchMS.readyState === 'open') this._watchMS.endOfStream(); } catch (e) { /* ignore */ }
        this._watchMS = null;
      }
      if (this.watchVideoSrc) {
        URL.revokeObjectURL(this.watchVideoSrc);
        this.watchVideoSrc = '';
      }
      this.watchVideoLoading = false;
    },
    setWatchVolume(val) {
      this.watchVolume = parseFloat(val);
      const el = this.$refs.watchVideo;
      if (el) { el.volume = this.watchVolume; el.muted = false; this.watchMuted = false; }
    },
    enterWatchFullscreen() {
      const el = this.$refs.watchVideo;
      if (!el) return;
      if (el.requestFullscreen) el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      else if (el.msRequestFullscreen) el.msRequestFullscreen();
    },
    initPlyr() {
      if (this._plyr) { this._plyr.destroy(); this._plyr = null; }
      if (typeof Plyr === 'undefined') return;
      const el = this.$refs.watchVideo;
      if (!el || !el.src) return;
      try {
        this._plyr = new Plyr(el, {
          controls: ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'fullscreen'],
          keyboard: { focused: true, global: true },
          tooltips: { controls: true, seek: true },
          invertTime: false,
          resetOnEnd: true
        });
      } catch (e) { /* plyr init failed, fallback to native controls */ }
    },
    watchSyncState() {
      const el = this.$refs.watchVideo;
      if (!el) return;
      this.watchCurrentTime = el.currentTime;
      this.watchDuration = el.duration || 0;
      this.watchProgress = el.duration ? (el.currentTime / el.duration) * 100 : 0;
      this.watchPlaying = !el.paused;
    },
    formatTime(seconds) {
      if (!seconds || isNaN(seconds)) return '00:00';
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    },
    formatBytes(bytes) {
      if (!bytes || bytes === 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB'];
      const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
      return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
    },
    getRelatedVideos() {
      if (!this.watchItem) return [];
      const tags = (this.watchItem.tags || []).map(t => t.toLowerCase());
      const candidates = [...this.uploads, ...this.videos];
      const seen = new Set();
      const result = [];
      for (const item of candidates) {
        if (item.id === this.watchId || seen.has(item.id)) continue;
        const itemTags = (item.tags || []).map(t => t.toLowerCase());
        const overlap = itemTags.filter(t => tags.includes(t));
        if (overlap.length > 0) {
          seen.add(item.id);
          result.push({ ...item, matchCount: overlap.length });
        }
      }
      result.sort((a, b) => b.matchCount - a.matchCount);
      return result.slice(0, 10);
    },
    getWatchComments() {
      if (!this.watchItem) return [];
      const item = this.watchItem;
      const c = [];
      const info = this.getVideoInfo(item.url);
      c.push({ label: 'Owner', value: item.submitterId || 'anonymous' });
      c.push({ label: 'Tags', value: (item.tags || []).join(', ') || '(none)' });
      c.push({ label: 'Views', value: String(this.watchViewCount) });
      c.push({ label: 'Added', value: this.relativeTime(item.timestamp) });
      if (info.type) c.push({ label: 'Source', value: info.type });
      return c;
    },
    fetchWatchPageData(url) {
      this.watchFetchedData = null;
      this.watchFetchLoading = true;
      const proxy = 'https://api.allorigins.win/raw?url=';
      fetch(proxy + encodeURIComponent(url))
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
        .then(html => {
          const d = document.createElement('div');
          d.innerHTML = html;
          const title = d.querySelector('title')?.textContent?.trim()
            || d.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim()
            || this.getUrlTitle(url);
          const desc = d.querySelector('meta[name="description"]')?.getAttribute('content')?.trim()
            || d.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim()
            || '';
          const image = d.querySelector('meta[property="og:image"]')?.getAttribute('content')?.trim() || '';
          this.watchFetchedData = { title, desc, image, url };
          this.watchFetchLoading = false;
        })
        .catch(() => {
          this.watchFetchedData = { title: this.getUrlTitle(url), desc: '', image: '', url };
          this.watchFetchLoading = false;
        });
    },
    async fetchWatchVideo() {
      if (!this.watchItem) { this.watchVideoLoading = false; return; }
      const url = this.watchItem.url;
      const info = this.getVideoInfo(url);
      if (!info || info.type !== 'file') { this.watchVideoLoading = false; return; }
      this.cleanupWatchVideo();
      this.watchVideoLoading = true;
      this.watchVideoSrc = null;
      this.watchFetchInfo = null;
      this.watchProgressBytes = { loaded: 0, total: 0, percent: 0 };

      try {
        const controller = new AbortController();
        this._watchAbort = controller;
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) { this.watchVideoSrc = url; this.watchVideoLoading = false; throw new Error('HTTP ' + response.status); }

        const ct = response.headers.get('content-type') || '';
        const cl = response.headers.get('content-length');
        const total = cl ? parseInt(cl) : 0;
        this.watchFetchInfo = {
          status: response.status + ' ' + response.statusText,
          contentType: ct || 'video/mp4',
          contentLength: cl || 'unknown',
          corsOrigin: response.headers.get('access-control-allow-origin') || 'none',
          acceptRanges: response.headers.get('accept-ranges') || 'unknown'
        };

        const MS = window.MediaSource || window.WebKitMediaSource;
        const hasStream = !!(response.body && response.body.getReader);

        if (MS && hasStream) {
          await this._streamWatchVideo(response, ct || 'video/mp4', total);
        } else {
          const blob = await response.blob();
          this.watchVideoSrc = URL.createObjectURL(blob);
          this.watchProgressBytes = { loaded: blob.size, total: blob.size, percent: 100 };
          this.watchVideoLoading = false;
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        this.watchVideoSrc = url;
        this.watchVideoLoading = false;
        if (!this.watchFetchInfo) {
          this.watchFetchInfo = { status: 'Fetch error', contentType: 'unknown', contentLength: 'unknown', corsOrigin: 'blocked', acceptRanges: 'unknown', error: err.message };
        } else {
          this.watchFetchInfo.error = err.message;
        }
      }
    },
    async _streamWatchVideo(response, mime, total) {
      const MS = window.MediaSource || window.WebKitMediaSource;
      if (!MS.isTypeSupported(mime)) mime = 'video/mp4';

      const ms = new MS();
      this._watchMS = ms;
      this.watchVideoSrc = URL.createObjectURL(ms);

      return new Promise((resolve, reject) => {
        let aborted = false;
        ms.addEventListener('sourceopen', async () => {
          try {
            const sb = ms.addSourceBuffer(mime);
            this._watchSB = sb;
            const reader = response.body.getReader();
            let loaded = 0;

            while (!aborted) {
              const { done, value } = await reader.read();
              if (done) {
                if (ms.readyState === 'open' && !aborted) ms.endOfStream();
                this.watchProgressBytes = { loaded: total || loaded, total: total || loaded, percent: 100 };
                this.watchVideoLoading = false;
                resolve();
                return;
              }
              loaded += value.length;
              this.watchProgressBytes = { loaded, total: total || 0, percent: total ? Math.round((loaded / total) * 100) : 0 };

              await new Promise(res => {
                const append = () => {
                  if (sb.updating) { sb.addEventListener('updateend', append, { once: true }); return; }
                  try { sb.appendBuffer(value); } catch (e) { /* skip bad chunks */ }
                  res();
                };
                append();
              });
            }
          } catch (err) {
            if (!aborted) reject(err);
          }
        });
        ms.addEventListener('sourceerror', () => { if (!aborted) reject(new Error('MediaSource error')); });
        ms.addEventListener('sourceended', () => { this.watchVideoLoading = false; if (!aborted) resolve(); });
      });
    },
    destroy() {
      this.cleanupWatchVideo();
    },

    startMidnightTimer() {
      const tick = () => {
        this.recentlyViewed = this.recentlyViewed.filter(x => this.isToday(x.timestamp));
        this.videoRecentlyViewed = this.videoRecentlyViewed.filter(x => this.isToday(x.timestamp));
        this.persist('recentlyViewed');
        this.persist('videoRecentlyViewed');
        this.processGovernance();
        this.videoGovernance();
        setTimeout(tick, this.msUntilMidnight());
      };
      setTimeout(tick, this.msUntilMidnight());
    },
    }));
});
