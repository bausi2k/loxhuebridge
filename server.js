const express = require('express');
const axios = require('axios');
const fs = require('fs');
const https = require('https');
const path = require('path');
const dgram = require('dgram');
const os = require('os');

// --- VERSION SAFETY CHECK ---
let pjson = { version: "unknown" };
try {
    const pJsonPath = path.join(__dirname, 'package.json');
    if (fs.existsSync(pJsonPath)) {
        pjson = JSON.parse(fs.readFileSync(pJsonPath, 'utf8'));
    }
} catch (e) {
    console.warn("⚠️ Konnte package.json nicht laden:", e.message);
}

// --- PFADE ---
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const MAPPING_FILE = path.join(DATA_DIR, 'mapping.json');

if (!fs.existsSync(DATA_DIR)) {
    try { fs.mkdirSync(DATA_DIR); } catch (e) { console.error(e); }
}

const HTTP_PORT = parseInt(process.env.HTTP_PORT || "8555");
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

let config = {
    bridgeIp: process.env.HUE_BRIDGE_IP || null,
    appKey: process.env.HUE_APP_KEY || null,
    loxoneIp: process.env.LOXONE_IP || null,
    loxonePort: parseInt(process.env.LOXONE_UDP_PORT || "7000"),
    debug: process.env.DEBUG === 'true',
    transitionTime: 400
};

let isConfigured = false;
const logBuffer = []; const MAX_LOGS = 100;

// --- LOGGING ---
const getTime = () => {
    const now = new Date();
    return now.toLocaleTimeString('de-DE', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0');
};

function addToLogBuffer(level, msg, category = 'SYSTEM') {
    logBuffer.unshift({ time: getTime(), level: level, msg: msg, cat: category });
    if (logBuffer.length > MAX_LOGS) logBuffer.pop();
}

const log = {
    info: (m, cat='SYSTEM') => { console.log(`ℹ️  [${getTime()}] [${cat}] ${m}`); addToLogBuffer('INFO', m, cat); },
    success: (m, cat='SYSTEM') => { console.log(`✅  [${getTime()}] [${cat}] ${m}`); addToLogBuffer('SUCCESS', m, cat); },
    warn: (m, cat='SYSTEM') => { console.log(`⚠️  [${getTime()}] [${cat}] ${m}`); addToLogBuffer('WARN', m, cat); },
    error: (m, cat='SYSTEM') => { console.error(`❌ [${getTime()}] [${cat}] ${m}`); addToLogBuffer('ERROR', m, cat); },
    debug: (m, cat='SYSTEM') => { if(config.debug){ console.log(`🐛 [${getTime()}] [${cat}] ${m}`); addToLogBuffer('DEBUG', m, cat); }},
    hueError: (e, cat='SYSTEM') => {
        const s = e.response ? e.response.status : 'Net';
        if (s === 429) {
            console.warn(`⚠️ [${getTime()}] RATE LIMIT (429) - Slowing down...`);
            addToLogBuffer('WARN', `HUE RATE LIMIT (429)`, cat);
            return;
        }
        const d = e.response ? JSON.stringify(e.response.data) : e.message;
        console.error(`❌ [${getTime()}] HUE ERR ${s}: ${d}`);
        addToLogBuffer('ERROR', `HUE ERR ${s}: ${d}`, cat);
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
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const d = JSON.parse(fs.readFileSync(CONFIG_FILE));
            config = { ...config, ...d };
            if (config.transitionTime === undefined) config.transitionTime = 400;
            if (config.bridgeIp && config.appKey) { isConfigured=true; return; }
        }
    } catch (e) {}
    if (config.bridgeIp && config.appKey) isConfigured=true;
    else log.warn("Setup erforderlich.", 'SYSTEM');
}
loadConfig();

function saveConfigToFile() {
    try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 4)); } catch(e){}
}

let mapping = []; let detectedItems = []; let serviceToDeviceMap = {}; let statusCache = {};
let lightCapabilities = {};

function loadMapping() {
    try {
        if (fs.existsSync(MAPPING_FILE)) mapping = JSON.parse(fs.readFileSync(MAPPING_FILE)).filter(m=>m.loxone_name);
    } catch (e) { mapping = []; }
}
loadMapping();

// --- HELFER ---
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

// --- GLOBAL RATE LIMITER QUEUE ---
// Verhindert "Too Many Requests" (429) Fehler.
const REQUEST_QUEUES = {
    light: { items: [], isProcessing: false, delayMs: 120 }, // ~8 Requests/sek
    grouped_light: { items: [], isProcessing: false, delayMs: 1100 } // ~0.9 Requests/sek
};

async function processQueue(type) {
    const q = REQUEST_QUEUES[type];
    if (q.isProcessing || q.items.length === 0) return;
    q.isProcessing = true;
    const task = q.items.shift();
    try { await task(); } catch (e) { log.error(`Queue Error (${type}): ${e.message}`, 'SYSTEM'); }
    setTimeout(() => {
        q.isProcessing = false;
        if (q.items.length > 0) processQueue(type);
    }, q.delayMs);
}

function enqueueRequest(type, taskFn) {
    const queueType = REQUEST_QUEUES[type] ? type : 'light';
    REQUEST_QUEUES[queueType].items.push(taskFn);
    processQueue(queueType);
}

// --- QUEUE LOGIC ---
const commandState = {}; 

async function updateLightWithQueue(uuid, type, payload, loxName, forcedDuration = null) {
    if (!commandState[uuid]) commandState[uuid] = { busy: false, next: null };

    let duration = config.transitionTime !== undefined ? config.transitionTime : 400;
    const isDigitalSwitch = Object.keys(payload).length === 1 && payload.on !== undefined;
    if (isDigitalSwitch && payload.on.on === true) duration = 0; 
    if (forcedDuration !== null) duration = forcedDuration;
    if (duration > 0) payload.dynamics = { duration: duration };

    if (commandState[uuid].busy) {
        commandState[uuid].next = payload;
        return;
    }
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
        } catch (e) {
            log.hueError(e, 'LIGHT');
        } finally {
            if (commandState[uuid].next) {
                const nextPayload = commandState[uuid].next;
                commandState[uuid].next = null; 
                await sendToHueRecursive(uuid, type, nextPayload, loxName);
            } else {
                commandState[uuid].busy = false;
            }
        }
    });
}

// --- EXECUTE COMMAND ---
async function executeCommand(entry, value, forcedTransition = null) {
    const rid = entry.hue_uuid;
    const rtype = entry.hue_type === 'group' ? 'grouped_light' : 'light';
    let payload = {}; 
    let n = parseInt(value); 
    if(isNaN(n)) n=0;

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
                } else {
                    payload = { on: { on: true }, dimming: { brightness: max }, color: { xy: rgbToXy(r, g, b) } };
                }
            }
        }
    }
    
    await updateLightWithQueue(rid, rtype, payload, entry.loxone_name, forcedTransition);
}


// --- UDP SEND ---
const udpClient = dgram.createSocket('udp4');
function sendToLoxone(baseName, suffix, value, category = 'SYSTEM') {
    if (!config.loxoneIp) return;
    const msg = `hue.${baseName}.${suffix} ${value}`;
    udpClient.send(Buffer.from(msg), config.loxonePort, config.loxoneIp, (err) => { 
        if(err) log.error(`UDP Err: ${err}`, category);
        else if(config.debug) log.debug(`UDP OUT: ${msg}`, category);
    });
}

// --- LOGIK ---
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
                min: l.color_temperature?.mirek_schema?.mirek_minimum || 153,
                max: l.color_temperature?.mirek_schema?.mirek_maximum || 500
            };
        });
    } catch (e) { log.error("Map Error: " + e.message, 'SYSTEM'); }
}

// --- FIX V1.7.2: STATUS UPDATE DEDUPLICATION ---
function updateStatus(loxName, key, val) {
    if (!statusCache[loxName]) statusCache[loxName] = {};
    
    // WICHTIG: Events (Buttons/Rotary) nie cachen!
    const isEvent = (key === 'button' || key === 'rotary');
    
    if (!isEvent && statusCache[loxName][key] === val) return; 
    
    statusCache[loxName][key] = val;

    const entry = mapping.find(m => m.loxone_name === loxName);
    if (!entry) return;

    let shouldSend = false;
    let category = 'SYSTEM';

    if (entry.hue_type === 'sensor') { shouldSend = true; category = 'SENSOR'; }
    else if (entry.hue_type === 'button') { shouldSend = true; category = 'BUTTON'; }
    else if (entry.sync_lox === true) { shouldSend = true; category = 'LIGHT'; } 

    if (shouldSend) {
        sendToLoxone(loxName, key, val, category);
    }
}

async function syncInitialStates() {
    if (!isConfigured) return;
    try {
        const res = await axios.get(`https://${config.bridgeIp}/clip/v2/resource/light`, { headers: { 'hue-application-key': config.appKey }, httpsAgent });
        res.data.data.forEach(l => {
            const entry = mapping.find(m => m.hue_uuid === l.id) || mapping.find(m => {
                const meta = serviceToDeviceMap[l.id];
                const mapMeta = serviceToDeviceMap[m.hue_uuid];
                return meta && mapMeta && meta.deviceId === mapMeta.deviceId;
            });
            if (entry) {
                const name = entry.loxone_name;
                if(l.on) updateStatus(name, 'on', l.on.on ? 1 : 0);
                if(l.dimming) updateStatus(name, 'bri', l.dimming.brightness);
                if(l.color && l.color.xy) updateStatus(name, 'hex', xyToHex(l.color.xy.x, l.color.xy.y, 1.0));
                else if (l.color_temperature && l.color_temperature.mirek) updateStatus(name, 'hex', mirekToHex(l.color_temperature.mirek));
            }
        });
        log.info("Initialer Status geladen.", 'SYSTEM');
    } catch(e) { log.warn("Sync fehlgeschlagen.", 'SYSTEM'); }
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
                    if (d.on) { updateStatus(lox, 'on', d.on.on ? 1 : 0); if(config.debug) log.debug(`Event: ${lox} On=${d.on.on}`, logCat); }
                    if (d.dimming) updateStatus(lox, 'bri', d.dimming.brightness);
                    
                    // BUTTON FILTER
                    if (d.button) { 
                        const evt = d.button.last_event;
                        if (evt === 'short_release' || evt === 'long_press') {
                            updateStatus(lox, 'button', evt); 
                            log.debug(`Event: ${lox} Btn=${evt}`, logCat); 
                        } else if(config.debug) log.debug(`Ignored Event: ${lox} (${evt})`, logCat);
                    }

                    if (d.power_state) updateStatus(lox, 'bat', d.power_state.battery_level);
                    
                    // ROTARY LOGIC (CW/CCW)
                    if (d.relative_rotary) {
                        let rotaryData = d.relative_rotary.rotary_report || d.relative_rotary.last_event || d.relative_rotary;
                        if (rotaryData && rotaryData.rotation) {
                            const dir = rotaryData.rotation.direction === 'clock_wise' ? 'cw' : 'ccw';
                            // Verwende sendToLoxone direkt oder updateStatus (jetzt da Fix drin ist, geht auch updateStatus)
                            sendToLoxone(lox, 'rotary', dir, logCat);
                            log.debug(`Event: ${lox} Dial=${dir}`, logCat);
                        }
                    }

                    if (d.color && d.color.xy) updateStatus(lox, 'hex', xyToHex(d.color.xy.x, d.color.xy.y));
                    if (d.color_temperature && d.color_temperature.mirek) updateStatus(lox, 'hex', mirekToHex(d.color_temperature.mirek));
                }
            });
        }
    });
}

let eventStreamActive = false;
async function startEventStream() {
    if (!isConfigured || eventStreamActive) return;
    eventStreamActive = true;
    await buildDeviceMap();
    await syncInitialStates();
    log.info("Starte EventStream...", 'SYSTEM');
    try {
        const response = await axios({ method: 'get', url: `https://${config.bridgeIp}/eventstream/clip/v2`, headers: { 'hue-application-key': config.appKey, 'Accept': 'text/event-stream' }, httpsAgent, responseType: 'stream' });
        response.data.on('data', (chunk) => {
            const lines = chunk.toString().split('\n');
            lines.forEach(line => {
                if (line.startsWith('data: ')) { try { processHueEvents(JSON.parse(line.substring(6))); } catch (e) {} }
            });
        });
        response.data.on('end', () => { eventStreamActive = false; setTimeout(startEventStream, 5000); });
    } catch (error) { eventStreamActive = false; setTimeout(startEventStream, 10000); }
}

const app = express();
app.use(express.json());
app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/setup.html') return next();
    if (!isConfigured) {
        if (req.path === '/') return res.sendFile(path.join(__dirname, 'public', 'setup.html'));
        return res.redirect('/');
    }
    next();
});
app.use(express.static(path.join(__dirname, 'public')));

// APIS
app.get('/api/setup/discover', async (req, res) => { try { const r = await axios.get('https://discovery.meethue.com/'); res.json(r.data); } catch (e) { res.status(500).json({}); } });
app.post('/api/setup/register', async (req, res) => { try { const r = await axios.post(`https://${req.body.ip}/api`, { devicetype: "loxHueBridge" }, { httpsAgent }); if(r.data[0].success) { config.bridgeIp = req.body.ip; config.appKey = r.data[0].success.username; return res.json({success:true}); } res.json({success:false, error: r.data[0].error.description}); } catch(e) { res.status(500).json({error:e.message}); } });
app.post('/api/setup/loxone', (req, res) => { config.loxoneIp = req.body.loxoneIp; config.loxonePort = parseInt(req.body.loxonePort); config.debug = !!req.body.debug; if(req.body.transitionTime!==undefined) config.transitionTime=parseInt(req.body.transitionTime); saveConfigToFile(); isConfigured=true; startEventStream(); res.json({success:true}); });
app.get('/api/download/outputs', (req, res) => { const filterNames = req.query.names ? req.query.names.split(',') : null; let lights = mapping.filter(m => m.hue_type === 'light' || m.hue_type === 'group'); if (filterNames) lights = lights.filter(m => filterNames.includes(m.loxone_name)); let xml = `<?xml version="1.0" encoding="utf-8"?>\n<VirtualOut Title="LoxHueBridge Lights" Address="http://${getServerIp()}:${HTTP_PORT}" CmdInit="" CloseAfterSend="true" CmdSep=";">\n\t<Info templateType="3" minVersion="16011106"/>\n`; lights.forEach(l => { const t = l.loxone_name.charAt(0).toUpperCase() + l.loxone_name.slice(1) + " (Hue)"; xml += `\t<VirtualOutCmd Title="${t}" Comment="${l.hue_name}" CmdOn="/${l.loxone_name}/<v>" Analog="true"/>\n`; }); xml += `</VirtualOut>`; res.set('Content-Type', 'text/xml'); res.set('Content-Disposition', `attachment; filename="lox_outputs.xml"`); res.send(xml); });

// XML INPUT GENERATOR
app.get('/api/download/inputs', (req, res) => { 
    const filterNames = req.query.names ? req.query.names.split(',') : null; 
    let sensors = mapping.filter(m => m.hue_type === 'sensor' || m.hue_type === 'button'); 
    if (filterNames) sensors = sensors.filter(m => filterNames.includes(m.loxone_name)); 
    
    let xml = `<?xml version="1.0" encoding="utf-8"?>\n<VirtualInUdp Title="LoxHueBridge Sensors" Port="${config.loxonePort}">\n\t<Info templateType="1" minVersion="16011106"/>\n`; 
    sensors.forEach(s => { 
        const n = s.loxone_name; const t = n.charAt(0).toUpperCase() + n.slice(1); 
        if (s.hue_type === 'sensor') { 
            xml += `\t<VirtualInUdpCmd Title="${t} Motion" Check="hue.${n}.motion \\v" Analog="true" DefVal="0" MinVal="0" MaxVal="1" Unit="&lt;v&gt;"/>\n`; 
            xml += `\t<VirtualInUdpCmd Title="${t} Lux" Check="hue.${n}.lux \\v" Analog="true" DefVal="0" MinVal="0" MaxVal="65000" Unit="&lt;v&gt; lx"/>\n`; 
            xml += `\t<VirtualInUdpCmd Title="${t} Temp" Check="hue.${n}.temp \\v" Analog="true" DefVal="0" MinVal="-50" MaxVal="100" Unit="&lt;v.1&gt; °C"/>\n`; 
            xml += `\t<VirtualInUdpCmd Title="${t} Battery" Check="hue.${n}.bat \\v" Analog="true" DefVal="0" MinVal="0" MaxVal="100" Unit="&lt;v&gt; %"/>\n`; 
        } else { 
            // Buttons
            xml += `\t<VirtualInUdpCmd Title="${t} Event" Check="hue.${n}.button \\v" Analog="false"/>\n`; 
            // Rotary (automatisch CW/CCW anlegen)
            if(s.hue_name.includes("Dreh") || s.hue_name.includes("Rotary") || s.hue_name.includes("Dial")) {
                xml += `\t<VirtualInUdpCmd Title="${t} Rotary CW" Check="hue.${n}.rotary cw" Analog="false"/>\n`; 
                xml += `\t<VirtualInUdpCmd Title="${t} Rotary CCW" Check="hue.${n}.rotary ccw" Analog="false"/>\n`; 
            }
        } 
    }); 
    xml += `</VirtualInUdp>`; 
    res.set('Content-Type', 'text/xml'); 
    res.set('Content-Disposition', `attachment; filename="lox_inputs.xml"`); 
    res.send(xml); 
});

app.get('/api/targets', async (req, res) => { if(!isConfigured) return res.status(503).json([]); try { await buildDeviceMap(); const [l, r, z, d] = await Promise.all([ axios.get(`https://${config.bridgeIp}/clip/v2/resource/light`, { headers: { 'hue-application-key': config.appKey }, httpsAgent }), axios.get(`https://${config.bridgeIp}/clip/v2/resource/room`, { headers: { 'hue-application-key': config.appKey }, httpsAgent }), axios.get(`https://${config.bridgeIp}/clip/v2/resource/zone`, { headers: { 'hue-application-key': config.appKey }, httpsAgent }), axios.get(`https://${config.bridgeIp}/clip/v2/resource/device`, { headers: { 'hue-application-key': config.appKey }, httpsAgent }) ]); let t = []; if(l.data?.data) l.data.data.forEach(x => { t.push({ uuid:x.id, name:x.metadata.name, type:'light', capabilities: lightCapabilities[x.id] || null }); }); [...(r.data?.data||[]), ...(z.data?.data||[])].forEach(x => { const s = x.services.find(y => y.rtype === 'grouped_light'); if(s) t.push({uuid:s.rid, name:x.metadata.name, type:'group'}); }); if(d.data?.data) d.data.data.forEach(x => { const m = x.services.find(y => y.rtype === 'motion'); if(m) t.push({uuid:m.rid, name:x.metadata.name, type:'sensor'}); const buttons = x.services.filter(y => y.rtype === 'button'); buttons.forEach((b, idx) => { let suffix = buttons.length > 1 ? ` (Taste ${idx + 1})` : ''; t.push({uuid: b.rid, name: `${x.metadata.name}${suffix}`, type:'button'}); }); const rot = x.services.find(y => y.rtype === 'relative_rotary'); if(rot) { t.push({uuid: rot.rid, name: `${x.metadata.name} (Drehring)`, type:'button'}); } }); t.sort((a,b) => a.name.localeCompare(b.name)); res.json(t); } catch(e) { res.status(500).json([]); } });
app.post('/api/mapping', (req, res) => { mapping = req.body.filter(m => m.loxone_name); fs.writeFileSync(MAPPING_FILE, JSON.stringify(mapping, null, 4)); mapping.forEach(m => { const mapMeta = serviceToDeviceMap[m.hue_uuid]; detectedItems = detectedItems.filter(d => { if(d.type === 'command') return d.name !== m.loxone_name; const detMeta = serviceToDeviceMap[d.id]; if(mapMeta && detMeta && mapMeta.deviceId === detMeta.deviceId) return false; return d.id !== m.hue_uuid; }); }); res.json({success:true}); });
app.get('/api/mapping', (req, res) => res.json(mapping));
app.get('/api/detected', (req, res) => res.json([...detectedItems].reverse()));
app.get('/api/status', (req, res) => res.json(statusCache));
app.get('/api/logs', (req, res) => res.json(logBuffer));
app.get('/api/settings', (req, res) => res.json({ bridge_ip: config.bridgeIp, loxone_ip: config.loxoneIp, loxone_port: config.loxonePort, http_port: HTTP_PORT, debug: config.debug, key_configured: isConfigured, transitionTime: config.transitionTime, version: pjson.version }));
app.post('/api/settings/debug', (req, res) => { config.debug = !!req.body.active; saveConfigToFile(); res.json({success:true}); });
app.get('/api/diagnostics', async (req, res) => { if(!isConfigured) return res.status(503).json({ error: "Not configured" }); try { const [resZigbee, resDev, resPower] = await Promise.all([ axios.get(`https://${config.bridgeIp}/clip/v2/resource/zigbee_connectivity`, { headers: { 'hue-application-key': config.appKey }, httpsAgent }), axios.get(`https://${config.bridgeIp}/clip/v2/resource/device`, { headers: { 'hue-application-key': config.appKey }, httpsAgent }), axios.get(`https://${config.bridgeIp}/clip/v2/resource/device_power`, { headers: { 'hue-application-key': config.appKey }, httpsAgent }) ]); const devMap = {}; resDev.data.data.forEach(d => devMap[d.id] = d); const powerMap = {}; if(resPower.data?.data) { resPower.data.data.forEach(p => { if(p.owner && p.owner.rid) powerMap[p.owner.rid] = p.power_state; }); } const result = []; if(resDev.data?.data) { resDev.data.data.forEach(device => { const deviceId = device.id; const zigbee = resZigbee.data.data.find(z => z.owner.rid === deviceId); const power = powerMap[deviceId]; let type = 'Sonstiges'; if (device.services.some(s => s.rtype === 'light')) type = 'Licht'; else if (device.services.some(s => s.rtype === 'motion')) type = 'Sensor'; else if (device.services.some(s => s.rtype === 'button' || s.rtype === 'relative_rotary')) type = 'Taster'; else if (device.product_data.product_name.toLowerCase().includes('bridge')) type = 'Bridge'; if (!zigbee && !power && type !== 'Bridge') return; result.push({ name: device.metadata.name, model: device.product_data.product_name, type: type, status: zigbee ? zigbee.status : (type === 'Bridge' ? 'connected' : 'unknown'), mac: zigbee ? zigbee.mac_address : '-', battery: power ? power.battery_level : null, last_seen: zigbee ? zigbee.last_seen : null }); }); } result.sort((a,b) => { const aCrit = (a.status === 'connectivity_issue' || a.status === 'disconnected') || (a.battery !== null && a.battery <= 20); const bCrit = (b.status === 'connectivity_issue' || b.status === 'disconnected') || (b.battery !== null && b.battery <= 20); if (aCrit && !bCrit) return -1; if (!aCrit && bCrit) return 1; if (a.type !== b.type) return a.type.localeCompare(b.type); return a.name.localeCompare(b.name); }); res.json(result); } catch (e) { log.error("Diag Error: " + e.message, 'SYSTEM'); res.status(500).json({ error: e.message }); } });
app.get('/:name/:value', async (req, res) => { const { name, value } = req.params; log.debug(`IN: /${name}/${value}`, 'LIGHT'); if(!isConfigured) return res.status(503).send("Not Configured"); const search = name.toLowerCase(); const entry = mapping.find(m => m.loxone_name === search); const isGlobalAll = (search === 'all' || search === 'alles'); const isMappedAll = (entry && entry.hue_uuid === 'pseudo-all'); if (isGlobalAll || isMappedAll) { const targets = mapping.filter(e => e.hue_type === 'light' || e.hue_type === 'group'); res.status(200).send(`Starting sequence for ${targets.length} devices`); (async () => { log.info(`Starte Sequenz für ${targets.length} Geräte...`, 'LIGHT'); const delay = 100; for (const target of targets) { executeCommand(target, value, 0); await new Promise(resolve => setTimeout(resolve, delay)); } })(); return; } if (!entry) { if(!detectedItems.find(d=>d.name===search)) { detectedItems.push({type:'command', name:name, id:'cmd_'+name}); if(detectedItems.length>10) detectedItems.shift(); } return res.status(200).send('Recorded'); } if (entry.hue_type === 'sensor' || entry.hue_type === 'button') return res.status(400).send("Read-only"); await executeCommand(entry, value); res.status(200).send('OK'); });

app.listen(HTTP_PORT, () => { console.log(`🚀 loxHueBridge Live auf ${HTTP_PORT}`); if (isConfigured) startEventStream(); });