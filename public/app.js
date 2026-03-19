document.addEventListener('DOMContentLoaded', () => {
    console.log('Door Control App v49 (Desktop & Mobile Fixed) Initialized');

    let groupSelect = null;
    let liveStatusTimer = null;
    let currentAbortController = null;

    const state = {
        config: { controllers: [] },
        liveEvents: [],
        selectedId: null
    };

    // Update Clock in Desktop Header
    const updateClock = () => {
        const now = new Date();
        const d = document.getElementById('current-date');
        const t = document.getElementById('current-time');
        if (d) d.textContent = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        if (t) t.textContent = now.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };
    setInterval(updateClock, 1000);
    updateClock();

    const api = async (path, method = 'GET', body = null) => {
        const signal = currentAbortController ? currentAbortController.signal : null;
        try {
            const options = { method, headers: { 'Content-Type': 'application/json' }, signal };
            if (body) options.body = JSON.stringify(body);
            const response = await fetch(path, options);
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || `Server Error: ${response.status}`);
            return data;
        } catch (err) {
            if (err.name === 'AbortError') return { aborted: true };
            console.error(`API Error [${path}]:`, err);
            throw err;
        }
    };

    const showLoader = (show) => {
        const el = document.getElementById('loader');
        if (el) el.style.display = show ? 'flex' : 'none';
    };

    const getText = (val) => {
        if (!val) return '';
        let t = val;
        if (typeof val === 'object') t = val.state || val.event || val.reason || val.value || JSON.stringify(val);
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
        if (typeof TomSelect === 'undefined') return;
        groupSelect = new TomSelect('#select-provision-groups', {
            plugins: ['remove_button'], valueField: 'value', labelField: 'text', searchField: 'text',
            options: groups.map(g => ({ value: g.id, text: g.name })), create: false
        });
    };

    const loadTab = async (tabId) => {
        showLoader(true);
        try {
            if (tabId === 'dashboard') await refreshDash();
            else if (tabId === 'controllers') await window.refreshControllers();
            else if (tabId === 'cards') await refreshCards();
            else if (tabId === 'door-groups') await refreshDoorGroups();
            else if (tabId === 'events') await refreshEvents();
            else if (tabId === 'debug') await refreshDebug();
            else if (tabId === 'settings') await refreshSettings();
        } catch (err) {
            if (err.name !== 'AbortError') console.error(`Failed to load ${tabId}:`, err);
        } finally {
            showLoader(false);
        }
    };

    document.querySelectorAll('[data-tab]').forEach(link => {
        link.addEventListener('click', async (e) => {
            e.preventDefault();
            const tabId = link.getAttribute('data-tab');
            if (currentAbortController) currentAbortController.abort();
            currentAbortController = new AbortController();

            document.querySelectorAll('.nav-link').forEach(nav => nav.classList.remove('active'));
            link.classList.add('active');

            const titleText = tabId.charAt(0).toUpperCase() + tabId.slice(1).replace('-', ' ');
            const vTitle = document.getElementById('view-title'); if (vTitle) vTitle.textContent = titleText;
            const mTitle = document.getElementById('mobile-title'); if (mTitle) mTitle.textContent = titleText;

            document.querySelectorAll('.tab-pane-content').forEach(pane => pane.classList.add('d-none'));
            const targetPane = document.getElementById(`tab-${tabId}`);
            if (targetPane) targetPane.classList.remove('d-none');

            const offcanvasWrapper = document.getElementById('sidebar-wrapper');
            if (offcanvasWrapper && window.innerWidth < 992) {
                const instance = bootstrap.Offcanvas.getInstance(offcanvasWrapper) || new bootstrap.Offcanvas(offcanvasWrapper);
                instance.hide();
            }
            await loadTab(tabId);
        });
    });

    const refreshDash = async () => {
        const config = await api('/api/getConfig'); if (config.aborted) return;
        state.config = config;
        const el = document.getElementById('stat-controllers'); if (el) el.textContent = config.controllers.length;
        const hist = await api('/api/eventHistory'); if (!hist.aborted) {
            const countEl = document.getElementById('stat-events'); if (countEl) countEl.textContent = hist.length;
        }
    };

    window.refreshControllers = async (scan = false) => {
        showLoader(true);
        let discovered = [];
        if (scan) { const dRes = await api('/api/getDevices'); if (!dRes.aborted) discovered = dRes; }
        const config = await api('/api/getConfig'); if (config.aborted) return;
        state.config = config;
        const map = new Map();
        config.controllers.forEach(c => map.set(Number(c.deviceId), { ...c, configured: true, offline: true }));
        discovered.forEach(d => {
            const id = Number(d.deviceId); const existing = map.get(id);
            map.set(id, { ...d, ...(existing || {}), configured: !!existing, offline: false });
        });
        const tbody = document.getElementById('table-controllers'); if (!tbody) return;
        tbody.innerHTML = '';
        map.forEach(ctrl => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td><strong>${ctrl.name || 'Unnamed'}</strong></td><td>${ctrl.deviceId}</td><td>${ctrl.address || 'Auto'}</td><td>${ctrl.doorCount || 4}</td><td><span class="badge ${ctrl.offline ? 'bg-secondary' : 'bg-success'}" id="status-${ctrl.deviceId}">${ctrl.offline ? 'Offline' : 'Online'}</span></td><td><div class="btn-group btn-group-sm"><button class="btn btn-primary" onclick="window.openDetails(${ctrl.deviceId})">Details</button><button class="btn btn-warning" onclick="window.openDoor(${ctrl.deviceId}, 1)">Unlock</button>${!ctrl.configured ? `<button class="btn btn-success" onclick="window.quickAdd(${ctrl.deviceId}, '${ctrl.address}')">Add</button>` : `<button class="btn btn-outline-danger" onclick="window.removeCtrl(${ctrl.deviceId})">Del</button>`}</div></td>`;
            tbody.appendChild(tr);
            if (ctrl.configured && ctrl.offline) {
                api(`/api/testController/${ctrl.deviceId}`).then(res => { if (res && !res.aborted) { const badge = document.getElementById(`status-${ctrl.deviceId}`); if (badge) { badge.className = 'badge bg-success'; badge.textContent = 'Online'; } } }).catch(() => {});
            }
        });
    };

    window.openAddControllerModal = () => { const modal = document.getElementById('modal-add-controller'); if (modal) bootstrap.Modal.getOrCreateInstance(modal).show(); };
    window.saveNewController = async (e) => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.target)); await api('/api/addDevice', 'POST', data); bootstrap.Modal.getOrCreateInstance(e.target.closest('.modal')).hide(); window.refreshControllers(); };

    window.openDetails = async (id) => {
        state.selectedId = id;
        const ctrl = state.config.controllers.find(c => c.deviceId == id) || { deviceId: id, name: 'New', doorCount: 4 };
        const modal = document.getElementById('modal-controller-details'); if (!modal) return;
        const title = document.getElementById('details-title'); if (title) title.textContent = `${ctrl.name} (S/N: ${id})`;
        const form = document.getElementById('form-det-gen');
        if (form) {
            form.deviceId.value = id; form.name.value = ctrl.name || ''; form.address.value = ctrl.address || ''; form.doorCount.value = ctrl.doorCount || 4;
            if (form.forceBroadcast) form.forceBroadcast.checked = !!ctrl.forceBroadcast;
        }
        modal.querySelectorAll('input[name="deviceId"]').forEach(i => i.value = id);
        const doorList = document.getElementById('det-doors-list');
        if (doorList) {
            doorList.innerHTML = '';
            for (let i = 1; i <= (ctrl.doorCount || 4); i++) {
                const col = document.createElement('div'); col.className = 'col-md-6 mb-3';
                col.innerHTML = `<div class="card p-3 border shadow-none"><div class="d-flex justify-content-between mb-2"><h6 class="mb-0">Door ${i}</h6><div id="status-badges-${id}-${i}"><span class="badge bg-secondary">...</span></div></div><div class="mb-2"><label class="x-small fw-bold text-muted">Delay</label><input type="number" id="delay-${id}-${i}" class="form-control form-control-sm" value="5"></div><div class="mb-3"><label class="x-small fw-bold text-muted">Mode</label><select id="mode-${id}-${i}" class="form-select form-select-sm"><option value="controlled">controlled</option><option value="normally open">normally open</option><option value="normally closed">normally closed</option></select></div><div class="btn-group btn-group-sm w-100"><button class="btn btn-success" onclick="window.saveDoor(${id},${i})">Save</button><button class="btn btn-warning" onclick="window.openDoor(${id},${i})">Unlock</button><button class="btn btn-info text-white" onclick="window.checkDoor(${id},${i})">Fetch</button></div></div>`;
                doorList.appendChild(col);
            }
        }
        bootstrap.Modal.getOrCreateInstance(modal).show();
        const updateStatusUI = (door, open, unlocked) => { const container = document.getElementById(`status-badges-${id}-${door}`); if (container) container.innerHTML = `<span class="badge ${unlocked ? 'bg-danger' : 'bg-success'} d-block mb-1">${unlocked ? 'UNLOCKED' : 'LOCKED'}</span><span class="badge ${open ? 'bg-warning text-dark' : 'bg-info'} d-block">${open ? 'OPEN' : 'CLOSED'}</span>`; };
        const pollStatus = async () => {
            if (!modal.classList.contains('show')) { clearInterval(liveStatusTimer); return; }
            try {
                const res = await api(`/api/getStatus/${id}`); if (res.aborted) return;
                const s = res.state || {}; for (let i = 1; i <= (ctrl.doorCount || 4); i++) { updateStatusUI(i, s.doors ? s.doors[i] : false, s.relays?.relays ? s.relays.relays[i] : false); }
            } catch (err) {}
        };
        pollStatus(); if (liveStatusTimer) clearInterval(liveStatusTimer); liveStatusTimer = setInterval(pollStatus, 5000);
        api(`/api/getTime/${id}`).then(d => { if (d && !d.aborted) { const el = document.getElementById('det-time'); if (el) el.textContent = d.datetime; } });
        window.fetchListener(); for (let i = 1; i <= (ctrl.doorCount || 4); i++) { window.checkDoor(id, i); }
    };

    window.saveDoor = async (id, door) => {
        const delay = document.getElementById(`delay-${id}-${door}`).value; const control = document.getElementById(`mode-${id}-${door}`).value;
        try { await api('/api/setDoorControl', 'POST', { deviceId: id, door, control, delay }); alert('Settings Programmed'); } catch (e) { alert(e.message); }
    };
    window.checkDoor = async (id, door) => {
        try {
            const res = await api(`/api/getDoorControl/${id}/${door}`); if (res.aborted) return;
            const s = res.doorControlState || {}; const ctrlTxt = getText(s.control);
            const dInp = document.getElementById(`delay-${id}-${door}`); if (dInp) dInp.value = s.delay;
            const sel = document.getElementById(`mode-${id}-${door}`); if (sel) { for (let opt of sel.options) { if (opt.value === ctrlTxt || ctrlTxt.toLowerCase().includes(opt.value)) { sel.value = opt.value; break; } } }
        } catch (err) {}
    };
    window.openDoor = async (id, door) => { if (confirm(`Unlock Door ${door}?`)) await api('/api/openDoor', 'POST', { deviceId: id, door }); };
    window.quickAdd = async (id, addr) => { await api('/api/addDevice', 'POST', { deviceId: id, address: addr }); window.refreshControllers(); };
    window.removeCtrl = async (id) => { if (confirm('Remove from fleet?')) { await api('/api/removeDevice', 'POST', { deviceId: id }); window.refreshControllers(); } };
    window.updateCtrlMeta = async (e) => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.target)); data.forceBroadcast = e.target.forceBroadcast.checked; await api('/api/updateController', 'POST', data); alert('Metadata Saved'); window.refreshControllers(); };
    window.syncTime = async () => { try { await api('/api/setTime', 'POST', { deviceId: state.selectedId, datetime: new Date().toISOString() }); alert('Clock Synced'); } catch (e) { alert(e.message); } };
    window.setHardwareIP = async (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); if (!d.deviceId || d.deviceId == '0') return alert('Invalid Controller'); try { await api('/api/setIP', 'POST', d); alert('IP Command Dispatched'); } catch (e) { alert(e.message); } };
    window.setListenerIP = async (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); try { await api('/api/setListener', 'POST', d); alert('Listener Updated'); window.fetchListener(); } catch (e) { alert(e.message); } };
    window.fetchListener = async () => { const el = document.getElementById('det-listener'); if (!el || !state.selectedId) return; try { const d = await api(`/api/getListener/${state.selectedId}`); if (!d.aborted) el.textContent = `${d.address}:${d.port}`; } catch (e) { el.textContent = 'Err'; } };
    window.toggleSpec = async () => { await api('/api/recordSpecialEvents', 'POST', { deviceId: state.selectedId, enabled: true }); alert('Enabled'); };
    window.factoryReset = async () => { if (confirm('PERMANENT WIPE?')) await api('/api/restoreDefaultParameters', 'POST', { deviceId: state.selectedId }); };

    const refreshCards = async () => {
        const config = await api('/api/getConfig'); if (config.aborted) return; state.config = config;
        const select = document.getElementById('select-card-controller'); if (select) { select.innerHTML = '<option value="">Choose Hardware...</option>'; config.controllers.forEach(c => select.add(new Option(`${c.name} (${c.deviceId})`, c.deviceId))); }
    };
    window.onCardControllerChange = async (id) => {
        state.selectedId = id; const btn = document.getElementById('btn-add-card'); if (btn) btn.disabled = !id;
        const tbody = document.getElementById('table-cards'); if (!tbody) return;
        tbody.innerHTML = id ? '<tr><td colspan="6" class="text-center py-4">Syncing authorization list...</td></tr>' : '';
        if (!id) return;
        try {
            const res = await api(`/api/getCards/${id}`); if (res.aborted) return;
            const stat = document.getElementById('stat-cards'); if (stat) stat.textContent = res.cards;
            tbody.innerHTML = '';
            for (let i = 1; i <= Math.min(res.cards, 50); i++) {
                try {
                    const data = await api(`/api/getCardByIndex/${id}/${i}`); if (data.aborted) return;
                    const c = data.card; const tr = document.createElement('tr');
                    tr.innerHTML = `<td><strong>${c.number}</strong></td><td>${c.valid.from}</td><td>${c.valid.to}</td><td>${c.doors[1]},${c.doors[2]},${c.doors[3]},${c.doors[4]}</td><td>${c.PIN}</td><td><button class="btn btn-sm btn-danger" onclick="window.delCard(${id},${c.number})">Del</button></td>`;
                    tbody.appendChild(tr);
                } catch (err) {}
            }
        } catch (err) { tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger">Fetch Failed</td></tr>'; }
    };
    window.openAddCardModal = () => { const modal = document.getElementById('modal-card'); if (modal) bootstrap.Modal.getOrCreateInstance(modal).show(); };
    window.saveCard = async (e) => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.target)); data.deviceId = state.selectedId; await api('/api/putCard', 'POST', data); bootstrap.Modal.getOrCreateInstance(e.target.closest('.modal')).hide(); window.onCardControllerChange(state.selectedId); };
    window.delCard = async (id, num) => { if (confirm(`Delete card ${num}?`)) { await api('/api/deleteCard', 'POST', { deviceId: id, cardNumber: num }); window.onCardControllerChange(id); } };

    const refreshDoorGroups = async () => {
        const groups = await api('/api/doorGroups'); if (groups.aborted) return;
        const tbody = document.getElementById('table-door-groups');
        if (tbody) {
            tbody.innerHTML = '';
            groups.forEach(g => {
                const tr = document.createElement('tr');
                tr.innerHTML = `<td><strong>${g.name}</strong></td><td><span class="badge bg-body-tertiary text-body border">${g.members.length} Doors</span></td><td><button class="btn btn-sm btn-outline-danger" onclick="window.removeGroup(${g.id})">Delete</button></td>`;
                tbody.appendChild(tr);
            });
        }
        initTomSelect(groups); await refreshAssignments();
    };

    const refreshAssignments = async () => {
        const list = await api('/api/assignments'); if (list.aborted) return;
        const tbody = document.getElementById('table-assignments'); if (!tbody) return;
        tbody.innerHTML = '';
        list.forEach(a => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td><strong>${a.cardNumber}</strong></td><td><span class="badge bg-info-subtle text-info border">${a.groupName}</span></td><td>${a.validFrom} to ${a.validTo}</td><td><div class="btn-group btn-group-sm"><button class="btn btn-outline-primary" onclick="window.editAssignment('${a.cardNumber}', ${a.groupId}, ${a.pin})">Edit</button><button class="btn btn-outline-danger" onclick="window.removeAssignment(${a.cardNumber}, ${a.groupId})">Del</button></div></td>`;
            tbody.appendChild(tr);
        });
    };

    window.openAddGroupModal = async () => {
        const res = await api('/api/getConfig'); if (res.aborted) return;
        const container = document.getElementById('group-door-selector'); if (!container) return;
        container.innerHTML = '';
        res.controllers.forEach(c => {
            const col = document.createElement('div'); col.className = 'col-md-4 mb-3';
            let checks = ''; for (let i=1; i<=(c.doorCount||4); i++) { checks += `<div class="form-check"><input class="form-check-input group-member-check" type="checkbox" data-dev="${c.deviceId}" data-door="${i}" id="chk-${c.deviceId}-${i}"><label class="form-check-label" for="chk-${c.deviceId}-${i}">Door ${i}</label></div>`; }
            col.innerHTML = `<div class="card p-2 border shadow-none bg-body-tertiary"><h6 class="small fw-bold">${c.name}</h6>${checks}</div>`;
            container.appendChild(col);
        });
        bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-add-group')).show();
    };

    window.saveDoorGroup = async (e) => { e.preventDefault(); const name = e.target.name.value; const members = []; document.querySelectorAll('.group-member-check:checked').forEach(chk => { members.push({ deviceId: chk.dataset.dev, door: chk.dataset.door }); }); if (members.length === 0) return alert('Select a door'); try { await api('/api/doorGroups', 'POST', { name, members }); bootstrap.Modal.getOrCreateInstance(e.target.closest('.modal')).hide(); await refreshDoorGroups(); } catch(e){ alert(e.message); } };
    window.removeGroup = async (id) => { if (confirm('Delete?')) { await api(`/api/doorGroups/${id}`, 'DELETE'); await refreshDoorGroups(); } };

    window.provisionToGroup = async (e) => {
        e.preventDefault(); if (!groupSelect) return;
        const data = Object.fromEntries(new FormData(e.target)); data.groupIds = groupSelect.getValue(); data.from = "2024-01-01"; data.to = "2029-12-31"; 
        const resEl = document.getElementById('provision-results'); resEl.innerHTML = '<div class="alert alert-info py-2 small">Syncing site access...</div>';
        try {
            const res = await api('/api/provisionCard', 'POST', data); if (res.aborted) return;
            let html = '<ul class="list-group list-group-flush border rounded x-small">';
            res.results.forEach(r => { html += `<li class="list-group-item d-flex justify-content-between">CTRL ${r.deviceId}: ${r.success ? '<span class="text-success fw-bold">OK</span>' : '<span class="text-danger">ERR</span>'}</li>`; });
            resEl.innerHTML = html + '</ul>'; await refreshAssignments();
            if (document.getElementById('btn-prov-cancel')?.style.display === 'block') window.cancelProvEdit();
        } catch (e) { resEl.innerHTML = `<div class="alert alert-danger py-2 small">${e.message}</div>`; }
    };

    window.editAssignment = (cardNumber, groupId, pin) => {
        document.getElementById('provision-card-header').textContent = 'Update Assignment';
        document.getElementById('prov-card-number').value = cardNumber; document.getElementById('prov-pin').value = pin;
        if (groupSelect) groupSelect.setValue([groupId]);
        document.getElementById('btn-prov-submit').textContent = 'Update';
        document.getElementById('btn-prov-cancel').style.display = 'block';
        window.scrollTo({ top: document.getElementById('form-provision').offsetTop - 100, behavior: 'smooth' });
    };

    window.cancelProvEdit = () => {
        document.getElementById('provision-card-header').textContent = 'Batch Deployment';
        document.getElementById('form-provision').reset(); if (groupSelect) groupSelect.clear();
        document.getElementById('btn-prov-submit').textContent = 'Sync Now';
        document.getElementById('btn-prov-cancel').style.display = 'none';
    };

    const refreshEvents = async () => {
        const select = document.getElementById('select-event-controller'); if (!select) return;
        select.innerHTML = '<option value="all">All Controllers</option>';
        const config = await api('/api/getConfig'); if (config.aborted) return;
        state.config = config; config.controllers.forEach(c => select.add(new Option(c.name || `CTRL ${c.deviceId}`, c.deviceId)));
        const history = await api('/api/eventHistory'); if (!history.aborted) renderHistory(history);
        window.fetchControllerHistory();
    };

    const renderHistory = (history) => {
        const tbody = document.getElementById('table-events-history'); if (!tbody) return;
        tbody.innerHTML = '';
        const sorted = history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        sorted.forEach(ev => {
            const tr = document.createElement('tr');
            const type = getText(ev.eventType || ev.type); const reason = getText(ev.reason).toLowerCase();
            const isSwipe = type.toLowerCase().includes('swipe') || (ev.cardNumber > 100) || reason.includes('card');
            let resultBadge = `<span class="badge ${ev.granted ? 'bg-success' : 'bg-danger'} shadow-sm x-small">${ev.granted ? 'GRANTED' : 'DENIED'}</span>`;
            if (!isSwipe) {
                if (reason.includes('lock') || reason.includes('relay')) resultBadge = `<span class="badge ${ev.granted ? 'bg-danger' : 'bg-success'} shadow-sm x-small">${ev.granted ? 'UNLOCKED' : 'LOCKED'}</span>`;
                else if (reason.includes('open')) resultBadge = `<span class="badge bg-warning text-dark shadow-sm x-small">OPEN</span>`;
                else resultBadge = `<span class="badge bg-info shadow-sm x-small">CLOSED</span>`;
            }
            tr.innerHTML = `<td><small class="text-muted fw-bold">${ev.timestamp}</small></td><td><span class="badge ${isSwipe ? 'bg-success' : 'bg-info'} py-1 px-2"><i class="bi ${isSwipe ? 'bi-person-vcard' : 'bi-broadcast'}"></i></span> <small class="text-secondary x-small">${type}</small></td><td><span class="font-monospace small">${ev.cardNumber || '-'}</span></td><td><span class="badge bg-body-tertiary text-body border x-small">D${ev.door}</span></td><td><div class="d-flex flex-column">${resultBadge}<small class="text-uppercase fw-bold text-muted x-small mt-1">${getText(ev.reason).replace(/[{}]/g, '')}</small></div></td>`;
            tbody.appendChild(tr);
        });
    };

    window.fetchControllerHistory = async () => {
        const val = document.getElementById('select-event-controller').value; showLoader(true);
        try {
            const targets = val === 'all' ? state.config.controllers.map(c => c.deviceId) : [val];
            let newLogs = [];
            for (const id of targets) {
                try {
                    const meta = await api(`/api/getEvents/${id}`); if (meta.aborted) return;
                    for (let i = meta.last; i >= Math.max(meta.first, meta.last - 20); i--) {
                        try {
                            const res = await api(`/api/getEvent/${id}/${i}`); if (res.aborted) return;
                            const e = res.event; newLogs.push({ deviceId: id, timestamp: e.timestamp, eventType: e.type, cardNumber: e.card, door: e.door, granted: e.granted, reason: e.reason });
                        } catch (err) {}
                    }
                } catch (err) {}
            }
            if (newLogs.length > 0) { await api('/api/saveEvents', 'POST', newLogs); const hist = await api('/api/eventHistory'); if (!hist.aborted) renderHistory(hist); }
        } finally { showLoader(false); }
    };

    window.refreshEventView = async () => { const hist = await api('/api/eventHistory'); if (!hist.aborted) renderHistory(hist); };

    window.refreshDebug = async () => {
        const res = await api('/api/getConfig'); if (res.aborted) return;
        const select = document.getElementById('debug-controller'); if (select) { select.innerHTML = '<option value="">(Broadcast)</option>'; res.controllers.forEach(c => select.add(new Option(`${c.name || 'Unnamed'} (${c.deviceId})`, c.deviceId))); }
    };

    window.onDebugCommandChange = (cmd) => {
        const params = document.getElementById('debug-params'); if (!params) return;
        params.innerHTML = '';
        if (cmd === 'openDoor' || cmd === 'getDoorControl') params.innerHTML = '<label class="x-small fw-bold">Door (1-4)</label><input type="number" id="dbg-door" class="form-control form-control-sm" value="1">';
        else if (cmd === 'setDoorControl') params.innerHTML = '<label class="x-small fw-bold">Door</label><input type="number" id="dbg-door" class="form-control form-control-sm mb-1" value="1"><label class="x-small fw-bold">Delay</label><input type="number" id="dbg-delay" class="form-control form-control-sm mb-1" value="5"><label class="x-small fw-bold">Mode</label><select id="dbg-mode" class="form-select form-select-sm"><option value="controlled">controlled</option><option value="normally open">normally open</option><option value="normally closed">normally closed</option></select>';
        else if (cmd === 'getCard') params.innerHTML = '<label class="x-small fw-bold">Card #</label><input type="number" id="dbg-card" class="form-control form-control-sm" required>';
        else if (cmd === 'getCardByIndex') params.innerHTML = '<label class="x-small fw-bold">Index</label><input type="number" id="dbg-index" class="form-control form-control-sm" required>';
    };

    window.executeDebugCommand = async () => {
        const cmd = document.getElementById('debug-command').value; const ctrlId = document.getElementById('debug-controller').value; const consoleEl = document.getElementById('debug-console');
        if (!cmd) return alert('Select a command');
        const log = (msg, type = 'info') => { const time = new Date().toLocaleTimeString(); const color = type === 'error' ? '#f87171' : (type === 'sent' ? '#60a5fa' : '#34d399'); consoleEl.innerHTML += `<div style="color:${color}">[${time}] ${msg}</div>`; consoleEl.scrollTop = consoleEl.scrollHeight; };
        let url = `/api/${cmd}`; let method = 'GET'; let body = null;
        if (cmd === 'getDevices') url = '/api/getDevices';
        else if (['getDevice', 'getStatus', 'getTime', 'getCards'].includes(cmd)) { if (!ctrlId) return alert('Select Hardware'); url = `/api/${cmd}/${ctrlId}`; }
        else if (cmd === 'openDoor') { if (!ctrlId) return alert('Select Hardware'); method = 'POST'; body = { deviceId: ctrlId, door: document.getElementById('dbg-door').value }; }
        else if (cmd === 'getDoorControl') { if (!ctrlId) return alert('Select Hardware'); url = `/api/getDoorControl/${ctrlId}/${document.getElementById('dbg-door').value}`; }
        else if (cmd === 'setDoorControl') { if (!ctrlId) return alert('Select Hardware'); method = 'POST'; body = { deviceId: ctrlId, door: document.getElementById('dbg-door').value, delay: document.getElementById('dbg-delay').value, control: document.getElementById('dbg-mode').value }; }
        else if (cmd === 'getCard') { if (!ctrlId) return alert('Select Hardware'); url = `/api/getCard/${ctrlId}/${document.getElementById('dbg-card').value}`; }
        else if (cmd === 'getCardByIndex') { if (!ctrlId) return alert('Select Hardware'); url = `/api/getCardByIndex/${ctrlId}/${document.getElementById('dbg-index').value}`; }
        log(`SENT: ${method} ${url}`, 'sent');
        try { const res = await api(url, method, body); if (!res.aborted) log(`RECV: ${JSON.stringify(res, null, 2)}`); } catch (e) { log(`ERR: ${e.message}`, 'error'); }
    };

    window.refreshSettings = async () => {
        const res = await api('/api/getConfig'); if (res.aborted) return;
        const form = document.getElementById('form-settings'); if (form) { form.bind.value = res.bind; form.broadcast.value = res.broadcast; form.listen.value = res.listen; form.timeout.value = res.timeout; form.debug.checked = !!res.debug; }
    };
    window.saveSettings = async (e) => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.target)); data.debug = e.target.debug.checked; await api('/api/setConfig', 'POST', data); alert('System Engine Config Updated'); };

    const setTheme = (isDark) => {
        document.documentElement.setAttribute('data-bs-theme', isDark ? 'dark' : 'light'); localStorage.setItem('theme', isDark ? 'dark' : 'light');
        const toggle = document.getElementById('theme-toggle'); if (toggle) toggle.checked = isDark;
    };
    const toggle = document.getElementById('theme-toggle'); if (toggle) toggle.onchange = (e) => setTheme(e.target.checked);
    setTheme(localStorage.getItem('theme') === 'dark');

    const socket = io();
    socket.on('doorEvent', (ev) => {
        state.liveEvents.push(ev); if (state.liveEvents.length > 50) state.liveEvents.shift();
        const stat = document.getElementById('stat-events'); if (stat) stat.textContent = state.liveEvents.length;
        const log = document.getElementById('events-log'); if (log) {
            const div = document.createElement('div'); div.innerHTML = `[${ev.timestamp}] <span class="text-info">SN:${ev.deviceId}:</span> ${ev.granted ? 'GRANTED' : 'DENIED'} (${getText(ev.eventType)})`;
            log.insertBefore(div, log.firstChild); if (log.children.length > 20) log.lastChild.remove();
        }
        window.updateActiveControllerUI(ev);
    });

    refreshDash();
});
