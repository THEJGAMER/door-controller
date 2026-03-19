document.addEventListener('DOMContentLoaded', () => {
    console.log('Door Control App v38 (Abort Controllers) Initialized');

    let groupSelect = null;
    let liveStatusTimer = null;
    let currentAbortController = null;

    const state = {
        config: { controllers: [] },
        liveEvents: [],
        selectedId: null
    };

    const api = async (p, m = 'GET', b = null) => {
        const signal = currentAbortController ? currentAbortController.signal : null;
        try {
            const r = await fetch(p, { 
                method: m, 
                headers: { 'Content-Type': 'application/json' }, 
                body: b ? JSON.stringify(b) : null,
                signal
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || `Server error ${r.status}`);
            return d;
        } catch (e) {
            if (e.name === 'AbortError') {
                console.log(`Fetch Aborted: ${p}`);
                return { aborted: true };
            }
            console.error(`API Error [${m} ${p}]:`, e);
            throw e;
        }
    };

    const showLoader = s => { const el = document.getElementById('loader'); if (el) el.style.display = s ? 'flex' : 'none'; };

    const getText = (val) => {
        if (!val) return '';
        let t = val;
        if (typeof val === 'object') t = val.state || val.event || val.reason || val.value || JSON.stringify(val);
        return String(t).replace(/[{}]/g, '');
    };

    window.updateActiveControllerUI = (event) => {};

    const initTomSelect = (groups = []) => {
        const el = document.getElementById('select-provision-groups');
        if (!el) return;
        if (groupSelect) {
            groupSelect.clearOptions();
            groupSelect.addOptions(groups.map(g => ({ value: g.id, text: g.name })));
            groupSelect.refreshItems();
            return;
        }
        if (typeof TomSelect === 'undefined') return;
        groupSelect = new TomSelect('#select-provision-groups', {
            plugins: ['remove_button'], valueField: 'value', labelField: 'text', searchField: 'text',
            options: groups.map(g => ({ value: g.id, text: g.name })), create: false
        });
    };

    // Navigation
    document.querySelectorAll('#sidebar .nav-link[data-tab]').forEach(l => {
        l.onclick = async (e) => {
            e.preventDefault();
            const t = l.dataset.tab;

            if (currentAbortController) {
                currentAbortController.abort();
                console.log('Stopping background sync tasks...');
            }
            currentAbortController = new AbortController();

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
            if (t === 'events') await refreshEvents();
            if (t === 'debug') await refreshDebug();
            if (t === 'settings') await refreshSettings();
        } catch (e) { 
            if (e.name !== 'AbortError') alert(`Error loading ${t}: ` + e.message); 
        } finally { showLoader(false); }
    };

    const refreshDash = async () => {
        const res = await api('/api/getConfig');
        if (res.aborted) return;
        state.config = res;
        const el = document.getElementById('stat-controllers');
        if (el) el.textContent = state.config.controllers.length;
    };

    window.refreshControllers = async (scan = false) => {
        showLoader(true);
        let discovered = [];
        if (scan) {
            const dRes = await api('/api/getDevices');
            if (dRes.aborted) return;
            discovered = dRes;
        }
        const cRes = await api('/api/getConfig');
        if (cRes.aborted) return;
        state.config = cRes;
        
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
            if (d.configured && d.offline) api(`/api/testController/${d.deviceId}`).then((res) => { 
                if (res && res.aborted) return;
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
        modalEl.querySelectorAll('input[name="deviceId"]').forEach(inp => inp.value = id);
        
        document.getElementById('det-time').textContent = '...';
        const dl = document.getElementById('det-doors-list'); 
        if (dl) {
            dl.innerHTML = '';
            for (let i=1; i<=(c.doorCount||4); i++) {
                const div = document.createElement('div'); div.className='col-md-6 mb-3';
                div.innerHTML = `
                    <div class="card p-3 border shadow-sm">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <h6 class="mb-0">Door ${i}</h6>
                            <div id="door-status-badges-${id}-${i}"><span class="badge bg-secondary mb-1">...</span></div>
                        </div>
                        <div class="mb-2"><label class="x-small fw-bold text-muted">Delay (sec)</label><input type="number" id="delay-${id}-${i}" class="form-control form-control-sm" value="5"></div>
                        <div class="mb-3"><label class="x-small fw-bold text-muted">Mode</label><select id="mode-${id}-${i}" class="form-select form-select-sm"><option value="controlled">controlled</option><option value="normally open">normally open</option><option value="normally closed">normally closed</option></select></div>
                        <div class="btn-group btn-group-sm w-100"><button class="btn btn-success" onclick="window.saveDoor(${id},${i})">Save</button><button class="btn btn-warning" onclick="window.openDoor(${id},${i})">Unlock</button><button class="btn btn-info" onclick="window.checkDoor(${id},${i})">Config</button></div>
                    </div>`;
                dl.appendChild(div);
            }
        }
        
        new bootstrap.Modal(modalEl).show();
        
        const updateDoorUI = (door, doorOpen, relayActive) => {
            const badgeContainer = document.getElementById(`door-status-badges-${id}-${door}`);
            if (!badgeContainer) return;
            badgeContainer.innerHTML = `
                <span class="badge ${relayActive ? 'bg-danger' : 'bg-success'} d-block mb-1">${relayActive ? 'UNLOCKED' : 'LOCKED'}</span>
                <span class="badge ${doorOpen ? 'bg-warning text-dark' : 'bg-info'} d-block">${doorOpen ? 'OPEN' : 'CLOSED'}</span>
            `;
        };

        window.updateActiveControllerUI = (ev) => {
            if (ev.deviceId == id) {
                if (ev.doorStates && ev.relayStates) {
                    for (let i=1; i<=(c.doorCount||4); i++) { updateDoorUI(i, ev.doorStates[i], ev.relayStates[i]); }
                } else if (ev.door) {
                    const relay = (ev.eventType === 'door' || ev.type === 'door') ? ev.granted : undefined;
                    updateDoorUI(ev.door, ev.doorOpen, relay !== undefined ? relay : false);
                }
            }
        };

        const pollStatus = async () => {
            if (!modalEl.classList.contains('show')) { clearInterval(liveStatusTimer); return; }
            try {
                const r = await api(`/api/getStatus/${id}`);
                if (r.aborted) return;
                const s = r.state || {};
                for (let i=1; i<=(c.doorCount||4); i++) { updateDoorUI(i, s.doors ? s.doors[i] : false, s.relays && s.relays.relays ? s.relays.relays[i] : false); }
            } catch (e) {}
        };

        pollStatus(); 
        if (liveStatusTimer) clearInterval(liveStatusTimer);
        liveStatusTimer = setInterval(pollStatus, 5000);

        api(`/api/getTime/${id}`).then(d => { 
            if (d && d.aborted) return;
            if (document.getElementById('det-time')) document.getElementById('det-time').textContent = d.datetime; 
        }).catch(() => {});
        window.fetchListener();

        for (let i=1; i<=(c.doorCount||4); i++) { window.checkDoor(id, i); }
    };

    window.saveDoor = async (id, door) => {
        const delay = document.getElementById(`delay-${id}-${door}`).value;
        const control = document.getElementById(`mode-${id}-${door}`).value;
        try { await api('/api/setDoorControl', 'POST', { deviceId: id, door, control, delay }); alert('Settings updated'); } catch (e) { alert('Update failed: ' + e.message); }
    };

    window.checkDoor = async (id, door) => { 
        try {
            const r = await api(`/api/getDoorControl/${id}/${door}`); 
            if (r.aborted) return;
            const s = r.doorControlState || {};
            const ctrlText = getText(s.control);
            if (document.getElementById(`delay-${id}-${door}`)) document.getElementById(`delay-${id}-${door}`).value = s.delay;
            const sel = document.getElementById(`mode-${id}-${door}`);
            if (sel) { for (let opt of sel.options) { if (opt.value === ctrlText || ctrlText.toLowerCase().includes(opt.value)) { sel.value = opt.value; break; } } }
        } catch (e) {}
    };

    window.openDoor = async (id, d) => { if (confirm(`Unlock Door ${d}?`)) await api('/api/openDoor', 'POST', { deviceId: id, door: d }); };
    window.quickAdd = async (id, a) => { await api('/api/addDevice', 'POST', { deviceId: id, address: a }); window.refreshControllers(); };
    window.removeCtrl = async (id) => { if (confirm('Remove?')) { await api('/api/removeDevice', 'POST', { deviceId: id }); window.refreshControllers(); } };
    window.updateCtrlMeta = async (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); d.forceBroadcast = e.target.forceBroadcast.checked; await api('/api/updateController', 'POST', d); alert('Saved'); window.refreshControllers(); };
    window.syncTime = async () => { try { await api('/api/setTime', 'POST', { deviceId: state.selectedId, datetime: new Date().toISOString() }); alert('Synced'); } catch(e){ alert(e.message); } };
    window.setHardwareIP = async (e) => { 
        e.preventDefault(); const fd = new FormData(e.target); const d = Object.fromEntries(fd); d.deviceId = d.deviceId || state.selectedId;
        if (!d.deviceId || d.deviceId == '0') return alert('Invalid Controller ID');
        try { await api('/api/setIP', 'POST', d); alert('Hardware IP reconfiguration command sent'); } catch (e) { alert('Failed: ' + e.message); }
    };
    window.setListenerIP = async (e) => { 
        e.preventDefault(); const fd = new FormData(e.target); const d = Object.fromEntries(fd); d.deviceId = d.deviceId || state.selectedId; 
        if (!d.deviceId || d.deviceId == '0') return alert('Invalid Controller ID');
        try { await api('/api/setListener', 'POST', d); alert('Listener configuration updated on hardware'); window.fetchListener(); } catch (e) { alert('Failed to update listener: ' + e.message); }
    };
    window.fetchListener = async () => { 
        const el = document.getElementById('det-listener'); 
        let id = state.selectedId; if (!id) { const idInp = document.querySelector('#modal-controller-details input[name="deviceId"]'); if (idInp) id = idInp.value; }
        if (!el || !id) return;
        el.textContent = 'Loading...';
        try { const d = await api(`/api/getListener/${id}`); if (d.aborted) return; el.textContent = `${d.address}:${d.port}`; } catch (e) { el.textContent = 'Error'; } 
    };
    window.toggleSpec = async () => { await api('/api/recordSpecialEvents', 'POST', { deviceId: state.selectedId, enabled: true }); alert('Enabled'); };
    window.factoryReset = async () => { if (confirm('WIPE?')) await api('/api/restoreDefaultParameters', 'POST', { deviceId: state.selectedId }); };

    // Cards
    const refreshCards = async () => {
        const res = await api('/api/getConfig');
        if (res.aborted) return;
        state.config = res;
        const s = document.getElementById('select-card-controller');
        if (!s) return;
        s.innerHTML = '<option value="">Select...</option>';
        state.config.controllers.forEach(c => s.add(new Option(`${c.name}(${c.deviceId})`, c.deviceId)));
    };
    window.onCardControllerChange = async (id) => {
        state.selectedId = id;
        if (document.getElementById('btn-add-card')) document.getElementById('btn-add-card').disabled = !id;
        const tbody = document.getElementById('table-cards');
        if (!tbody) return;
        tbody.innerHTML = id ? '<tr><td colspan="6" class="text-center">Loading...</td></tr>' : '';
        if (!id) return;
        try {
            const res = await api(`/api/getCards/${id}`);
            if (res.aborted) return;
            if (document.getElementById('stat-cards')) document.getElementById('stat-cards').textContent = res.cards;
            tbody.innerHTML = '';
            for (let i=1; i<=Math.min(res.cards, 50); i++) {
                try {
                    const data = await api(`/api/getCardByIndex/${id}/${i}`);
                    if (data.aborted) return;
                    const c = data.card;
                    const tr = document.createElement('tr');
                    tr.innerHTML = `<td>${c.number}</td><td>${c.valid.from}</td><td>${c.valid.to}</td><td>${c.doors[1]},${c.doors[2]},${c.doors[3]},${c.doors[4]}</td><td>${c.PIN}</td><td><button class="btn btn-sm btn-danger" onclick="window.delCard(${id},${c.number})">Del</button></td>`;
                    tbody.appendChild(tr);
                } catch(e){}
            }
        } catch(e) { tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger">Failed to load</td></tr>'; }
    };
    window.delCard = async (id, n) => { if (confirm(`Delete ${n}?`)) { await api('/api/deleteCard', 'POST', { deviceId: id, cardNumber: n }); window.onCardControllerChange(id); } };
    window.openAddCardModal = () => { const el = document.getElementById('modal-card'); if (el) bootstrap.Modal.getOrCreateInstance(el).show(); };
    window.saveCard = async (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); d.deviceId = state.selectedId; await api('/api/putCard', 'POST', d); bootstrap.Modal.getOrCreateInstance(e.target.closest('.modal')).hide(); window.onCardControllerChange(state.selectedId); };

    // Door Groups
    const refreshDoorGroups = async () => {
        const groups = await api('/api/doorGroups');
        if (groups.aborted) return;
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
        if (list.aborted) return;
        const tbody = document.getElementById('table-assignments');
        if (!tbody) return;
        tbody.innerHTML = '';
        list.forEach(a => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${a.cardNumber}</td><td>${a.groupName}</td><td>${a.validFrom} to ${a.validTo}</td><td><div class="btn-group btn-group-sm"><button class="btn btn-outline-primary" onclick="window.editAssignment('${a.cardNumber}', ${a.groupId}, ${a.pin})"><i class="bi bi-pencil"></i> Edit</button><button class="btn btn-outline-danger" onclick="window.removeAssignment(${a.cardNumber}, ${a.groupId})"><i class="bi bi-person-x"></i> Deprovision</button></div></td>`;
            tbody.appendChild(tr);
        });
    };

    window.editAssignment = (cardNumber, groupId, pin) => {
        if (document.getElementById('provision-card-header')) document.getElementById('provision-card-header').textContent = 'Update Site Assignment';
        document.getElementById('prov-card-number').value = cardNumber; document.getElementById('prov-pin').value = pin;
        if (groupSelect) groupSelect.setValue([groupId]);
        if (document.getElementById('btn-prov-submit')) document.getElementById('btn-prov-submit').textContent = 'Update Provisioning';
        if (document.getElementById('btn-prov-cancel')) document.getElementById('btn-prov-cancel').style.display = 'block';
        window.scrollTo({ top: document.getElementById('form-provision').offsetTop - 100, behavior: 'smooth' });
    };

    window.cancelProvEdit = () => {
        if (document.getElementById('provision-card-header')) document.getElementById('provision-card-header').textContent = 'Provision Card to Site(s)';
        if (document.getElementById('form-provision')) document.getElementById('form-provision').reset();
        if (groupSelect) groupSelect.clear();
        if (document.getElementById('btn-prov-submit')) document.getElementById('btn-prov-submit').textContent = 'Provision Site';
        if (document.getElementById('btn-prov-cancel')) document.getElementById('btn-prov-cancel').style.display = 'none';
    };

    window.removeAssignment = async (cardNumber, groupId) => {
        if (confirm(`Remove access for card ${cardNumber}?`)) { showLoader(true); try { await api('/api/deprovisionCard', 'POST', { cardNumber, groupId }); await refreshDoorGroups(); } finally { showLoader(false); } }
    };

    window.openAddGroupModal = async () => {
        const res = await api('/api/getConfig');
        if (res.aborted) return;
        state.config = res;
        const container = document.getElementById('group-door-selector');
        if (!container) return;
        container.innerHTML = '';
        state.config.controllers.forEach(c => {
            const col = document.createElement('div'); col.className = 'col-md-4 mb-3';
            let doorChecks = '';
            for (let i=1; i<=(c.doorCount||4); i++) { doorChecks += `<div class="form-check"><input class="form-check-input group-member-check" type="checkbox" data-dev="${c.deviceId}" data-door="${i}" id="chk-${c.deviceId}-${i}"><label class="form-check-label" for="chk-${c.deviceId}-${i}">Door ${i}</label></div>`; }
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
        document.querySelectorAll('.group-member-check:checked').forEach(chk => { members.push({ deviceId: chk.dataset.dev, door: chk.dataset.door }); });
        if (members.length === 0) return alert('Select at least one door');
        try { await api('/api/doorGroups', 'POST', { name, members }); bootstrap.Modal.getOrCreateInstance(e.target.closest('.modal')).hide(); await refreshDoorGroups(); } catch(e){ alert(e.message); }
    };

    window.removeGroup = async (id) => { if (confirm('Delete Group?')) { await api(`/api/doorGroups/${id}`, 'DELETE'); await refreshDoorGroups(); } };

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
            if (res.aborted) return;
            let html = '<h6>Results:</h6><ul class="list-group">';
            res.results.forEach(r => { html += `<li class="list-group-item d-flex justify-content-between small">Group ${r.groupId} | CTRL ${r.deviceId}: ${r.success ? '<span class="text-success">SUCCESS</span>' : '<span class="text-danger">FAILED ('+r.error+')</span>'}</li>`; });
            html += '</ul>';
            resEl.innerHTML = html;
            await refreshAssignments();
            if (document.getElementById('btn-prov-cancel') && document.getElementById('btn-prov-cancel').style.display === 'block') window.cancelProvEdit();
        } catch (e) { resEl.innerHTML = `<div class="alert alert-danger">Error: ${e.message}</div>`; }
    };

    // Events
    const refreshEvents = async () => {
        const s = document.getElementById('select-event-controller');
        if (!s) return;
        s.innerHTML = '<option value="all">All Controllers</option>';
        const cRes = await api('/api/getConfig');
        if (cRes.aborted) return;
        state.config = cRes;
        state.config.controllers.forEach(c => s.add(new Option(c.name || `CTRL ${c.deviceId}`, c.deviceId)));
        const hist = await api('/api/eventHistory');
        if (hist.aborted) return;
        renderHistory(hist);
        window.fetchControllerHistory();
    };
    const renderHistory = (h) => {
        const tbody = document.getElementById('table-events-history'); 
        if (!tbody) return;
        tbody.innerHTML = '';
        const sorted = h.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
        sorted.forEach(ev => {
            const tr = document.createElement('tr');
            const rawType = getText(ev.eventType || ev.type);
            const rawReason = getText(ev.reason).toLowerCase();
            let classification = 'Sensor';
            let badgeClass = 'bg-secondary';
            let icon = 'bi-door-closed';
            const isSwipe = rawType.toLowerCase().includes('swipe') || (ev.cardNumber > 100) || rawReason.includes('card');
            if (isSwipe) { classification = 'Swipe'; badgeClass = ev.granted ? 'bg-success' : 'bg-danger'; icon = 'bi-person-vcard'; } else { classification = 'Sensor'; badgeClass = 'bg-info'; icon = 'bi-broadcast'; }
            let resultHtml = `<span class="badge ${ev.granted?'bg-success':'bg-danger'} shadow-sm">${ev.granted?'GRANTED':'DENIED'}</span>`;
            if (classification === 'Sensor') {
                const isLock = rawReason.includes('lock') || rawReason.includes('relay') || rawReason.includes('unlocked');
                const isOpen = rawReason.includes('opened') || rawReason.includes('open');
                const isClosed = rawReason.includes('closed');
                if (isLock) { resultHtml = `<span class="badge ${ev.granted || rawReason.includes('unlocked') ? 'bg-danger' : 'bg-success'} shadow-sm">${(ev.granted || rawReason.includes('unlocked')) ? 'UNLOCKED' : 'LOCKED'}</span>`; } else if (isOpen) { resultHtml = `<span class="badge bg-warning text-dark shadow-sm">OPEN</span>`; } else if (isClosed) { resultHtml = `<span class="badge bg-info shadow-sm">CLOSED</span>`; }
            }
            const cleanReason = getText(ev.reason).replace(/[{}]/g, '').toUpperCase();
            const reasonCode = (ev.reason && ev.reason.code) ? ev.reason.code : (ev.type && ev.type.code ? ev.type.code : '-');
            tr.innerHTML = `<td><small class="text-muted fw-bold">${ev.timestamp}</small></td><td><div class="d-flex align-items-center"><span class="badge ${badgeClass} me-2"><i class="bi ${icon} me-1"></i> ${classification}</span><span class="badge bg-dark-subtle text-muted border" style="font-size:0.6rem">CODE ${reasonCode}</span></div><small class="text-secondary d-block mt-1" style="font-size:0.7rem">${rawType}</small></td><td><span class="font-monospace">${ev.cardNumber || '-'}</span></td><td><span class="badge bg-light text-dark border">D${ev.door}</span> <small class="text-muted">ID:${ev.deviceId}</small></td><td><div class="d-flex flex-column align-items-start">${resultHtml}<small class="text-uppercase fw-bold text-muted mt-1" style="font-size:0.65rem"><i class="bi bi-info-circle me-1"></i>${cleanReason}</small></div></td>`;
            tbody.appendChild(tr);
        });
    };
    window.fetchControllerHistory = async () => {
        const val = document.getElementById('select-event-controller').value;
        showLoader(true);
        try {
            const targets = val === 'all' ? state.config.controllers.map(c => c.deviceId) : [val];
            let allNewLogs = [];
            for (const id of targets) {
                try {
                    const meta = await api(`/api/getEvents/${id}`);
                    if (meta.aborted) return;
                    for (let i=meta.last; i>=Math.max(meta.first, meta.last-20); i--) {
                        try { 
                            const res = await api(`/api/getEvent/${id}/${i}`); 
                            if (res.aborted) return;
                            const e = res.event;
                            allNewLogs.push({ deviceId: id, timestamp: e.timestamp, eventType: e.type, cardNumber: e.card, door: e.door, granted: e.granted, reason: e.reason }); 
                        } catch (ex){}
                    }
                } catch (err) {}
            }
            if (allNewLogs.length > 0) { 
                const save = await api('/api/saveEvents', 'POST', allNewLogs); 
                if (save && save.aborted) return;
                const hist = await api('/api/eventHistory');
                if (hist.aborted) return;
                renderHistory(hist);
            }
        } finally { showLoader(false); }
    };

    // Debug
    const refreshDebug = async () => {
        const res = await api('/api/getConfig');
        if (res.aborted) return;
        state.config = res;
        const s = document.getElementById('debug-controller');
        if (!s) return;
        s.innerHTML = '<option value="">(Network Broadcast)</option>';
        state.config.controllers.forEach(c => s.add(new Option(`${c.name || 'Unnamed'} (${c.deviceId})`, c.deviceId)));
    };

    window.onDebugCommandChange = (cmd) => {
        const p = document.getElementById('debug-params');
        p.innerHTML = '';
        if (cmd === 'getDevice' || cmd === 'getStatus' || cmd === 'getTime' || cmd === 'getCards') {
        } else if (cmd === 'openDoor' || cmd === 'getDoorControl') {
            p.innerHTML = '<label class="x-small fw-bold">Door (1-4)</label><input type="number" id="dbg-door" class="form-control form-control-sm" value="1">';
        } else if (cmd === 'setDoorControl') {
            p.innerHTML = `<label class="x-small fw-bold">Door (1-4)</label><input type="number" id="dbg-door" class="form-control form-control-sm mb-1" value="1"><label class="x-small fw-bold">Delay (sec)</label><input type="number" id="dbg-delay" class="form-control form-control-sm mb-1" value="5"><label class="x-small fw-bold">Mode</label><select id="dbg-mode" class="form-select form-select-sm"><option value="controlled">controlled</option><option value="normally open">normally open</option><option value="normally closed">normally closed</option></select>`;
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
        const log = (msg, type = 'info') => { const time = new Date().toLocaleTimeString(); const color = type === 'error' ? '#ff4444' : (type === 'sent' ? '#44aaff' : '#00ff00'); consoleEl.innerHTML += `<div style="color:${color}">[${time}] ${msg}</div>`; consoleEl.scrollTop = consoleEl.scrollHeight; };
        let url = `/api/${cmd}`; let method = 'GET'; let body = null;
        if (cmd === 'getDevices') { url = '/api/getDevices'; } else if (['getDevice', 'getStatus', 'getTime', 'getCards'].includes(cmd)) { if (!ctrlId) return alert('Select a controller'); url = `/api/${cmd}/${ctrlId}`; } else if (cmd === 'openDoor') { if (!ctrlId) return alert('Select a controller'); method = 'POST'; body = { deviceId: ctrlId, door: document.getElementById('dbg-door').value }; } else if (cmd === 'getDoorControl') { if (!ctrlId) return alert('Select a controller'); url = `/api/getDoorControl/${ctrlId}/${document.getElementById('dbg-door').value}`; } else if (cmd === 'setDoorControl') { if (!ctrlId) return alert('Select a controller'); method = 'POST'; body = { deviceId: ctrlId, door: document.getElementById('dbg-door').value, delay: document.getElementById('dbg-delay').value, control: document.getElementById('dbg-mode').value }; } else if (cmd === 'getCard') { if (!ctrlId) return alert('Select a controller'); url = `/api/getCard/${ctrlId}/${document.getElementById('dbg-card').value}`; } else if (cmd === 'getCardByIndex') { if (!ctrlId) return alert('Select a controller'); url = `/api/getCardByIndex/${ctrlId}/${document.getElementById('dbg-index').value}`; }
        log(`SENDING: ${method} ${url} ${body ? JSON.stringify(body) : ''}`, 'sent');
        try { const res = await api(url, method, body); if (res && res.aborted) return; log(`RECEIVED: ${JSON.stringify(res, null, 2)}`); } catch (e) { log(`ERROR: ${e.message}`, 'error'); }
    };

    // Settings
    const refreshSettings = async () => {
        const res = await api('/api/getConfig');
        if (res.aborted) return;
        state.config = res;
        const f = document.getElementById('form-settings');
        if (!f) return;
        f.bind.value = state.config.bind; f.broadcast.value = state.config.broadcast; f.listen.value = state.config.listen; f.timeout.value = state.config.timeout; f.debug.checked = !!state.config.debug;
    };
    window.saveSettings = async (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); d.debug = e.target.debug.checked; await api('/api/setConfig', 'POST', d); alert('Saved'); };

    // Theme Management
    const themeToggle = document.getElementById('theme-toggle');
    const setTheme = (isDark) => {
        document.documentElement.setAttribute('data-bs-theme', isDark ? 'dark' : 'light');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
        if (themeToggle) themeToggle.checked = isDark;
    };
    if (themeToggle) themeToggle.onchange = (e) => setTheme(e.target.checked);
    const savedTheme = localStorage.getItem('theme') || 'light';
    setTheme(savedTheme === 'dark');

    setInterval(async () => {
        try {
            const res = await fetch('/api/liveEvents');
            const evs = await res.json();
            if (evs.length !== state.liveEvents.length) {
                state.liveEvents = evs;
                if (document.getElementById('stat-events')) document.getElementById('stat-events').textContent = evs.length;
                const log = document.getElementById('events-log'); if (log) log.innerHTML = evs.slice(-20).reverse().map(e => `<div>[${e.timestamp}] <span class="text-info">CTRL ${e.deviceId}:</span> ${e.granted?'GRANTED':'DENIED'} (${getText(e.eventType||e.type)}) Door ${e.door||'-'}</div>`).join('');
                const lastEv = evs[evs.length - 1];
                window.updateActiveControllerUI(lastEv);
            }
        } catch(e){}
    }, 2000);

    refreshDash();
});
