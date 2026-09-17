import { db, doc, onSnapshot } from './firebase.js';

// Hardcoded Institute ID for zero-touch Yodeck deployment
const DEFAULT_INSTITUTE_ID = "XnTaWEgDWBqdODmxXGG4";

const instId = DEFAULT_INSTITUTE_ID;

let dashboardData = null;
let eventConfig = null;
let leaderboardData = [];
let categoryPerformanceData = [];
let latestPublishedResults = [];

let slidesList = [];
let currentSlideIndex = 0;
let rotatorTimer = null;
const ROTATION_DURATION = 10000; // Increased to 10 seconds for easier reading on digital signage

// Premium, muted color palette suited for dark poster themes
const TEAM_PALETTES = [
    '#fbbf24', // Amber
    '#60a5fa', // Blue
    '#34d399', // Emerald
    '#c084fc', // Purple
    '#f472b6', // Pink
    '#22d3ee'  // Cyan
];
const teamColorMap = {};

function formatTimeAMPM(timestamp) {
    const date = timestamp ? new Date(timestamp) : new Date();
    let hours = date.getHours();
    let minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours}:${minutes < 10 ? '0' + minutes : minutes} ${ampm}`;
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
    const title = eventConfig?.eventName || eventConfig?.madrasaName || "CHAMPIONSHIP";
    const titleEl = document.getElementById('liveMeeladName');
    if (titleEl) titleEl.textContent = title;

    const total = dashboardData?.programsCount || 0;
    const completed = dashboardData?.publicPublishedResultsCount || 0;
    const progressPct = dashboardData?.publicOverallProgressPct ?? (total > 0 ? Math.round((completed / total) * 100) : 0);

    const statComp = document.getElementById('statCompletedProg');
    const statProg = document.getElementById('statProgressPct');
    const statUpdated = document.getElementById('statLastUpdated');

    if (statComp) statComp.textContent = `${completed} / ${total}`;
    if (statProg) statProg.textContent = `${progressPct}%`;
    if (statUpdated) {
        const d = dashboardData?.lastUpdated?.seconds ? new Date(dashboardData.lastUpdated.seconds * 1000) : new Date();
        statUpdated.textContent = `Live as of ${formatTimeAMPM(d)}`;
    }
}

// VIEW 1: Team Standings (Massive Editorial Rows)
function renderTeamChampionship() {
    const grid = document.getElementById('teamChampionshipGrid');
    if (!grid) return;
    assignTeamColors();

    if (!leaderboardData.length) {
        grid.innerHTML = `<div class="text-neutral-500 text-2xl font-light">Awaiting final standings...</div>`;
        return;
    }

    const maxPts = Math.max(...leaderboardData.map(t => t.points || 0), 1);

    grid.innerHTML = leaderboardData.map((t, idx) => {
        const rank = idx + 1;
        const pts = t.points || 0;
        const widthPct = Math.min(Math.round((pts / maxPts) * 100), 100);
        const color = teamColorMap[t.name] || '#fbbf24';

        return `
            <div class="relative flex items-center justify-between pb-4 border-b border-white/10">
                <div class="flex items-center gap-8 z-10 w-full">
                    <span class="poster-font text-5xl font-black text-neutral-700 w-12">${rank}</span>
                    <div class="flex-1">
                        <h3 class="text-3xl font-bold tracking-wide uppercase text-white mb-2">${t.name}</h3>
                        <div class="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                            <div class="h-full" style="width: ${widthPct}%; background-color: ${color}; box-shadow: 0 0 20px ${color};"></div>
                        </div>
                    </div>
                    <div class="poster-font text-6xl font-black text-right min-w-[150px]" style="color: ${color}">
                        ${pts}<span class="text-xl text-neutral-500 ml-2">PTS</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// VIEW 2: Category Leaders (Hero Style Spotlight)
function renderCategoryLeaders(catName) {
    const container = document.getElementById('categoryLeadersContainer');
    if (!container) return;

    const cat = categoryPerformanceData.find(c => c.categoryName === catName);
    if (!cat || !cat.teams || !cat.teams.length) {
        container.innerHTML = `<div class="text-neutral-500 text-2xl font-light">No leaders established yet.</div>`;
        return;
    }

    const top = cat.teams[0];
    const color = teamColorMap[top.name] || '#fbbf24';
    const runnersUp = cat.teams.slice(1, 3);

    let html = `
        <div class="flex flex-col items-center text-center mb-16">
            <span class="text-neutral-500 uppercase tracking-[0.3em] text-sm font-bold mb-4">Current Frontrunner</span>
            <h1 class="poster-font text-8xl font-black uppercase tracking-tight mb-4" style="color: ${color}; text-shadow: 0 0 80px ${color}40;">
                ${top.name}
            </h1>
            <div class="text-4xl font-bold text-white poster-font">${top.points} Points</div>
        </div>
    `;

    if (runnersUp.length > 0) {
        html += `<div class="flex justify-center gap-12 border-t border-white/10 pt-12">`;
        runnersUp.forEach(t => {
            html += `
                <div class="text-center">
                    <div class="text-neutral-500 uppercase tracking-widest text-xs font-bold mb-2">Rank ${t.rank}</div>
                    <div class="text-2xl font-bold uppercase text-white">${t.name}</div>
                    <div class="text-xl text-neutral-400 poster-font mt-1">${t.points} pts</div>
                </div>
            `;
        });
        html += `</div>`;
    }

    container.innerHTML = html;
}

// VIEW 3: Category Comparison
function renderCategoryComparison(catName) {
    const container = document.getElementById('categoryComparisonContainer');
    if (!container) return;

    const cat = categoryPerformanceData.find(c => c.categoryName === catName);
    if (!cat || !cat.teams || !cat.teams.length) return;

    container.innerHTML = cat.teams.map((t) => {
        const color = teamColorMap[t.name] || '#fbbf24';
        return `
            <div class="flex items-center gap-8 py-3 border-b border-white/5">
                <span class="poster-font text-2xl text-neutral-600 font-black w-8">${t.rank}</span>
                <span class="text-2xl font-bold text-white uppercase w-1/3">${t.name}</span>
                <span class="poster-font text-3xl font-black w-32 text-right" style="color: ${color}">${t.points}</span>
            </div>
        `;
    }).join('');
}

// TICKER RIBBON
function renderMarqueeRibbon() {
    const track = document.getElementById('ribbonTrack');
    if (!track) return;
    if (!latestPublishedResults.length) return;

    const items = latestPublishedResults.slice(0, 8).map(item => 
        `<span><span class="opacity-50 mr-2">${item.programCode || ''}</span>${item.programName || 'Event'} &mdash; <span class="font-black">${item.winnerName}</span> (${item.winningTeam})</span> &bull;`
    ).join(' ');

    track.innerHTML = items + ' ' + items;
}

// ROTATION ENGINE
function buildSlidesSequence() {
    slidesList = [{ type: 'championship', title: 'Overall Standings', categoryName: null }];

    if (categoryPerformanceData.length > 0) {
        categoryPerformanceData.forEach(cat => {
            slidesList.push({ type: 'catLeaders', title: 'Category Leader', categoryName: cat.categoryName });
            slidesList.push({ type: 'catComparison', title: 'Category Breakdown', categoryName: cat.categoryName });
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
    const viewTitle = document.getElementById('viewTitle');
    const viewCatBadge = document.getElementById('viewCategoryBadge');

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
        screenTeam && screenTeam.classList.add('active');
    } else if (slide.type === 'catLeaders') {
        renderCategoryLeaders(slide.categoryName);
        screenLeaders && screenLeaders.classList.add('active');
    } else if (slide.type === 'catComparison') {
        renderCategoryComparison(slide.categoryName);
        screenComp && screenComp.classList.add('active');
    }

    // Reset Progress Bar
    const fill = document.getElementById('rotatorProgressFill');
    if (fill) {
        fill.style.transition = 'none';
        fill.style.width = '0%';
        void fill.offsetWidth; // Force DOM reflow
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

// INIT
document.addEventListener('DOMContentLoaded', () => {
    // 1. Config Snapshot
    onSnapshot(doc(db, "institutes", instId, "metadata", "eventConfig"), (snap) => {
        eventConfig = snap.exists() ? snap.data() : null;
        updateHeader();
    });

    // 2. Dashboard Snapshot
    onSnapshot(doc(db, "institutes", instId, "metadata", "dashboard"), (snap) => {
        if (snap.exists()) {
            const data = snap.data();
            dashboardData = data;
            leaderboardData = data.publicLeaderboard || [];
            categoryPerformanceData = data.publicCategoryPerformance || [];
            latestPublishedResults = data.publicLatestPublishedResults || [];
        }

        assignTeamColors();
        buildSlidesSequence();
        updateHeader();
        renderMarqueeRibbon();
        displayCurrentSlide(); // Re-render current slide immediately on new data
    });

    startAutoRotation();
});
