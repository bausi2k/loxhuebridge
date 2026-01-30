const express = require('express');
const axios = require('axios');
const fs = require('fs');
const https = require('https');
const path = require('path');
const dgram = require('dgram');
const os = require('os');
const mqtt = require('mqtt');
const { DatabaseSync } = require('node:sqlite');

// --- BOOT MSG ---
console.log("🚀 [BOOT] loxHueBridge Prozess gestartet...");

// --- CRASH MONITOR ---
process.on('uncaughtException', (err) => {
    console.error('🔥 [FATAL] UNCAUGHT EXCEPTION:', err);
    try { if(insertLogStmt) insertLogStmt.run(Date.now(), 'ERROR', 'SYSTEM', `CRASH: ${err.message}`); } catch(e){}
    process.exit(1); 
});

let pjson = { version: "unknown" };
try {
    const pJsonPath = path.join(__dirname, 'package.json');
    if (fs.existsSync(pJsonPath)) pjson = JSON.parse(fs.readFileSync(pJsonPath, 'utf8'));
} catch (e) { console.warn("⚠️ Konnte package.json nicht laden:", e.message); }

const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const MAPPING_FILE = path.join(DATA_DIR, 'mapping.json');
const DB_FILE = path.join(DATA_DIR, 'logs.db');

// Ensure Data Dir
if (!fs.existsSync(DATA_DIR)) {
    try { fs.mkdirSync(DATA_DIR); console.log(`[INIT] Ordner erstellt: ${DATA_DIR}`); } 
    catch (e) { console.error(`[FATAL] Konnte Datenordner nicht erstellen: ${e.message}`); }
}

const HTTP_PORT = parseInt(process.env.HTTP_PORT || "8555");
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Default Config
let config = {
    bridgeIp: process.env.HUE_BRIDGE_IP || null,
    appKey: process.env.HUE_APP_KEY || null,
    loxoneIp: process.env.LOXONE_IP || null,
    loxonePort: parseInt(process.env.LOXONE_UDP_PORT || "7000"),
    debug: process.env.DEBUG === 'true',
    transitionTime: 400,
    throttleTime: 100,
    mqttEnabled: false,
    mqttBroker: null,
    mqttPort: 1883,
    mqttUser: "",
    mqttPass: "",
    mqttPrefix: "loxhue",
    disableLogDisk: false
};

// --- DB SETUP ---
let db = null;
let insertLogStmt = null;
let dbError = null;

try {
    db = new DatabaseSync(DB_FILE);
    db.exec(`CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER, level TEXT, category TEXT, msg TEXT)`);
    db.exec('PRAGMA journal_mode = WAL;');
    insertLogStmt = db.prepare('INSERT INTO logs (timestamp, level, category, msg) VALUES (?, ?, ?, ?)');
} catch (e) {
    console.error("⚠️ [DB ERROR] RAM-Modus aktiv. Grund:", e.message);
    dbError = e.message;
    config.disableLogDisk = true; 
}

let isConfigured = false;
let mqttClient = null;
const MAX_RAM_LOGS = 500;
let ramLogs = [];

// --- MQTT SETUP (Safe) ---
function connectToMqtt() {
    if (mqttClient) { try { mqttClient.end(); } catch(e){} mqttClient = null; }
    
    if (!config.mqttEnabled || !config.mqttBroker) return;

    const brokerUrl = `mqtt://${config.mqttBroker}:${config.mqttPort || 1883}`;
    log.info(`Verbinde zu MQTT Broker: ${brokerUrl} ...`, 'SYSTEM');

    const safeStr = (s) => (s && typeof s === 'string') ? s.trim() : "";
    const options = { clientId: 'loxhue_' + Math.random().toString(16).substr(2, 8), reconnectPeriod: 5000 };
    
    const user = safeStr(config.mqttUser);
    const pass = safeStr(config.mqttPass);
    if (user.length > 0) options.username = user;
    if (pass.length > 0) options.password = pass;

    try {
        mqttClient = mqtt.connect(brokerUrl, options);
        mqttClient.on('connect', () => { log.success("MQTT Verbunden!", 'SYSTEM'); });
        mqttClient.on('error', (err) => { 
            log.error(`MQTT Fehler: ${err.message}`, 'SYSTEM');
            if (err.message && (err.message.includes('Not authorized') || err.message.includes('Connection refused'))) {
                log.warn("MQTT Auth fehlgeschlagen. Stoppe Verbindung.", 'SYSTEM');
                if(mqttClient) { mqttClient.end(); mqttClient = null; }
            }
        });
        mqttClient.on('offline', () => {});
    } catch (e) { log.error(`MQTT Init Fehler: ${e.message}`, 'SYSTEM'); }
}

const getTime = () => {
    const now = new Date();
    return now.toLocaleTimeString('de-DE', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0');
};

function addToLogBuffer(level, msg, category = 'SYSTEM') {
    const timeStr = getTime();
    const timestamp = Date.now();
    
    if (level === 'ERROR') console.error(`[${timeStr}] [${category}] ${msg}`);
    else console.log(`[${timeStr}] [${category}] ${msg}`);

    if (config.disableLogDisk || !insertLogStmt) {
        ramLogs.push({ id: timestamp, timestamp, level, category, msg });
        if (ramLogs.length > MAX_RAM_LOGS) ramLogs.shift();
    } else {
        try { insertLogStmt.run(timestamp, level, category, msg); } catch(e) { console.error("DB Write Error:", e); }
    }
}

const log = {
    info: (m, cat='SYSTEM') => addToLogBuffer('INFO', m, cat),
    success: (m, cat='SYSTEM') => addToLogBuffer('SUCCESS', m, cat),
    warn: (m, cat='SYSTEM') => addToLogBuffer('WARN', m, cat),
    error: (m, cat='SYSTEM') => addToLogBuffer('ERROR', m, cat),
    debug: (m, cat='SYSTEM') => { if(config.debug) addToLogBuffer('DEBUG', m, cat); },
    hueError: (e, cat='SYSTEM') => {
        const s = e.response ? e.response.status : 'Net';
        if (s === 429) { log.warn(`HUE RATE LIMIT (429)`, cat); return; }
        const d = e.response ? JSON.stringify(e.response.data) : e.message;
        log.error(`HUE ERR ${s}: ${d}`, cat);
    }
};

function getServerIp() {
    const interfaces = os.networkInterfaces();
    for (const devName in interfaces) {
        for (const alias of interfaces[devName]) {
            if (alias.family === 'IPv4' && !alias.internal) return alias.address;
        }
    }
    return '127.0.0.1';
}

function loadConfig() {
    console.log(`[INIT] Lade Konfiguration von: ${CONFIG_FILE}`);
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const content = fs.readFileSync(CONFIG_FILE, 'utf8');
            if(content) {
                const d = JSON.parse(content);
                config = { ...config, ...d };
                
                // Sanity Checks
                if (config.transitionTime === undefined) config.transitionTime = 400;
                if (config.throttleTime === undefined) config.throttleTime = 100;
                if (config.mqttPort === undefined) config.mqttPort = 1883;
                if (config.mqttPrefix === undefined) config.mqttPrefix = "loxhue";
                if (config.disableLogDisk === undefined) config.disableLogDisk = false;
                
                if (config.bridgeIp && config.appKey) { 
                    isConfigured=true; 
                    setTimeout(connectToMqtt, 500); 
                    return; 
                }
            }
        } else {
            console.log("[INIT] Keine Config-Datei gefunden. Starte mit Defaults.");
        }
    } catch (e) {
        log.error("Config Load Error: " + e.message, 'SYSTEM');
    }
    if (config.bridgeIp && config.appKey) isConfigured=true;
    else log.warn("Setup erforderlich. Bitte Dashboard öffnen.", 'SYSTEM');
}
loadConfig();

if (dbError) log.error(`DB Init fehlgeschlagen: ${dbError}. RAM-Modus aktiv.`, 'SYSTEM');

function saveConfigToFile() { 
    try { 
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 4)); 
        // log.info("Konfiguration gespeichert.", 'SYSTEM'); 
    } catch(e) {
        log.error(`Fehler beim Speichern der Config: ${e.message}`, 'SYSTEM');
    } 
}

let mapping = []; let detectedItems = []; let serviceToDeviceMap = {}; let statusCache = {};
let lightCapabilities = {};

function loadMapping() { try { if (fs.existsSync(MAPPING_FILE)) mapping = JSON.parse(fs.readFileSync(MAPPING_FILE)).filter(m=>m.loxone_name); } catch (e) { mapping = []; } }
loadMapping();

const LOX_MIN_MIREK = 153; const LOX_MAX_MIREK = 370;
function mapRange(v, i1, i2, o1, o2) { return (v - i1) * (o2 - o1) / (i2 - i1) + o1; }
function kelvinToMirek(k) { if (k < 2000) return 500; return Math.round(1000000/k); }
function componentToHex(c) { const hex = c.toString(16); return hex.length == 1 ? "0" + hex : hex; }
function rgbToHex(r, g, b) { return "#" + componentToHex(Math.round(r)) + componentToHex(Math.round(g)) + componentToHex(Math.round(b)); }
function xyToHex(x, y, bri = 1.0) {
    let z = 1.0 - x - y; let Y = bri; let X = (Y / y) * x; let Z = (Y / y) * z;
    let r = X * 1.656492 - Y * 0.354851 - Z * 0.255038;
    let g = -X * 0.707196 + Y * 1.655397 + Z * 0.036152;
    let b = X * 0.051713 - Y * 0.121364 + Z * 1.011530;
    r = r <= 0.0031308 ? 12.92 * r : (1.0 + 0.055) * Math.pow(r, (1.0 / 2.4)) - 0.055;
    g = g <= 0.0031308 ? 12.92 * g : (1.0 + 0.055) * Math.pow(g, (1.0 / 2.4)) - 0.055;
    b = b <= 0.0031308 ? 12.92 * b : (1.0 + 0.055) * Math.pow(b, (1.0 / 2.4)) - 0.055;
    return rgbToHex(Math.max(0, Math.min(255, r * 255)), Math.max(0, Math.min(255, g * 255)), Math.max(0, Math.min(255, b * 255)));
}
function mirekToHex(mirek) {
    let temp = 1000000 / mirek / 100; let r, g, b;
    if (temp <= 66) { r = 255; g = 99.4708025861 * Math.log(temp) - 161.1195681661; b = temp <= 19 ? 0 : 138.5177312231 * Math.log(temp - 10) - 305.0447927307; } 
    else { r = 329.698727446 * Math.pow(temp - 60, -0.1332047592); g = 288.1221695283 * Math.pow(temp - 60, -0.0755148492); b = 255; }
    return rgbToHex(Math.max(0, Math.min(255, r)), Math.max(0, Math.min(255, g)), Math.max(0, Math.min(255, b)));
}
function rgbToXy(r, g, b) {
    let red = r/100, green = g/100, blue = b/100;
    red = (red > 0.04045) ? Math.pow((red + 0.055) / 1.055, 2.4) : (red / 12.92);
    green = (green > 0.04045) ? Math.pow((green + 0.055) / 1.055, 2.4) : (green / 12.92);
    blue = (blue > 0.04045) ? Math.pow((blue + 0.055) / 1.055, 2.4) : (blue / 12.92);
    let X = red * 0.664511 + green * 0.154324 + blue * 0.162028;
    let Y = red * 0.283881 + green * 0.729798 + blue * 0.065885;
    let Z = red * 0.000088 + green * 0.077053 + blue * 0.950255;
    let sum = X + Y + Z;
    if (sum === 0) return { x: 0, y: 0 };
    return { x: Number((X / sum).toFixed(4)), y: Number((Y / sum).toFixed(4)) };
}
function rgbToMirekFallback(r, g, b, minM, maxM) {
    if ((r + b) === 0) return Math.round((minM + maxM) / 2);
    let warmth = r / (r + b); 
    return Math.round(minM + (warmth * (maxM - minM)));
}
function hueLightToLux(v) { return Math.round(Math.pow(10, (v - 1) / 10000)); }

const REQUEST_QUEUES = { light: { items: [], isProcessing: false, delayMs: 100 }, grouped_light: { items: [], isProcessing: false, delayMs: 1100 } };
if(config.throttleTime !== undefined) REQUEST_QUEUES.light.delayMs = config.throttleTime;

async function processQueue(type) {
    const q = REQUEST_QUEUES[type];
    if (q.isProcessing || q.items.length === 0) return;
    q.isProcessing = true;
    const task = q.items.shift();
    try { await task(); } catch (e) { log.error(`Queue Error (${type}): ${e.message}`, 'SYSTEM'); }
    setTimeout(() => { q.isProcessing = false; if (q.items.length > 0) processQueue(type); }, q.delayMs);
}
function enqueueRequest(type, taskFn) {
    const queueType = REQUEST_QUEUES[type] ? type : 'light';
    REQUEST_QUEUES[queueType].items.push(taskFn);
    processQueue(queueType);
}

const commandState = {}; 
async function updateLightWithQueue(uuid, type, payload, loxName, forcedDuration = null) {
    if (!commandState[uuid]) commandState[uuid] = { busy: false, next: null };
    let duration = config.transitionTime !== undefined ? config.transitionTime : 400;
    const isDigitalSwitch = Object.keys(payload).length === 1 && payload.on !== undefined;
    if (isDigitalSwitch && payload.on.on === true) duration = 0; 
    if (forcedDuration !== null) duration = forcedDuration;
    if (duration > 0) payload.dynamics = { duration: duration };
    if (commandState[uuid].busy) { commandState[uuid].next = payload; return; }
    commandState[uuid].busy = true;
    await sendToHueRecursive(uuid, type, payload, loxName);
}
async function sendToHueRecursive(uuid, type, payload, loxName) {
    enqueueRequest(type, async () => {
        try {
            const url = `https://${config.bridgeIp}/clip/v2/resource/${type}/${uuid}`;
            log.debug(`OUT -> Hue (${loxName}): ${JSON.stringify(payload)}`, 'LIGHT');
            await axios.put(url, payload, { headers: { 'hue-application-key': config.appKey }, httpsAgent });
            updateStatus(loxName, 'on', payload.on?.on ? 1 : 0);
            if(payload.dimming) updateStatus(loxName, 'bri', payload.dimming.brightness);
        } catch (e) { log.hueError(e, 'LIGHT'); } finally {
            if (commandState[uuid].next) { const nextPayload = commandState[uuid].next; commandState[uuid].next = null; await sendToHueRecursive(uuid, type, nextPayload, loxName); } else { commandState[uuid].busy = false; }
        }
    });
}

async function executeCommand(entry, value, forcedTransition = null) {
    const rid = entry.hue_uuid;
    const rtype = entry.hue_type === 'group' ? 'grouped_light' : 'light';
    let payload = {}; let n = parseInt(value); if(isNaN(n)) n=0;
    if (n === 0) payload = { on: { on: false } };
    else if (n === 1) payload = { on: { on: true } };
    else if (n > 1 && n <= 100) payload = { on: { on: true }, dimming: { brightness: n } };
    else {
        const s = value.toString();
        if (s.startsWith('20') && s.length >= 9) {
            const b = parseInt(s.substring(2, 5)); const k = parseInt(s.substring(5));
            let targetMirek = kelvinToMirek(k);
            const caps = lightCapabilities[rid];
            if (caps && caps.min && caps.max) {
                const scaled = Math.round(mapRange(targetMirek, LOX_MIN_MIREK, LOX_MAX_MIREK, caps.min, caps.max));
                targetMirek = Math.max(caps.min, Math.min(caps.max, scaled));
            }
            payload = (b===0) ? { on: { on: false } } : { on: { on: true }, dimming: { brightness: b }, color_temperature: { mirek: targetMirek } };
        } else {
            let b = Math.floor(n / 1000000), rem = n % 1000000, g = Math.floor(rem / 1000), r = rem % 1000, max = Math.max(r, g, b);
            if (max === 0) { payload = { on: { on: false } }; } else {
                const caps = lightCapabilities[rid];
                const supportsColor = caps ? caps.supportsColor : true;
                if (!supportsColor && caps && caps.supportsCt) {
                    const minM = caps.min || 153; const maxM = caps.max || 500;
                    const targetMirek = rgbToMirekFallback(r, g, b, minM, maxM);
                    payload = { on: { on: true }, dimming: { brightness: max }, color_temperature: { mirek: targetMirek } };
                    log.debug(`RGB Fallback: R${r} B${b} -> ${targetMirek}m`, 'LIGHT');
                } else { payload = { on: { on: true }, dimming: { brightness: max }, color: { xy: rgbToXy(r, g, b) } }; }
            }
        }
    }
    await updateLightWithQueue(rid, rtype, payload, entry.loxone_name, forcedTransition);
}

const udpClient = dgram.createSocket('udp4');
function sendToLoxone(baseName, suffix, value, category = 'SYSTEM') {
    if (!config.loxoneIp) return;
    const msg = `hue.${baseName}.${suffix} ${value}`;
    udpClient.send(Buffer.from(msg), config.loxonePort, config.loxoneIp, (err) => { if(err) log.error(`UDP Err: ${err}`, category); else if(config.debug) log.debug(`UDP OUT: ${msg}`, category); });
}
function publishMqtt(baseName, suffix, value, entry) {
    if(!mqttClient || !mqttClient.connected) return;
    const typeMap = { 'light': 'light', 'group': 'group', 'sensor': 'sensor', 'button': 'button' };
    const type = typeMap[entry.hue_type] || 'device';
    const topic = `${config.mqttPrefix}/${type}/${baseName}/${suffix}`;
    mqttClient.publish(topic, String(value), { retain: true });
}

async function buildDeviceMap() {
    if (!isConfigured) return;
    try {
        const [resDev, resLight] = await Promise.all([
            axios.get(`https://${config.bridgeIp}/clip/v2/resource/device`, { headers: { 'hue-application-key': config.appKey }, httpsAgent }),
            axios.get(`https://${config.bridgeIp}/clip/v2/resource/light`, { headers: { 'hue-application-key': config.appKey }, httpsAgent })
        ]);
        serviceToDeviceMap = {}; lightCapabilities = {};
        resDev.data.data.forEach(d => d.services.forEach(s => serviceToDeviceMap[s.rid] = { deviceId: d.id, deviceName: d.metadata.name, serviceType: s.rtype }));
        resLight.data.data.forEach(l => {
            lightCapabilities[l.id] = {
                supportsColor: !!l.color, supportsCt: !!l.color_temperature,
                min: l.color_temperature?.mirek_schema?.mirek_minimum || 153, max: l.color_temperature?.mirek_schema?.mirek_maximum || 500
            };
        });
    } catch (e) { log.error("Map Error: " + e.message, 'SYSTEM'); }
}

function updateStatus(loxName, key, val) {
    if (!statusCache[loxName]) statusCache[loxName] = {};
    const isEvent = (key === 'button' || key === 'rotary');
    if (!isEvent && statusCache[loxName][key] === val) return; 
    statusCache[loxName][key] = val;
    const entry = mapping.find(m => m.loxone_name === loxName);
    if (!entry) return;
    let shouldSend = false; let category = 'SYSTEM';
    if (entry.hue_type === 'sensor') { shouldSend = true; category = 'SENSOR'; }
    else if (entry.hue_type === 'button') { shouldSend = true; category = 'BUTTON'; }
    else if (entry.sync_lox === true) { shouldSend = true; category = 'LIGHT'; } 
    if (shouldSend) sendToLoxone(loxName, key, val, category);
    publishMqtt(loxName, key, val, entry);
}

async function syncInitialStates() {
    if (!isConfigured) return;
    try {
        log.info("Lade initialen Status aller Geräte...", 'SYSTEM');
        const [resLight, resGroup, resMotion, resContact, resTemp, resLux, resBat] = await Promise.all([
            axios.get(`https://${config.bridgeIp}/clip/v2/resource/light`, { headers: { 'hue-application-key': config.appKey }, httpsAgent }),
            axios.get(`https://${config.bridgeIp}/clip/v2/resource/grouped_light`, { headers: { 'hue-application-key': config.appKey }, httpsAgent }),
            axios.get(`https://${config.bridgeIp}/clip/v2/resource/motion`, { headers: { 'hue-application-key': config.appKey }, httpsAgent }),
            axios.get(`https://${config.bridgeIp}/clip/v2/resource/contact`, { headers: { 'hue-application-key': config.appKey }, httpsAgent }),
            axios.get(`https://${config.bridgeIp}/clip/v2/resource/temperature`, { headers: { 'hue-application-key': config.appKey }, httpsAgent }),
            axios.get(`https://${config.bridgeIp}/clip/v2/resource/light_level`, { headers: { 'hue-application-key': config.appKey }, httpsAgent }),
            axios.get(`https://${config.bridgeIp}/clip/v2/resource/device_power`, { headers: { 'hue-application-key': config.appKey }, httpsAgent })
        ]);

        const findMapping = (id) => mapping.find(m => m.hue_uuid === id) || mapping.find(m => {
             const meta = serviceToDeviceMap[id];
             const mapMeta = serviceToDeviceMap[m.hue_uuid];
             return meta && mapMeta && meta.deviceId === mapMeta.deviceId;
        });

        if(resLight.data?.data) resLight.data.data.forEach(d => {
            const entry = findMapping(d.id);
            if (entry) {
                const name = entry.loxone_name;
                if(d.on) updateStatus(name, 'on', d.on.on ? 1 : 0);
                if(d.dimming) updateStatus(name, 'bri', d.dimming.brightness);
                if(d.color_temperature?.mirek) { updateStatus(name, 'mirek', d.color_temperature.mirek); updateStatus(name, 'hex', mirekToHex(d.color_temperature.mirek)); }
                if(d.color?.xy) updateStatus(name, 'hex', xyToHex(d.color.xy.x, d.color.xy.y));
            }
        });
        if(resGroup.data?.data) resGroup.data.data.forEach(d => {
            const entry = findMapping(d.id);
            if (entry) {
                const name = entry.loxone_name;
                if(d.on) updateStatus(name, 'on', d.on.on ? 1 : 0);
                if(d.dimming) updateStatus(name, 'bri', d.dimming.brightness);
            }
        });
        if(resMotion.data?.data) resMotion.data.data.forEach(d => { const entry = findMapping(d.id); if (entry && d.motion) updateStatus(entry.loxone_name, 'motion', d.motion.motion ? 1 : 0); });
        if(resContact.data?.data) resContact.data.data.forEach(d => { const entry = findMapping(d.id); if (entry && d.contact_report) updateStatus(entry.loxone_name, 'contact', d.contact_report.state === 'no_contact' ? 1 : 0); });
        if(resTemp.data?.data) resTemp.data.data.forEach(d => { const entry = findMapping(d.id); if (entry && d.temperature) updateStatus(entry.loxone_name, 'temp', d.temperature.temperature); });
        if(resLux.data?.data) resLux.data.data.forEach(d => { const entry = findMapping(d.id); if (entry && d.light) updateStatus(entry.loxone_name, 'lux', hueLightToLux(d.light.light_level)); });
        if(resBat.data?.data) resBat.data.data.forEach(d => { if(d.owner && d.owner.rid) { const deviceId = d.owner.rid; mapping.forEach(m => { const meta = serviceToDeviceMap[m.hue_uuid]; if(meta && meta.deviceId === deviceId) { updateStatus(m.loxone_name, 'bat', d.power_state.battery_level); } }); } });
        log.info("Initial Sync abgeschlossen.", 'SYSTEM');
    } catch(e) { log.warn("Initial Sync Fehler: " + e.message, 'SYSTEM'); }
}

function processHueEvents(events) {
    events.forEach(evt => {
        if (evt.type === 'update' || evt.type === 'add') {
            evt.data.forEach(d => {
                const entry = mapping.find(m => m.hue_uuid === d.id) || mapping.find(m => {
                    const meta = serviceToDeviceMap[d.id];
                    const mapMeta = serviceToDeviceMap[m.hue_uuid];
                    return meta && mapMeta && meta.deviceId === mapMeta.deviceId;
                });
                let logCat = 'SYSTEM';
                if(entry) {
                    if(entry.hue_type === 'light' || entry.hue_type === 'group') logCat = 'LIGHT';
                    else if(entry.hue_type === 'sensor') logCat = 'SENSOR';
                    else if(entry.hue_type === 'button') logCat = 'BUTTON';
                } else if (d.motion) logCat = 'SENSOR';
                else if (d.button) logCat = 'BUTTON';
                else if (d.on) logCat = 'LIGHT';

                if (entry) {
                    const lox = entry.loxone_name;
                    if (d.motion && d.motion.motion !== undefined) { updateStatus(lox, 'motion', d.motion.motion ? 1 : 0); if(config.debug) log.debug(`Event: ${lox} Motion ${d.motion.motion}`, logCat); }
                    if (d.temperature) updateStatus(lox, 'temp', d.temperature.temperature);
                    if (d.light) updateStatus(lox, 'lux', hueLightToLux(d.light.light_level));
                    if (d.contact_report && d.contact_report.state) { const isOpen = d.contact_report.state === 'no_contact'; updateStatus(lox, 'contact', isOpen ? 1 : 0); if(config.debug) log.debug(`Event: ${lox} Contact=${isOpen ? 'OPEN' : 'CLOSED'}`, logCat); }
                    if (d.on) { updateStatus(lox, 'on', d.on.on ? 1 : 0); if(config.debug) log.debug(`Event: ${lox} On=${d.on.on}`, logCat); }
                    if (d.dimming) updateStatus(lox, 'bri', d.dimming.brightness);
                    if (d.button) { const evt = d.button.last_event; if (evt === 'short_release' || evt === 'long_press') { updateStatus(lox, 'button', evt); log.debug(`Event: ${lox} Btn=${evt}`, logCat); } }
                    if (d.power_state) updateStatus(lox, 'bat', d.power_state.battery_level);
                    if (d.relative_rotary) { let rotaryData = d.relative_rotary.rotary_report || d.relative_rotary.last_event || d.relative_rotary; if (rotaryData && rotaryData.rotation) { const dir = rotaryData.rotation.direction === 'clock_wise' ? 'cw' : 'ccw'; updateStatus(lox, 'rotary', dir); log.debug(`Event: ${lox} Dial=${dir}`, logCat); } }
                    if (d.color && d.color.xy) updateStatus(lox, 'hex', xyToHex(d.color.xy.x, d.color.xy.y));
                    if (d.color_temperature && d.color_temperature.mirek) { updateStatus(lox, 'hex', mirekToHex(d.color_temperature.mirek)); updateStatus(lox, 'mirek', d.color_temperature.mirek); }
                }
            });
        }
    });
}

let eventStreamActive = false; let eventStreamRequest = null; let watchdogInterval = null; let lastEventTimestamp = Date.now();
function startWatchdog() { if (watchdogInterval) clearInterval(watchdogInterval); watchdogInterval = setInterval(() => { if (!eventStreamActive) return; const silenceDuration = Date.now() - lastEventTimestamp; if (silenceDuration > 60000) { log.warn(`EventStream Watchdog: Keine Daten seit ${Math.round(silenceDuration/1000)}s. Erzwinge Neustart...`, 'SYSTEM'); restartEventStream(); } }, 30000); }
function restartEventStream() { if (eventStreamRequest) { try { eventStreamRequest.destroy(); } catch (e) { console.error(e); } } eventStreamActive = false; eventStreamRequest = null; setTimeout(startEventStream, 1000); }
async function startEventStream() {
    if (!isConfigured || eventStreamActive) return;
    eventStreamActive = true; lastEventTimestamp = Date.now(); startWatchdog(); await buildDeviceMap(); await syncInitialStates();
    log.info("Starte EventStream...", 'SYSTEM');
    try {
        const response = await axios({ method: 'get', url: `https://${config.bridgeIp}/eventstream/clip/v2`, headers: { 'hue-application-key': config.appKey, 'Accept': 'text/event-stream' }, httpsAgent, responseType: 'stream', timeout: 0 });
        eventStreamRequest = response.data;
        response.data.on('data', (chunk) => { lastEventTimestamp = Date.now(); const lines = chunk.toString().split('\n'); lines.forEach(line => { if (line.startsWith('data: ')) { try { processHueEvents(JSON.parse(line.substring(6))); } catch (e) {} } }); });
        response.data.on('end', () => { log.warn("EventStream vom Server beendet.", 'SYSTEM'); eventStreamActive = false; setTimeout(startEventStream, 5000); });
        response.data.on('error', (err) => { log.error("EventStream Fehler: " + err.message, 'SYSTEM'); eventStreamActive = false; setTimeout(startEventStream, 5000); });
    } catch (error) { log.error("EventStream Verbindungsfehler: " + error.message, 'SYSTEM'); eventStreamActive = false; setTimeout(startEventStream, 10000); }
}

const app = express(); app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => { if (req.path.startsWith('/api/') || req.path === '/setup.html') return next(); if (!isConfigured) { if (req.path === '/') return res.sendFile(path.join(__dirname, 'public', 'setup.html')); return res.redirect('/'); } next(); });
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/setup/discover', async (req, res) => { try { const r = await axios.get('https://discovery.meethue.com/'); res.json(r.data); } catch (e) { res.status(500).json({}); } });
app.post('/api/setup/register', async (req, res) => { try { const r = await axios.post(`https://${req.body.ip}/api`, { devicetype: "loxHueBridge" }, { httpsAgent }); if(r.data[0].success) { config.bridgeIp = req.body.ip; config.appKey = r.data[0].success.username; return res.json({success:true}); } res.json({success:false, error: r.data[0].error.description}); } catch(e) { res.status(500).json({error:e.message}); } });
app.post('/api/setup/loxone', (req, res) => { 
    config.loxoneIp = req.body.loxoneIp; config.loxonePort = parseInt(req.body.loxonePort); config.debug = !!req.body.debug; 
    if(req.body.transitionTime!==undefined) config.transitionTime=parseInt(req.body.transitionTime); 
    if(req.body.throttleTime!==undefined) { config.throttleTime=parseInt(req.body.throttleTime); REQUEST_QUEUES.light.delayMs = config.throttleTime; }
    if(req.body.mqttEnabled !== undefined) config.mqttEnabled = !!req.body.mqttEnabled;
    if(req.body.mqttBroker !== undefined) config.mqttBroker = req.body.mqttBroker;
    if(req.body.mqttPort !== undefined) config.mqttPort = parseInt(req.body.mqttPort);
    if(req.body.mqttUser !== undefined) config.mqttUser = req.body.mqttUser;
    if(req.body.mqttPass !== undefined) config.mqttPass = req.body.mqttPass;
    if(req.body.mqttPrefix !== undefined) config.mqttPrefix = req.body.mqttPrefix;
    if(req.body.disableLogDisk !== undefined) config.disableLogDisk = !!req.body.disableLogDisk;
    saveConfigToFile(); isConfigured=true; connectToMqtt(); startEventStream(); res.json({success:true}); 
});
app.get('/api/download/outputs', (req, res) => { const filterNames = req.query.names ? req.query.names.split(',') : null; let lights = mapping.filter(m => m.hue_type === 'light' || m.hue_type === 'group'); if (filterNames) lights = lights.filter(m => filterNames.includes(m.loxone_name)); let xml = `<?xml version="1.0" encoding="utf-8"?>\n<VirtualOut Title="LoxHueBridge Lights" Address="http://${getServerIp()}:${HTTP_PORT}" CmdInit="" CloseAfterSend="true" CmdSep=";">\n\t<Info templateType="3" minVersion="16011106"/>\n`; lights.forEach(l => { const t = l.loxone_name.charAt(0).toUpperCase() + l.loxone_name.slice(1) + " (Hue)"; xml += `\t<VirtualOutCmd Title="${t}" Comment="${l.hue_name}" CmdOn="/${l.loxone_name}/<v>" Analog="true"/>\n`; }); xml += `</VirtualOut>`; res.set('Content-Type', 'text/xml'); res.set('Content-Disposition', `attachment; filename="lox_outputs.xml"`); res.send(xml); });
app.get('/api/download/inputs', (req, res) => { const filterNames = req.query.names ? req.query.names.split(',') : null; let sensors = mapping.filter(m => m.hue_type === 'sensor' || m.hue_type === 'button'); if (filterNames) sensors = sensors.filter(m => filterNames.includes(m.loxone_name)); let xml = `<?xml version="1.0" encoding="utf-8"?>\n<VirtualInUdp Title="LoxHueBridge Sensors" Port="${config.loxonePort}">\n\t<Info templateType="1" minVersion="16011106"/>\n`; sensors.forEach(s => { const n = s.loxone_name; const t = n.charAt(0).toUpperCase() + n.slice(1); if (s.hue_type === 'sensor') { xml += `\t<VirtualInUdpCmd Title="${t} Motion" Check="hue.${n}.motion \\v" Analog="true" DefVal="0" MinVal="0" MaxVal="1" Unit="&lt;v&gt;"/>\n`; xml += `\t<VirtualInUdpCmd Title="${t} Contact" Check="hue.${n}.contact \\v" Analog="true" DefVal="0" MinVal="0" MaxVal="1" Unit="&lt;v&gt;"/>\n`; xml += `\t<VirtualInUdpCmd Title="${t} Lux" Check="hue.${n}.lux \\v" Analog="true" DefVal="0" MinVal="0" MaxVal="65000" Unit="&lt;v&gt; lx"/>\n`; xml += `\t<VirtualInUdpCmd Title="${t} Temp" Check="hue.${n}.temp \\v" Analog="true" DefVal="0" MinVal="-50" MaxVal="100" Unit="&lt;v.1&gt; °C"/>\n`; xml += `\t<VirtualInUdpCmd Title="${t} Battery" Check="hue.${n}.bat \\v" Analog="true" DefVal="0" MinVal="0" MaxVal="100" Unit="&lt;v&gt; %"/>\n`; } else { xml += `\t<VirtualInUdpCmd Title="${t} Event" Check="hue.${n}.button \\v" Analog="false"/>\n`; if(s.hue_name.includes("Dreh") || s.hue_name.includes("Rotary") || s.hue_name.includes("Dial")) { xml += `\t<VirtualInUdpCmd Title="${t} Rotary CW" Check="hue.${n}.rotary cw" Analog="false"/>\n`; xml += `\t<VirtualInUdpCmd Title="${t} Rotary CCW" Check="hue.${n}.rotary ccw" Analog="false"/>\n`; } } }); xml += `</VirtualInUdp>`; res.set('Content-Type', 'text/xml'); res.set('Content-Disposition', `attachment; filename="lox_inputs.xml"`); res.send(xml); });
app.get('/api/targets', async (req, res) => { if(!isConfigured) return res.status(503).json([]); try { await buildDeviceMap(); const [l, r, z, d] = await Promise.all([ axios.get(`https://${config.bridgeIp}/clip/v2/resource/light`, { headers: { 'hue-application-key': config.appKey }, httpsAgent }), axios.get(`https://${config.bridgeIp}/clip/v2/resource/room`, { headers: { 'hue-application-key': config.appKey }, httpsAgent }), axios.get(`https://${config.bridgeIp}/clip/v2/resource/zone`, { headers: { 'hue-application-key': config.appKey }, httpsAgent }), axios.get(`https://${config.bridgeIp}/clip/v2/resource/device`, { headers: { 'hue-application-key': config.appKey }, httpsAgent }) ]); let t = []; if(l.data?.data) l.data.data.forEach(x => { t.push({ uuid:x.id, name:x.metadata.name, type:'light', capabilities: lightCapabilities[x.id] || null }); }); [...(r.data?.data||[]), ...(z.data?.data||[])].forEach(x => { const s = x.services.find(y => y.rtype === 'grouped_light'); if(s) t.push({uuid:s.rid, name:x.metadata.name, type:'group'}); }); if(d.data?.data) d.data.data.forEach(x => { const m = x.services.find(y => y.rtype === 'motion'); if(m) t.push({uuid:m.rid, name:x.metadata.name, type:'sensor'}); const c = x.services.find(y => y.rtype === 'contact'); if(c) t.push({uuid:c.rid, name:x.metadata.name, type:'sensor'}); const buttons = x.services.filter(y => y.rtype === 'button'); buttons.forEach((b, idx) => { let suffix = buttons.length > 1 ? ` (Taste ${idx + 1})` : ''; t.push({uuid: b.rid, name: `${x.metadata.name}${suffix}`, type:'button'}); }); const rot = x.services.find(y => y.rtype === 'relative_rotary'); if(rot) { t.push({uuid: rot.rid, name: `${x.metadata.name} (Drehring)`, type:'button'}); } }); t.sort((a,b) => a.name.localeCompare(b.name)); res.json(t); } catch(e) { res.status(500).json([]); } });
app.post('/api/mapping', (req, res) => { mapping = req.body.filter(m => m.loxone_name); fs.writeFileSync(MAPPING_FILE, JSON.stringify(mapping, null, 4)); mapping.forEach(m => { const mapMeta = serviceToDeviceMap[m.hue_uuid]; detectedItems = detectedItems.filter(d => { if(d.type === 'command') return d.name !== m.loxone_name; const detMeta = serviceToDeviceMap[d.id]; if(mapMeta && detMeta && mapMeta.deviceId === detMeta.deviceId) return false; return d.id !== m.hue_uuid; }); }); res.json({success:true}); });
app.get('/api/mapping', (req, res) => res.json(mapping));
app.get('/api/detected', (req, res) => res.json([...detectedItems].reverse()));
app.get('/api/status', (req, res) => res.json(statusCache));

app.get('/api/logs', (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    const category = req.query.category;
    const search = req.query.search ? req.query.search.toLowerCase() : null;

    if (config.disableLogDisk) {
        let filtered = ramLogs.slice().reverse();
        if (category && category !== 'ALL') filtered = filtered.filter(l => l.category === category);
        if (search) filtered = filtered.filter(l => l.msg.toLowerCase().includes(search));
        const result = filtered.slice(0, limit).map(r => ({ ...r, time: new Date(r.timestamp).toLocaleTimeString('de-DE') + '.' + String(r.timestamp % 1000).padStart(3, '0') }));
        res.json(result);
    } else {
        let sql = "SELECT * FROM logs WHERE 1=1";
        let params = [];
        if (category && category !== 'ALL') { sql += " AND category = ?"; params.push(category); }
        if (search) { sql += " AND msg LIKE ?"; params.push(`%${search}%`); }
        sql += " ORDER BY id DESC LIMIT ?"; params.push(limit);
        try {
            const query = db.prepare(sql);
            const rows = query.all(...params);
            const formatted = rows.map(r => ({ ...r, time: new Date(r.timestamp).toLocaleTimeString('de-DE') + '.' + String(r.timestamp % 1000).padStart(3, '0') }));
            res.json(formatted);
        } catch(e) { res.status(500).json({error: e.message}); }
    }
});

app.get('/api/settings', (req, res) => res.json({ 
    bridge_ip: config.bridgeIp, loxone_ip: config.loxoneIp, loxone_port: config.loxonePort, http_port: HTTP_PORT, 
    debug: config.debug, key_configured: isConfigured, transitionTime: config.transitionTime, throttleTime: config.throttleTime,
    mqttEnabled: config.mqttEnabled, mqttBroker: config.mqttBroker, mqttPort: config.mqttPort, mqttUser: config.mqttUser, mqttPrefix: config.mqttPrefix,
    mqttConnected: mqttClient && mqttClient.connected, version: pjson.version,
    disableLogDisk: config.disableLogDisk
}));
app.post('/api/settings/debug', (req, res) => { config.debug = !!req.body.active; saveConfigToFile(); res.json({success:true}); });
app.post('/api/system/restart', (req, res) => { res.json({success: true}); log.warn("Neustart...", "SYSTEM"); setTimeout(() => process.exit(0), 500); });

app.get('/api/system/logdownload', (req, res) => { 
    try { 
        let text = "";
        if (config.disableLogDisk || !db || !insertLogStmt) {
             text = ramLogs.slice().reverse().map(l => `[${new Date(l.timestamp).toLocaleString('de-DE')}] [${l.category}] [${l.level}] ${l.msg}`).join('\n');
        } else {
             const query = db.prepare("SELECT * FROM logs ORDER BY id DESC LIMIT 10000"); 
             const rows = query.all(); 
             text = rows.reverse().map(l => `[${new Date(l.timestamp).toLocaleString('de-DE')}] [${l.category}] [${l.level}] ${l.msg}`).join('\n'); 
        }
        res.set('Content-Type', 'text/plain'); 
        res.set('Content-Disposition', 'attachment; filename="loxhuebridge.log"'); 
        res.send(text); 
    } catch(e) { res.status(500).send("Fehler: " + e.message); } 
});

app.get('/api/system/backup', (req, res) => { try { const backup = { config: config, mapping: mapping, version: pjson.version, date: new Date().toISOString() }; res.json(backup); } catch(e) { res.status(500).json({error: e.message}); } });
app.post('/api/system/restore', (req, res) => { try { const backup = req.body; if (!backup.config || !backup.mapping || !Array.isArray(backup.mapping)) return res.status(400).json({success: false, error: "Ungültig."}); config = { ...config, ...backup.config }; mapping = backup.mapping; saveConfigToFile(); fs.writeFileSync(MAPPING_FILE, JSON.stringify(mapping, null, 4)); log.success("Restore OK!", "SYSTEM"); res.json({success: true}); setTimeout(() => process.exit(0), 1000); } catch(e) { log.error("Restore Err: " + e.message, "SYSTEM"); res.status(500).json({success: false, error: e.message}); } });

app.get('/:name/:value', async (req, res) => { const { name, value } = req.params; log.debug(`IN: /${name}/${value}`, 'LIGHT'); if(!isConfigured) return res.status(503).send("Not Configured"); const search = name.toLowerCase(); const entry = mapping.find(m => m.loxone_name === search); const isGlobalAll = (search === 'all' || search === 'alles'); const isMappedAll = (entry && entry.hue_uuid === 'pseudo-all'); if (isGlobalAll || isMappedAll) { const targets = mapping.filter(e => e.hue_type === 'light' || e.hue_type === 'group'); res.status(200).send(`Seq for ${targets.length}`); (async () => { log.info(`Starte Sequenz für ${targets.length}...`, 'LIGHT'); const delay = 100; for (const target of targets) { executeCommand(target, value, 0); await new Promise(resolve => setTimeout(resolve, delay)); } })(); return; } if (!entry) { if(!detectedItems.find(d=>d.name===search)) { detectedItems.push({type:'command', name:name, id:'cmd_'+name}); if(detectedItems.length>10) detectedItems.shift(); } return res.status(200).send('Recorded'); } if (entry.hue_type === 'sensor' || entry.hue_type === 'button') return res.status(400).send("Read-only"); await executeCommand(entry, value); res.status(200).send('OK'); });

app.listen(HTTP_PORT, () => { console.log(`🚀 loxHueBridge Live auf ${HTTP_PORT}`); if (isConfigured) startEventStream(); });