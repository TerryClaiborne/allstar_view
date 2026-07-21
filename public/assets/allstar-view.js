(() => {
    'use strict';

    const page = document.querySelector('.allstar-view-page');
    if (!page) {
        return;
    }

    const localEndpoint = String(page.dataset.statusEndpoint || '').trim();
    const downstreamEndpoint = String(page.dataset.downstreamEndpoint || '').trim();
    const echoLinkEndpoint = String(page.dataset.echolinkEndpoint || '').trim();
    const mobileActivityMedia = window.matchMedia('(max-width: 760px)');
    const MOBILE_ACTIVITY_LIMIT = 8;
    if (!localEndpoint) {
        return;
    }

    const elements = {
        connections: document.getElementById('allstar-view-connections'),
        directCount: document.getElementById('allstar-view-direct-count'),
        directNote: document.getElementById('allstar-view-direct-note'),
        downstream: document.getElementById('allstar-view-downstream'),
        downstreamCount: document.getElementById('allstar-view-downstream-count'),
        downstreamNote: document.getElementById('allstar-view-downstream-note'),
        downstreamFilters: Array.from(document.querySelectorAll('[data-downstream-filter]')),
        filterAllCount: document.getElementById('allstar-view-filter-all-count'),
        filterNodesCount: document.getElementById('allstar-view-filter-nodes-count'),
        filterPrivateCount: document.getElementById('allstar-view-filter-private-count'),
        filterClientsCount: document.getElementById('allstar-view-filter-clients-count'),
        filterEchoLinkCount: document.getElementById('allstar-view-filter-echolink-count'),
        keyedCount: document.getElementById('allstar-view-keyed-count'),
        keyedNote: document.getElementById('allstar-view-keyed-note'),
        refreshTime: document.getElementById('allstar-view-refresh-time'),
        refreshNote: document.getElementById('allstar-view-refresh-note'),
        detailNode: document.getElementById('allstar-view-detail-node'),
        detailCall: document.getElementById('allstar-view-detail-call'),
        detailPath: document.getElementById('allstar-view-detail-path'),
        detailLocation: document.getElementById('allstar-view-detail-location'),
        detailDescription: document.getElementById('allstar-view-detail-description'),
        detailLinks: document.getElementById('allstar-view-detail-links'),
        detailQrz: document.getElementById('allstar-view-detail-qrz'),
        activity: document.getElementById('allstar-view-activity'),
        activityToggle: document.getElementById('allstar-view-activity-toggle'),
    };

    const state = {
        localTimer: 0,
        downstreamTimer: 0,
        localLoading: false,
        localSnapshotLoaded: false,
        downstreamLoading: false,
        echoLinkLoading: false,
        echoLinkTimer: 0,
        echoLinkNextAllowed: 0,
        selectedKey: '',
        selectedType: '',
        preferredDirectNode: '',
        preferredRemoteClients: false,
        downstreamFilter: 'all',
        localNode: '',
        scrollDownstreamOnRender: false,
        downstreamHighlightTimer: 0,
        connections: [],
        activity: [],
        activityRenderSignature: '',
        activityExpanded: false,
        downstreamRenderSignature: '',
        downstreamNodes: [],
        downstreamDirect: [],
        downstreamSummary: {},
        downstreamCache: {},
        echoLinkEntries: {},
    };

    function escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function formatTime(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return 'Just now';
        }
        return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    }

    function activityEventKey(event) {
        const id = String(event?.id || '').trim();
        if (id) {
            return id;
        }
        return [event?.timestamp, event?.type, event?.key, event?.node].map((value) => String(value || '')).join(':');
    }

    function qrzCallsign(value) {
        const match = String(value || '').toUpperCase().match(/\b([A-Z]{1,3}[0-9][A-Z0-9]{1,4})\b/);
        return match ? match[1] : '';
    }

    function webPhoneCallsign(value) {
        const match = String(value || '').trim().toUpperCase().match(/^([A-Z]{1,3}[0-9][A-Z0-9]{1,4})-P$/);
        return match ? match[1] : '';
    }

    function isRemoteWebPhoneClient(item) {
        if (!item) {
            return false;
        }
        return String(item.client_type || '').trim() === 'web_phone'
            || (String(item.kind || '').trim() === 'client' && /-P$/i.test(String(item.node || '').trim()));
    }

    function isDownstreamWebPhoneClient(item) {
        return Boolean(item)
            && String(item.kind || '').trim() === 'client'
            && String(item.client_type || '').trim() === 'web_phone'
            && Boolean(String(item.direct_node || '').trim());
    }

    function isDownstreamEchoLink(item) {
        return Boolean(item)
            && String(item.kind || '').trim() === 'echo'
            && Boolean(String(item.direct_node || '').trim());
    }

    function echoLinkNodeNumber(value) {
        const raw = String(value || '').trim();
        const mapped = raw.match(/^3(\d{6})$/);
        if (mapped) {
            return mapped[1].replace(/^0+/, '') || '0';
        }
        return /^\d{1,6}$/.test(raw) ? (raw.replace(/^0+/, '') || '0') : '';
    }

    function echoLinkCallsignKey(value) {
        const callsign = String(value || '').trim().toUpperCase();
        return callsign ? `call:${callsign}` : '';
    }

    function echoLinkDescription(callsign) {
        const value = String(callsign || '').trim().toUpperCase();
        if (!value) return 'EchoLink';
        if (value.endsWith('-R')) return 'EchoLink Repeater';
        if (value.endsWith('-L')) return 'EchoLink Link';
        if (qrzCallsign(value)) return 'EchoLink User';
        return 'EchoLink Conference';
    }

    function applyEchoLinkIdentity(item) {
        if (!item || String(item.kind || '').trim() !== 'echo') {
            return item;
        }

        const reportedNode = echoLinkNodeNumber(item.echolink_node || item.reported_node || item.node);
        const liveCallsign = String(item.callsign || '').trim().toUpperCase();
        const callsignEntry = liveCallsign ? state.echoLinkEntries[echoLinkCallsignKey(liveCallsign)] : null;
        const nodeEntry = reportedNode ? state.echoLinkEntries[reportedNode] : null;

        // Relay-mode EchoLink sessions can report a made-up node number.
        // The live callsign is reliable, and the official callsign lookup is
        // authoritative for the assigned EchoLink node number.
        const callsign = String(liveCallsign || callsignEntry?.callsign || nodeEntry?.callsign || '').trim().toUpperCase();
        const officialNode = echoLinkNodeNumber(callsignEntry?.node || (!liveCallsign ? nodeEntry?.node : ''));
        const displayNode = officialNode || (!liveCallsign ? reportedNode : '');

        if (!callsign) {
            return {
                ...item,
                node: reportedNode || String(item.node || ''),
                echolink_node: reportedNode || String(item.echolink_node || ''),
                identity_pending: true,
            };
        }

        const qrz = qrzCallsign(callsign);
        return {
            ...item,
            node: displayNode,
            echolink_node: displayNode,
            callsign,
            description: echoLinkDescription(callsign),
            display: callsign,
            identity_pending: false,
            stats_url: '',
            qrz_url: qrz ? `https://www.qrz.com/db/${encodeURIComponent(qrz)}` : '',
        };
    }

    function orderedDownstreamChildren(rootNode, children) {
        const byParent = new Map();
        for (const item of children) {
            const parent = String(item.parent_node || rootNode || '').trim();
            if (!byParent.has(parent)) {
                byParent.set(parent, []);
            }
            byParent.get(parent).push(item);
        }

        const sortItems = (items) => items.sort((a, b) => {
            const kindOrder = (item) => isDownstreamWebPhoneClient(item) ? 1 : (isDownstreamEchoLink(item) ? 2 : 0);
            const order = kindOrder(a) - kindOrder(b);
            if (order !== 0) {
                return order;
            }
            return String(a.node || '').localeCompare(String(b.node || ''), undefined, { numeric: true });
        });
        for (const items of byParent.values()) {
            sortItems(items);
        }

        const ordered = [];
        const visited = new Set();
        const visit = (parent) => {
            for (const item of byParent.get(String(parent)) || []) {
                const key = String(item.key || `${item.direct_node || ''}:${item.parent_node || ''}:${item.node || ''}`);
                if (visited.has(key)) {
                    continue;
                }
                visited.add(key);
                ordered.push(item);
                if (String(item.kind || '') === 'asl') {
                    visit(item.node);
                }
            }
        };

        visit(rootNode);
        for (const item of sortItems([...children])) {
            const key = String(item.key || `${item.direct_node || ''}:${item.parent_node || ''}:${item.node || ''}`);
            if (!visited.has(key)) {
                ordered.push(item);
            }
        }
        return ordered;
    }

    function historicalActivityItem(event) {
        if (!event) {
            return null;
        }

        const source = String(event.source || '').trim();
        const key = String(event.key || '');
        const node = String(event.node || '').trim();
        let kind = String(event.kind || '').trim() || (source === 'AllStarLink' || key.startsWith('asl:') ? 'asl' : '');
        if (!kind && /-P$/i.test(node)) {
            kind = 'client';
        }
        const callsign = String(event.callsign || '').trim();
        const clientType = String(event.client_type || '').trim();
        const webPhoneCall = webPhoneCallsign(node);
        const isWebPhone = clientType === 'web_phone' || (kind === 'client' && /-P$/i.test(node));
        const resolvedCallsign = callsign || webPhoneCall;
        const qrz = qrzCallsign(resolvedCallsign || node);
        const isAllStar = kind === 'asl' && /^\d+$/.test(node);
        const isEchoLink = kind === 'echo';

        return {
            ...event,
            key: activityEventKey(event),
            kind,
            client_type: isWebPhone ? 'web_phone' : clientType,
            node,
            source: isWebPhone ? 'Web/Phone Client' : (source || 'Recorded activity'),
            callsign: resolvedCallsign,
            description: String(event.description || '').trim(),
            location: String(event.location || '').trim(),
            mode: String(event.mode || '').trim(),
            mode_label: String(event.mode_label || '').trim() || 'Recorded state',
            direction: String(event.direction || '').trim(),
            channel: String(event.channel || '').trim(),
            peer: String(event.peer || '').trim(),
            stats_url: isAllStar ? (String(event.stats_url || '').trim() || `https://stats.allstarlink.org/stats/${encodeURIComponent(node)}`) : '',
            qrz_url: (isAllStar || isWebPhone || isEchoLink) && qrz
                ? (String(event.qrz_url || '').trim() || `https://www.qrz.com/db/${encodeURIComponent(qrz)}`)
                : '',
            historical: true,
            activity_type: String(event.type || '').trim(),
            activity_timestamp: String(event.timestamp || '').trim(),
            duration_seconds: Number(event.duration_seconds || 0),
        };
    }

    function sourceClass(kind) {
        return {
            asl: 'chip-asl',
            echo: 'chip-echo',
            iax: 'chip-iax',
            client: 'chip-client',
        }[kind] || 'chip-client';
    }

    function modeClass(mode) {
        return mode === 'local_monitor' ? 'chip-monitor' : 'chip-tx';
    }

    function selectItem(item, type) {
        state.selectedKey = String(item?.key || '');
        state.selectedType = state.selectedKey ? type : '';
        renderConnections(state.connections);
        renderActivity();
        renderDownstream();
        renderDetails(item || null);
    }

    function selectActivity(event) {
        const item = historicalActivityItem(event);
        state.selectedKey = item ? item.key : '';
        state.selectedType = state.selectedKey ? 'activity' : '';
        renderConnections(state.connections);
        renderActivity();
        renderDownstream();
        renderDetails(item);
    }

    function prioritizeDownstream(node) {
        const directNode = String(node || '').trim();
        if (!directNode) {
            return;
        }
        state.preferredDirectNode = directNode;
        state.preferredRemoteClients = false;
        state.scrollDownstreamOnRender = true;
    }

    function prioritizeRemoteClients() {
        state.preferredDirectNode = '';
        state.preferredRemoteClients = true;
        state.scrollDownstreamOnRender = true;
    }

    function selectedItem() {
        if (state.selectedType === 'current') {
            return state.connections.find((item) => item.key === state.selectedKey) || null;
        }
        if (state.selectedType === 'downstream') {
            return state.downstreamNodes.find((item) => item.key === state.selectedKey) || null;
        }
        if (state.selectedType === 'root') {
            return state.downstreamDirect.find((item) => item.key === state.selectedKey) || null;
        }
        if (state.selectedType === 'activity') {
            const event = state.activity.find((item) => activityEventKey(item) === state.selectedKey) || null;
            return historicalActivityItem(event);
        }
        return null;
    }

    function renderConnectionEmpty(message, detail = '') {
        if (!elements.connections) {
            return;
        }
        elements.connections.innerHTML = `
            <div class="allstar-view-empty">
                <span class="allstar-view-empty-icon" aria-hidden="true">&#8644;</span>
                <strong>${escapeHtml(message)}</strong>
                ${detail ? `<p>${escapeHtml(detail)}</p>` : ''}
            </div>`;
    }

    function renderConnections(connections) {
        if (!elements.connections) {
            return;
        }

        elements.connections.setAttribute('aria-busy', 'false');
        if (!connections.length) {
            renderConnectionEmpty('No direct connections detected', 'The local Asterisk snapshot is active and will update automatically.');
            if (state.selectedType === 'current') {
                state.selectedKey = '';
                state.selectedType = '';
                renderDetails(null);
            }
            return;
        }

        elements.connections.innerHTML = connections.map((item) => {
            const selected = state.selectedType === 'current' && item.key === state.selectedKey ? ' is-selected' : '';
            const keyed = item.keyed ? ' is-keyed' : '';
            const secondary = String(item.kind || '') === 'asl'
                ? ([item.callsign, item.description, item.location].filter(Boolean).join(' — ') || 'AllStarLink node')
                : ([item.callsign, item.description].filter(Boolean).join(' — ') || item.channel || item.peer || 'Local Asterisk connection');
            const direction = item.direction ? `<span class="allstar-view-direction">${escapeHtml(item.direction)}</span>` : '';
            const keyedBadge = item.keyed ? '<span class="allstar-view-keyed-badge">Keyed</span>' : '';

            return `
                <button type="button" class="allstar-view-connection-row${selected}${keyed}" data-connection-key="${escapeHtml(item.key)}">
                    <span class="allstar-view-connection-source allstar-view-chip ${sourceClass(item.kind)}">${escapeHtml(item.source)}</span>
                    <span class="allstar-view-connection-main">
                        <strong>${escapeHtml(item.node)}</strong>
                        <span>${escapeHtml(secondary)}</span>
                    </span>
                    <span class="allstar-view-connection-state">
                        ${keyedBadge}
                        <span class="allstar-view-chip ${modeClass(item.mode)}">${escapeHtml(item.mode_label)}</span>
                        ${direction}
                    </span>
                </button>`;
        }).join('');

        for (const row of elements.connections.querySelectorAll('[data-connection-key]')) {
            row.addEventListener('click', () => {
                const item = state.connections.find((connection) => connection.key === String(row.dataset.connectionKey || ''));
                if (item) {
                    if (item.kind === 'asl') {
                        prioritizeDownstream(item.node);
                    } else if (isRemoteWebPhoneClient(item)) {
                        prioritizeRemoteClients();
                    }
                    selectItem(item, 'current');
                }
            });
        }
    }

    function activityClass(type) {
        return {
            key: 'activity-key',
            unkey: 'activity-unkey',
            connect: 'activity-connect',
            disconnect: 'activity-disconnect',
        }[type] || 'activity-connect';
    }

    function activityLabel(type) {
        return {
            key: 'Key',
            unkey: 'Unkey',
            connect: 'Connect',
            disconnect: 'Disconnect',
        }[type] || 'Update';
    }

    function formatActivityTimestamp(value) {
        const time = formatTime(value);
        if (mobileActivityMedia.matches) {
            return time;
        }

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return time;
        }

        return `${time} · ${date.getMonth() + 1}/${date.getDate()}`;
    }

    function activityIdentity(item) {
        const detail = String(item.kind || '') === 'asl'
            ? [item.callsign, item.location].filter(Boolean).join(' — ')
            : [item.callsign, item.description].filter(Boolean).join(' — ');
        return detail || item.node || item.source || 'Connection';
    }

    function activityRenderSignature() {
        const selected = state.selectedType === 'activity' ? state.selectedKey : '';
        return [
            selected,
            mobileActivityMedia.matches ? 'mobile' : 'desktop',
            state.activityExpanded ? 'expanded' : 'recent',
            ...state.activity.map((event) => [
                activityEventKey(event),
                event.type,
                event.node,
                event.callsign,
                event.description,
                event.location,
                event.source,
                event.timestamp,
                event.duration_seconds,
            ].map((value) => String(value || '')).join('|')),
        ].join('~');
    }

    function updateActivityActions() {
        const mobileLimited = mobileActivityMedia.matches && state.activity.length > MOBILE_ACTIVITY_LIMIT;

        if (elements.activityToggle) {
            elements.activityToggle.hidden = !mobileLimited;
            elements.activityToggle.textContent = state.activityExpanded ? 'Show Recent' : 'Show All';
            elements.activityToggle.setAttribute('aria-expanded', state.activityExpanded ? 'true' : 'false');
        }

    }

    function renderActivity() {
        if (!elements.activity) {
            return;
        }

        const signature = activityRenderSignature();
        if (signature === state.activityRenderSignature) {
            return;
        }
        state.activityRenderSignature = signature;

        updateActivityActions();

        if (!state.activity.length) {
            elements.activity.innerHTML = `
                <div class="allstar-view-empty allstar-view-empty-compact">
                    <span class="allstar-view-empty-icon" aria-hidden="true">&#9889;</span>
                    <strong>No recorded activity yet</strong>
                    <p>Connect, disconnect, key, and unkey changes will be retained here when they occur.</p>
                </div>`;
            elements.activity.scrollTop = 0;
            return;
        }

        const visibleActivity = mobileActivityMedia.matches && !state.activityExpanded
            ? state.activity.slice(0, MOBILE_ACTIVITY_LIMIT)
            : state.activity;

        elements.activity.innerHTML = visibleActivity.map((event) => {
            const identity = activityIdentity(event);
            const activityKind = String(event.kind || '');
            const sourceLabel = activityKind === 'asl'
                ? 'ASL'
                : (activityKind === 'echo' ? '' : String(event.source || '').trim());
            const eventKey = activityEventKey(event);
            const selected = state.selectedType === 'activity' && state.selectedKey === eventKey ? ' is-selected' : '';
            const duration = Number(event.duration_seconds || 0);
            const durationText = event.type === 'unkey' && duration > 0 ? ` · ${duration}s` : '';
            return `
                <button type="button" class="allstar-view-activity-row${selected}" data-activity-id="${escapeHtml(eventKey)}">
                    <span class="allstar-view-activity-type ${activityClass(event.type)}">${activityLabel(event.type)}</span>
                    <span class="allstar-view-activity-main">
                        <strong>${escapeHtml(event.node || identity)}</strong>
                        <span>${escapeHtml(identity)}${sourceLabel ? ` · ${escapeHtml(sourceLabel)}` : ''}${durationText}</span>
                    </span>
                    <time datetime="${escapeHtml(event.timestamp)}">${escapeHtml(formatActivityTimestamp(event.timestamp))}</time>
                </button>`;
        }).join('');
    }

    elements.activity?.addEventListener('click', (event) => {
        const row = event.target.closest('[data-activity-id]');
        if (!row || !elements.activity.contains(row)) {
            return;
        }
        const eventKey = String(row.dataset.activityId || '');
        const activity = state.activity.find((item) => activityEventKey(item) === eventKey);
        if (activity) {
            selectActivity(activity);
        }
    });

    elements.activityToggle?.addEventListener('click', () => {
        state.activityExpanded = !state.activityExpanded;
        state.activityRenderSignature = '';
        renderActivity();
    });

    const handleActivityViewportChange = () => {
        if (!mobileActivityMedia.matches) {
            state.activityExpanded = false;
        }
        state.activityRenderSignature = '';
        renderActivity();
    };

    if (typeof mobileActivityMedia.addEventListener === 'function') {
        mobileActivityMedia.addEventListener('change', handleActivityViewportChange);
    } else if (typeof mobileActivityMedia.addListener === 'function') {
        mobileActivityMedia.addListener(handleActivityViewportChange);
    }

    function downstreamCategory(item) {
        if (isDownstreamWebPhoneClient(item)) return 'clients';
        if (isDownstreamEchoLink(item)) return 'echolink';
        if (Boolean(item?.is_private)) return 'private';
        return String(item?.kind || 'asl') === 'asl' ? 'nodes' : '';
    }

    function matchesDownstreamFilter(item) {
        return state.downstreamFilter === 'all' || downstreamCategory(item) === state.downstreamFilter;
    }

    function downstreamFilterCounts() {
        const counts = { all: 0, nodes: 0, privateNodes: 0, clients: 0, echolink: 0 };
        for (const item of state.downstreamNodes) {
            const category = downstreamCategory(item);
            if (category === 'private') counts.privateNodes++;
            else if (category && category in counts) counts[category]++;
        }
        counts.clients += state.connections.filter(isRemoteWebPhoneClient).length;
        counts.all = counts.nodes + counts.privateNodes + counts.clients + counts.echolink;
        return counts;
    }

    function updateDownstreamFilters() {
        const counts = downstreamFilterCounts();
        if (elements.filterAllCount) elements.filterAllCount.textContent = String(counts.all);
        if (elements.filterNodesCount) elements.filterNodesCount.textContent = String(counts.nodes);
        if (elements.filterPrivateCount) elements.filterPrivateCount.textContent = String(counts.privateNodes);
        if (elements.filterClientsCount) elements.filterClientsCount.textContent = String(counts.clients);
        if (elements.filterEchoLinkCount) elements.filterEchoLinkCount.textContent = String(counts.echolink);
        for (const button of elements.downstreamFilters) {
            const active = String(button.dataset.downstreamFilter || '') === state.downstreamFilter;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        }
    }

    function downstreamPath(item) {
        if (!item) return '';
        const directNode = String(item.direct_node || '').trim();
        if (!directNode) {
            const local = state.localNode || 'Local node';
            return `${local} → ${String(item.node || item.callsign || 'Connection')}`;
        }

        const byNode = new Map();
        for (const candidate of state.downstreamNodes) {
            if (String(candidate.direct_node || '') === directNode && String(candidate.kind || 'asl') === 'asl') {
                byNode.set(String(candidate.node || ''), candidate);
            }
        }

        const path = [];
        const visited = new Set();
        let parent = String(item.parent_node || directNode).trim();
        while (parent && !visited.has(parent)) {
            visited.add(parent);
            path.unshift(parent);
            if (parent === directNode) break;
            const parentItem = byNode.get(parent);
            parent = String(parentItem?.parent_node || directNode).trim();
        }
        if (!path.length || path[0] !== directNode) path.unshift(directNode);

        let endpoint = String(item.node || '').trim();
        if (isDownstreamEchoLink(item)) endpoint = String(item.callsign || endpoint).trim();
        if (endpoint && path[path.length - 1] !== endpoint) path.push(endpoint);
        return path.join(' → ');
    }

    function downstreamIdentity(item) {
        if (Boolean(item?.is_private)) return `Node ${item.node} - Private Node`;
        return [item.callsign, item.description, item.location].filter(Boolean).join(' — ') || `Node ${item.node}`;
    }

    function downstreamRenderSignature() {
        const compact = (item) => [
            String(item?.key || ''),
            String(item?.node || ''),
            String(item?.direct_node || ''),
            String(item?.parent_node || ''),
            Number(item?.depth || 0),
            String(item?.kind || ''),
            String(item?.client_type || ''),
            String(item?.callsign || ''),
            String(item?.description || ''),
            String(item?.location || ''),
            String(item?.mode || ''),
            String(item?.mode_label || ''),
            Boolean(item?.is_private),
            Boolean(item?.keyed),
        ];

        return JSON.stringify([
            state.downstreamFilter,
            state.selectedType,
            state.selectedKey,
            state.preferredDirectNode,
            state.preferredRemoteClients,
            state.downstreamDirect.map(compact),
            state.downstreamNodes.map(compact),
            state.connections.filter(isRemoteWebPhoneClient).map(compact),
        ]);
    }

    function renderDownstreamEmpty(title, detail) {
        if (!elements.downstream) {
            return;
        }
        elements.downstream.innerHTML = `
            <div class="allstar-view-empty allstar-view-empty-compact">
                <span class="allstar-view-empty-icon" aria-hidden="true">&#9670;</span>
                <strong>${escapeHtml(title)}</strong>
                <p>${escapeHtml(detail)}</p>
            </div>`;
    }

    function renderDownstream() {
        if (!elements.downstream) {
            return;
        }

        elements.downstream.setAttribute('aria-busy', 'false');
        updateDownstreamFilters();

        const renderSignature = downstreamRenderSignature();
        if (!state.scrollDownstreamOnRender && renderSignature === state.downstreamRenderSignature) {
            return;
        }
        state.downstreamRenderSignature = renderSignature;

        const allRemoteClients = state.connections.filter(isRemoteWebPhoneClient);
        const remoteClients = state.downstreamFilter === 'all' || state.downstreamFilter === 'clients' ? allRemoteClients : [];
        const publicGroups = state.downstreamDirect.map((root, index) => {
            const children = state.downstreamNodes.filter((item) => item.direct_node === root.node);
            return {
                type: 'public',
                root,
                index,
                children,
                visibleChildren: orderedDownstreamChildren(String(root.node || ''), children).filter(matchesDownstreamFilter),
            };
        }).filter((group) => state.downstreamFilter === 'all' || group.visibleChildren.length > 0);

        if (!publicGroups.length && !remoteClients.length) {
            const empty = {
                nodes: ['No downstream nodes', 'No public downstream AllStar nodes are currently reported.'],
                private: ['No private nodes', 'No unlisted or private downstream nodes are currently reported.'],
                clients: ['No remote clients', 'No Web/Phone clients are currently reported.'],
                echolink: ['No EchoLink connections', 'No downstream EchoLink connections are currently reported.'],
            }[state.downstreamFilter];
            if (empty) {
                renderDownstreamEmpty(empty[0], empty[1]);
            } else {
                renderDownstreamEmpty('No direct AllStarLink source', 'Downstream discovery starts when a public AllStarLink node is directly connected.');
            }
            return;
        }

        if (state.preferredDirectNode) {
            publicGroups.sort((a, b) => {
                const aPreferred = String(a.root.node) === state.preferredDirectNode ? 0 : 1;
                const bPreferred = String(b.root.node) === state.preferredDirectNode ? 0 : 1;
                return aPreferred - bPreferred || a.index - b.index;
            });
        }

        const directGroupTotal = publicGroups.length;
        const sections = publicGroups.map((group, index) => ({
            ...group,
            directPosition: index + 1,
            directTotal: directGroupTotal,
        }));
        if (remoteClients.length) {
            const remoteSection = { type: 'remote', clients: remoteClients };
            if (state.preferredRemoteClients) {
                sections.unshift(remoteSection);
            } else {
                sections.push(remoteSection);
            }
        }

        elements.downstream.innerHTML = sections.map((section) => {
            if (section.type === 'remote') {
                const clients = section.clients;
                const prioritized = state.preferredRemoteClients ? ' is-prioritized' : '';
                const rows = clients.map((item, index) => {
                    const selected = state.selectedType === 'current' && state.selectedKey === item.key ? ' is-selected' : '';
                    const branch = index === clients.length - 1 ? '&#9492;&#9472;' : '&#9500;&#9472;';
                    const callsign = item.callsign || webPhoneCallsign(item.node);
                    const secondary = callsign ? `${callsign} · Web/Phone Client` : 'Web/Phone Client';
                    const keyedBadge = item.keyed ? '<span class="allstar-view-keyed-badge">Keyed</span>' : '';
                    return `
                        <button type="button" class="allstar-view-downstream-row allstar-view-remote-client-row${selected}" data-remote-client-key="${escapeHtml(item.key)}">
                            <span class="allstar-view-downstream-branch" aria-hidden="true">${branch}</span>
                            <span class="tree-dot tree-dot-remote" aria-hidden="true"></span>
                            <span class="allstar-view-downstream-main">
                                <strong>${escapeHtml(item.node)}</strong>
                                <span>${escapeHtml(secondary)}</span>
                            </span>
                            <span class="allstar-view-downstream-state">
                                ${keyedBadge}
                                <span class="allstar-view-chip chip-client">Web/Phone Client</span>
                            </span>
                        </button>`;
                }).join('');

                return `
                    <section class="allstar-view-downstream-group allstar-view-remote-clients-group${prioritized}" data-downstream-group="remote-clients">
                        <div class="allstar-view-downstream-root allstar-view-remote-clients-root">
                            <span class="tree-dot tree-dot-remote" aria-hidden="true"></span>
                            <span class="allstar-view-downstream-main">
                                <strong>Remote Clients</strong>
                                <span>Connected Web/Phone clients reported by local Asterisk</span>
                            </span>
                            <span class="allstar-view-downstream-state">
                                <span class="allstar-view-downstream-count-badge">${clients.length} ${clients.length === 1 ? 'client' : 'clients'}</span>
                            </span>
                        </div>
                        <div class="allstar-view-downstream-children">${rows}</div>
                    </section>`;
            }

            const { root, visibleChildren } = section;
            const orderedChildren = visibleChildren;
            const rootSelected = state.selectedType === 'root' && state.selectedKey === root.key ? ' is-selected' : '';
            const rootIdentity = [root.callsign, root.description, root.location].filter(Boolean).join(' — ') || 'Direct AllStarLink node';
            const childRows = orderedChildren.length ? orderedChildren.map((item, index) => {
                const selected = state.selectedType === 'downstream' && state.selectedKey === item.key ? ' is-selected' : '';
                const branch = index === orderedChildren.length - 1 ? '&#9492;&#9472;' : '&#9500;&#9472;';
                const depth = Math.max(1, Number(item.depth || 1));
                const depthClass = depth >= 5 ? 'depth-deep' : `depth-${depth}`;
                if (isDownstreamWebPhoneClient(item)) {
                    const callsign = item.callsign || webPhoneCallsign(item.node);
                    const secondary = `${callsign || item.node} · Web/Phone Client · Parent ${item.parent_node || root.node}`;
                    return `
                        <button type="button" class="allstar-view-downstream-row allstar-view-downstream-remote-row ${depthClass}${selected}" data-downstream-key="${escapeHtml(item.key)}">
                            <span class="allstar-view-downstream-branch" aria-hidden="true">${branch}</span>
                            <span class="tree-dot tree-dot-remote" aria-hidden="true"></span>
                            <span class="allstar-view-downstream-main">
                                <strong>${escapeHtml(item.node)}</strong>
                                <span>${escapeHtml(secondary)}</span>
                            </span>
                            <span class="allstar-view-downstream-state">
                                <span class="allstar-view-chip chip-client">Web/Phone Client</span>
                                <span class="tree-depth">Depth ${escapeHtml(depth)}</span>
                            </span>
                        </button>`;
                }

                if (isDownstreamEchoLink(item)) {
                    const callsign = String(item.callsign || '').trim();
                    const secondary = `${callsign || `EchoLink node ${item.node}`} · ${echoLinkDescription(callsign)} · Parent ${item.parent_node || root.node}`;
                    return `
                        <button type="button" class="allstar-view-downstream-row ${depthClass}${selected}" data-downstream-key="${escapeHtml(item.key)}">
                            <span class="allstar-view-downstream-branch" aria-hidden="true">${branch}</span>
                            <span class="tree-dot tree-dot-depth-one" aria-hidden="true"></span>
                            <span class="allstar-view-downstream-main">
                                <strong>${escapeHtml(callsign || item.node)}</strong>
                                <span>${escapeHtml(secondary)}</span>
                            </span>
                            <span class="allstar-view-downstream-state">
                                <span class="allstar-view-chip chip-echo">EchoLink</span>
                                <span class="tree-depth">Depth ${escapeHtml(depth)}</span>
                            </span>
                        </button>`;
                }

                const privateClass = Boolean(item.is_private) ? ' allstar-view-downstream-private-row' : '';
                const privateChip = Boolean(item.is_private)
                    ? '<span class="allstar-view-chip chip-private">Pvt Node</span>'
                    : `<span class="allstar-view-chip ${modeClass(item.mode)}">${escapeHtml(item.mode_label)}</span>`;
                const privateDot = Boolean(item.is_private) ? 'tree-dot-private' : 'tree-dot-depth-one';
                return `
                    <button type="button" class="allstar-view-downstream-row ${depthClass}${privateClass}${selected}" data-downstream-key="${escapeHtml(item.key)}">
                        <span class="allstar-view-downstream-branch" aria-hidden="true">${branch}</span>
                        <span class="tree-dot ${privateDot}" aria-hidden="true"></span>
                        <span class="allstar-view-downstream-main">
                            <strong>${escapeHtml(item.node)}</strong>
                            <span>${escapeHtml(downstreamIdentity(item))}</span>
                        </span>
                        <span class="allstar-view-downstream-state">
                            ${privateChip}
                            <span class="tree-depth">Depth ${escapeHtml(depth)}</span>
                        </span>
                    </button>`;
            }).join('') : '<div class="allstar-view-downstream-none">No public child nodes, Web/Phone clients, or EchoLink connections reported for this direct path.</div>';

            const prioritized = String(root.node) === state.preferredDirectNode ? ' is-prioritized' : '';
            return `
                <section class="allstar-view-downstream-group${prioritized}" data-direct-node="${escapeHtml(root.node)}">
                    <button type="button" class="allstar-view-downstream-root${rootSelected}" data-downstream-root-key="${escapeHtml(root.key)}">
                        <span class="tree-dot tree-dot-direct" aria-hidden="true"></span>
                        <span class="allstar-view-downstream-main">
                            <strong>${escapeHtml(root.node)}</strong>
                            <span>${escapeHtml(rootIdentity)}</span>
                        </span>
                        <span class="allstar-view-downstream-state">
                            <span class="allstar-view-chip ${modeClass(root.mode)}">${escapeHtml(root.mode_label)}</span>
                        </span>
                    </button>
                    <div class="allstar-view-downstream-children">${childRows}</div>
                </section>`;
        }).join('');


        if (state.scrollDownstreamOnRender) {
            let target = null;
            if (state.preferredRemoteClients) {
                target = elements.downstream.querySelector('[data-downstream-group="remote-clients"]');
            } else if (state.preferredDirectNode) {
                target = Array.from(elements.downstream.querySelectorAll('[data-direct-node]'))
                    .find((group) => String(group.dataset.directNode || '') === state.preferredDirectNode) || null;
            }

            if (target) {
                state.scrollDownstreamOnRender = false;
                elements.downstream.scrollTo({ top: 0, behavior: 'smooth' });
                target.classList.add('is-focus-flash');
                window.clearTimeout(state.downstreamHighlightTimer);
                state.downstreamHighlightTimer = window.setTimeout(() => {
                    target.classList.remove('is-focus-flash');
                }, 1600);
            }
        }
    }

    elements.downstream?.addEventListener('click', (event) => {
        const row = event.target.closest('[data-downstream-root-key], [data-downstream-key], [data-remote-client-key]');
        if (!row || !elements.downstream.contains(row)) {
            return;
        }

        const rootKey = String(row.dataset.downstreamRootKey || '');
        if (rootKey) {
            const item = state.downstreamDirect.find((entry) => entry.key === rootKey);
            if (item) {
                prioritizeDownstream(item.node);
                selectItem(item, 'root');
            }
            return;
        }

        const downstreamKey = String(row.dataset.downstreamKey || '');
        if (downstreamKey) {
            const item = state.downstreamNodes.find((entry) => entry.key === downstreamKey);
            if (item) selectItem(item, 'downstream');
            return;
        }

        const clientKey = String(row.dataset.remoteClientKey || '');
        const item = state.connections.find((entry) => entry.key === clientKey);
        if (item) {
            prioritizeRemoteClients();
            selectItem(item, 'current');
        }
    });

    function setLink(element, url, visible) {
        if (!element) {
            return;
        }
        element.hidden = !visible;
        if (visible) {
            element.href = url;
        } else {
            element.removeAttribute('href');
        }
    }

    function renderDetails(item) {
        if (!item) {
            clearDetails();
            return;
        }

        if (elements.detailNode) elements.detailNode.textContent = item.node || '—';
        if (elements.detailCall) elements.detailCall.textContent = item.callsign || '—';
        if (elements.detailLocation) elements.detailLocation.textContent = item.location || '—';

        if (elements.detailPath) {
            if (item.historical) {
                const eventLabel = activityLabel(item.activity_type);
                const mode = item.mode_label && item.mode_label !== 'Recorded state' ? ` · ${item.mode_label}` : '';
                const direction = item.direction ? ` · ${item.direction}` : '';
                elements.detailPath.textContent = `Historical ${eventLabel} · ${formatTime(item.activity_timestamp)} · ${item.source}${mode}${direction}`;
            } else if (item.direct_node) {
                elements.detailPath.textContent = `${downstreamPath(item)} · Depth ${item.depth || 1} · ${item.mode_label}`;
            } else if (String(item.key || '').startsWith('downstream-root:')) {
                const local = state.localNode ? `${state.localNode} → ` : '';
                elements.detailPath.textContent = `${local}${item.node} · Direct AllStarLink · ${item.mode_label}`;
            } else if (isRemoteWebPhoneClient(item)) {
                elements.detailPath.textContent = `${downstreamPath(item)} · Web/Phone Client · ${item.mode_label}`;
            } else {
                elements.detailPath.textContent = `${item.source} · ${item.mode_label}${item.direction ? ` · ${item.direction}` : ''}`;
            }
        }

        if (elements.detailDescription) {
            const baseDescription = item.description || item.channel || item.peer || 'No additional description is available.';
            if (item.historical && item.activity_type === 'unkey' && Number(item.duration_seconds || 0) > 0) {
                elements.detailDescription.textContent = `${baseDescription} · Keyed for ${Number(item.duration_seconds)} seconds.`;
            } else {
                elements.detailDescription.textContent = baseDescription;
            }
        }

        const hasQrz = Boolean(item.qrz_url);
        setLink(elements.detailQrz, item.qrz_url, hasQrz);
        if (elements.detailLinks) {
            elements.detailLinks.hidden = !hasQrz;
        }
    }

    function clearDetails() {
        if (elements.detailNode) elements.detailNode.textContent = '—';
        if (elements.detailCall) elements.detailCall.textContent = '—';
        if (elements.detailPath) elements.detailPath.textContent = 'Select a row';
        if (elements.detailLocation) elements.detailLocation.textContent = '—';
        if (elements.detailDescription) elements.detailDescription.textContent = '—';
        if (elements.detailLinks) elements.detailLinks.hidden = true;
    }

    function unresolvedEchoLinkNodes() {
        const identifiers = new Set();
        for (const item of [...state.connections, ...state.downstreamNodes, ...state.activity]) {
            if (String(item?.kind || '') !== 'echo') continue;

            const callsign = String(item.callsign || '').trim().toUpperCase();
            const callsignKey = echoLinkCallsignKey(callsign);
            if (callsignKey && !state.echoLinkEntries[callsignKey]?.node) {
                identifiers.add(callsign);
                continue;
            }

            const node = echoLinkNodeNumber(item.echolink_node || item.reported_node || item.node);
            if (node && !callsign && !state.echoLinkEntries[node]?.callsign) {
                identifiers.add(node);
            }
        }
        return Array.from(identifiers);
    }

    function applyEchoLinkEntries(entries) {
        if (entries && typeof entries === 'object') {
            state.echoLinkEntries = { ...state.echoLinkEntries, ...entries };
        }
        state.connections = state.connections.map(applyEchoLinkIdentity);
        state.downstreamNodes = state.downstreamNodes.map(applyEchoLinkIdentity);
        state.activity = state.activity.map((item) => String(item?.kind || '') === 'echo' ? applyEchoLinkIdentity(item) : item);
        window.dispatchEvent(new CustomEvent('allstar_view:connections', { detail: state.connections }));
    }

    function scheduleEchoLinkLookup(delay = 150) {
        if (!echoLinkEndpoint || document.hidden || state.echoLinkLoading || !unresolvedEchoLinkNodes().length) {
            return;
        }

        const wait = Math.max(delay, state.echoLinkNextAllowed - Date.now());
        window.clearTimeout(state.echoLinkTimer);
        state.echoLinkTimer = window.setTimeout(refreshEchoLink, wait);
    }

    async function refreshEchoLink() {
        const lookupNodes = unresolvedEchoLinkNodes();
        if (!echoLinkEndpoint || state.echoLinkLoading || document.hidden || !lookupNodes.length) {
            return;
        }

        state.echoLinkLoading = true;
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 3500);

        try {
            const response = await fetch(`${echoLinkEndpoint}?_=${Date.now()}`, {
                method: 'POST',
                cache: 'no-store',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nodes: lookupNodes }),
                signal: controller.signal,
            });
            const payload = await response.json();
            if (!response.ok || !payload?.ok || !payload?.data) {
                throw new Error(payload?.message || 'EchoLink identity lookup failed.');
            }

            const pending = Number(payload.data.pending || 0);
            const retrySeconds = Math.max(1, Number(payload.data.retry_after_seconds || 15));
            state.echoLinkNextAllowed = pending > 0 ? Date.now() + retrySeconds * 1000 : 0;
            applyEchoLinkEntries(payload.data.entries || {});
            renderConnections(state.connections);
            renderActivity();
            renderDownstream();
            renderDetails(selectedItem());
            if (payload.data.updated) {
                window.setTimeout(refreshLocal, 100);
            }
            if (pending > 0) {
                scheduleEchoLinkLookup(retrySeconds * 1000);
            }
        } catch (error) {
            state.echoLinkNextAllowed = Date.now() + 30000;
        } finally {
            window.clearTimeout(timeout);
            state.echoLinkLoading = false;
        }
    }

    function renderLocalSnapshot(snapshot) {
        state.localSnapshotLoaded = true;
        const connections = Array.isArray(snapshot.connections) ? snapshot.connections : [];
        const summary = snapshot.summary && typeof snapshot.summary === 'object' ? snapshot.summary : {};
        state.localNode = String(snapshot.node || state.localNode || '').trim();
        state.connections = connections.map(applyEchoLinkIdentity);
        state.activity = (Array.isArray(snapshot.activity) ? snapshot.activity : [])
            .map((item) => String(item?.kind || '') === 'echo' ? applyEchoLinkIdentity(item) : item);
        window.dispatchEvent(new CustomEvent('allstar_view:connections', { detail: state.connections }));

        if (state.selectedType === 'current' && !state.connections.some((item) => item.key === state.selectedKey)) {
            state.selectedKey = '';
            state.selectedType = '';
        }
        if (state.selectedType === 'activity' && !state.activity.some((item) => activityEventKey(item) === state.selectedKey)) {
            state.selectedKey = '';
            state.selectedType = '';
        }
        if (state.preferredDirectNode && !connections.some((item) => item.kind === 'asl' && String(item.node) === state.preferredDirectNode)) {
            state.preferredDirectNode = '';
            state.scrollDownstreamOnRender = false;
        }
        if (state.preferredRemoteClients && !connections.some(isRemoteWebPhoneClient)) {
            state.preferredRemoteClients = false;
            state.scrollDownstreamOnRender = false;
        }
        if (!state.selectedKey && connections.length) {
            state.selectedKey = connections[0].key;
            state.selectedType = 'current';
        }

        renderActivity();
        renderConnections(state.connections);
        renderDownstream();
        updateDownstreamSummary();
        renderDetails(selectedItem());

        if (elements.directCount) elements.directCount.textContent = String(summary.direct ?? connections.length);
        if (elements.directNote) {
            const hidden = Number(summary.hidden_private || 0);
            elements.directNote.textContent = hidden > 0 ? `${hidden} configured private link hidden` : 'Local Asterisk data';
        }
        if (elements.keyedCount) elements.keyedCount.textContent = String(summary.keyed ?? 0);
        if (elements.keyedNote) elements.keyedNote.textContent = Number(summary.keyed || 0) > 0 ? 'Current keyed connections' : 'No connection keyed';
        if (elements.refreshTime) elements.refreshTime.textContent = formatTime(snapshot.timestamp);

        scheduleEchoLinkLookup();
    }

    function updateDownstreamSummary() {
        const summary = state.downstreamSummary && typeof state.downstreamSummary === 'object' ? state.downstreamSummary : {};
        const cache = state.downstreamCache && typeof state.downstreamCache === 'object' ? state.downstreamCache : {};
        const publicCount = Number(summary.downstream || 0);
        const privateCount = Number(summary.private || 0);
        const downstreamClientCount = Number(summary.remote_clients || 0);
        const echoCount = Number(summary.echolink || 0);
        const localClientCount = state.connections.filter(isRemoteWebPhoneClient).length;
        const clientCount = downstreamClientCount + localClientCount;
        const total = publicCount + privateCount + clientCount + echoCount;

        if (elements.downstreamCount) {
            elements.downstreamCount.textContent = String(total);
        }
        if (!elements.downstreamNote) {
            return;
        }

        const hidden = Number(summary.hidden || 0);
        if (!state.downstreamDirect.length) {
            elements.downstreamNote.textContent = localClientCount > 0
                ? `${localClientCount} ${localClientCount === 1 ? 'client' : 'clients'} · no public tree`
                : 'Waiting for direct AllStarLink';
            return;
        }
        if (cache.refreshing) {
            elements.downstreamNote.textContent = cache.pending > 0
                ? `Scanning full tree · ${cache.pending} queued`
                : 'Finishing full-tree scan';
            return;
        }
        if (!cache.updated_at) {
            elements.downstreamNote.textContent = 'Waiting for first cached result';
            return;
        }

        const parts = [`${publicCount} ${publicCount === 1 ? 'node' : 'nodes'}`];
        if (privateCount > 0) {
            parts.push(`${privateCount} ${privateCount === 1 ? 'pvt node' : 'pvt nodes'}`);
        }
        if (clientCount > 0) {
            parts.push(`${clientCount} ${clientCount === 1 ? 'client' : 'clients'}`);
        }
        if (echoCount > 0) {
            parts.push(`${echoCount} EchoLink`);
        }
        if (hidden > 0) {
            parts.push(`${hidden} filtered`);
        }
        elements.downstreamNote.textContent = parts.join(' · ');
    }

    function renderDownstreamSnapshot(snapshot) {
        const summary = snapshot.summary && typeof snapshot.summary === 'object' ? snapshot.summary : {};
        const cache = snapshot.cache && typeof snapshot.cache === 'object' ? snapshot.cache : {};
        state.downstreamSummary = summary;
        state.downstreamCache = cache;
        state.downstreamNodes = (Array.isArray(snapshot.nodes) ? snapshot.nodes : []).map(applyEchoLinkIdentity);
        state.downstreamDirect = Array.isArray(snapshot.direct) ? snapshot.direct : [];

        if (state.selectedType === 'downstream' && !state.downstreamNodes.some((item) => item.key === state.selectedKey)) {
            state.selectedKey = '';
            state.selectedType = '';
        }
        if (state.selectedType === 'root' && !state.downstreamDirect.some((item) => item.key === state.selectedKey)) {
            state.selectedKey = '';
            state.selectedType = '';
        }
        if (!state.selectedKey && !state.connections.length) {
            const first = state.downstreamNodes[0] || state.downstreamDirect[0];
            if (first) {
                state.selectedKey = first.key;
                state.selectedType = first.direct_node ? 'downstream' : 'root';
            }
        }

        updateDownstreamSummary();

        renderDownstream();
        renderDetails(selectedItem());
        scheduleEchoLinkLookup();
    }


    async function refreshLocal() {
        if (state.localLoading || document.hidden) {
            return;
        }
        state.localLoading = true;
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 2500);

        try {
            const response = await fetch(`${localEndpoint}?_=${Date.now()}`, {
                cache: 'no-store',
                credentials: 'same-origin',
                signal: controller.signal,
            });
            const payload = await response.json();
            if (!response.ok || !payload?.ok || !payload?.data) {
                throw new Error(payload?.message || 'Local status request failed.');
            }
            renderLocalSnapshot(payload.data);
        } catch (error) {
            if (error?.name === 'AbortError' && state.localSnapshotLoaded) {
                return;
            }
            // Keep the last successful snapshot and retry quietly.
        } finally {
            window.clearTimeout(timeout);
            state.localLoading = false;
        }
    }

    async function refreshDownstream() {
        if (!downstreamEndpoint || state.downstreamLoading || document.hidden) {
            return;
        }
        state.downstreamLoading = true;
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 3500);

        try {
            const response = await fetch(`${downstreamEndpoint}?_=${Date.now()}`, {
                cache: 'no-store',
                credentials: 'same-origin',
                signal: controller.signal,
            });
            const payload = await response.json();
            if (!response.ok || !payload?.ok || !payload?.data) {
                throw new Error(payload?.message || 'Downstream status request failed.');
            }
            renderDownstreamSnapshot(payload.data);
        } catch (error) {
            // Keep the last successful tree and retry quietly.
        } finally {
            window.clearTimeout(timeout);
            state.downstreamLoading = false;
        }
    }

    for (const button of elements.downstreamFilters) {
        button.addEventListener('click', () => {
            const filter = String(button.dataset.downstreamFilter || 'all');
            if (!['all', 'nodes', 'private', 'clients', 'echolink'].includes(filter) || filter === state.downstreamFilter) {
                return;
            }
            state.downstreamFilter = filter;
            state.scrollDownstreamOnRender = false;
            if (elements.downstream) elements.downstream.scrollTop = 0;
            renderDownstream();
        });
    }

    function schedule() {
        window.clearInterval(state.localTimer);
        window.clearInterval(state.downstreamTimer);
        state.localTimer = window.setInterval(refreshLocal, 1000);
        state.downstreamTimer = window.setInterval(refreshDownstream, 2000);
    }

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            refreshLocal();
            refreshDownstream();
            scheduleEchoLinkLookup();
        }
    });

    refreshLocal();
    window.setTimeout(refreshDownstream, 800);
    schedule();
})();
