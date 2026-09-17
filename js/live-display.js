import { db, doc, onSnapshot } from './firebase.js';

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
let lastAnnouncedResultId = null; // Tracks the newest result to trigger the announcement
const ROTATION_DURATION = 9000; 

const TEAM_PALETTES = [
    'linear-gradient(90deg, #0f5132, #198754)', 
    'linear-gradient(90deg, #b45309, #d97706)', 
    'linear-gradient(90deg, #1e3a8a, #2563eb)', 
    'linear-gradient(90deg, #6b21a8, #9333ea)', 
    'linear-gradient(90deg, #9f1239, #e11d48)'  
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
    const title = eventConfig?.eventName || eventConfig?.madrasaName || "MEELAD CHAMPIONSHIP";
    const titleEl = document.getElementById('liveMeeladName');
    if (titleEl) titleEl.textContent = title;

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
        statUpdated.textContent = `Updated ${formatTimeAMPM(d)}`;
    }
}

// Cinematic New Result Announcement
function triggerNewResultAnnouncement(result) {
    // Pause standard rotation
    if (rotatorTimer) clearInterval(rotatorTimer);

    const overlay = document.getElementById('newResultOverlay');
    const headerEl = document.getElementById('normalViewHeader');
    
    // Hide active screens
    document.querySelectorAll('.screen-view').forEach(s => s.classList.remove('active'));
    headerEl.style.opacity = '0';

    // Populate data
    document.getElementById('announceProgramName').textContent = result.programName || 'Competition Event';
    document.getElementById('announceCategory').textContent = result.categoryName || 'General';
    document.getElementById('announceWinner').textContent = result.winnerName || 'Winner Declared';
    document.getElementById('announceTeam').textContent = result.winningTeam || '';

    // Trigger Entrance Animation
    overlay.classList.remove('hidden', 'announce-exit');
    overlay.classList.add('announce-active');

    // Hold for 12 seconds, then dismiss and resume normal rotation
    setTimeout(() => {
        overlay.classList.remove('announce-active');
        overlay.classList.add('announce-exit');
        
        setTimeout(() => {
            overlay.classList.add('hidden');
            headerEl.style.opacity = '1';
            displayCurrentSlide(); // Resume immediately
            startAutoRotation();
        }, 600); // Wait for exit animation to finish
    }, 12000);
}

function renderTeamChampionship() {
    const grid = document.getElementById('teamChampionshipGrid');
    if (!grid) return;
    assignTeamColors();

    if (!leaderboardData.length) {
        grid.innerHTML = `<div class="glass-panel p-6 rounded-2xl text-stone-500 font-medium text-center">Standings will appear once published.</div>`;
        return;
    }

    const maxPts = Math.max(...leaderboardData.map(t => t.points || 0), 1);

    grid.innerHTML = leaderboardData.slice(0, 5).map((t, idx) => {
        const rank = idx + 1;
        const pts = t.points || 0;
        const widthPct = Math.min(Math.round((pts / maxPts) * 100), 100);
        const gradient = teamColorMap[t.name] || 'linear-gradient(90deg, #0f5132, #198754)';
        const rankSymbol = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;

        return `
            <div class="glass-panel px-5 py-3 rounded-xl flex items-center justify-between gap-4 border">
                <div class="w-8 text-center text-lg font-bold">${rankSymbol}</div>
                <div class="w-48 font-black uppercase text-stone-900 tracking-wide truncate text-sm">${t.name}</div>
                <div class="flex-1 bg-stone-300/60 h-2.5 rounded-full overflow-hidden">
                    <div class="h-full rounded-full transition-all duration-700" style="width: ${widthPct}%; background: ${gradient};"></div>
                </div>
                <div class="mono-font text-lg font-black text-emerald-900 w-24 text-right">
                    ${pts} <span class="text-[10px] font-sans font-semibold text-stone-500">PTS</span>
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
        container.innerHTML = `<div class="glass-panel p-6 rounded-2xl text-stone-500 text-center font-medium">No results for ${catName} yet.</div>`;
        return;
    }

    const top = cat.teams[0];
    const runnersUp = cat.teams.slice(1, 3);

    let html = `
        <div class="glass-panel p-6 rounded-2xl border mb-3 flex items-center justify-between">
            <div class="flex items-center gap-5">
                <div class="text-5xl">🥇</div>
                <div>
                    <span class="text-[11px] font-black uppercase tracking-widest text-amber-700">Category Leader</span>
                    <h2 class="cinzel-font text-3xl font-black uppercase text-stone-900 mt-0.5">${top.name}</h2>
                </div>
            </div>
            <div class="mono-font text-4xl font-black text-emerald-900">
                ${top.points} <span class="text-xs font-sans font-bold text-stone-500">PTS</span>
            </div>
        </div>
    `;

    if (runnersUp.length > 0) {
        html += `<div class="grid grid-cols-2 gap-3">`;
        runnersUp.forEach((t, i) => {
            const medal = i === 0 ? '🥈' : '🥉';
            html += `
                <div class="glass-panel px-4 py-3 rounded-xl border flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <span class="text-xl">${medal}</span>
                        <span class="font-bold text-sm uppercase text-stone-800">${t.name}</span>
                    </div>
                    <span class="mono-font font-bold text-stone-700">${t.points} pts</span>
                </div>
            `;
        });
        html += `</div>`;
    }

    container.innerHTML = html;
}

function renderCategoryComparison(catName) {
    const container = document.getElementById('categoryComparisonContainer');
    if (!container) return;

    const cat = categoryPerformanceData.find(c => c.categoryName === catName);
    if (!cat || !cat.teams || !cat.teams.length) return;

    container.innerHTML = cat.teams.slice(0, 5).map(t => {
        const gradient = teamColorMap[t.name] || 'linear-gradient(90deg, #0f5132, #198754)';
        return `
            <div class="glass-panel px-4 py-2.5 rounded-xl border flex items-center justify-between gap-4">
                <span class="mono-font text-xs font-bold text-stone-500 w-6">#${t.rank}</span>
                <span class="font-bold uppercase text-xs text-stone-800 w-40 truncate">${t.name}</span>
                <div class="flex-1 bg-stone-300/60 h-2 rounded-full overflow-hidden">
                    <div class="h-full rounded-full" style="width: ${t.pct}%; background: ${gradient};"></div>
                </div>
                <span class="mono-font text-sm font-bold text-stone-800 w-20 text-right">${t.points} pts</span>
            </div>
        `;
    }).join('');
}

function renderMarqueeRibbon() {
    const track = document.getElementById('ribbonTrack');
    if (!track) return;
    if (!latestPublishedResults.length) return;

    const items = latestPublishedResults.slice(0, 8).map(item => `
        <span class="inline-flex items-center gap-2">
            <span class="text-amber-400 font-mono font-bold">${item.programCode || ''}</span>
            <span class="text-white">${item.programName || 'Competition'}</span>
            <span class="bg-stone-800 text-stone-300 px-1.5 py-0.5 rounded text-[10px]">${item.categoryName || ''}</span>
            <span class="text-emerald-400 font-bold">🥇 ${item.winnerName} (${item.winningTeam})</span>
        </span>
    `).join('<span class="mx-3 text-stone-600">&bull;</span>');

    track.innerHTML = items + '<span class="mx-3 text-stone-600">&bull;</span>' + items;
}

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
    // If the overlay is active, don't interrupt it with a slide change
    if (document.getElementById('newResultOverlay').classList.contains('announce-active')) return;

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
        screenTeam?.classList.add('active');
    } else if (slide.type === 'catLeaders') {
        renderCategoryLeaders(slide.categoryName);
        screenLeaders?.classList.add('active');
    } else if (slide.type === 'catComparison') {
        renderCategoryComparison(slide.categoryName);
        screenComp?.classList.add('active');
    }

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

document.addEventListener('DOMContentLoaded', () => {
    onSnapshot(doc(db, "institutes", instId, "metadata", "eventConfig"), (snap) => {
        eventConfig = snap.exists() ? snap.data() : null;
        updateHeader();
    });

    onSnapshot(doc(db, "institutes", instId, "metadata", "dashboard"), (snap) => {
        if (snap.exists()) {
            const data = snap.data();
            dashboardData = data;
            leaderboardData = data.publicLeaderboard || [];
            categoryPerformanceData = data.publicCategoryPerformance || [];
            
            const newResultsList = data.publicLatestPublishedResults || [];
            
            // Check if there's a new result to announce
            if (newResultsList.length > 0) {
                const newestResult = newResultsList[0];
                // If this is not the first load, and the ID is different, trigger takeover
                if (lastAnnouncedResultId !== null && newestResult.id !== lastAnnouncedResultId) {
                    triggerNewResultAnnouncement(newestResult);
                }
                lastAnnouncedResultId = newestResult.id;
            }
            
            latestPublishedResults = newResultsList;
        }

        assignTeamColors();
        buildSlidesSequence();
        updateHeader();
        renderMarqueeRibbon();
        
        // Only force display if the announcement isn't running
        if (!document.getElementById('newResultOverlay').classList.contains('announce-active')) {
            displayCurrentSlide();
        }
    });

    startAutoRotation();
});
