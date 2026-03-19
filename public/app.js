document.addEventListener('DOMContentLoaded', () => {
    console.log('Door Control App v11 Initialized');

    const state = {
        config: { controllers: [] },
        liveEvents: [],
        selectedId: null
    };

    const api = async (p, m = 'GET', b = null) => {
        const r = await fetch(p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : null });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Server error');
        return d;
    };

    const showLoader = s => document.getElementById('loader').style.display = s ? 'flex' : 'none';

    // Navigation
    document.querySelectorAll('#sidebar .nav-link[data-tab]').forEach(l => {
        l.onclick = async (e) => {
            e.preventDefault();
            const t = l.dataset.tab;
            document.querySelectorAll('#sidebar .nav-link').forEach(nav => nav.classList.remove('active'));
            l.classList.add('active');
            document.getElementById('view-title').textContent = t.charAt(0).toUpperCase() + t.slice(1);
            document.querySelectorAll('.tab-pane-content').forEach(p => p.classList.add('d-none'));
            document.getElementById(`tab-${t}`).classList.remove('d-none');
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
            if (t === 'events') await refreshEvents();
            if (t === 'settings') await refreshSettings();
        } finally { showLoader(false); }
    };

    const refreshDash = async () => {
        state.config = await api('/api/getConfig');
        document.getElementById('stat-controllers').textContent = state.config.controllers.length;
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
        tbody.innerHTML = '';
        map.forEach(d => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${d.name||'Unnamed'}</td><td>${d.deviceId}</td><td>${d.address||'Auto'}</td><td>${d.doorCount||4}</td><td><span class="badge ${d.offline?'bg-secondary':'bg-success'}" id="status-${d.deviceId}">${d.offline?'Offline':'Online'}</span></td><td><div class="btn-group btn-group-sm"><button class="btn btn-primary" onclick="window.openDetails(${d.deviceId})">Details</button><button class="btn btn-warning" onclick="window.openDoor(${d.deviceId},1)">Unlock</button>${!d.configured?`<button class="btn btn-success" onclick="window.quickAdd(${d.deviceId},'${d.address}')">Add</button>`:`<button class="btn btn-danger" onclick="window.removeCtrl(${d.deviceId})">Del</button>`}</div></td>`;
            tbody.appendChild(tr);
            if (d.configured && d.offline) api(`/api/testController/${d.deviceId}`).then(() => { 
                d.offline = false; 
                const b = document.getElementById(`status-${d.deviceId}`);
                if (b) { b.className = 'badge bg-success'; b.textContent = 'Online'; }
            }).catch(()=>{});
        });
        showLoader(false);
    };

    window.openDetails = async (id) => {
        state.selectedId = id;
        const c = state.config.controllers.find(x => x.deviceId == id) || { deviceId: id, name: 'New', doorCount: 4, address: '' };
        document.getElementById('details-title').textContent = `${c.name} (${id})`;
        const f = document.getElementById('form-det-gen');
        f.deviceId.value = id; f.name.value = c.name || ''; f.address.value = c.address || ''; f.doorCount.value = c.doorCount || 4; f.forceBroadcast.checked = !!c.forceBroadcast;
        document.getElementById('det-time').textContent = '...';
        const dl = document.getElementById('det-doors-list'); dl.innerHTML = '';
        for (let i=1; i<=(c.doorCount||4); i++) {
            const div = document.createElement('div'); div.className='col-md-6 mb-3';
            div.innerHTML = `
                <div class="card p-3 border">
                    <h6>Door ${i}</h6>
                    <div class="mb-2">
                        <label class="small fw-bold">Delay (sec)</label>
                        <input type="number" id="delay-${id}-${i}" class="form-control form-control-sm" value="5">
                    </div>
                    <div class="mb-2">
                        <label class="small fw-bold">Mode</label>
                        <select id="mode-${id}-${i}" class="form-select form-select-sm">
                            <option value="controlled">Controlled</option>
                            <option value="normally open">Normally Open</option>
                            <option value="normally closed">Normally Closed</option>
                        </select>
                    </div>
                    <div class="btn-group btn-group-sm w-100">
                        <button class="btn btn-success" onclick="window.saveDoor(${id},${i})">Save</button>
                        <button class="btn btn-warning" onclick="window.openDoor(${id},${i})">Unlock</button>
                        <button class="btn btn-info" onclick="window.checkDoor(${id},${i})">Check</button>
                    </div>
                    <div id="dinfo-${id}-${i}" class="mt-2 small text-muted"></div>
                </div>`;
            dl.appendChild(div);
        }
        new bootstrap.Modal(document.getElementById('modal-controller-details')).show();
        api(`/api/getTime/${id}`).then(d => document.getElementById('det-time').textContent = d.datetime).catch(()=>document.getElementById('det-time').textContent='Offline');
    };

    window.saveDoor = async (id, door) => {
        const delay = document.getElementById(`delay-${id}-${door}`).value;
        const control = document.getElementById(`mode-${id}-${door}`).value;
        try {
            await api('/api/setDoorControl', 'POST', { deviceId: id, door, control, delay });
            alert('Settings updated');
        } catch (e) { alert('Update failed: ' + e.message); }
    };

    const getText = (val) => {
        if (!val) return '';
        let t = val;
        if (typeof val === 'object') t = val.state || val.event || val.value || JSON.stringify(val);
        return String(t).replace(/[{}]/g, '');
    };

    window.checkDoor = async (id, door) => { 
        try {
            const r = await api(`/api/getDoorControl/${id}/${door}`); 
            const s = r.doorControlState || {};
            const ctrlText = getText(s.control);
            
            document.getElementById(`dinfo-${id}-${door}`).textContent = `Current: ${s.delay}s, ${ctrlText}`; 
            document.getElementById(`delay-${id}-${door}`).value = s.delay;
            
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
    window.syncTime = async () => { await api('/api/setTime', 'POST', { deviceId: state.selectedId, datetime: new Date().toISOString() }); alert('Synced'); };
    window.setHardwareIP = async (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); d.deviceId = state.selectedId; await api('/api/setIP', 'POST', d); alert('Request sent'); };
    window.setListenerIP = async (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); d.deviceId = state.selectedId; await api('/api/setListener', 'POST', d); alert('Request sent'); };
    window.toggleSpec = async () => { await api('/api/recordSpecialEvents', 'POST', { deviceId: state.selectedId, enabled: true }); alert('Enabled'); };
    window.factoryReset = async () => { if (confirm('WIPE?')) await api('/api/restoreDefaultParameters', 'POST', { deviceId: state.selectedId }); };

    // Cards
    const refreshCards = async () => {
        state.config = await api('/api/getConfig');
        const s = document.getElementById('select-card-controller');
        s.innerHTML = '<option value="">Select...</option>';
        state.config.controllers.forEach(c => s.add(new Option(`${c.name}(${c.deviceId})`, c.deviceId)));
    };
    window.onCardControllerChange = async (id) => {
        state.selectedId = id;
        document.getElementById('btn-add-card').disabled = !id;
        const tbody = document.getElementById('table-cards');
        tbody.innerHTML = id ? '<tr><td colspan="6" class="text-center">Loading...</td></tr>' : '';
        if (!id) return;
        try {
            const { cards: count } = await api(`/api/getCards/${id}`);
            document.getElementById('stat-cards').textContent = count;
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
    window.openAddCardModal = () => new bootstrap.Modal(document.getElementById('modal-card')).show();
    window.saveCard = async (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); d.deviceId = state.selectedId; await api('/api/putCard', 'POST', d); bootstrap.Modal.getInstance(e.target.closest('.modal')).hide(); window.onCardControllerChange(state.selectedId); };

    // Door Groups
    const refreshDoorGroups = async () => {
        const groups = await api('/api/doorGroups');
        const tbody = document.getElementById('table-door-groups');
        tbody.innerHTML = '';
        const select = document.getElementById('select-provision-group');
        select.innerHTML = '<option value="">Select Group...</option>';

        groups.forEach(g => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${g.name}</td><td>${g.members.length} Doors</td><td><button class="btn btn-sm btn-danger" onclick="window.removeGroup(${g.id})">Delete</button></td>`;
            tbody.appendChild(tr);
            select.add(new Option(g.name, g.id));
        });
    };

    window.openAddGroupModal = async () => {
        state.config = await api('/api/getConfig');
        const container = document.getElementById('group-door-selector');
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
        new bootstrap.Modal(document.getElementById('modal-add-group')).show();
    };

    window.saveDoorGroup = async (e) => {
        e.preventDefault();
        const name = e.target.name.value;
        const members = [];
        document.querySelectorAll('.group-member-check:checked').forEach(chk => {
            members.push({ deviceId: chk.dataset.dev, door: chk.dataset.door });
        });
        if (members.length === 0) return alert('Select at least one door');
        await api('/api/doorGroups', 'POST', { name, members });
        bootstrap.Modal.getInstance(e.target.closest('.modal')).hide();
        await refreshDoorGroups();
    };

    window.removeGroup = async (id) => {
        if (confirm('Delete Group?')) { await api(`/api/doorGroups/${id}`, 'DELETE'); await refreshDoorGroups(); }
    };

    window.provisionToGroup = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const data = Object.fromEntries(fd);
        data.from = "2024-01-01"; data.to = "2029-12-31"; // Default dates for simplicity
        const resEl = document.getElementById('provision-results');
        resEl.innerHTML = '<div class="alert alert-info">Provisioning site... please wait.</div>';
        try {
            const res = await api('/api/provisionCard', 'POST', data);
            let html = '<h6>Results:</h6><ul class="list-group">';
            res.results.forEach(r => {
                html += `<li class="list-group-item d-flex justify-content-between">CTRL ${r.deviceId}: ${r.success ? '<span class="text-success">SUCCESS</span>' : '<span class="text-danger">FAILED ('+r.error+')</span>'}</li>`;
            });
            html += '</ul>';
            resEl.innerHTML = html;
        } catch (e) { resEl.innerHTML = `<div class="alert alert-danger">Error: ${e.message}</div>`; }
    };

    // Events
    const refreshEvents = async () => {
        const s = document.getElementById('select-event-controller');
        s.innerHTML = '<option value="">Select...</option>';
        state.config.controllers.forEach(c => s.add(new Option(c.name, c.deviceId)));
        const hist = await api('/api/eventHistory');
        renderHistory(hist);
    };
    const renderHistory = (h) => {
        const tbody = document.getElementById('table-events-history'); tbody.innerHTML = '';
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

    // Settings
    const refreshSettings = async () => {
        state.config = await api('/api/getConfig');
        const f = document.getElementById('form-settings');
        f.bind.value = state.config.bind; f.broadcast.value = state.config.broadcast; f.listen.value = state.config.listen; f.timeout.value = state.config.timeout; f.debug.checked = !!state.config.debug;
    };
    window.saveSettings = async (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); d.debug = e.target.debug.checked; await api('/api/setConfig', 'POST', d); alert('Saved'); };

    setInterval(async () => {
        try {
            const res = await fetch('/api/liveEvents');
            const evs = await res.json();
            if (evs.length !== state.liveEvents.length) {
                state.liveEvents = evs;
                document.getElementById('stat-events').textContent = evs.length;
                document.getElementById('events-log').innerHTML = evs.slice(-20).reverse().map(e => `<div>[${e.timestamp}] <span class="text-info">CTRL ${e.deviceId}:</span> ${e.granted?'GRANTED':'DENIED'} (${getText(e.eventType||e.type)})</div>`).join('');
            }
        } catch(e){}
    }, 2000);

    refreshDash();
});
