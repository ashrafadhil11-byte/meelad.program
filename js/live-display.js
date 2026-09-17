import { db, doc, onSnapshot } from './firebase.js';

const DEFAULT_INSTITUTE_ID = "XnTaWEgDWBqdODmxXGG4";

function resolveInstituteId() {
    const urlParams = new URLSearchParams(window.location.search);
    let id = urlParams.get('id') || urlParams.get('instId');
    
    if (!id) {
        id = localStorage.getItem('currentInstituteId') ||
             localStorage.getItem('melad_institute_id') ||
             sessionStorage.getItem('currentInstituteId') ||
             sessionStorage.getItem('melad_institute_id') ||
             DEFAULT_INSTITUTE_ID;
    }

    try {
        localStorage.setItem('currentInstituteId', id);
        localStorage.setItem('melad_institute_id', id);
    } catch (e) {}

    return id;
}

const instId = resolveInstituteId();

let dashboardData = null;
let eventConfig = null;
let leaderboardData = [];
let categoryPerformanceData = [];
let latestPublishedResults = [];

let slidesList = [];
let currentSlideIndex = 0;
let rotatorTimer = null;
const ROTATION_DURATION = 8000; // 8 seconds per view

const TEAM_PALETTES = [
    'linear-gradient(90deg, #F59E0B, #D97706)',
    'linear-gradient(90deg, #3B82F6, #1D4ED8)',
    'linear-gradient(90deg, #10B981, #047857)',
    'linear-gradient(90deg, #8B5CF6, #6D28D9)',
    'linear-gradient(90deg, #EC4899, #BE185D)',
    'linear-gradient(90deg, #06B6D4, #0891B2)'
];
const teamColorMap = {};

function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatTimeAMPM(timestamp) {
    const date = timestamp ? new Date(timestamp) : new Date();
    let hours = date.getHours();
    let minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours < 10 ? '0' + hours : hours}:${minutes < 10 ? '0' + minutes : minutes} ${ampm}`;
}

function assignTeamColors() {
    const names = new Set();
    leaderboardData.forEach(t => t.name && names.add(t.name));
    Array.from(names).sort().forEach((name, idx) => {
        if (!teamColorMap[name]) {
            teamColorMap[name] = TEAM_PALETTES[idx % TEAM_PALETTES.length];
        }
    });
}

function updateHeader() {
    const title = eventConfig?.eventName || eventConfig?.madrasaName || "Meelad Championship";
    const titleEl = document.getElementById('liveMeeladName');
    if (titleEl) titleEl.textContent = title.toUpperCase();

    const logoImg = document.getElementById('headerLogoImg');
    const logoFallback = document.getElementById('headerLogoFallback');
    if (eventConfig?.eventLogo && logoImg && logoFallback) {
        logoImg.src = eventConfig.eventLogo;
        logoImg.classList.remove('hidden');
        logoFallback.classList.add('hidden');
    }

    const total = dashboardData?.programsCount || 0;
    const completed = dashboardData?.publicPublishedResultsCount || 0;
    const pending = dashboardData?.publicPendingProgramsCount ?? Math.max(0, total - completed);
    const progressPct = dashboardData?.publicOverallProgressPct ?? (total > 0 ? Math.round((completed / total) * 100) : 0);

    const statComp = document.getElementById('statCompletedProg');
    const statProg = document.getElementById('statProgressPct');
    const statPend = document.getElementById('statPendingProg');
    const statUpdated = document.getElementById('statLastUpdated');

    if (statComp) statComp.textContent = `${completed} / ${total}`;
    if (statProg) statProg.textContent = `${progressPct}%`;
    if (statPend) statPend.textContent = pending;
    if (statUpdated) {
        const d = dashboardData?.lastUpdated?.seconds ? new Date(dashboardData.lastUpdated.seconds * 1000) : new Date();
        statUpdated.textContent = formatTimeAMPM(d);
    }
}

function renderTeamChampionship() {
    const grid = document.getElementById('teamChampionshipGrid');
    if (!grid) return;
    assignTeamColors();

    if (!leaderboardData.length) {
        grid.innerHTML = `<div class="text-center py-20 text-slate-500 font-medium">No team standings published yet.</div>`;
        return;
    }

    const maxPts = Math.max(...leaderboardData.map(t => t.points || 0), 1);

    grid.innerHTML = leaderboardData.map((t, idx) => {
        const rank = idx + 1;
        const pts = t.points || 0;
        const widthPct = Math.min(Math.round((pts / maxPts) * 100), 100);
        const bg = teamColorMap[t.name] || 'linear-gradient(90deg, #F59E0B, #D97706)';
        const rankBadge = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;

        return `
            <div class="flex items-center gap-4 bg-slate-900/60 border border-slate-800 p-3.5 rounded-2xl">
                <div class="w-10 text-center font-bold text-lg">${rankBadge}</div>
                <div class="w-48 font-bold text-white truncate">${escapeHTML(t.name)}</div>
                <div class="flex-1 bg-slate-800/80 rounded-full h-3 overflow-hidden">
                    <div class="h-full rounded-full transition-all duration-700" style="width: ${widthPct}%; background: ${bg}"></div>
                </div>
                <div class="font-mono-nums font-black text-amber-400 text-lg w-24 text-right">
                    ${pts} <span class="text-xs text-slate-400 font-sans">pts</span>
                </div>
            </div>
        `;
    }).join('');
}

function renderCategoryLeaders(catName) {
    const container = document.getElementById('categoryLeadersContainer');
    if (!container) return;

    const cat = categoryPerformanceData.find(c => c.categoryName === catName);
    if (!cat || !cat.teams || !cat.teams.length) {
        container.innerHTML = `<div class="text-center py-20 text-slate-500 font-medium">No results for ${escapeHTML(catName)} yet.</div>`;
        return;
    }

    const top = cat.teams[0];
    const topBg = teamColorMap[top.name] || 'linear-gradient(90deg, #F59E0B, #D97706)';

    container.innerHTML = `
        <div class="bg-slate-900/80 border border-amber-500/30 rounded-3xl p-8 flex items-center justify-between shadow-2xl mb-4">
            <div class="flex items-center gap-6">
                <span class="text-6xl">🥇</span>
                <div>
                    <span class="text-xs font-bold uppercase tracking-wider text-amber-400">1st Place Category Leader</span>
                    <h2 class="text-3xl font-black text-white mt-1">${escapeHTML(top.name)}</h2>
                </div>
            </div>
            <div class="font-mono-nums text-4xl font-black text-amber-400">
                ${top.points} <span class="text-sm font-sans text-slate-400">pts</span>
            </div>
        </div>
    `;
}

function renderCategoryComparison(catName) {
    const container = document.getElementById('categoryComparisonContainer');
    if (!container) return;

    const cat = categoryPerformanceData.find(c => c.categoryName === catName);
    if (!cat || !cat.teams || !cat.teams.length) {
        container.innerHTML = `<div class="text-center py-20 text-slate-500 font-medium">No comparison data for ${escapeHTML(catName)}.</div>`;
        return;
    }

    container.innerHTML = cat.teams.map((t) => {
        const bg = teamColorMap[t.name] || 'linear-gradient(90deg, #3B82F6, #1D4ED8)';
        return `
            <div class="flex items-center gap-4 bg-slate-900/60 border border-slate-800 p-3 rounded-xl">
                <span class="w-8 font-bold text-slate-400">${t.rank === 1 ? '🥇' : t.rank === 2 ? '🥈' : t.rank === 3 ? '🥉' : `#${t.rank}`}</span>
                <span class="w-44 font-bold text-white truncate">${escapeHTML(t.name)}</span>
                <div class="flex-1 bg-slate-800 rounded-full h-2.5 overflow-hidden">
                    <div class="h-full rounded-full" style="width: ${t.pct}%; background: ${bg}"></div>
                </div>
                <span class="font-mono-nums font-bold text-slate-300 w-20 text-right">${t.points} pts</span>
            </div>
        `;
    }).join('');
}

function renderMarqueeRibbon() {
    const track = document.getElementById('ribbonTrack');
    if (!track) return;

    if (!latestPublishedResults.length) {
        track.innerHTML = `<div class="text-sm text-slate-500">Waiting for published competition results...</div>`;
        return;
    }

    const cards = latestPublishedResults.slice(0, 8).map(item => `
        <div class="flex items-center gap-3 bg-slate-900 border border-slate-800 px-4 py-1.5 rounded-full whitespace-nowrap">
            <span class="text-xs font-mono font-bold text-amber-400">${escapeHTML(item.programCode || 'Prog')}</span>
            <span class="text-sm font-semibold text-white">${escapeHTML(item.programName || 'Event')}</span>
            <span class="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">${escapeHTML(item.categoryName || '')}</span>
            <span class="text-xs font-bold text-emerald-400">🥇 ${escapeHTML(item.winnerName || 'Winner')} (${escapeHTML(item.winningTeam || 'Team')})</span>
        </div>
    `).join('');

    // Duplicate content to achieve seamless continuous marquee scroll
    track.innerHTML = cards + cards;
}

function buildSlidesSequence() {
    slidesList = [{ type: 'championship', title: 'Team Standings', icon: '🏆', categoryName: null }];

    if (categoryPerformanceData.length > 0) {
        categoryPerformanceData.forEach(cat => {
            slidesList.push({ type: 'catLeaders', title: 'Category Leaders', icon: '👑', categoryName: cat.categoryName });
            slidesList.push({ type: 'catComparison', title: 'Category Breakdown', icon: '📊', categoryName: cat.categoryName });
        });
    }
}

function displayCurrentSlide() {
    if (!slidesList.length) buildSlidesSequence();
    const slide = slidesList[currentSlideIndex];
    if (!slide) return;

    const screenTeam = document.getElementById('screenTeamChampionship');
    const screenLeaders = document.getElementById('screenCategoryLeaders');
    const screenComp = document.getElementById('screenCategoryComparison');

    const viewIcon = document.getElementById('viewIcon');
    const viewTitle = document.getElementById('viewTitle');
    const viewCatBadge = document.getElementById('viewCategoryBadge');

    if (viewIcon) viewIcon.textContent = slide.icon;
    if (viewTitle) viewTitle.textContent = slide.title;

    if (slide.categoryName && viewCatBadge) {
        viewCatBadge.textContent = slide.categoryName;
        viewCatBadge.classList.remove('hidden');
    } else if (viewCatBadge) {
        viewCatBadge.classList.add('hidden');
    }

    [screenTeam, screenLeaders, screenComp].forEach(s => s && s.classList.remove('active'));

    if (slide.type === 'championship') {
        renderTeamChampionship();
        if (screenTeam) screenTeam.classList.add('active');
    } else if (slide.type === 'catLeaders') {
        renderCategoryLeaders(slide.categoryName);
        if (screenLeaders) screenLeaders.classList.add('active');
    } else if (slide.type === 'catComparison') {
        renderCategoryComparison(slide.categoryName);
        if (screenComp) screenComp.classList.add('active');
    }

    // Reset progress fill bar
    const fill = document.getElementById('rotatorProgressFill');
    if (fill) {
        fill.style.transition = 'none';
        fill.style.width = '0%';
        void fill.offsetWidth;
        fill.style.transition = `width ${ROTATION_DURATION}ms linear`;
        fill.style.width = '100%';
    }
}

function startAutoRotation() {
    if (rotatorTimer) clearInterval(rotatorTimer);
    displayCurrentSlide();
    rotatorTimer = setInterval(() => {
        currentSlideIndex = (currentSlideIndex + 1) % slidesList.length;
        displayCurrentSlide();
    }, ROTATION_DURATION);
}

function initListeners() {
    if (!instId) return;

    // Listen to eventConfig
    onSnapshot(doc(db, "institutes", instId, "metadata", "eventConfig"), (snap) => {
        eventConfig = snap.exists() ? snap.data() : null;
        updateHeader();
    });

    // Listen to precalculated dashboard aggregates
    onSnapshot(doc(db, "institutes", instId, "metadata", "dashboard"), (snap) => {
        if (snap.exists()) {
            const data = snap.data();
            dashboardData = data;
            leaderboardData = data.publicLeaderboard || [];
            categoryPerformanceData = data.publicCategoryPerformance || [];
            latestPublishedResults = data.publicLatestPublishedResults || [];
        } else {
            dashboardData = null;
            leaderboardData = [];
            categoryPerformanceData = [];
            latestPublishedResults = [];
        }

        assignTeamColors();
        buildSlidesSequence();
        updateHeader();
        renderMarqueeRibbon();

        const slide = slidesList[currentSlideIndex];
        if (slide) {
            if (slide.type === 'championship') renderTeamChampionship();
            else if (slide.type === 'catLeaders') renderCategoryLeaders(slide.categoryName);
            else if (slide.type === 'catComparison') renderCategoryComparison(slide.categoryName);
        }
    });

    buildSlidesSequence();
    startAutoRotation();
}

function initFullscreen() {
    const overlay = document.getElementById('fullscreenOverlay');
    if (!overlay) return;

    overlay.addEventListener('click', () => {
        const el = document.documentElement;
        if (el.requestFullscreen) el.requestFullscreen();
        overlay.classList.add('opacity-0', 'pointer-events-none');
        setTimeout(() => overlay.style.display = 'none', 300);
    });

    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement) {
            overlay.style.display = 'flex';
            void overlay.offsetWidth;
            overlay.classList.remove('opacity-0', 'pointer-events-none');
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initListeners();
    initFullscreen();
});
