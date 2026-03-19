document.addEventListener('DOMContentLoaded', () => {
    console.log('Door Control App v15 (Stable) Initialized');

    let groupSelect = null;
    const state = {
        config: { controllers: [] },
        liveEvents: [],
        selectedId: null
    };

    const api = async (p, m = 'GET', b = null) => {
        try {
            const r = await fetch(p, { 
                method: m, 
                headers: { 'Content-Type': 'application/json' }, 
                body: b ? JSON.stringify(b) : null 
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || `Server error ${r.status}`);
            return d;
        } catch (e) {
            console.error(`API Error [${m} ${p}]:`, e);
            throw e;
        }
    };

    const showLoader = s => {
        const el = document.getElementById('loader');
        if (el) el.style.display = s ? 'flex' : 'none';
    };

    const getText = (val) => {
        if (!val) return '';
        let t = val;
        if (typeof val === 'object') t = val.state || val.event || val.value || JSON.stringify(val);
        return String(t).replace(/[{}]/g, '');
    };

    const initTomSelect = (groups = []) => {
        const el = document.getElementById('select-provision-groups');
        if (!el) return;
        
        if (groupSelect) {
            groupSelect.clearOptions();
            groupSelect.addOptions(groups.map(g => ({ value: g.id, text: g.name })));
            groupSelect.refreshItems();
            return;
        }

        if (typeof TomSelect === 'undefined') {
            console.error('TomSelect library not loaded');
            return;
        }

        groupSelect = new TomSelect('#select-provision-groups', {
            plugins: ['remove_button'],
            valueField: 'value',
            labelField: 'text',
            searchField: 'text',
            options: groups.map(g => ({ value: g.id, text: g.name })),
            create: false
        });
    };

    // Navigation
    document.querySelectorAll('#sidebar .nav-link[data-tab]').forEach(l => {
        l.onclick = async (e) => {
            e.preventDefault();
            const t = l.dataset.tab;
            document.querySelectorAll('#sidebar .nav-link').forEach(nav => nav.classList.remove('active'));
            l.classList.add('active');
            document.getElementById('view-title').textContent = t.charAt(0).toUpperCase() + t.slice(1);
            document.querySelectorAll('.tab-pane-content').forEach(p => p.classList.add('d-none'));
            const pane = document.getElementById(`tab-${t}`);
            if (pane) pane.classList.remove('d-none');
            await loadTab(t);
        };
    });

    const loadTab = async (t) => {
        showLoader(true);
        try {
            if (t === 'dashboard') await refreshDash();
            if (t === 'controllers') await window.refreshControllers();
            if (t === 'cards') await refreshCards();
            if (t === 'door-groups') await refreshDoorGroups();
            if (t === 'debug') await refreshDebug();
            if (t === 'events') await refreshEvents();
            if (t === 'settings') await refreshSettings();
        } catch (e) {
            alert(`Error loading ${t}: ` + e.message);
        } finally { showLoader(false); }
    };

    const refreshDash = async () => {
        state.config = await api('/api/getConfig');
        const el = document.getElementById('stat-controllers');
        if (el) el.textContent = state.config.controllers.length;
    };

    window.refreshControllers = async (scan = false) => {
        showLoader(true);
        let discovered = [];
        if (scan) try { discovered = await api('/api/getDevices'); } catch(e) {}
        state.config = await api('/api/getConfig');
        const map = new Map();
        state.config.controllers.forEach(c => map.set(Number(c.deviceId), { ...c, configured: true, offline: true }));
        discovered.forEach(d => {
            const id = Number(d.deviceId);
            const ex = map.get(id);
            map.set(id, { ...d, ...(ex || {}), configured: !!ex, offline: false });
        });

        const tbody = document.getElementById('table-controllers');
        if (!tbody) return;
        tbody.innerHTML = '';
        map.forEach(d => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${d.name||'Unnamed'}</td><td>${d.deviceId}</td><td>${d.address||'Auto'}</td><td>${d.doorCount||4}</td><td><span class="badge ${d.offline?'bg-secondary':'bg-success'}" id="status-${d.deviceId}">${d.offline?'Offline':'Online'}</span></td><td><div class="btn-group btn-group-sm"><button class="btn btn-primary" onclick="window.openDetails(${d.deviceId})">Details</button><button class="btn btn-warning" onclick="window.openDoor(${d.deviceId},1)">Unlock</button>${!d.configured?`<button class="btn btn-success" onclick="window.quickAdd(${d.deviceId},'${d.address}')">Add</button>`:`<button class="btn btn-danger" onclick="window.removeCtrl(${d.deviceId})">Del</button>`}</div></td>`;
            tbody.appendChild(tr);
            if (d.configured && d.offline) api(`/api/testController/${d.deviceId}`).then(() => { 
                const b = document.getElementById(`status-${d.deviceId}`);
                if (b) { b.className = 'badge bg-success'; b.textContent = 'Online'; }
            }).catch(()=>{});
        });
        showLoader(false);
    };

    window.openDetails = async (id) => {
        state.selectedId = id;
        const c = state.config.controllers.find(x => x.deviceId == id) || { deviceId: id, name: 'New', doorCount: 4, address: '' };
        const modalEl = document.getElementById('modal-controller-details');
        if (!modalEl) return;

        document.getElementById('details-title').textContent = `${c.name} (${id})`;
        const f = document.getElementById('form-det-gen');
        f.deviceId.value = id; f.name.value = c.name || ''; f.address.value = c.address || ''; f.doorCount.value = c.doorCount || 4; f.forceBroadcast.checked = !!c.forceBroadcast;
        
        document.getElementById('det-time').textContent = '...';
        const dl = document.getElementById('det-doors-list'); 
        if (dl) {
            dl.innerHTML = '';
            for (let i=1; i<=(c.doorCount||4); i++) {
                const div = document.createElement('div'); div.className='col-md-6 mb-3';
                div.innerHTML = `<div class="card p-3 border"><h6>Door ${i}</h6><div class="mb-2"><label class="small fw-bold">Delay (sec)</label><input type="number" id="delay-${id}-${i}" class="form-control form-control-sm" value="5"></div><div class="mb-2"><label class="small fw-bold">Mode</label><select id="mode-${id}-${i}" class="form-select form-select-sm"><option value="controlled">Controlled</option><option value="normally open">Normally Open</option><option value="normally closed">Normally Closed</option></select></div><div class="btn-group btn-group-sm w-100"><button class="btn btn-success" onclick="window.saveDoor(${id},${i})">Save</button><button class="btn btn-warning" onclick="window.openDoor(${id},${i})">Unlock</button><button class="btn btn-info" onclick="window.checkDoor(${id},${i})">Check</button></div><div id="dinfo-${id}-${i}" class="mt-2 small text-muted"></div></div>`;
                dl.appendChild(div);
            }
        }
        
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
        api(`/api/getTime/${id}`).then(d => {
            const el = document.getElementById('det-time');
            if (el) el.textContent = d.datetime;
        }).catch(() => {
            const el = document.getElementById('det-time');
            if (el) el.textContent = 'Offline';
        });
    };

    window.saveDoor = async (id, door) => {
        const delay = document.getElementById(`delay-${id}-${door}`).value;
        const control = document.getElementById(`mode-${id}-${door}`).value;
        try {
            await api('/api/setDoorControl', 'POST', { deviceId: id, door, control, delay });
            alert('Settings updated');
        } catch (e) { alert('Update failed: ' + e.message); }
    };

    window.checkDoor = async (id, door) => { 
        try {
            const r = await api(`/api/getDoorControl/${id}/${door}`); 
            const s = r.doorControlState || {};
            const ctrlText = getText(s.control);
            const infoEl = document.getElementById(`dinfo-${id}-${door}`);
            if (infoEl) infoEl.textContent = `Current: ${s.delay}s, ${ctrlText}`; 
            const dInp = document.getElementById(`delay-${id}-${door}`);
            if (dInp) dInp.value = s.delay;
            const sel = document.getElementById(`mode-${id}-${door}`);
            if (sel) {
                for (let opt of sel.options) {
                    if (opt.value === ctrlText || ctrlText.toLowerCase().includes(opt.value)) {
                        sel.value = opt.value; break;
                    }
                }
            }
        } catch (e) { alert('Check failed: ' + e.message); }
    };

    window.openDoor = async (id, d) => { if (confirm(`Unlock Door ${d}?`)) await api('/api/openDoor', 'POST', { deviceId: id, door: d }); };
    window.quickAdd = async (id, a) => { await api('/api/addDevice', 'POST', { deviceId: id, address: a }); window.refreshControllers(); };
    window.removeCtrl = async (id) => { if (confirm('Remove?')) { await api('/api/removeDevice', 'POST', { deviceId: id }); window.refreshControllers(); } };
    window.updateCtrlMeta = async (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); d.forceBroadcast = e.target.forceBroadcast.checked; await api('/api/updateController', 'POST', d); alert('Saved'); window.refreshControllers(); };
    window.syncTime = async () => { try { await api('/api/setTime', 'POST', { deviceId: state.selectedId, datetime: new Date().toISOString() }); alert('Synced'); } catch(e){ alert(e.message); } };
    window.setHardwareIP = async (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); d.deviceId = state.selectedId; await api('/api/setIP', 'POST', d); alert('Request sent'); };
    window.setListenerIP = async (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); d.deviceId = state.selectedId; await api('/api/setListener', 'POST', d); alert('Request sent'); };
    window.toggleSpec = async () => { await api('/api/recordSpecialEvents', 'POST', { deviceId: state.selectedId, enabled: true }); alert('Enabled'); };
    window.factoryReset = async () => { if (confirm('WIPE?')) await api('/api/restoreDefaultParameters', 'POST', { deviceId: state.selectedId }); };

    // Cards
    const refreshCards = async () => {
        state.config = await api('/api/getConfig');
        const s = document.getElementById('select-card-controller');
        if (!s) return;
        s.innerHTML = '<option value="">Select...</option>';
        state.config.controllers.forEach(c => s.add(new Option(`${c.name}(${c.deviceId})`, c.deviceId)));
    };
    window.onCardControllerChange = async (id) => {
        state.selectedId = id;
        const btn = document.getElementById('btn-add-card');
        if (btn) btn.disabled = !id;
        const tbody = document.getElementById('table-cards');
        if (!tbody) return;
        tbody.innerHTML = id ? '<tr><td colspan="6" class="text-center">Loading...</td></tr>' : '';
        if (!id) return;
        try {
            const { cards: count } = await api(`/api/getCards/${id}`);
            const stat = document.getElementById('stat-cards');
            if (stat) stat.textContent = count;
            tbody.innerHTML = '';
            for (let i=1; i<=Math.min(count, 50); i++) {
                try {
                    const { card: c } = await api(`/api/getCardByIndex/${id}/${i}`);
                    const tr = document.createElement('tr');
                    tr.innerHTML = `<td>${c.number}</td><td>${c.valid.from}</td><td>${c.valid.to}</td><td>${c.doors[1]},${c.doors[2]},${c.doors[3]},${c.doors[4]}</td><td>${c.PIN}</td><td><button class="btn btn-sm btn-danger" onclick="window.delCard(${id},${c.number})">Del</button></td>`;
                    tbody.appendChild(tr);
                } catch(e){}
            }
        } catch(e) { tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger">Failed to load</td></tr>'; }
    };
    window.delCard = async (id, n) => { if (confirm(`Delete ${n}?`)) { await api('/api/deleteCard', 'POST', { deviceId: id, cardNumber: n }); window.onCardControllerChange(id); } };
    window.openAddCardModal = () => {
        const el = document.getElementById('modal-card');
        if (el) bootstrap.Modal.getOrCreateInstance(el).show();
    };
    window.saveCard = async (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); d.deviceId = state.selectedId; await api('/api/putCard', 'POST', d); bootstrap.Modal.getOrCreateInstance(e.target.closest('.modal')).hide(); window.onCardControllerChange(state.selectedId); };

    // Door Groups
    const refreshDoorGroups = async () => {
        const groups = await api('/api/doorGroups');
        const tbody = document.getElementById('table-door-groups');
        if (tbody) {
            tbody.innerHTML = '';
            groups.forEach(g => {
                const tr = document.createElement('tr');
                tr.innerHTML = `<td>${g.name}</td><td>${g.members.length} Doors</td><td><button class="btn btn-sm btn-danger" onclick="window.removeGroup(${g.id})">Delete</button></td>`;
                tbody.appendChild(tr);
            });
        }
        initTomSelect(groups);
        await refreshAssignments();
    };

    const refreshAssignments = async () => {
        const list = await api('/api/assignments');
        const tbody = document.getElementById('table-assignments');
        if (!tbody) return;
        tbody.innerHTML = '';
        list.forEach(a => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${a.cardNumber}</td>
                <td>${a.groupName}</td>
                <td>${a.validFrom} to ${a.validTo}</td>
                <td>
                    <div class="btn-group btn-group-sm">
                        <button class="btn btn-outline-primary" onclick="window.editAssignment('${a.cardNumber}', ${a.groupId}, ${a.pin})"><i class="bi bi-pencil"></i> Edit</button>
                        <button class="btn btn-outline-danger" onclick="window.removeAssignment(${a.cardNumber}, ${a.groupId})"><i class="bi bi-person-x"></i> Deprovision</button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    };

    window.editAssignment = (cardNumber, groupId, pin) => {
        const header = document.getElementById('provision-card-header');
        if (header) header.textContent = 'Update Site Assignment';
        document.getElementById('prov-card-number').value = cardNumber;
        document.getElementById('prov-pin').value = pin;
        if (groupSelect) groupSelect.setValue([groupId]);
        const btn = document.getElementById('btn-prov-submit');
        if (btn) btn.textContent = 'Update Provisioning';
        const cancel = document.getElementById('btn-prov-cancel');
        if (cancel) cancel.style.display = 'block';
        window.scrollTo({ top: document.getElementById('form-provision').offsetTop - 100, behavior: 'smooth' });
    };

    window.cancelProvEdit = () => {
        document.getElementById('provision-card-header').textContent = 'Provision Card to Site(s)';
        const form = document.getElementById('form-provision');
        if (form) form.reset();
        if (groupSelect) groupSelect.clear();
        document.getElementById('btn-prov-submit').textContent = 'Provision Site';
        document.getElementById('btn-prov-cancel').style.display = 'none';
    };

    window.removeAssignment = async (cardNumber, groupId) => {
        if (confirm(`Remove access for card ${cardNumber}?`)) {
            showLoader(true);
            try {
                await api('/api/deprovisionCard', 'POST', { cardNumber, groupId });
                await refreshDoorGroups();
            } finally { showLoader(false); }
        }
    };

    window.openAddGroupModal = async () => {
        state.config = await api('/api/getConfig');
        const container = document.getElementById('group-door-selector');
        if (!container) return;
        container.innerHTML = '';
        state.config.controllers.forEach(c => {
            const col = document.createElement('div');
            col.className = 'col-md-4 mb-3';
            let doorChecks = '';
            for (let i=1; i<=(c.doorCount||4); i++) {
                doorChecks += `<div class="form-check"><input class="form-check-input group-member-check" type="checkbox" data-dev="${c.deviceId}" data-door="${i}" id="chk-${c.deviceId}-${i}"><label class="form-check-label" for="chk-${c.deviceId}-${i}">Door ${i}</label></div>`;
            }
            col.innerHTML = `<div class="card p-2"><h6>${c.name}</h6>${doorChecks}</div>`;
            container.appendChild(col);
        });
        const modalEl = document.getElementById('modal-add-group');
        if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).show();
    };

    window.saveDoorGroup = async (e) => {
        e.preventDefault();
        const name = e.target.name.value;
        const members = [];
        document.querySelectorAll('.group-member-check:checked').forEach(chk => {
            members.push({ deviceId: chk.dataset.dev, door: chk.dataset.door });
        });
        if (members.length === 0) return alert('Select at least one door');
        try {
            await api('/api/doorGroups', 'POST', { name, members });
            bootstrap.Modal.getOrCreateInstance(e.target.closest('.modal')).hide();
            await refreshDoorGroups();
        } catch(e){ alert(e.message); }
    };

    window.removeGroup = async (id) => {
        if (confirm('Delete Group?')) { await api(`/api/doorGroups/${id}`, 'DELETE'); await refreshDoorGroups(); }
    };

    window.provisionToGroup = async (e) => {
        e.preventDefault();
        if (!groupSelect) return;
        const fd = new FormData(e.target);
        const data = Object.fromEntries(fd);
        data.groupIds = groupSelect.getValue();
        data.from = "2024-01-01"; data.to = "2029-12-31"; 
        const resEl = document.getElementById('provision-results');
        resEl.innerHTML = '<div class="alert alert-info">Provisioning site(s)... please wait.</div>';
        try {
            const res = await api('/api/provisionCard', 'POST', data);
            let html = '<h6>Results:</h6><ul class="list-group">';
            res.results.forEach(r => {
                html += `<li class="list-group-item d-flex justify-content-between small">Group ${r.groupId} | CTRL ${r.deviceId}: ${r.success ? '<span class="text-success">SUCCESS</span>' : '<span class="text-danger">FAILED ('+r.error+')</span>'}</li>`;
            });
            html += '</ul>';
            resEl.innerHTML = html;
            await refreshAssignments();
            if (document.getElementById('btn-prov-cancel').style.display === 'block') window.cancelProvEdit();
        } catch (e) { resEl.innerHTML = `<div class="alert alert-danger">Error: ${e.message}</div>`; }
    };

    // Events
    const refreshEvents = async () => {
        const s = document.getElementById('select-event-controller');
        if (!s) return;
        s.innerHTML = '<option value="">Select...</option>';
        state.config.controllers.forEach(c => s.add(new Option(c.name, c.deviceId)));
        const hist = await api('/api/eventHistory');
        renderHistory(hist);
    };
    const renderHistory = (h) => {
        const tbody = document.getElementById('table-events-history'); 
        if (!tbody) return;
        tbody.innerHTML = '';
        h.forEach(ev => {
            const tr = document.createElement('tr');
            const type = getText(ev.eventType || ev.type);
            tr.innerHTML = `<td>${ev.timestamp}</td><td>${type||'Access'}</td><td>${ev.cardNumber||'-'}</td><td>${ev.door}</td><td><span class="badge ${ev.granted?'bg-success':'bg-danger'}">${ev.granted?'YES':'NO'}</span></td>`;
            tbody.appendChild(tr);
        });
    };
    window.fetchControllerHistory = async () => {
        const id = document.getElementById('select-event-controller').value;
        if (!id) return;
        showLoader(true);
        try {
            const meta = await api(`/api/getEvents/${id}`);
            const logs = [];
            for (let i=meta.last; i>=Math.max(meta.first, meta.last-30); i--) {
                try { 
                    const { event: e } = await api(`/api/getEvent/${id}/${i}`); 
                    logs.push({ timestamp: e.timestamp, eventType: e.type, cardNumber: e.card, door: e.door, granted: e.granted }); 
                } catch (ex){}
            }
            renderHistory(logs);
        } finally { showLoader(false); }
    };

    // Debug
    const refreshDebug = async () => {
        state.config = await api('/api/getConfig');
        const s = document.getElementById('debug-controller');
        if (!s) return;
        s.innerHTML = '<option value="">(Network Broadcast)</option>';
        state.config.controllers.forEach(c => s.add(new Option(`${c.name || 'Unnamed'} (${c.deviceId})`, c.deviceId)));
    };

    window.onDebugCommandChange = (cmd) => {
        const p = document.getElementById('debug-params');
        p.innerHTML = '';
        if (cmd === 'getDevice' || cmd === 'getStatus' || cmd === 'getTime' || cmd === 'getCards') {
            // No extra params needed beyond ID
        } else if (cmd === 'openDoor' || cmd === 'getDoorControl') {
            p.innerHTML = '<label class="x-small fw-bold">Door (1-4)</label><input type="number" id="dbg-door" class="form-control form-control-sm" value="1">';
        } else if (cmd === 'setDoorControl') {
            p.innerHTML = `
                <label class="x-small fw-bold">Door (1-4)</label><input type="number" id="dbg-door" class="form-control form-control-sm mb-1" value="1">
                <label class="x-small fw-bold">Delay (sec)</label><input type="number" id="dbg-delay" class="form-control form-control-sm mb-1" value="5">
                <label class="x-small fw-bold">Mode</label><select id="dbg-mode" class="form-select form-select-sm"><option value="controlled">controlled</option><option value="normally open">normally open</option><option value="normally closed">normally closed</option></select>`;
        } else if (cmd === 'getCard') {
            p.innerHTML = '<label class="x-small fw-bold">Card Number</label><input type="number" id="dbg-card" class="form-control form-control-sm" required>';
        } else if (cmd === 'getCardByIndex') {
            p.innerHTML = '<label class="x-small fw-bold">Record Index</label><input type="number" id="dbg-index" class="form-control form-control-sm" required>';
        }
    };

    window.executeDebugCommand = async () => {
        const cmd = document.getElementById('debug-command').value;
        const ctrlId = document.getElementById('debug-controller').value;
        const consoleEl = document.getElementById('debug-console');
        if (!cmd) return alert('Select a command');

        const log = (msg, type = 'info') => {
            const time = new Date().toLocaleTimeString();
            const color = type === 'error' ? '#ff4444' : (type === 'sent' ? '#44aaff' : '#00ff00');
            consoleEl.innerHTML += `<div style="color:${color}">[${time}] ${msg}</div>`;
            consoleEl.scrollTop = consoleEl.scrollHeight;
        };

        let url = `/api/${cmd}`;
        let method = 'GET';
        let body = null;

        if (cmd === 'getDevices') {
            url = '/api/getDevices';
        } else if (['getDevice', 'getStatus', 'getTime', 'getCards'].includes(cmd)) {
            if (!ctrlId) return alert('Select a controller');
            url = `/api/${cmd}/${ctrlId}`;
        } else if (cmd === 'openDoor') {
            if (!ctrlId) return alert('Select a controller');
            method = 'POST';
            body = { deviceId: ctrlId, door: document.getElementById('dbg-door').value };
        } else if (cmd === 'getDoorControl') {
            if (!ctrlId) return alert('Select a controller');
            url = `/api/getDoorControl/${ctrlId}/${document.getElementById('dbg-door').value}`;
        } else if (cmd === 'setDoorControl') {
            if (!ctrlId) return alert('Select a controller');
            method = 'POST';
            body = { deviceId: ctrlId, door: document.getElementById('dbg-door').value, delay: document.getElementById('dbg-delay').value, control: document.getElementById('dbg-mode').value };
        } else if (cmd === 'getCard') {
            if (!ctrlId) return alert('Select a controller');
            url = `/api/getCard/${ctrlId}/${document.getElementById('dbg-card').value}`;
        } else if (cmd === 'getCardByIndex') {
            if (!ctrlId) return alert('Select a controller');
            url = `/api/getCardByIndex/${ctrlId}/${document.getElementById('dbg-index').value}`;
        }

        log(`SENDING: ${method} ${url} ${body ? JSON.stringify(body) : ''}`, 'sent');
        try {
            const res = await api(url, method, body);
            log(`RECEIVED: ${JSON.stringify(res, null, 2)}`);
        } catch (e) {
            log(`ERROR: ${e.message}`, 'error');
        }
    };

    // Settings
    const refreshSettings = async () => {
        state.config = await api('/api/getConfig');
        const f = document.getElementById('form-settings');
        if (!f) return;
        f.bind.value = state.config.bind; f.broadcast.value = state.config.broadcast; f.listen.value = state.config.listen; f.timeout.value = state.config.timeout; f.debug.checked = !!state.config.debug;
    };
    window.saveSettings = async (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); d.debug = e.target.debug.checked; await api('/api/setConfig', 'POST', d); alert('Saved'); };

    setInterval(async () => {
        try {
            const res = await fetch('/api/liveEvents');
            const evs = await res.json();
            if (evs.length !== state.liveEvents.length) {
                state.liveEvents = evs;
                const stat = document.getElementById('stat-events');
                if (stat) stat.textContent = evs.length;
                const log = document.getElementById('events-log');
                if (log) log.innerHTML = evs.slice(-20).reverse().map(e => `<div>[${e.timestamp}] <span class="text-info">CTRL ${e.deviceId}:</span> ${e.granted?'GRANTED':'DENIED'} (${getText(e.eventType||e.type)})</div>`).join('');
            }
        } catch(e){}
    }, 2000);

    refreshDash();
});
