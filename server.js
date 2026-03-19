require('dotenv').config();
const express = require('express');
const { auth } = require('express-openid-connect');
const morgan = require('morgan');
const uhppoted = require('uhppoted');
const path = require('path');
const Database = require('better-sqlite3');
const http = require('http');
const { Server } = require('socket.io');

// --- DATABASE SETUP ---
const db = new Database('/opt/door-controller/door-control.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS controllers (deviceId INTEGER PRIMARY KEY, address TEXT, name TEXT, doorCount INTEGER DEFAULT 4, forceBroadcast INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT, deviceId INTEGER, cardNumber INTEGER, door INTEGER, granted INTEGER, eventType TEXT, reason TEXT);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_events_dedup ON events (timestamp, deviceId, cardNumber, door, eventType);
  CREATE TABLE IF NOT EXISTS door_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE);
  CREATE TABLE IF NOT EXISTS door_group_members (groupId INTEGER, deviceId INTEGER, door INTEGER, PRIMARY KEY(groupId, deviceId, door));
  CREATE TABLE IF NOT EXISTS card_group_assignments (cardNumber INTEGER, groupId INTEGER, pin INTEGER, validFrom TEXT, validTo TEXT, PRIMARY KEY(cardNumber, groupId));
  CREATE TABLE IF NOT EXISTS logout_tokens (sid TEXT PRIMARY KEY, expiresAt INTEGER);
`);

const logoutStore = {
  get: (sid, cb) => {
    try {
      const row = db.prepare('SELECT sid FROM logout_tokens WHERE sid = ? AND expiresAt > ?').get(sid, Date.now());
      cb(null, row ? { sid: row.sid } : null);
    } catch (err) { cb(err); }
  },
  set: (sid, val, cb) => {
    try {
      const expiresAt = Date.now() + (24 * 60 * 60 * 1000);
      db.prepare('INSERT OR REPLACE INTO logout_tokens (sid, expiresAt) VALUES (?, ?)').run(sid, expiresAt);
      cb(null);
    } catch (err) { cb(err); }
  },
  destroy: (sid, cb) => {
    try {
      db.prepare('DELETE FROM logout_tokens WHERE sid = ?').run(sid);
      cb(null);
    } catch (err) { cb(err); }
  }
};

function saveEventToDb(ev) {
  try {
    const extractText = (v) => {
      if (!v) return '';
      if (typeof v === 'string') return v.replace(/[{}]/g, '');
      if (typeof v === 'object') return (v.state || v.event || v.reason || v.value || JSON.stringify(v)).replace(/[{}]/g, '');
      return String(v);
    };
    db.prepare('INSERT OR IGNORE INTO events (timestamp, deviceId, cardNumber, door, granted, eventType, reason) VALUES (?, ?, ?, ?, ?, ?, ?)').run(ev.timestamp || new Date().toISOString().replace('T', ' ').split('.')[0], Number(ev.deviceId), ev.cardNumber || ev.card || 0, ev.door || 0, ev.granted ? 1 : 0, extractText(ev.eventType || ev.type || 'Access'), extractText(ev.reason || ''));
  } catch (e) { console.error('DB Save Error', e); }
}

function getSetting(key, defaultValue) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}
function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
}

const globalConfig = {
  bind: getSetting('bind', process.env.UHPPOTE_BIND || '0.0.0.0'),
  broadcast: getSetting('broadcast', process.env.UHPPOTE_BROADCAST || '192.168.0.255:60000'),
  listen: getSetting('listen', process.env.UHPPOTE_LISTEN || '0.0.0.0:60001'),
  timeout: parseInt(getSetting('timeout', process.env.UHPPOTE_TIMEOUT || '5000')),
  debug: getSetting('debug', process.env.UHPPOTE_DEBUG || 'false') === 'true'
};

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set('trust proxy', true);
app.use(express.json());
app.use(morgan('dev'));

// Header cleaning middleware to prevent CSP conflicts
app.use((req, res, next) => {
  res.removeHeader('Content-Security-Policy');
  res.removeHeader('X-Content-Security-Policy');
  res.removeHeader('X-WebKit-CSP');
  // Set a very permissive CSP to ensure OIDC redirects and Cloudflare beacons are never blocked
  res.setHeader('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;");
  next();
});

// Static files bypass BEFORE auth
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(__dirname, 'public', 'favicon.ico')));
app.get('/app.js', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.js')));

const oidcConfig = {
  authRequired: true,
  auth0Logout: false,
  idpLogout: true,
  backchannelLogout: { store: logoutStore },
  secret: process.env.OIDC_SECRET,
  baseURL: process.env.BASE_URL,
  clientID: process.env.OIDC_CLIENT_ID,
  issuerBaseURL: process.env.OIDC_ISSUER_URL,
  clientSecret: process.env.OIDC_CLIENT_SECRET,
  authorizationParams: { 
    response_type: 'code', 
    response_mode: 'query', // Switch to GET redirects for maximum compatibility
    scope: 'openid profile email' 
  },
  session: { 
    name: 'appSession', 
    absoluteDuration: 3600, 
    rolling: true, 
    rollingDuration: 900,
    cookie: { secure: true, sameSite: 'Lax' } // Standard setting for query mode
  },
};

app.use(auth(oidcConfig));

app.use(async (req, res, next) => {
  if (req.oidc && req.oidc.isAuthenticated()) {
    try {
      const lastCheck = req.appSession.lastSync || 0;
      if (Date.now() - lastCheck > 60000) {
        await req.oidc.fetchUserInfo();
        req.appSession.lastSync = Date.now();
      }
    } catch (e) { return res.redirect('/logout'); }
  }
  next();
});

function getUhppoteConfig() {
  const savedControllers = db.prepare('SELECT * FROM controllers').all();
  const controllerList = savedControllers.map(c => {
    const ctrl = { deviceId: c.deviceId, forceBroadcast: !!c.forceBroadcast };
    if (c.address && c.address.trim() !== '') ctrl.address = c.address.trim();
    return ctrl;
  });
  return new uhppoted.Config('uhppoted', globalConfig.bind, globalConfig.broadcast, globalConfig.listen, globalConfig.timeout, controllerList, globalConfig.debug);
}

let ctx = { config: getUhppoteConfig(), logger: console.log };

const wrap = fn => async (req, res, next) => {
  try {
    const result = await fn(req, res, next);
    res.json(result || { success: true });
  } catch (err) {
    console.error(`[UHPPOTE ERROR] ${req.path}:`, err);
    res.status(500).json({ error: err.message || String(err) });
  }
};

app.get('/api/getConfig', (req, res) => res.json({ ...globalConfig, controllers: db.prepare('SELECT * FROM controllers').all() }));
app.post('/api/setConfig', (req, res) => {
  const { bind, broadcast, listen, timeout, debug } = req.body;
  if (bind) { globalConfig.bind = bind; setSetting('bind', bind); }
  if (broadcast) { globalConfig.broadcast = broadcast; setSetting('broadcast', broadcast); }
  if (listen) { globalConfig.listen = listen; setSetting('listen', listen); }
  if (timeout) { globalConfig.timeout = parseInt(timeout); setSetting('timeout', timeout); }
  if (typeof debug !== 'undefined') { globalConfig.debug = Boolean(debug); setSetting('debug', debug); }
  ctx.config = getUhppoteConfig();
  res.json({ success: true });
});

app.post('/api/addDevice', wrap(async (req) => {
  const { deviceId, address, forceBroadcast, name, doorCount } = req.body;
  db.prepare('INSERT OR REPLACE INTO controllers (deviceId, address, forceBroadcast, name, doorCount) VALUES (?, ?, ?, ?, ?)')
    .run(Number(deviceId), address || '', forceBroadcast ? 1 : 0, name || `Controller ${deviceId}`, doorCount || 4);
  ctx.config = getUhppoteConfig();
  return { success: true };
}));

app.post('/api/updateController', wrap(async (req) => {
  const { deviceId, address, forceBroadcast, name, doorCount } = req.body;
  db.prepare('INSERT OR REPLACE INTO controllers (deviceId, address, forceBroadcast, name, doorCount) VALUES (?, ?, ?, ?, ?)')
    .run(Number(deviceId), address || '', forceBroadcast ? 1 : 0, name, Number(doorCount));
  ctx.config = getUhppoteConfig();
  return { success: true };
}));

app.post('/api/setDoorControl', wrap(async (req) => await uhppoted.setDoorControl(ctx, Number(req.body.deviceId), Number(req.body.door), Number(req.body.delay), req.body.control)));
app.post('/api/removeDevice', wrap(async (req) => {
  db.prepare('DELETE FROM controllers WHERE deviceId = ?').run(Number(req.body.deviceId));
  ctx.config = getUhppoteConfig();
  return { success: true };
}));

app.get('/api/testController/:id', wrap(async (req) => await uhppoted.getDevice(ctx, Number(req.params.id))));
app.get('/api/getDevices', wrap(async () => await uhppoted.getDevices(ctx)));
app.get('/api/getDevice/:id', wrap(async (req) => await uhppoted.getDevice(ctx, Number(req.params.id))));
app.post('/api/setIP', wrap(async (req) => await uhppoted.setIP(ctx, Number(req.body.deviceId), req.body.address, req.body.netmask, req.body.gateway)));
app.get('/api/getTime/:id', wrap(async (req) => await uhppoted.getTime(ctx, Number(req.params.id))));
app.post('/api/setTime', wrap(async (req) => await uhppoted.setTime(ctx, Number(req.body.deviceId), new Date(req.body.datetime))));
app.get('/api/getDoorControl/:id/:door', wrap(async (req) => await uhppoted.getDoorControl(ctx, Number(req.params.id), Number(req.params.door))));
app.post('/api/openDoor', wrap(async (req) => await uhppoted.openDoor(ctx, Number(req.body.deviceId), Number(req.body.door))));
app.post('/api/setDoorPasscodes', wrap(async (req) => await uhppoted.setDoorPasscodes(ctx, Number(req.body.deviceId), Number(req.body.door), Number(req.body.passcode1), Number(req.body.passcode2), Number(req.body.passcode3), Number(req.body.passcode4))));
app.post('/api/setInterlock', wrap(async (req) => await uhppoted.setInterlock(ctx, Number(req.body.deviceId), Number(req.body.interlock))));
app.post('/api/setPCControl', wrap(async (req) => await uhppoted.setPCControl(ctx, Number(req.body.deviceId), Boolean(req.body.enabled))));
app.get('/api/getListener/:id', wrap(async (req) => await uhppoted.getListener(ctx, Number(req.params.id))));
app.post('/api/setListener', wrap(async (req) => await uhppoted.setListener(ctx, Number(req.body.deviceId), req.body.address, Number(req.body.port), 0)));
app.post('/api/recordSpecialEvents', wrap(async (req) => await uhppoted.recordSpecialEvents(ctx, Number(req.body.deviceId), Boolean(req.body.enabled))));
app.get('/api/getEvents/:id', wrap(async (req) => await uhppoted.getEvents(ctx, Number(req.params.id))));
app.get('/api/getEvent/:id/:index', wrap(async (req) => await uhppoted.getEvent(ctx, Number(req.params.id), Number(req.params.index))));
app.get('/api/getEventIndex/:id', wrap(async (req) => await uhppoted.getEventIndex(ctx, Number(req.params.id))));
app.post('/api/setEventIndex', wrap(async (req) => await uhppoted.setEventIndex(ctx, Number(req.body.deviceId), Number(req.body.index))));
app.get('/api/getStatus/:id', wrap(async (req) => await uhppoted.getStatus(ctx, Number(req.params.id))));
app.get('/api/getAntiPassback/:id', wrap(async (req) => await uhppoted.getAntiPassback(ctx, Number(req.params.id))));
app.post('/api/setAntiPassback', wrap(async (req) => await uhppoted.setAntiPassback(ctx, Number(req.body.deviceId), Number(req.body.mode))));
app.post('/api/activateKeypads', wrap(async (req) => await uhppoted.activateKeypads(ctx, Number(req.body.deviceId), Boolean(req.body.reader1), Boolean(req.body.reader2), Boolean(req.body.reader3), Boolean(req.body.reader4))));
app.post('/api/restoreDefaultParameters', wrap(async (req) => await uhppoted.restoreDefaultParameters(ctx, Number(req.body.deviceId))));
app.get('/api/getCards/:id', wrap(async (req) => await uhppoted.getCards(ctx, Number(req.params.id))));
app.get('/api/getCard/:id/:cardNumber', wrap(async (req) => await uhppoted.getCard(ctx, Number(req.params.id), Number(req.params.cardNumber))));
app.get('/api/getCardByIndex/:id/:index', wrap(async (req) => await uhppoted.getCardByIndex(ctx, Number(req.params.id), Number(req.params.index))));
app.post('/api/putCard', wrap(async (req) => {
  const { deviceId, cardNumber, from, to, door1, door2, door3, door4, pin } = req.body;
  const mapPermission = (p) => { const v = Number(p); if (v === 0) return false; if (v === 1) return true; return v; };
  return await uhppoted.putCard(ctx, Number(deviceId), Number(cardNumber), from, to, { 1: mapPermission(door1), 2: mapPermission(door2), 3: mapPermission(door3), 4: mapPermission(door4) }, Number(pin));
}));
app.post('/api/deleteCard', wrap(async (req) => await uhppoted.deleteCard(ctx, Number(req.body.deviceId), Number(req.body.cardNumber))));
app.post('/api/deleteCards', wrap(async (req) => await uhppoted.deleteCards(ctx, Number(req.body.deviceId))));
app.get('/api/getTimeProfile/:id/:profileId', wrap(async (req) => await uhppoted.getTimeProfile(ctx, Number(req.params.id), Number(req.params.profileId))));
app.post('/api/setTimeProfile', wrap(async (req) => {
  const { deviceId, profileId, start, end, monday, tuesday, wednesday, thursday, friday, saturday, sunday, segment1start, segment1end, segment2start, segment2end, segment3start, segment3end, linkedProfileID } = req.body;
  return await uhppoted.setTimeProfile(ctx, Number(deviceId), { profileId: Number(profileId), start, end, monday: Boolean(monday), tuesday: Boolean(tuesday), wednesday: Boolean(wednesday), thursday: Boolean(thursday), friday: Boolean(friday), saturday: Boolean(saturday), sunday: Boolean(sunday), segment1start, segment1end, segment2start, segment2end, segment3start, segment3end, linkedProfileID: Number(linkedProfileID) });
}));
app.post('/api/clearTimeProfiles', wrap(async (req) => await uhppoted.clearTimeProfiles(ctx, Number(req.body.deviceId))));
app.post('/api/clearTaskList', wrap(async (req) => await uhppoted.clearTaskList(ctx, Number(req.body.deviceId))));
app.post('/api/addTask', wrap(async (req) => await uhppoted.addTask(ctx, Number(req.body.deviceId), req.body.task)));
app.post('/api/refreshTaskList', wrap(async (req) => await uhppoted.refreshTaskList(ctx, Number(req.body.deviceId))));

app.get('/api/doorGroups', (req, res) => res.json(db.prepare('SELECT * FROM door_groups').all().map(g => ({ ...g, members: db.prepare('SELECT * FROM door_group_members WHERE groupId = ?').all(g.id) }))));
app.post('/api/doorGroups', (req, res) => {
  const { name, members } = req.body;
  const groupId = db.prepare('INSERT INTO door_groups (name) VALUES (?)').run(name).lastInsertRowid;
  const insert = db.prepare('INSERT INTO door_group_members (groupId, deviceId, door) VALUES (?, ?, ?)');
  for (const m of members) insert.run(groupId, Number(m.deviceId), Number(m.door));
  res.json({ success: true, id: groupId });
});
app.delete('/api/doorGroups/:id', (req, res) => {
  db.prepare('DELETE FROM door_groups WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM door_group_members WHERE groupId = ?').run(req.params.id);
  res.json({ success: true });
});
app.post('/api/provisionCard', wrap(async (req) => {
  const { groupIds, cardNumber, from, to, pin } = req.body;
  const targets = Array.isArray(groupIds) ? groupIds : [groupIds];
  const results = [];
  for (const gid of targets) {
    db.prepare('INSERT OR REPLACE INTO card_group_assignments (cardNumber, groupId, pin, validFrom, validTo) VALUES (?, ?, ?, ?, ?)').run(Number(cardNumber), Number(gid), Number(pin), from, to);
    const members = db.prepare('SELECT * FROM door_group_members WHERE groupId = ?').all(gid);
    const deviceDoors = {};
    members.forEach(m => { if (!deviceDoors[m.deviceId]) deviceDoors[m.deviceId] = []; deviceDoors[m.deviceId].push(m.door); });
    for (const [did, doors] of Object.entries(deviceDoors)) {
      const doorMap = { 1: false, 2: false, 3: false, 4: false };
      doors.forEach(d => doorMap[d] = true);
      try { await uhppoted.putCard(ctx, Number(did), Number(cardNumber), from, to, doorMap, Number(pin)); results.push({ groupId: gid, deviceId: did, success: true }); }
      catch (e) { results.push({ groupId: gid, deviceId: did, success: false, error: e.message }); }
    }
  }
  return { results };
}));
app.get('/api/assignments', (req, res) => res.json(db.prepare('SELECT a.*, g.name as groupName FROM card_group_assignments a JOIN door_groups g ON a.groupId = g.id').all()));
app.post('/api/deprovisionCard', wrap(async (req) => {
  const { groupId, cardNumber } = req.body;
  const members = db.prepare('SELECT * FROM door_group_members WHERE groupId = ?').all(groupId);
  const ids = [...new Set(members.map(m => m.deviceId))];
  const results = [];
  for (const id of ids) {
    try { await uhppoted.deleteCard(ctx, Number(id), Number(cardNumber)); results.push({ deviceId: id, success: true }); }
    catch (e) { results.push({ deviceId: id, success: false, error: e.message }); }
  }
  db.prepare('DELETE FROM card_group_assignments WHERE cardNumber = ? AND groupId = ?').run(Number(cardNumber), Number(groupId));
  return { results };
}));
app.post('/api/saveEvents', (req, res) => { (Array.isArray(req.body) ? req.body : [req.body]).forEach(saveEventToDb); res.json({ success: true }); });

app.get('/api/lastEventIndex/:id', (req, res) => {
  const row = db.prepare('SELECT MAX(id) as lastId FROM events WHERE deviceId = ?').get(Number(req.params.id));
  res.json({ lastId: row ? row.lastId : 0 });
});

const liveEvents = [];
app.get('/api/liveEvents', (req, res) => res.json(liveEvents));
app.get('/api/eventHistory', (req, res) => res.json(db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 100').all()));

uhppoted.listen(ctx, (event) => {
  const normalized = {
    deviceId: event.deviceId,
    timestamp: event.timestamp || (event.state && event.state.event ? event.state.event.timestamp : new Date().toISOString().replace('T', ' ').split('.')[0]),
    door: event.door || (event.state && event.state.event ? event.state.event.door : 0),
    eventType: event.eventType || (event.state && event.state.event ? event.state.event.type : 'status'),
    cardNumber: event.cardNumber || (event.state && event.state.event ? event.state.event.card : 0),
    granted: event.granted || (event.state && event.state.event ? event.state.event.granted : false),
    reason: event.reason || (event.state && event.state.event ? event.state.event.reason : ''),
    doorStates: event.state ? event.state.doors : null,
    relayStates: (event.state && event.state.relays) ? event.state.relays.relays : null
  };
  liveEvents.push(normalized);
  if (liveEvents.length > 50) liveEvents.shift();
  saveEventToDb(normalized);
  io.emit('doorEvent', normalized);
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
