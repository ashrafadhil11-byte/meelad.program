import { db, doc, onSnapshot, collection, query, where } from './firebase.js';

const DEFAULT_INSTITUTE_ID = "XnTaWEgDWBqdODmxXGG4";
const instId = DEFAULT_INSTITUTE_ID;
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
const ANNOUNCEMENT_DURATION = 30000; 

// Ad Settings
const AD_INTERVAL = 5 * 60 * 1000; 
const AD_DURATION = 30000; 
let isAdShowing = false;
let adCycleIntervalId = null;
let adDurationTimeoutId = null;

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

function getGradientForString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    const gradients = [
        'linear-gradient(to bottom right, #450a0a, #dc2626)', 
        'linear-gradient(to bottom right, #172554, #2563eb)', 
        'linear-gradient(to bottom right, #052e16, #16a34a)', 
        'linear-gradient(to bottom right, #3b0764, #9333ea)', 
        'linear-gradient(to bottom right, #431407, #ea580c)', 
        'linear-gradient(to bottom right, #042f2e, #0d9488)', 
        'linear-gradient(to bottom right, #4c0519, #e11d48)'  
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
// ADVERTISEMENT ENGINE (5 Mins)
// ─────────────────────────────────────────────
function startAdCycle() {
    if (adCycleIntervalId) clearInterval(adCycleIntervalId);
    adCycleIntervalId = setInterval(() => {
        triggerAdTakeover();
    }, AD_INTERVAL);
}

function triggerAdTakeover() {
    if (isAnnouncing) return; 

    isAdShowing = true;
    if (rotatorTimer) clearInterval(rotatorTimer);

    const adOverlay = document.getElementById('adSponsorOverlay');
    const normalTopHeader = document.getElementById('normalTopHeader');
    const normalViewHeader = document.getElementById('normalViewHeader');
    const normalFooter = document.getElementById('normalFooter');

    document.querySelectorAll('.screen-view').forEach(s => s.classList.remove('active'));
    if (normalTopHeader) normalTopHeader.style.opacity = '0';
    if (normalViewHeader) normalViewHeader.style.opacity = '0';
    if (normalFooter) normalFooter.style.opacity = '0';

    adOverlay.classList.remove('hidden');
    setTimeout(() => { adOverlay.classList.remove('opacity-0'); }, 50);

    const fill = document.getElementById('adTimeFill');
    if (fill) {
        fill.style.transition = 'none'; fill.style.width = '0%';
        void fill.offsetWidth;
        fill.style.transition = `width ${AD_DURATION}ms linear`;
        fill.style.width = '100%';
    }

    adDurationTimeoutId = setTimeout(() => {
        endAdTakeover();
    }, AD_DURATION);
}

function endAdTakeover() {
    if (!isAdShowing) return;
    isAdShowing = false;
    
    const adOverlay = document.getElementById('adSponsorOverlay');
    adOverlay.classList.add('opacity-0');
    
    setTimeout(() => {
        adOverlay.classList.add('hidden');
        if (!isAnnouncing) {
            const normalTopHeader = document.getElementById('normalTopHeader');
            const normalViewHeader = document.getElementById('normalViewHeader');
            const normalFooter = document.getElementById('normalFooter');
            
            if (normalTopHeader) normalTopHeader.style.opacity = '1';
            if (normalViewHeader) normalViewHeader.style.opacity = '1';
            if (normalFooter) normalFooter.style.opacity = '1';
            
            displayCurrentSlide();
            startAutoRotation();
        }
    }, 500); 
}

// ─────────────────────────────────────────────
// DYNAMIC POSTER ENGINE
// ─────────────────────────────────────────────
function queueResultAnnouncement(resultData) {
    announcementQueue.push(resultData);
    if (!isAnnouncing) processNextAnnouncement();
}

function processNextAnnouncement() {
    if (isAdShowing) {
        clearTimeout(adDurationTimeoutId);
        const adOverlay = document.getElementById('adSponsorOverlay');
        adOverlay.classList.add('hidden', 'opacity-0');
        isAdShowing = false;
    }

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
    
    const stableId = res.programId || res.id || 'default';
    const uniqueGradient = getGradientForString(stableId);
    document.getElementById('posterGradientFooter').style.background = uniqueGradient;

    let rawCode = res.programCode || res.programNumber || res.code || '';
    let pName = res.programName || 'Competition Program';
    
    if (!rawCode) {
        const match = pName.trim().match(/^(\d+)/);
        if (match) rawCode = match[1];
    }
    let pCode = rawCode ? String(rawCode).padStart(2, '0') : '--';

    let cleanName = pName.trim();
    if (rawCode) {
        const paddedCode = String(rawCode).padStart(2, '0');
        if (cleanName.toLowerCase().startsWith(String(rawCode).toLowerCase())) {
            cleanName = cleanName.substring(String(rawCode).length).trim();
        } else if (cleanName.toLowerCase().startsWith(paddedCode.toLowerCase())) {
            cleanName = cleanName.substring(paddedCode.length).trim();
        }
    }
    if (cleanName.startsWith('-') || cleanName.startsWith(':')) cleanName = cleanName.substring(1).trim();

    document.getElementById('posterCategory').textContent = res.categoryName || 'General';
    document.getElementById('posterProgCode').textContent = pCode;
    document.getElementById('posterProgName').textContent = cleanName;
    document.getElementById('posterQueueCounter').textContent = `Queue: ${announcementQueue.length + 1}`;

    const programUrl = `${PUBLIC_DOMAIN_URL}?id=${instId}&prog=${stableId}`;
    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&format=svg&color=000000&bgcolor=ffffff&data=${encodeURIComponent(programUrl)}`;
    document.getElementById('posterQrImage').src = qrApiUrl;

    let winnersList = [];
    if (Array.isArray(res.marksData) && res.marksData.length > 0) {
        winnersList = [...res.marksData].filter(m => m.rank && m.rank <= 3).sort((a, b) => a.rank - b.rank);
    } else if (Array.isArray(res.winners) && res.winners.length > 0) {
        winnersList = [...res.winners].filter(w => w.rank && w.rank <= 3).sort((a, b) => a.rank - b.rank);
    }

    const winnersContainer = document.getElementById('posterWinnersContainer');
    if (winnersList.length === 0) {
        winnersContainer.innerHTML = `<div class="text-stone-500 font-bold py-4 text-sm text-center w-full">Results finalized. Awaiting roster data.</div>`;
    } else {
        const firstPlace = winnersList.filter(w => w.rank === 1);
        const runnersUp = winnersList.filter(w => w.rank === 2 || w.rank === 3);

        // Auto-Center Wrap Container
        let html = `<div class="flex flex-col justify-center gap-3 md:gap-4 w-[90%] md:w-[85%] mx-auto mt-2 min-h-0">`;

        firstPlace.forEach(w => {
            html += `
            <div class="flex items-center gap-3 md:gap-5">
                <div class="text-[50px] md:text-[60px] text-amber-500 font-black drop-shadow-sm flex-shrink-0 leading-none">1</div>
                <div class="flex-1 min-w-0">
                    <div class="ml-font text-2xl md:text-3xl font-black text-stone-900 leading-[1.1] mb-0.5 md:mb-1 truncate">
                        ${escapeHTML(w.studentName || w.name || 'Candidate')}
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="text-[9px] md:text-xs font-bold uppercase tracking-widest text-stone-500 whitespace-nowrap flex-shrink-0">${escapeHTML(w.teamName || w.team || 'Team')}</span>
                        ${w.grade ? `<span class="bg-stone-200 text-stone-600 px-1.5 py-0.5 rounded text-[8px] md:text-[9px] font-mono font-bold whitespace-nowrap flex-shrink-0">Grade: ${escapeHTML(w.grade)}</span>` : ''}
                    </div>
                </div>
            </div>`;
        });

        if (runnersUp.length > 0) {
            html += `<div class="flex flex-col gap-2 md:gap-3 pl-2 md:pl-3 min-h-0">`;
            runnersUp.forEach(w => {
                html += `
                <div class="flex items-center gap-3 md:gap-4">
                    <div class="text-[28px] md:text-[32px] text-stone-300 font-black w-6 md:w-8 text-center flex-shrink-0 leading-none">${w.rank}</div>
                    <div class="flex-1 min-w-0">
                        <div class="ml-font text-lg md:text-[22px] font-bold text-stone-700 leading-none mb-0.5 md:mb-1 truncate">
                            ${escapeHTML(w.studentName || w.name || 'Candidate')}
                        </div>
                        <div class="flex items-center gap-1.5">
                            <span class="text-[8px] md:text-[9px] font-bold uppercase tracking-widest text-stone-400 whitespace-nowrap flex-shrink-0">${escapeHTML(w.teamName || w.team || 'Team')}</span>
                        </div>
                    </div>
                </div>`;
            });
            html += `</div>`;
        }
        html += `</div>`;
        winnersContainer.innerHTML = html;
    }

    overlay.classList.remove('hidden', 'poster-overlay-exit');
    overlay.classList.add('poster-overlay-active');

    const fill = document.getElementById('posterTimeFill');
    if (fill) {
        fill.style.transition = 'none'; fill.style.width = '0%';
        void fill.offsetWidth;
        fill.style.transition = `width ${ANNOUNCEMENT_DURATION}ms linear`;
        fill.style.width = '100%';
    }

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
            <div class="glass-panel px-4 md:px-5 py-2.5 md:py-3 rounded-xl flex items-center gap-3 md:gap-4 border">
                <div class="w-6 md:w-8 flex-shrink-0 text-center text-base md:text-lg font-bold">${rankSymbol}</div>
                <div class="flex-1 min-w-0 font-black uppercase text-stone-900 tracking-wide truncate text-xs md:text-sm">${t.name}</div>
                <div class="hidden sm:block w-1/4 md:w-1/3 bg-stone-300/60 h-2 md:h-2.5 rounded-full overflow-hidden flex-shrink-0">
                    <div class="h-full rounded-full transition-all duration-700" style="width: ${widthPct}%; background: ${gradient};"></div>
                </div>
                <div class="mono-font text-base md:text-lg font-black text-emerald-900 w-16 md:w-24 text-right flex-shrink-0">
                    ${pts} <span class="text-[8px] md:text-[10px] font-sans font-semibold text-stone-500">PTS</span>
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
        <div class="glass-panel p-5 md:p-6 rounded-2xl border mb-3 flex items-center justify-between">
            <div class="flex items-center gap-4 md:gap-5 min-w-0">
                <div class="text-4xl md:text-5xl flex-shrink-0">🥇</div>
                <div class="min-w-0">
                    <span class="text-[9px] md:text-[11px] font-black uppercase tracking-widest text-amber-700 whitespace-nowrap">Category Leader</span>
                    <h2 class="cinzel-font text-2xl md:text-3xl font-black uppercase text-stone-900 mt-0.5 truncate">${top.name}</h2>
                </div>
            </div>
            <div class="mono-font text-3xl md:text-4xl font-black text-emerald-900 flex-shrink-0 ml-4">${top.points} <span class="text-[10px] md:text-xs font-sans font-bold text-stone-500">PTS</span></div>
        </div>
    `;

    if (runnersUp.length > 0) {
        html += `<div class="grid grid-cols-2 gap-2 md:gap-3">`;
        runnersUp.forEach((t, i) => {
            html += `
                <div class="glass-panel px-3 md:px-4 py-2.5 md:py-3 rounded-xl border flex items-center justify-between">
                    <div class="flex items-center gap-2 md:gap-3 min-w-0"><span class="text-lg md:text-xl flex-shrink-0">${i === 0 ? '🥈' : '🥉'}</span><span class="font-bold text-xs md:text-sm uppercase text-stone-800 truncate">${t.name}</span></div>
                    <span class="mono-font font-bold text-xs md:text-sm text-stone-700 flex-shrink-0 ml-2">${t.points} pts</span>
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
            <div class="glass-panel px-3 md:px-4 py-2 md:py-2.5 rounded-xl border flex items-center justify-between gap-3 md:gap-4">
                <span class="mono-font text-[10px] md:text-xs font-bold text-stone-500 w-5 md:w-6 flex-shrink-0">#${t.rank}</span>
                <span class="font-bold uppercase text-[10px] md:text-xs text-stone-800 flex-1 min-w-0 truncate">${t.name}</span>
                <div class="hidden sm:block w-1/4 md:w-1/3 bg-stone-300/60 h-1.5 md:h-2 rounded-full overflow-hidden flex-shrink-0"><div class="h-full rounded-full" style="width: ${t.pct}%; background: ${gradient};"></div></div>
                <span class="mono-font text-xs md:text-sm font-bold text-stone-800 w-16 md:w-20 text-right flex-shrink-0">${t.points} pts</span>
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
    if (isAnnouncing || isAdShowing) return;

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
        if (!isAnnouncing && !isAdShowing) displayCurrentSlide();
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
    startAdCycle(); 
});
