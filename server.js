require('dotenv').config();
const express = require('express');
const { auth } = require('express-openid-connect');
const morgan = require('morgan');
const uhppoted = require('uhppoted');
const path = require('path');
const Database = require('better-sqlite3');

// --- DATABASE SETUP ---
const db = new Database('/opt/door-controller/door-control.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS controllers (
    deviceId INTEGER PRIMARY KEY,
    address TEXT,
    name TEXT,
    doorCount INTEGER DEFAULT 4,
    forceBroadcast INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT,
    deviceId INTEGER,
    cardNumber INTEGER,
    door INTEGER,
    granted INTEGER,
    eventType TEXT
  );
  CREATE TABLE IF NOT EXISTS door_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE
  );
  CREATE TABLE IF NOT EXISTS door_group_members (
    groupId INTEGER,
    deviceId INTEGER,
    door INTEGER,
    PRIMARY KEY(groupId, deviceId, door)
  );
`);

// Helper to get/set settings
function getSetting(key, defaultValue) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}
function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
}

// Initial Global Config from DB or Env
const globalConfig = {
  bind: getSetting('bind', process.env.UHPPOTE_BIND || '0.0.0.0'),
  broadcast: getSetting('broadcast', process.env.UHPPOTE_BROADCAST || '192.168.0.255:60000'),
  listen: getSetting('listen', process.env.UHPPOTE_LISTEN || '0.0.0.0:60001'),
  timeout: parseInt(getSetting('timeout', process.env.UHPPOTE_TIMEOUT || '5000')),
  debug: getSetting('debug', process.env.UHPPOTE_DEBUG || 'false') === 'true'
};

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use(morgan('dev'));

// OIDC configuration
const oidcConfig = {
  authRequired: true,
  auth0Logout: false,
  idpLogout: true,
  secret: process.env.OIDC_SECRET,
  baseURL: process.env.BASE_URL,
  clientID: process.env.OIDC_CLIENT_ID,
  issuerBaseURL: process.env.OIDC_ISSUER_URL,
  clientSecret: process.env.OIDC_CLIENT_SECRET,
  authorizationParams: {
    response_type: 'code',
    scope: 'openid profile email',
  },
  session: {
    name: 'appSession',
    cookie: {
      secure: true,
      sameSite: 'Lax',
    }
  },
};

app.use((req, res, next) => {
  const skip = ['/favicon.ico', '/app.js', '/index.html'].some(p => req.path === p);
  if (skip) return next();
  auth(oidcConfig)(req, res, next);
});

// Setup UHPPOTE Configuration
function getUhppoteConfig() {
  const savedControllers = db.prepare('SELECT * FROM controllers').all();
  const controllerList = savedControllers.map(c => {
    const ctrl = {
      deviceId: c.deviceId,
      forceBroadcast: !!c.forceBroadcast
    };
    if (c.address && c.address.trim() !== '') {
      ctrl.address = c.address.trim();
    }
    return ctrl;
  });
  return new uhppoted.Config(
    'uhppoted',
    globalConfig.bind,
    globalConfig.broadcast,
    globalConfig.listen,
    globalConfig.timeout,
    controllerList,
    globalConfig.debug
  );
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

// API: Config & Persistence
app.get('/api/getConfig', (req, res) => {
  const ctrls = db.prepare('SELECT * FROM controllers').all();
  res.json({
    ...globalConfig,
    controllers: ctrls
  });
});

app.post('/api/setConfig', (req, res) => {
  const { bind, broadcast, listen, timeout, debug } = req.body;
  if (bind) { globalConfig.bind = bind; setSetting('bind', bind); }
  if (broadcast) { globalConfig.broadcast = broadcast; setSetting('broadcast', broadcast); }
  if (listen) { globalConfig.listen = listen; setSetting('listen', listen); }
  if (timeout) { globalConfig.timeout = parseInt(timeout); setSetting('timeout', timeout); }
  if (typeof debug !== 'undefined') { globalConfig.debug = Boolean(debug); setSetting('debug', debug); }
  ctx.config = getUhppoteConfig(); // Refresh context
  res.json({ success: true });
});

app.post('/api/addDevice', wrap(async (req) => {
  const { deviceId, address, forceBroadcast, name, doorCount } = req.body;
  db.prepare('INSERT OR REPLACE INTO controllers (deviceId, address, forceBroadcast, name, doorCount) VALUES (?, ?, ?, ?, ?)')
    .run(Number(deviceId), address || '', forceBroadcast ? 1 : 0, name || `Controller ${deviceId}`, doorCount || 4);
  ctx.config = getUhppoteConfig(); // Refresh context
  return { success: true };
}));

app.post('/api/updateController', wrap(async (req) => {
  const { deviceId, address, forceBroadcast, name, doorCount } = req.body;
  db.prepare('INSERT OR REPLACE INTO controllers (deviceId, address, forceBroadcast, name, doorCount) VALUES (?, ?, ?, ?, ?)')
    .run(Number(deviceId), address || '', forceBroadcast ? 1 : 0, name, Number(doorCount));
  ctx.config = getUhppoteConfig();
  return { success: true };
}));

app.post('/api/setDoorControl', wrap(async (req) => {
  const { deviceId, door, control, delay } = req.body;
  // Signature: (ctx, controller, door, delay, mode)
  return await uhppoted.setDoorControl(ctx, Number(deviceId), Number(door), Number(delay), control);
}));

app.post('/api/removeDevice', wrap(async (req) => {
  db.prepare('DELETE FROM controllers WHERE deviceId = ?').run(Number(req.body.deviceId));
  ctx.config = getUhppoteConfig();
  return { success: true };
}));

app.get('/api/testController/:id', wrap(async (req) => {
  return await uhppoted.getDevice(ctx, Number(req.params.id));
}));

// API: Standard UHPPOTE
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
app.post('/api/setListener', wrap(async (req) => await uhppoted.setListener(ctx, Number(req.body.deviceId), req.body.address, Number(req.body.port))));
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
  const doors = {
    1: Number(door1),
    2: Number(door2),
    3: Number(door3),
    4: Number(door4)
  };
  return await uhppoted.putCard(ctx, Number(deviceId), Number(cardNumber), from, to, doors, Number(pin));
}));
app.post('/api/deleteCard', wrap(async (req) => await uhppoted.deleteCard(ctx, Number(req.body.deviceId), Number(req.body.cardNumber))));
app.post('/api/deleteCards', wrap(async (req) => await uhppoted.deleteCards(ctx, Number(req.body.deviceId))));
app.get('/api/getTimeProfile/:id/:profileId', wrap(async (req) => await uhppoted.getTimeProfile(ctx, Number(req.params.id), Number(req.params.profileId))));
app.post('/api/setTimeProfile', wrap(async (req) => {
  const { deviceId, profileId, start, end, monday, tuesday, wednesday, thursday, friday, saturday, sunday, segment1start, segment1end, segment2start, segment2end, segment3start, segment3end, linkedProfileID } = req.body;
  return await uhppoted.setTimeProfile(ctx, Number(deviceId), {
    profileId: Number(profileId), start, end,
    monday: Boolean(monday), tuesday: Boolean(tuesday), wednesday: Boolean(wednesday), thursday: Boolean(thursday), friday: Boolean(friday), saturday: Boolean(saturday), sunday: Boolean(sunday),
    segment1start, segment1end, segment2start, segment2end, segment3start, segment3end,
    linkedProfileID: Number(linkedProfileID)
  });
}));
app.post('/api/clearTimeProfiles', wrap(async (req) => await uhppoted.clearTimeProfiles(ctx, Number(req.body.deviceId))));
app.post('/api/clearTaskList', wrap(async (req) => await uhppoted.clearTaskList(ctx, Number(req.body.deviceId))));
app.post('/api/addTask', wrap(async (req) => await uhppoted.addTask(ctx, Number(req.body.deviceId), req.body.task)));
app.post('/api/refreshTaskList', wrap(async (req) => await uhppoted.refreshTaskList(ctx, Number(req.body.deviceId))));

// API: Door Groups
app.get('/api/doorGroups', (req, res) => {
  const groups = db.prepare('SELECT * FROM door_groups').all();
  const result = groups.map(g => {
    const members = db.prepare('SELECT * FROM door_group_members WHERE groupId = ?').all(g.id);
    return { ...g, members };
  });
  res.json(result);
});

app.post('/api/doorGroups', (req, res) => {
  const { name, members } = req.body;
  const info = db.prepare('INSERT INTO door_groups (name) VALUES (?)').run(name);
  const groupId = info.lastInsertRowid;
  const insertMember = db.prepare('INSERT INTO door_group_members (groupId, deviceId, door) VALUES (?, ?, ?)');
  for (const m of members) {
    insertMember.run(groupId, Number(m.deviceId), Number(m.door));
  }
  res.json({ success: true, id: groupId });
});

app.delete('/api/doorGroups/:id', (req, res) => {
  db.prepare('DELETE FROM door_groups WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM door_group_members WHERE groupId = ?').run(req.params.id);
  res.json({ success: true });
});

app.post('/api/provisionCard', wrap(async (req) => {
  const { groupId, cardNumber, from, to, pin } = req.body;
  const members = db.prepare('SELECT * FROM door_group_members WHERE groupId = ?').all(groupId);
  
  // Group members by deviceId
  const deviceDoors = {};
  members.forEach(m => {
    if (!deviceDoors[m.deviceId]) deviceDoors[m.deviceId] = [];
    deviceDoors[m.deviceId].push(m.door);
  });

  const results = [];
  for (const [deviceId, doors] of Object.entries(deviceDoors)) {
    const doorMap = { 1: 0, 2: 0, 3: 0, 4: 0 };
    doors.forEach(d => doorMap[d] = 1);
    try {
      await uhppoted.putCard(ctx, Number(deviceId), Number(cardNumber), from, to, doorMap, Number(pin));
      results.push({ deviceId, success: true });
    } catch (e) {
      results.push({ deviceId, success: false, error: e.message });
    }
  }
  return { results };
}));

// Background Listen
const liveEvents = [];
app.get('/api/liveEvents', (req, res) => res.json(liveEvents));
app.get('/api/eventHistory', (req, res) => {
  const rows = db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 100').all();
  res.json(rows);
});

uhppoted.listen(ctx, (event) => {
  liveEvents.push(event);
  if (liveEvents.length > 50) liveEvents.shift();
  // Persist to DB
  try {
    db.prepare('INSERT INTO events (timestamp, deviceId, cardNumber, door, granted, eventType) VALUES (?, ?, ?, ?, ?, ?)')
      .run(event.timestamp, event.deviceId, event.cardNumber, event.door, event.granted ? 1 : 0, event.eventType || 'Access');
  } catch (e) { console.error('DB Event Save Error', e); }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
