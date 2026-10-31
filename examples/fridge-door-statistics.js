'use strict';

/**
 * ioBroker refrigerator door statistics
 * Set SOURCE_ID to a contact state whose value is "open" or "closed".
 * All required states below ROOT_ID are created automatically.
 */
const SOURCE_ID = 'smartthings.0.REPLACE_ME.status.cooler.contactSensor.contact.value';
const ROOT_ID = '0_userdata.0.Kuehlschrank.Tuer';
const UPDATE_INTERVAL_MS = 5000;

const ID = {
    day: `${ROOT_ID}.day`, isOpen: `${ROOT_ID}.isOpen`, openSince: `${ROOT_ID}.openSince`,
    currentOpenSeconds: `${ROOT_ID}.currentOpenSeconds`, lastOpenSeconds: `${ROOT_ID}.lastOpenSeconds`,
    todayOpenSeconds: `${ROOT_ID}.todayOpenSeconds`, todayCompletedOpenSeconds: `${ROOT_ID}.todayCompletedOpenSeconds`,
    todayOpenCount: `${ROOT_ID}.todayOpenCount`, todayLongestOpenSeconds: `${ROOT_ID}.todayLongestOpenSeconds`,
    lastClosedAt: `${ROOT_ID}.lastClosedAt`,
};

const stateDefinitions = [
    [ID.day, '', 'Statistiktag', 'string', 'text'],
    [ID.isOpen, false, 'Kühlschranktür offen', 'boolean', 'sensor.open'],
    [ID.openSince, 0, 'Kühlschranktür geöffnet seit', 'number', 'value.time', 'ms'],
    [ID.currentOpenSeconds, 0, 'Aktuelle Öffnungsdauer', 'number', 'value.interval', 's'],
    [ID.lastOpenSeconds, 0, 'Letzte Öffnungsdauer', 'number', 'value.interval', 's'],
    [ID.todayOpenSeconds, 0, 'Gesamte Öffnungsdauer heute', 'number', 'value.interval', 's'],
    [ID.todayCompletedOpenSeconds, 0, 'Abgeschlossene Öffnungsdauer heute (intern)', 'number', 'value.interval', 's'],
    [ID.todayOpenCount, 0, 'Türöffnungen heute', 'number', 'value'],
    [ID.todayLongestOpenSeconds, 0, 'Längste Öffnung heute', 'number', 'value.interval', 's'],
    [ID.lastClosedAt, 0, 'Tür zuletzt geschlossen', 'number', 'value.time', 'ms'],
];

for (const [id, initialValue, name, type, role, unit] of stateDefinitions) {
    const common = { name, type, role, read: true, write: false };
    if (unit) common.unit = unit;
    createState(id, initialValue, common);
}

function readNumber(id) {
    const value = Number((getState(id) || {}).val);
    return Number.isFinite(value) ? value : 0;
}
function readBoolean(id) { return Boolean((getState(id) || {}).val); }
function writeIfChanged(id, value) {
    const state = getState(id);
    if (!state || state.val !== value || state.q !== 0 || state.ack !== true) setState(id, value, true);
}
function dayKey(timestamp) {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function startOfDay(timestamp) {
    const date = new Date(timestamp); date.setHours(0, 0, 0, 0); return date.getTime();
}
function secondsBetween(from, to) { return Math.max(0, Math.round((to - from) / 1000)); }
function sourceIsOpen(value) { return String(value || '').toLowerCase() === 'open'; }

function ensureDay(now) {
    const currentDay = dayKey(now);
    if (String((getState(ID.day) || {}).val || '') === currentDay) return;
    writeIfChanged(ID.day, currentDay);
    writeIfChanged(ID.todayCompletedOpenSeconds, 0);
    writeIfChanged(ID.todayOpenSeconds, 0);
    writeIfChanged(ID.todayOpenCount, 0);
    writeIfChanged(ID.todayLongestOpenSeconds, 0);
}

function updateLive(now) {
    ensureDay(now);
    const completed = readNumber(ID.todayCompletedOpenSeconds);
    if (!readBoolean(ID.isOpen)) {
        writeIfChanged(ID.currentOpenSeconds, 0);
        writeIfChanged(ID.todayOpenSeconds, completed);
        return;
    }
    const openSince = readNumber(ID.openSince);
    if (!openSince) return;
    const fullSessionSeconds = secondsBetween(openSince, now);
    const daySegmentSeconds = secondsBetween(Math.max(openSince, startOfDay(now)), now);
    writeIfChanged(ID.currentOpenSeconds, fullSessionSeconds);
    writeIfChanged(ID.todayOpenSeconds, completed + daySegmentSeconds);
    if (daySegmentSeconds > readNumber(ID.todayLongestOpenSeconds)) writeIfChanged(ID.todayLongestOpenSeconds, daySegmentSeconds);
}

function startSession(now, countOpening) {
    ensureDay(now);
    writeIfChanged(ID.isOpen, true); writeIfChanged(ID.openSince, now); writeIfChanged(ID.currentOpenSeconds, 0);
    if (countOpening) writeIfChanged(ID.todayOpenCount, readNumber(ID.todayOpenCount) + 1);
    updateLive(now);
}

function closeSession(now) {
    ensureDay(now);
    const openSince = readNumber(ID.openSince);
    if (!openSince) {
        writeIfChanged(ID.isOpen, false); writeIfChanged(ID.currentOpenSeconds, 0); return;
    }
    const fullSessionSeconds = secondsBetween(openSince, now);
    const daySegmentSeconds = secondsBetween(Math.max(openSince, startOfDay(now)), now);
    const completed = readNumber(ID.todayCompletedOpenSeconds) + daySegmentSeconds;
    writeIfChanged(ID.todayCompletedOpenSeconds, completed);
    writeIfChanged(ID.todayOpenSeconds, completed);
    writeIfChanged(ID.lastOpenSeconds, fullSessionSeconds);
    writeIfChanged(ID.lastClosedAt, now);
    if (daySegmentSeconds > readNumber(ID.todayLongestOpenSeconds)) writeIfChanged(ID.todayLongestOpenSeconds, daySegmentSeconds);
    writeIfChanged(ID.isOpen, false); writeIfChanged(ID.openSince, 0); writeIfChanged(ID.currentOpenSeconds, 0);
}

function initialize() {
    const now = Date.now(); ensureDay(now);
    const source = getState(SOURCE_ID);
    if (!source) { log(`Türkontakt nicht verfügbar: ${SOURCE_ID}`, 'warn'); return; }
    if (sourceIsOpen(source.val)) {
        if (!readBoolean(ID.isOpen) || !readNumber(ID.openSince)) {
            const inferredOpenSince = source.lc && source.lc <= now ? source.lc : now;
            startSession(inferredOpenSince, inferredOpenSince >= startOfDay(now));
        }
        updateLive(now);
    } else if (readBoolean(ID.isOpen)) {
        closeSession(source.lc && source.lc <= now ? source.lc : now);
    } else {
        writeIfChanged(ID.isOpen, false); writeIfChanged(ID.openSince, 0); writeIfChanged(ID.currentOpenSeconds, 0); updateLive(now);
    }
}

on({ id: SOURCE_ID, change: 'ne' }, obj => {
    const eventTime = obj.state && obj.state.ts ? obj.state.ts : Date.now();
    if (sourceIsOpen(obj.state && obj.state.val)) {
        if (!readBoolean(ID.isOpen)) startSession(eventTime, true);
    } else if (readBoolean(ID.isOpen)) closeSession(eventTime);
});

setInterval(() => updateLive(Date.now()), UPDATE_INTERVAL_MS);
schedule('0 0 * * *', () => updateLive(Date.now()));
setTimeout(initialize, 1000);

