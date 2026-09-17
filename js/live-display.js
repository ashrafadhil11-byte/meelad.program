import { db, doc, onSnapshot, collection, query, where } from './firebase.js';

const DEFAULT_INSTITUTE_ID = "XnTaWEgDWBqdODmxXGG4";
const instId = DEFAULT_INSTITUTE_ID;

// Target domain for the QR code to prompt user download instead of TV Screen
const PUBLIC_DOMAIN_URL = "https://meelad-program.vercel.app/result.html"; 

let dashboardData = null;
let eventConfig = null;
let leaderboardData = [];
let categoryPerformanceData = [];
let latestPublishedResults = [];

let slidesList = [];
let currentSlideIndex = 0;
let rotatorTimer = null;
const ROTATION_DURATION = 9000;
const ANNOUNCEMENT_DURATION = 30000; // 30 seconds per result

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

// 95% Dark (Top Left) fading to 60% Light (Bottom Right) of unique hues
function getGradientForString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    const gradients = [
        'linear-gradient(to bottom right, #450a0a, #dc2626)', // Cherry Red
        'linear-gradient(to bottom right, #172554, #2563eb)', // Sapphire Blue
        'linear-gradient(to bottom right, #052e16, #16a34a)', // Forest Green
        'linear-gradient(to bottom right, #3b0764, #9333ea)', // Royal Purple
        'linear-gradient(to bottom right, #431407, #ea580c)', // Terracotta Orange
        'linear-gradient(to bottom right, #042f2e, #0d9488)', // Deep Teal
        'linear-gradient(to bottom right, #4c0519, #e11d48)'  // Rose Pink
    ];
    return gradients[Math.abs(hash) % gradients.length];
}

function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div'); div.textContent = str; return div.innerHTML;
}

function formatTimeAMPM(timestamp) {
    const date = timestamp ? new Date(timestamp) : new Date();
    let hours = date.getHours(); let minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours}:${minutes < 10 ? '0' + minutes : minutes} ${ampm}`;
}

function assignTeamColors() {
    const names = new Set();
    leaderboardData.forEach(t => t.name && names.add(t.name));
    Array.from(names).sort().forEach((name, idx) => {
        if (!teamColorMap[name]) teamColorMap[name] = TEAM_PALETTES[idx % TEAM_PALETTES.length];
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
// DYNAMIC POSTER ENGINE (1:1 Ratio Square)
// ─────────────────────────────────────────────
function queueResultAnnouncement(resultData) {
    announcementQueue.push(resultData);
    if (!isAnnouncing) processNextAnnouncement();
}

function processNextAnnouncement() {
    const overlay = document.getElementById('posterAnnouncementOverlay');
    const normalTopHeader = document.getElementById('normalTopHeader');
    const normalViewHeader = document.getElementById('normalViewHeader');
    const normalFooter = document.getElementById('normalFooter');

    if (announcementQueue.length === 0) {
        isAnnouncing = false;
        overlay.classList.remove('poster-overlay-active');
        overlay.classList.add('poster-overlay-exit');

        setTimeout(() => {
            overlay.classList.add('hidden');
            overlay.classList.remove('poster-overlay-exit');
            if (normalTopHeader) normalTopHeader.style.opacity = '1';
            if (normalViewHeader) normalViewHeader.style.opacity = '1';
            if (normalFooter) normalFooter.style.opacity = '1';
            displayCurrentSlide();
            startAutoRotation();
        }, 600);
        return;
    }

    isAnnouncing = true;
    if (rotatorTimer) clearInterval(rotatorTimer);

    document.querySelectorAll('.screen-view').forEach(s => s.classList.remove('active'));
    if (normalTopHeader) normalTopHeader.style.opacity = '0';
    if (normalViewHeader) normalViewHeader.style.opacity = '0';
    if (normalFooter) normalFooter.style.opacity = '0';

    const currentResult = announcementQueue.shift();
    renderPosterCard(currentResult);
}

function renderPosterCard(res) {
    const overlay = document.getElementById('posterAnnouncementOverlay');
    
    // Inject Gradient to Footer (95% Top Left -> 60% Bottom Right)
    const uniqueGradient = getGradientForString(res.programName || res.id || 'default');
    document.getElementById('posterGradientFooter').style.background = uniqueGradient;

    // Populate Text
    document.getElementById('posterCategory').textContent = res.categoryName || 'General';
    document.getElementById('posterProgCode').textContent = res.programCode ? String(res.programCode).padStart(2, '0') : '01';
    document.getElementById('posterProgName').textContent = res.programName || 'Competition Program';
    document.getElementById('posterQueueCounter').textContent = `Queue: ${announcementQueue.length + 1}`;

    // Generate QR Code via API to Dedicated Result Webpage
    const programUrl = `${PUBLIC_DOMAIN_URL}?id=${instId}&prog=${res.programId || res.id}`;
    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&format=svg&color=000000&bgcolor=ffffff&data=${encodeURIComponent(programUrl)}`;
    document.getElementById('posterQrImage').src = qrApiUrl;

    // Extract Winners (1st, 2nd, 3rd)
    let winnersList = [];
    if (Array.isArray(res.marksData) && res.marksData.length > 0) {
        winnersList = [...res.marksData].filter(m => m.rank && m.rank <= 3).sort((a, b) => a.rank - b.rank);
    } else if (Array.isArray(res.winners) && res.winners.length > 0) {
        winnersList = [...res.winners].filter(w => w.rank && w.rank <= 3).sort((a, b) => a.rank - b.rank);
    }

    const winnersContainer = document.getElementById('posterWinnersContainer');
    if (winnersList.length === 0) {
        winnersContainer.innerHTML = `<div class="text-stone-500 font-bold py-6 text-xl">Results finalized. Awaiting roster data.</div>`;
    } else {
        const firstPlace = winnersList.filter(w => w.rank === 1);
        const runnersUp = winnersList.filter(w => w.rank === 2 || w.rank === 3);

        let html = `<div class="flex flex-col gap-4 w-full">`;

        // First Place Display (Massive text)
        firstPlace.forEach(w => {
            html += `
            <div class="flex items-center gap-6">
                <div class="text-6xl text-amber-500 font-black drop-shadow-sm flex-shrink-0">1</div>
                <div class="min-w-0">
                    <div class="ml-font text-4xl font-black text-stone-900 leading-tight mb-1 truncate">
                        ${escapeHTML(w.studentName || w.name || 'Candidate')}
                    </div>
                    <div class="flex items-center gap-3">
                        <span class="text-xs font-bold uppercase tracking-widest text-stone-500">${escapeHTML(w.teamName || w.team || 'Team')}</span>
                        ${w.grade ? `<span class="bg-stone-200 text-stone-600 px-2 py-0.5 rounded text-[10px] font-mono font-bold">Grade: ${escapeHTML(w.grade)}</span>` : ''}
                    </div>
                </div>
            </div>`;
        });

        // 2nd & 3rd Place Display (Smaller)
        if (runnersUp.length > 0) {
            html += `<div class="flex flex-col gap-4 mt-2 pl-2">`;
            runnersUp.forEach(w => {
                html += `
                <div class="flex items-center gap-5">
                    <div class="text-3xl text-stone-300 font-black w-8 text-center flex-shrink-0">${w.rank}</div>
                    <div class="min-w-0">
                        <div class="ml-font text-2xl font-bold text-stone-700 leading-none mb-1 truncate">
                            ${escapeHTML(w.studentName || w.name || 'Candidate')}
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="text-[10px] font-bold uppercase tracking-widest text-stone-400">${escapeHTML(w.teamName || w.team || 'Team')}</span>
                        </div>
                    </div>
                </div>`;
            });
            html += `</div>`;
        }
        html += `</div>`;
        winnersContainer.innerHTML = html;
    }

    // Trigger Entrance
    overlay.classList.remove('hidden', 'poster-overlay-exit');
    overlay.classList.add('poster-overlay-active');

    // 30s Timer Animation
    const fill = document.getElementById('posterTimeFill');
    if (fill) {
        fill.style.transition = 'none'; fill.style.width = '0%';
        void fill.offsetWidth;
        fill.style.transition = `width ${ANNOUNCEMENT_DURATION}ms linear`;
        fill.style.width = '100%';
    }

    // Advance Queue
    setTimeout(() => { processNextAnnouncement(); }, ANNOUNCEMENT_DURATION);
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
        const rank = idx + 1; const pts = t.points || 0;
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
    if (!cat || !cat.teams || !cat.teams.length) return;

    const top = cat.teams[0]; const runnersUp = cat.teams.slice(1, 3);

    let html = `
        <div class="glass-panel p-6 rounded-2xl border mb-3 flex items-center justify-between">
            <div class="flex items-center gap-5">
                <div class="text-5xl">🥇</div>
                <div>
                    <span class="text-[11px] font-black uppercase tracking-widest text-amber-700">Category Leader</span>
                    <h2 class="cinzel-font text-3xl font-black uppercase text-stone-900 mt-0.5">${top.name}</h2>
                </div>
            </div>
            <div class="mono-font text-4xl font-black text-emerald-900">${top.points} <span class="text-xs font-sans font-bold text-stone-500">PTS</span></div>
        </div>
    `;

    if (runnersUp.length > 0) {
        html += `<div class="grid grid-cols-2 gap-3">`;
        runnersUp.forEach((t, i) => {
            html += `
                <div class="glass-panel px-4 py-3 rounded-xl border flex items-center justify-between">
                    <div class="flex items-center gap-3"><span class="text-xl">${i === 0 ? '🥈' : '🥉'}</span><span class="font-bold text-sm uppercase text-stone-800">${t.name}</span></div>
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
                <div class="flex-1 bg-stone-300/60 h-2 rounded-full overflow-hidden"><div class="h-full rounded-full" style="width: ${t.pct}%; background: ${gradient};"></div></div>
                <span class="mono-font text-sm font-bold text-stone-800 w-20 text-right">${t.points} pts</span>
            </div>
        `;
    }).join('');
}

function renderMarqueeRibbon() {
    const track = document.getElementById('ribbonTrack');
    if (!track || !latestPublishedResults.length) return;

    const items = latestPublishedResults.slice(0, 8).map(item => `
        <span class="inline-flex items-center gap-2">
            <span class="text-amber-400 font-mono font-bold">${item.programCode || ''}</span>
            <span class="text-white">${item.programName || 'Competition'}</span>
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

    if (slide.type === 'championship') { renderTeamChampionship(); screenTeam?.classList.add('active'); }
    else if (slide.type === 'catLeaders') { renderCategoryLeaders(slide.categoryName); screenLeaders?.classList.add('active'); }
    else if (slide.type === 'catComparison') { renderCategoryComparison(slide.categoryName); screenComp?.classList.add('active'); }

    const fill = document.getElementById('rotatorProgressFill');
    if (fill) {
        fill.style.transition = 'none'; fill.style.width = '0%'; void fill.offsetWidth;
        fill.style.transition = `width ${ROTATION_DURATION}ms linear`; fill.style.width = '100%';
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
            latestPublishedResults = data.publicLatestPublishedResults || [];
        }
        assignTeamColors();
        buildSlidesSequence();
        updateHeader();
        renderMarqueeRibbon();
        if (!isAnnouncing) displayCurrentSlide();
    });

    const resultsCol = collection(db, "institutes", instId, "results");
    const qResults = query(resultsCol, where("status", "==", "published"), where("publicReleased", "==", true));

    onSnapshot(qResults, (snapshot) => {
        if (isFirstSync) {
            snapshot.docs.forEach(docSnap => processedResultDocIds.add(docSnap.id));
            isFirstSync = false; return;
        }

        snapshot.docChanges().forEach((change) => {
            if (change.type === "added" || change.type === "modified") {
                const docId = change.doc.id;
                const data = change.doc.data();
                if (!processedResultDocIds.has(docId)) {
                    processedResultDocIds.add(docId);
                    queueResultAnnouncement(data);
                }
            }
        });
    });

    startAutoRotation();
});
