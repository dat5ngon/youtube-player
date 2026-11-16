// YouTube Player -- watch and organize YouTube videos, ad-free
// Invidious API for search (no key needed), YouTube IFrame Player API for playback.

// Fallback instances -- dynamically updated at startup from api.invidious.io
let INVIDIOUS_INSTANCES = [
    'https://yt.chocolatemoo53.com',
];
let currentInstance = localStorage.getItem('video_inv_instance') || INVIDIOUS_INSTANCES[0];
let instancesDiscovered = false;

// Discover working Invidious instances at startup
async function discoverInstances() {
    try {
        const r = await fetch('https://api.invidious.io/instances.json', { signal: AbortSignal.timeout(8000) });
        const data = await r.json();
        const candidates = data
            .filter(([, info]) => info.api === true && info.type === 'https')
            .map(([, info]) => info.uri);
        if (candidates.length > 0) {
            // Test top candidates in parallel (first 6), keep those that respond
            const tests = candidates.slice(0, 6).map(async uri => {
                try {
                    const tr = await fetch(`${uri}/api/v1/search?q=test&type=video`, { signal: AbortSignal.timeout(5000) });
                    if (tr.ok) return uri;
                } catch { /* skip */ }
                return null;
            });
            const results = await Promise.allSettled(tests);
            const working = results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
            if (working.length > 0) {
                INVIDIOUS_INSTANCES = working;
                if (!working.includes(currentInstance)) {
                    currentInstance = working[0];
                    localStorage.setItem('video_inv_instance', currentInstance);
                }
                instancesDiscovered = true;
            }
        }
    } catch { /* use hardcoded fallback */ }
}

// State
let playlists = loadPlaylists();
let currentPlaylistId = null;
let currentQueue = [];
let currentQueueIndex = -1;
let currentVideo = null;
let isPlaying = false;
let lastSearchQuery = '';
let lastSearchResults = [];
let searchPage = 1;
let hasMoreResults = false;
let isLoadingMore = false;
let sortOrder = 'relevance';
let repeatMode = 'none';
let playlistViewMode = localStorage.getItem('video_view_mode') || 'grid';
let pendingVideoForNewPlaylist = null;
let ytPlayer = null;
let ytReady = false;
let progressTimer = null;

// DOM
const $ = id => document.getElementById(id);
const playerSection = $('playerSection');
const vpTitle = $('vpTitle');
const vpChannel = $('vpChannel');
const searchInput = $('searchInput');
const searchResults = $('searchResults');
const resultCount = $('resultCount');
const loadingIndicator = $('loadingIndicator');
const playlistList = $('playlistList');
const playlistVideos = $('playlistVideos');
const playlistVideoList = $('playlistVideoList');
const currentPlaylistName = $('currentPlaylistName');
const playlistModal = $('playlistModal');
const playlistNameInput = $('playlistNameInput');
const addToPlaylistModal = $('addToPlaylistModal');
const playlistSelectList = $('playlistSelectList');
const confirmModal = $('confirmModal');
const confirmTitle = $('confirmTitle');
const confirmMessage = $('confirmMessage');
const urlImportModal = $('urlImportModal');
const urlInput = $('urlInput');
const urlImportStatus = $('urlImportStatus');
const progressBar = $('progressBar');
const currentTimeEl = $('currentTime');
const totalTimeEl = $('totalTime');
const volumeBar = $('volumeBar');
const volumeIcon = $('volumeIcon');
const playPauseBtn = $('playPauseBtn');

// YouTube IFrame API
function loadYTAPI() {
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
}

window.onYouTubeIframeAPIReady = function() {
    ytPlayer = new YT.Player('videoPlayer', {
        height: '100%', width: '100%',
        playerVars: { autoplay: 0, controls: 0, modestbranding: 1, rel: 0, fs: 1, iv_load_policy: 3, disablekb: 1 },
        events: { onReady: onYTReady, onStateChange: onYTState, onError: onYTError }
    });
};

function onYTReady() {
    ytReady = true;
    ytPlayer.setVolume(parseInt(volumeBar.value, 10));
}

function onYTState(e) {
    const s = e.data;
    if (s === YT.PlayerState.PLAYING) { isPlaying = true; updatePlayBtn(); startProgress(); }
    else if (s === YT.PlayerState.PAUSED) { isPlaying = false; updatePlayBtn(); stopProgress(); }
    else if (s === YT.PlayerState.ENDED) { stopProgress(); handleEnded(); }
}

function onYTError(e) {
    const c = e.data;
    showToast(c === 101 || c === 150 ? 'Embed-restricted. Trying next...' : 'Video unavailable. Trying next...');
    setTimeout(playNext, 1000);
}

// Init
function init() {
    loadYTAPI();
    renderPlaylists();
    setupEvents();
    applyViewMode(playlistViewMode);
    discoverInstances(); // async, runs in background
}

function setupEvents() {
    $('searchBtn').addEventListener('click', () => { const q = searchInput.value.trim(); if (q) searchVideos(q); });
    searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') { const q = searchInput.value.trim(); if (q) searchVideos(q); } });

    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            sortOrder = btn.dataset.sort;
            if (lastSearchQuery) searchVideos(lastSearchQuery);
        });
    });

    playPauseBtn.addEventListener('click', togglePlayPause);
    $('prevBtn').addEventListener('click', playPrev);
    $('nextBtn').addEventListener('click', playNext);
    $('repeatBtn').addEventListener('click', toggleRepeat);

    progressBar.addEventListener('input', () => {
        if (ytPlayer && ytReady) { const d = ytPlayer.getDuration(); if (d) ytPlayer.seekTo((progressBar.value / 100) * d, true); }
    });
    volumeBar.addEventListener('input', () => {
        const v = parseInt(volumeBar.value, 10);
        if (ytPlayer && ytReady) ytPlayer.setVolume(v);
        updateVolIcon(v);
    });
    volumeIcon.addEventListener('click', toggleMute);

    $('addCurrentBtn').addEventListener('click', () => { if (currentVideo) showAddModal(currentVideo); });
    $('newPlaylistBtn').addEventListener('click', () => { pendingVideoForNewPlaylist = null; showModal(playlistModal); });
    $('cancelPlaylistBtn').addEventListener('click', () => { pendingVideoForNewPlaylist = null; hideModal(playlistModal); });
    $('createPlaylistBtn').addEventListener('click', createPlaylist);
    playlistNameInput.addEventListener('keydown', e => { if (e.key === 'Enter') createPlaylist(); });
    $('cancelAddBtn').addEventListener('click', () => hideModal(addToPlaylistModal));

    $('backToPlaylists').addEventListener('click', showPlaylistList);
    $('playAllBtn').addEventListener('click', playAllVideos);
    $('deletePlaylistBtn').addEventListener('click', deletePlaylist);
    currentPlaylistName.addEventListener('click', editPlaylistName);

    $('listViewBtn').addEventListener('click', () => setViewMode('list'));
    $('gridViewBtn').addEventListener('click', () => setViewMode('grid'));

    $('exportBtn').addEventListener('click', syncExport);

    const dd = $('importDropdown');
    $('importBtn').addEventListener('click', e => { e.stopPropagation(); dd.classList.toggle('hidden'); });
    $('importFromDriveBtn').addEventListener('click', () => { dd.classList.add('hidden'); syncImport(); });
    $('importFromUrlBtn').addEventListener('click', () => { dd.classList.add('hidden'); urlInput.value = ''; urlImportStatus.classList.add('hidden'); showModal(urlImportModal); });
    document.addEventListener('click', () => dd.classList.add('hidden'));

    $('cancelUrlImportBtn').addEventListener('click', () => hideModal(urlImportModal));
    $('doUrlImportBtn').addEventListener('click', importFromUrl);
    urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') importFromUrl(); });

    $('confirmCancelBtn').addEventListener('click', () => hideModal(confirmModal));

    [playlistModal, addToPlaylistModal, confirmModal, urlImportModal].forEach(m => {
        m.addEventListener('click', e => { if (e.target === m) hideModal(m); });
    });

    document.addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT') return;
        if (e.code === 'Space') { e.preventDefault(); togglePlayPause(); }
        if (e.code === 'ArrowRight' && e.ctrlKey) playNext();
        if (e.code === 'ArrowLeft' && e.ctrlKey) playPrev();
    });
}

// Search -- tries all known instances before giving up
async function searchVideos(query) {
    lastSearchQuery = query;
    searchPage = 1;
    showLoading(true);
    searchResults.innerHTML = '';
    resultCount.textContent = '';

    // Try current instance first, then rotate through all others
    const tried = new Set();
    for (let attempt = 0; attempt < INVIDIOUS_INSTANCES.length; attempt++) {
        if (tried.has(currentInstance)) { await rotateInstance(); continue; }
        tried.add(currentInstance);
        try {
            const videos = await invSearch(query, 1);
            showLoading(false);
            if (videos.length > 0) {
                lastSearchResults = videos;
                renderResults(videos);
                resultCount.textContent = `${videos.length} videos`;
                if (hasMoreResults) addLoadMore();
            } else {
                searchResults.innerHTML = '<div class="empty-state"><span class="empty-icon">--</span><p>No videos found.</p></div>';
            }
            return; // success
        } catch {
            await rotateInstance();
        }
    }
    showLoading(false);
    searchResults.innerHTML = '<div class="error-state"><span class="error-icon">!</span><p>All servers unavailable. Try again later.</p></div>';
}

async function loadMore() {
    if (isLoadingMore || !lastSearchQuery) return;
    isLoadingMore = true;
    const btn = searchResults.querySelector('.load-more-btn');
    if (btn) btn.textContent = 'Loading...';
    try {
        searchPage++;
        const vids = await invSearch(lastSearchQuery, searchPage);
        if (btn) btn.remove();
        if (vids.length > 0) {
            lastSearchResults.push(...vids);
            vids.forEach((v, i) => searchResults.appendChild(createVideoEl(v, lastSearchResults.length - vids.length + i, 'search')));
            resultCount.textContent = `${lastSearchResults.length} videos`;
            if (hasMoreResults) addLoadMore();
        }
    } catch { showToast('Failed to load more'); if (btn) btn.textContent = 'Load More'; }
    isLoadingMore = false;
}

function addLoadMore() {
    const b = document.createElement('button');
    b.className = 'btn btn-primary load-more-btn';
    b.textContent = 'Load More';
    b.style.cssText = 'width:100%;margin-top:12px';
    b.addEventListener('click', loadMore);
    searchResults.appendChild(b);
}

// Invidious API
async function invSearch(query, page) {
    const sortMap = { relevance: 'relevance', date: 'upload_date', views: 'view_count' };
    const url = `${currentInstance}/api/v1/search?q=${encodeURIComponent(query)}&page=${page}&sort_by=${sortMap[sortOrder] || 'relevance'}&type=video`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (!Array.isArray(data)) return [];
    const vids = data.filter(i => i.type === 'video');
    hasMoreResults = vids.length >= 20;
    return vids.map(i => ({
        id: i.videoId, title: i.title || 'Untitled', channel: i.author || 'Unknown',
        channelId: i.authorId || '', duration: i.lengthSeconds || 0,
        views: i.viewCount || 0, published: i.publishedText || '',
        image: bestThumb(i.videoThumbnails), source: 'youtube'
    }));
}

async function invVideo(videoId) {
    const r = await fetch(`${currentInstance}/api/v1/videos/${videoId}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    return { id: d.videoId, title: d.title || 'Untitled', channel: d.author || 'Unknown', channelId: d.authorId || '', duration: d.lengthSeconds || 0, views: d.viewCount || 0, published: d.publishedText || '', image: bestThumb(d.videoThumbnails), source: 'youtube' };
}

async function invPlaylist(plId) {
    const r = await fetch(`${currentInstance}/api/v1/playlists/${plId}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const vids = (d.videos || []).map(i => ({ id: i.videoId, title: i.title || 'Untitled', channel: i.author || 'Unknown', channelId: i.authorId || '', duration: i.lengthSeconds || 0, image: bestThumb(i.videoThumbnails), source: 'youtube' }));
    return { title: d.title || 'Playlist', videos: vids };
}

function bestThumb(thumbs) {
    if (!thumbs || !Array.isArray(thumbs) || !thumbs.length) return placeholderImage();
    const m = thumbs.find(t => t.quality === 'medium' || t.quality === 'default');
    return m ? m.url : thumbs[0].url;
}

async function rotateInstance() {
    const i = INVIDIOUS_INSTANCES.indexOf(currentInstance);
    currentInstance = INVIDIOUS_INSTANCES[(i + 1) % INVIDIOUS_INSTANCES.length];
    localStorage.setItem('video_inv_instance', currentInstance);
}

// Rendering
function renderResults(videos) {
    searchResults.innerHTML = '';
    videos.forEach((v, i) => searchResults.appendChild(createVideoEl(v, i, 'search')));
}

function createVideoEl(video, index, context) {
    const div = document.createElement('div');
    div.className = 'track-item';
    if (currentVideo && currentVideo.id === video.id) div.classList.add('playing');
    const dur = video.duration ? formatTime(video.duration) : '';
    const views = video.views ? formatNum(video.views) + ' views' : '';
    const meta = [dur, views, video.published].filter(Boolean).join(' · ');

    div.innerHTML = `
        <img class="track-image" src="${esc(video.image)}" alt="${esc(video.title)}" loading="lazy" onerror="this.src='${placeholderImage()}'">
        <div class="track-info">
            <div class="track-title" title="${esc(video.title)}">${escH(video.title)}</div>
            <div class="track-artist" title="${esc(video.channel)}">${escH(video.channel)}</div>
            <div class="track-duration">${escH(meta)}</div>
        </div>
        <div class="track-actions">
            <button class="track-action-btn play-btn" title="Play">►</button>
            ${context === 'search' ? '<button class="track-action-btn add-btn" title="Add to playlist">+</button>' : ''}
            ${context === 'playlist' ? '<button class="track-action-btn remove-btn" title="Remove">✕</button>' : ''}
        </div>`;

    div.querySelector('.play-btn').addEventListener('click', e => { e.stopPropagation(); queueAndPlay(context, index, video); });
    div.addEventListener('dblclick', () => queueAndPlay(context, index, video));
    if (context === 'search') div.querySelector('.add-btn').addEventListener('click', e => { e.stopPropagation(); showAddModal(video); });
    if (context === 'playlist') div.querySelector('.remove-btn').addEventListener('click', e => { e.stopPropagation(); removeVideo(currentPlaylistId, video.id); });
    return div;
}

function queueAndPlay(ctx, idx, video) {
    if (ctx === 'playlist') currentQueue = getAllPlaylistVideos();
    else currentQueue = [...lastSearchResults];
    currentQueueIndex = idx;
    playVideo(video);
}

// Playback
function playVideo(video) {
    if (!video || !video.id) { showToast('No video available'); return; }
    currentVideo = video;
    playerSection.classList.remove('hidden');
    if (ytPlayer && ytReady) ytPlayer.loadVideoById(video.id);
    else setTimeout(() => { if (ytPlayer && ytReady) ytPlayer.loadVideoById(video.id); }, 1000);
    updateVideoInfo();
    highlightPlaying();
}

function togglePlayPause() {
    if (!ytPlayer || !ytReady || !currentVideo) return;
    ytPlayer.getPlayerState() === YT.PlayerState.PLAYING ? ytPlayer.pauseVideo() : ytPlayer.playVideo();
}

function handleEnded() {
    if (repeatMode === 'one') { ytPlayer.seekTo(0); ytPlayer.playVideo(); return; }
    if (repeatMode === 'all') { currentQueueIndex = (currentQueueIndex + 1) % currentQueue.length; playVideo(currentQueue[currentQueueIndex]); return; }
    if (currentQueueIndex < currentQueue.length - 1) { currentQueueIndex++; playVideo(currentQueue[currentQueueIndex]); }
    else { isPlaying = false; updatePlayBtn(); }
}

function playNext() { if (!currentQueue.length) return; currentQueueIndex = (currentQueueIndex + 1) % currentQueue.length; playVideo(currentQueue[currentQueueIndex]); }
function playPrev() { if (!currentQueue.length) return; if (ytPlayer && ytReady && ytPlayer.getCurrentTime() > 3) { ytPlayer.seekTo(0); return; } currentQueueIndex = (currentQueueIndex - 1 + currentQueue.length) % currentQueue.length; playVideo(currentQueue[currentQueueIndex]); }

function toggleRepeat() {
    const b = $('repeatBtn');
    if (repeatMode === 'none') { repeatMode = 'all'; b.textContent = '↻'; b.classList.add('active'); b.title = 'Repeat: All'; showToast('Repeat: All'); }
    else if (repeatMode === 'all') { repeatMode = 'one'; b.textContent = '↻¹'; b.classList.add('active'); b.title = 'Repeat: One'; showToast('Repeat: One'); }
    else { repeatMode = 'none'; b.textContent = '↻'; b.classList.remove('active'); b.title = 'Repeat: Off'; showToast('Repeat: Off'); }
}

function updateVideoInfo() { if (!currentVideo) return; vpTitle.textContent = currentVideo.title; vpChannel.textContent = currentVideo.channel; updatePlayBtn(); }
function updatePlayBtn() { playPauseBtn.textContent = isPlaying ? '❚❚' : '►'; }
function startProgress() { stopProgress(); progressTimer = setInterval(updateProgress, 500); }
function stopProgress() { if (progressTimer) { clearInterval(progressTimer); progressTimer = null; } }
function updateProgress() { if (!ytPlayer || !ytReady) return; const d = ytPlayer.getDuration(), c = ytPlayer.getCurrentTime(); if (!d) return; progressBar.value = (c / d) * 100; currentTimeEl.textContent = formatTime(c); totalTimeEl.textContent = formatTime(d); }
function highlightPlaying() { document.querySelectorAll('.track-item').forEach(el => el.classList.remove('playing')); if (!currentVideo) return; document.querySelectorAll('.track-item').forEach(el => { const t = el.querySelector('.track-title'); if (t && t.textContent === currentVideo.title) el.classList.add('playing'); }); }

function toggleMute() {
    if (!ytPlayer || !ytReady) return;
    if (ytPlayer.isMuted()) { ytPlayer.unMute(); volumeBar.value = ytPlayer.getVolume(); }
    else { ytPlayer.mute(); volumeBar.value = 0; }
    updateVolIcon(parseInt(volumeBar.value, 10));
}
function updateVolIcon(v) { if (v === undefined && ytPlayer && ytReady) v = ytPlayer.getVolume(); volumeIcon.textContent = v === 0 ? '○' : v < 50 ? '◎' : '◉'; }

function getAllPlaylistVideos() { if (!currentPlaylistId) return []; const p = playlists.find(p => p.id === currentPlaylistId); return p ? [...p.videos] : []; }

// Playlists
function loadPlaylists() { try { return JSON.parse(localStorage.getItem('video_playlists') || '[]'); } catch { return []; } }
function savePlaylists() { localStorage.setItem('video_playlists', JSON.stringify(playlists)); }

function renderPlaylists() {
    playlistList.innerHTML = '';
    if (!playlists.length) { playlistList.innerHTML = '<div class="empty-state"><span class="empty-icon">--</span><p>No playlists yet. Create one!</p></div>'; return; }
    playlists.forEach(pl => {
        const div = document.createElement('div');
        div.className = 'playlist-item';
        const cover = pl.videos.length > 0 && pl.videos[0].image ? pl.videos[0].image : placeholderImage();
        div.innerHTML = `<div class="playlist-item-info"><div class="playlist-cover-wrap"><img class="playlist-cover" src="${esc(cover)}" alt="${esc(pl.name)}" loading="lazy" onerror="this.src='${placeholderImage()}'"></div><span class="playlist-icon">▶</span><div class="playlist-item-text"><div class="playlist-name">${escH(pl.name)}</div><div class="playlist-count">${pl.videos.length} video${pl.videos.length !== 1 ? 's' : ''}</div></div></div>`;
        div.addEventListener('click', () => openPlaylist(pl.id));
        playlistList.appendChild(div);
    });
}

function setViewMode(m) { playlistViewMode = m; localStorage.setItem('video_view_mode', m); applyViewMode(m); }
function applyViewMode(m) {
    const lb = $('listViewBtn'), gb = $('gridViewBtn');
    if (m === 'grid') { playlistList.classList.add('grid-view'); gb.classList.add('active'); lb.classList.remove('active'); }
    else { playlistList.classList.remove('grid-view'); lb.classList.add('active'); gb.classList.remove('active'); }
}

function createPlaylist() {
    const name = playlistNameInput.value.trim();
    if (!name) { showToast('Enter a playlist name'); return; }
    const pl = { id: 'pl_' + Date.now(), name, videos: [], createdAt: new Date().toISOString() };
    if (pendingVideoForNewPlaylist) { pl.videos.push({ ...pendingVideoForNewPlaylist }); pendingVideoForNewPlaylist = null; }
    playlists.push(pl); savePlaylists(); renderPlaylists(); hideModal(playlistModal);
    playlistNameInput.value = '';
    showToast(pl.videos.length > 0 ? `Created "${name}" with 1 video` : `Playlist "${name}" created`);
}

function openPlaylist(id) {
    currentPlaylistId = id;
    const pl = playlists.find(p => p.id === id);
    if (!pl) return;
    currentPlaylistName.textContent = pl.name;
    playlistList.classList.add('hidden');
    playlistVideos.classList.remove('hidden');
    renderPlaylistVids(pl);
}

function renderPlaylistVids(pl) {
    playlistVideoList.innerHTML = '';
    if (!pl.videos.length) { playlistVideoList.innerHTML = '<div class="empty-state"><span class="empty-icon">▶</span><p>No videos yet. Search and add some!</p></div>'; return; }
    pl.videos.forEach((v, i) => playlistVideoList.appendChild(createVideoEl(v, i, 'playlist')));
}

function editPlaylistName() {
    if (!currentPlaylistId) return;
    const pl = playlists.find(p => p.id === currentPlaylistId);
    if (!pl) return;
    const h3 = currentPlaylistName, old = pl.name;
    const inp = document.createElement('input');
    inp.type = 'text'; inp.value = old; inp.maxLength = 50; inp.className = 'playlist-name-edit';
    h3.textContent = ''; h3.appendChild(inp); inp.focus(); inp.select();
    function commit() { const n = inp.value.trim(); if (n && n !== old) { pl.name = n; savePlaylists(); showToast('Renamed'); } h3.textContent = pl.name; }
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } if (e.key === 'Escape') { inp.value = old; inp.blur(); } });
}

function showPlaylistList() { currentPlaylistId = null; playlistVideos.classList.add('hidden'); playlistList.classList.remove('hidden'); renderPlaylists(); }

function showAddModal(video) {
    playlistSelectList.innerHTML = '';
    const cr = document.createElement('div');
    cr.className = 'playlist-select-item playlist-select-create';
    cr.innerHTML = '<span class="playlist-icon">+</span><span>Create new playlist</span>';
    cr.addEventListener('click', () => { hideModal(addToPlaylistModal); pendingVideoForNewPlaylist = video; showModal(playlistModal); });
    playlistSelectList.appendChild(cr);
    playlists.forEach(pl => {
        const d = document.createElement('div'); d.className = 'playlist-select-item';
        const exists = pl.videos.some(v => v.id === video.id);
        d.innerHTML = `<span class="playlist-icon">▶</span><span>${escH(pl.name)} (${pl.videos.length})${exists ? ' ✓' : ''}</span>`;
        if (!exists) d.addEventListener('click', () => { addVideo(pl.id, video); hideModal(addToPlaylistModal); });
        else { d.style.opacity = '0.5'; d.style.cursor = 'default'; }
        playlistSelectList.appendChild(d);
    });
    addToPlaylistModal.querySelector('h3').textContent = 'Add to Playlist';
    showModal(addToPlaylistModal);
}

function addVideo(pid, video) {
    const pl = playlists.find(p => p.id === pid);
    if (!pl || pl.videos.some(v => v.id === video.id)) { showToast('Already in playlist'); return; }
    pl.videos.push({ ...video }); savePlaylists();
    showToast(`Added to "${pl.name}"`);
    renderPlaylists();
    if (currentPlaylistId === pid) renderPlaylistVids(pl);
}

function removeVideo(pid, vid) {
    const pl = playlists.find(p => p.id === pid);
    if (!pl) return;
    pl.videos = pl.videos.filter(v => v.id !== vid);
    savePlaylists(); renderPlaylistVids(pl); showToast('Video removed');
}

function deletePlaylist() {
    if (!currentPlaylistId) return;
    const pl = playlists.find(p => p.id === currentPlaylistId);
    if (!pl) return;
    showConfirm('Delete Playlist', `Delete "${pl.name}"? This cannot be undone.`, () => {
        playlists = playlists.filter(p => p.id !== currentPlaylistId);
        savePlaylists(); showPlaylistList(); showToast('Playlist deleted');
    });
}

function playAllVideos() {
    if (!currentPlaylistId) return;
    const pl = playlists.find(p => p.id === currentPlaylistId);
    if (!pl || !pl.videos.length) { showToast('No videos to play'); return; }
    currentQueue = [...pl.videos]; currentQueueIndex = 0; playVideo(currentQueue[0]);
}

// Import from URL
async function importFromUrl() {
    let input = urlInput.value.trim();
    if (!input) { showToast('Enter a YouTube URL'); return; }

    // Extract video ID
    let videoId = null, playlistId = null;
    const vidMatch = input.match(/(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
    const plMatch = input.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    if (vidMatch) videoId = vidMatch[1];
    if (plMatch) playlistId = plMatch[1];

    if (!videoId && !playlistId) { showToast('Invalid YouTube URL'); return; }

    urlImportStatus.classList.remove('hidden');
    urlImportStatus.innerHTML = '<div class="spinner" style="width:20px;height:20px;margin:0 auto 8px"></div><p>Fetching...</p>';
    $('doUrlImportBtn').disabled = true;

    try {
        if (playlistId) {
            const result = await invPlaylist(playlistId);
            if (!result.videos.length) { urlImportStatus.innerHTML = '<p class="import-error">No videos found in playlist.</p>'; $('doUrlImportBtn').disabled = false; return; }
            hideModal(urlImportModal);
            showPlaylistPicker(result.videos, result.title);
        } else {
            const video = await invVideo(videoId);
            hideModal(urlImportModal);
            showAddModal(video);
        }
    } catch {
        urlImportStatus.innerHTML = '<p class="import-error">Failed to fetch. Check URL and try again.</p>';
    }
    $('doUrlImportBtn').disabled = false;
}

function showPlaylistPicker(videos, title) {
    const count = videos.length;
    const label = `${count} video${count !== 1 ? 's' : ''}`;
    playlistSelectList.innerHTML = '';

    const cr = document.createElement('div');
    cr.className = 'playlist-select-item playlist-select-create';
    cr.innerHTML = `<span class="playlist-icon">+</span><span>Create new playlist (${label})</span>`;
    cr.addEventListener('click', () => {
        hideModal(addToPlaylistModal);
        const name = title.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const pl = { id: 'pl_' + Date.now(), name, videos: [...videos], createdAt: new Date().toISOString() };
        playlists.push(pl); savePlaylists(); renderPlaylists(); openPlaylist(pl.id);
        showToast(`Created "${name}" with ${label}`);
    });
    playlistSelectList.appendChild(cr);

    playlists.forEach(pl => {
        const d = document.createElement('div'); d.className = 'playlist-select-item';
        d.innerHTML = `<span class="playlist-icon">▶</span><span>${escH(pl.name)} (${pl.videos.length})</span>`;
        d.addEventListener('click', () => {
            hideModal(addToPlaylistModal);
            let added = 0;
            for (const v of videos) { if (!pl.videos.some(x => x.id === v.id)) { pl.videos.push({ ...v }); added++; } }
            savePlaylists();
            if (currentPlaylistId === pl.id) renderPlaylistVids(pl);
            renderPlaylists();
            showToast(`Added ${added} video${added !== 1 ? 's' : ''} to "${pl.name}"`);
            openPlaylist(pl.id);
        });
        playlistSelectList.appendChild(d);
    });

    addToPlaylistModal.querySelector('h3').textContent = `Add ${label} to Playlist`;
    showModal(addToPlaylistModal);
}

// Confirm dialog
function showConfirm(title, message, onConfirm, okLabel) {
    confirmTitle.textContent = title;
    confirmMessage.textContent = message;
    showModal(confirmModal);
    const old = $('confirmOkBtn');
    const btn = old.cloneNode(true);
    old.parentNode.replaceChild(btn, old);
    btn.textContent = okLabel || 'Delete';
    btn.className = (okLabel && okLabel !== 'Delete') ? 'btn btn-primary' : 'btn btn-danger';
    btn.addEventListener('click', () => { hideModal(confirmModal); onConfirm(); });
}

// UI Helpers
function showLoading(show) { loadingIndicator.classList.toggle('hidden', !show); searchResults.classList.toggle('hidden', show); }
function showModal(m) { m.classList.remove('hidden'); const i = m.querySelector('input'); if (i) setTimeout(() => i.focus(), 100); }
function hideModal(m) { m.classList.add('hidden'); }

function formatNum(n) { if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return String(n); }
function formatTime(s) { if (!s || isNaN(s)) return '0:00'; s = Math.floor(s); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60; return h > 0 ? `${h}:${m.toString().padStart(2,'0')}:${sec.toString().padStart(2,'0')}` : `${m}:${sec.toString().padStart(2,'0')}`; }

function escH(str) { if (!str) return ''; const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
function esc(str) { return escH(str).replace(/"/g, '&quot;'); }

function placeholderImage() {
    return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 45'%3E%3Crect fill='%2316213e' width='80' height='45'/%3E%3Ctext x='40' y='28' text-anchor='middle' fill='%236c6c80' font-size='16'%3E%E2%96%B6%3C/text%3E%3C/svg%3E";
}

let toastTimer;
function showToast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

// Google Drive Sync (via SafePlace iframe + postMessage)
const SP_ORIGIN = 'https://dat5ngon.github.io';
const SP_APP = 'video-player';
const SP_FILE = 'playlists.json';
const spFrame = $('safePlaceFrame');

function spRequest(action, params = {}) {
    return new Promise((resolve, reject) => {
        if (!spFrame.contentWindow) { reject(new Error('SafePlace iframe not available.')); return; }
        const id = 'sp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        const timeout = setTimeout(() => { window.removeEventListener('message', handler); reject(new Error('SafePlace not responding. Sign in first.')); }, 10000);
        function handler(e) {
            if (e.origin !== SP_ORIGIN) return;
            const m = e.data;
            if (!m || m.type !== 'safeplace-response' || m.id !== id) return;
            clearTimeout(timeout); window.removeEventListener('message', handler);
            m.ok ? resolve(m) : reject(new Error(m.error || 'Unknown error'));
        }
        window.addEventListener('message', handler);
        spFrame.contentWindow.postMessage({ type: 'safeplace-request', id, action, ...params }, SP_ORIGIN);
    });
}

async function spAuth() { try { await spRequest('ping'); return true; } catch { return false; } }

function handleSyncErr(err) {
    setSyncStatus('');
    const msg = err.message || '';
    if (msg.includes('not authenticated') || msg.includes('Not authenticated')) {
        showConfirm('Sign in Required', 'Sign in to SafePlace first for Google Drive backup. Open SafePlace?', () => window.open('https://dat5ngon.github.io/safe-place/', '_blank'), 'Open SafePlace');
    } else if (msg.includes('not responding')) {
        showConfirm('Connection Issue', 'Could not connect to SafePlace. Try refreshing.', () => window.open('https://dat5ngon.github.io/safe-place/', '_blank'), 'Open SafePlace');
    } else {
        showConfirm('Sync Error', msg || 'Unknown error.', () => {}, 'OK');
    }
}

async function syncExport() {
    if (!playlists.length) { showToast('No playlists to export'); return; }
    const btn = $('exportBtn');
    try {
        setSyncStatus('Checking sign-in...'); btn.disabled = true;
        if (!await spAuth()) { setSyncStatus(''); showConfirm('Sign in Required', 'Sign in to SafePlace first.', () => window.open('https://dat5ngon.github.io/safe-place/', '_blank'), 'Open SafePlace'); btn.disabled = false; return; }
        setSyncStatus('Backing up...');
        await spRequest('save', { app: SP_APP, filename: SP_FILE, data: playlists });
        setSyncStatus(`Backed up ${playlists.length} playlist${playlists.length !== 1 ? 's' : ''}`);
        showToast('Playlists backed up to Google Drive');
    } catch (e) { handleSyncErr(e); } finally { btn.disabled = false; }
}

async function syncImport() {
    try {
        setSyncStatus('Checking sign-in...');
        if (!await spAuth()) { setSyncStatus(''); showConfirm('Sign in Required', 'Sign in to SafePlace first.', () => window.open('https://dat5ngon.github.io/safe-place/', '_blank'), 'Open SafePlace'); return; }
        setSyncStatus('Restoring...');
        const result = await spRequest('load', { app: SP_APP, filename: SP_FILE });
        if (!result.data) { setSyncStatus(''); showToast('No playlists on Google Drive'); return; }
        const imported = result.data;
        if (!Array.isArray(imported)) { setSyncStatus(''); showConfirm('Sync Error', 'Invalid backup data.', () => {}, 'OK'); return; }
        const ids = new Set(playlists.map(p => p.id));
        let added = 0, updated = 0;
        for (const pl of imported) {
            if (!pl.id || !pl.name) continue;
            if (ids.has(pl.id)) { const local = playlists.find(p => p.id === pl.id); if (local) { local.videos = pl.videos || []; local.name = pl.name; updated++; } }
            else { playlists.push(pl); added++; }
        }
        savePlaylists(); renderPlaylists();
        const parts = []; if (added) parts.push(`${added} new`); if (updated) parts.push(`${updated} updated`);
        const summary = parts.length ? parts.join(', ') : 'No changes';
        setSyncStatus(`Restored: ${summary}`); showToast(`Restore: ${summary}`);
    } catch (e) { handleSyncErr(e); }
}

function setSyncStatus(msg, isErr) {
    const el = $('syncStatus');
    el.textContent = msg; el.className = 'sync-status' + (isErr ? ' sync-error' : '');
    if (msg && !isErr) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 4000);
}

// Start
init();