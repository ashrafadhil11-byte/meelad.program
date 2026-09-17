import { db, doc, onSnapshot, collection, query, where } from './firebase.js';

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
const ROTATION_DURATION = 9000;
const ANNOUNCEMENT_DURATION = 30000; // Exactly 30 seconds per published item

// Queue Management for Results
const announcementQueue = [];
let isAnnouncing = false;
const processedResultDocIds = new Set();
let isFirstSync = true;

const TEAM_PALETTES = [
    'linear-gradient(90deg, #0f5132, #198754)', 
    'linear-gradient(90deg, #b45309, #d97706)', 
    'linear-gradient(90deg, #1e3a8a, #2563eb)', 
    'linear-gradient(90deg, #6b21a8, #9333ea)', 
    'linear-gradient(90deg, #9f1239, #e11d48)'  
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

// ─────────────────────────────────────────────
// POSTER TAKEOVER ENGINE (30 SEC QUEUE HANDLER)
// ─────────────────────────────────────────────
function queueResultAnnouncement(resultData) {
    announcementQueue.push(resultData);
    if (!isAnnouncing) {
        processNextAnnouncement();
    }
}

function processNextAnnouncement() {
    if (announcementQueue.length === 0) {
        isAnnouncing = false;
        const overlay = document.getElementById('posterAnnouncementOverlay');
        const normalHeader = document.getElementById('normalViewHeader');
        
        overlay.classList.remove('poster-active');
        overlay.classList.add('poster-exit');

        setTimeout(() => {
            overlay.classList.add('hidden');
            overlay.classList.remove('poster-exit');
            if (normalHeader) normalHeader.style.opacity = '1';
            displayCurrentSlide();
            startAutoRotation();
        }, 500);
        return;
    }

    isAnnouncing = true;
    if (rotatorTimer) clearInterval(rotatorTimer);

    const currentResult = announcementQueue.shift();
    renderPosterCard(currentResult);
}

function renderPosterCard(res) {
    const overlay = document.getElementById('posterAnnouncementOverlay');
    const normalHeader = document.getElementById('normalViewHeader');
    
    document.querySelectorAll('.screen-view').forEach(s => s.classList.remove('active'));
    if (normalHeader) normalHeader.style.opacity = '0';

    // Populate Program Information
    document.getElementById('posterCategory').textContent = res.categoryName || 'General';
    document.getElementById('posterProgCode').textContent = res.programCode ? String(res.programCode).padStart(2, '0') : '01';
    document.getElementById('posterProgName').textContent = res.programName || 'Competition Program';
    document.getElementById('posterQueueCounter').textContent = `Remaining in Queue: ${announcementQueue.length + 1}`;

    // Extract Ranks 1, 2, 3
    let winnersList = [];
    if (Array.isArray(res.marksData) && res.marksData.length > 0) {
        const sorted = [...res.marksData]
            .filter(m => m.rank && m.rank <= 3)
            .sort((a, b) => a.rank - b.rank);
        winnersList = sorted.map(w => ({
            rank: w.rank,
            name: w.studentName || w.name || 'Candidate',
            team: w.teamName || '',
            grade: w.grade || ''
        }));
    } else if (Array.isArray(res.winners) && res.winners.length > 0) {
        const sorted = [...res.winners]
            .filter(w => w.rank && w.rank <= 3)
            .sort((a, b) => a.rank - b.rank);
        winnersList = sorted.map(w => ({
            rank: w.rank,
            name: w.studentName || w.name || 'Candidate',
            team: w.teamName || '',
            grade: w.grade || ''
        }));
    }

    const winnersContainer = document.getElementById('posterWinnersContainer');
    if (winnersList.length === 0) {
        winnersContainer.innerHTML = `<div class="text-stone-500 font-bold py-6">Results announced. Awaiting winner roster.</div>`;
    } else {
        winnersContainer.innerHTML = winnersList.map(w => `
            <div class="flex items-center gap-5 bg-white/70 border border-stone-300/70 p-3.5 rounded-2xl shadow-sm">
                <div class="w-11 h-11 rounded-full rank-circle-gold flex items-center justify-center font-black text-xl flex-shrink-0">
                    ${w.rank}
                </div>
                <div class="flex-1 min-w-0">
                    <div class="ml-font text-2xl font-bold text-stone-900 truncate leading-snug">
                        ${escapeHTML(w.name)}
                    </div>
                    <div class="flex items-center gap-2 mt-0.5">
                        <span class="text-xs font-black uppercase tracking-wider text-amber-900 bg-amber-500/20 px-2 py-0.5 rounded">
                            ${escapeHTML(w.team || 'Team')}
                        </span>
                        ${w.grade ? `<span class="text-xs font-mono font-bold text-emerald-800 bg-emerald-500/10 px-1.5 py-0.5 rounded">Grade: ${escapeHTML(w.grade)}</span>` : ''}
                    </div>
                </div>
            </div>
        `).join('');
    }

    // Trigger Overlay Entrance
    overlay.classList.remove('hidden', 'poster-exit');
    overlay.classList.add('poster-active');

    // 30-Second Progress Line Animation
    const fill = document.getElementById('posterTimeFill');
    const timerLabel = document.getElementById('posterTimerSec');
    
    if (fill) {
        fill.style.transition = 'none';
        fill.style.width = '0%';
        void fill.offsetWidth;
        fill.style.transition = `width ${ANNOUNCEMENT_DURATION}ms linear`;
        fill.style.width = '100%';
    }

    let remainingSec = ANNOUNCEMENT_DURATION / 1000;
    const interval = setInterval(() => {
        remainingSec--;
        if (timerLabel) timerLabel.textContent = `${remainingSec}s`;
        if (remainingSec <= 0) {
            clearInterval(interval);
        }
    }, 1000);

    // Switch to next in queue after 30 seconds
    setTimeout(() => {
        processNextAnnouncement();
    }, ANNOUNCEMENT_DURATION);
}

// ─────────────────────────────────────────────
// NORMAL SCREENS (ROTATION)
// ─────────────────────────────────────────────
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
    if (isAnnouncing) return;

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

// ─────────────────────────────────────────────
// REALTIME DATA LISTENERS
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // 1. Config Metadata
    onSnapshot(doc(db, "institutes", instId, "metadata", "eventConfig"), (snap) => {
        eventConfig = snap.exists() ? snap.data() : null;
        updateHeader();
    });

    // 2. Aggregates for Leaderboard & Ticker
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

        if (!isAnnouncing) {
            displayCurrentSlide();
        }
    });

    // 3. Raw Published Results Listener (Extracts 1st, 2nd, 3rd Winner Rosters)
    const resultsCol = collection(db, "institutes", instId, "results");
    const qResults = query(resultsCol, where("status", "==", "published"), where("publicReleased", "==", true));

    onSnapshot(qResults, (snapshot) => {
        if (isFirstSync) {
            // Seed existing published documents so only future publications trigger popups
            snapshot.docs.forEach(docSnap => processedResultDocIds.add(docSnap.id));
            isFirstSync = false;
            return;
        }

        snapshot.docChanges().forEach((change) => {
            if (change.type === "added" || change.type === "modified") {
                const docId = change.doc.id;
                const data = change.doc.data();

                // Detect newly published event
                if (!processedResultDocIds.has(docId)) {
                    processedResultDocIds.add(docId);
                    queueResultAnnouncement(data);
                }
            }
        });
    });

    startAutoRotation();
});
