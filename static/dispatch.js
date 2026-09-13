// ── Dispatch Terminal ────────────────────────────────────────────────
// Left: search + type grid (from /api/core_types_summary).
// Right: quantity entry -> availability check -> step-by-step pick wizard
// (from /api/request_dispatch) -> counting station for partial picks
// (from /api/confirm_pick) -> done.
//
// TODO(hardware): the "Simulate: remove 1 piece" button stands in for
// the ESP32 scale sending live weight readings during a partial pick.
// Replace simulateRemovePiece() with a real weight-poll loop that calls
// /api/calculate_count as weight changes, once the scale is wired in.

let coreTypes = [];
let selectedType = null;
let rackGrid = null;       // cached /api/rack_matrix grid
let pickPlan = [];
let currentStepIndex = 0;

// counting station state for the active partial-pick step
let counting = { boxId: null, startQty: 0, targetRemove: 0, removed: 0, takeQty: 0 };

const panels = {
    empty: document.getElementById('panel-empty'),
    quantity: document.getElementById('panel-quantity'),
    error: document.getElementById('panel-error'),
    step: document.getElementById('panel-step'),
    done: document.getElementById('panel-done'),
};

function showPanel(name) {
    Object.values(panels).forEach(p => p.classList.remove('is-active'));
    panels[name].classList.add('is-active');
}

function showToast(msg, isError = false) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.toggle('toast-error', isError);
    toast.classList.add('is-visible');
    setTimeout(() => toast.classList.remove('is-visible'), 3200);
}

// ── Load types (left grid) ──────────────────────────────────────────
async function loadTypes() {
    try {
        const res = await fetch('/api/core_types_summary');
        coreTypes = await res.json();
        renderTypeGrid(coreTypes);
    } catch (err) {
        console.error('Failed to load core types:', err);
        showToast('Could not load core types.', true);
    }
}

function thumbHtml(type) {
    if (type.image_path) {
        return `<img src="${type.image_path}" alt="" onerror="this.remove()">`;
    }
    return '';
}

function renderTypeGrid(list) {
    const grid = document.getElementById('type-grid');
    if (list.length === 0) {
        grid.innerHTML = `<p class="type-grid-empty">No matching core types.</p>`;
        return;
    }
    grid.innerHTML = list.map(t => `
        <button class="type-card ${selectedType && selectedType.type_id === t.type_id ? 'is-selected' : ''}"
                data-id="${t.type_id}">
            <div class="type-thumb">${thumbHtml(t)}</div>
            <span class="type-name">${t.type_name}</span>
            <span class="type-sub">${t.ready_quantity} ready</span>
        </button>
    `).join('');
    grid.querySelectorAll('.type-card').forEach(card => {
        card.addEventListener('click', () => selectType(Number(card.dataset.id)));
    });
}

document.getElementById('type-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    renderTypeGrid(coreTypes.filter(t => t.type_name.toLowerCase().includes(q)));
});

// ── Type selection -> quantity panel ────────────────────────────────
function selectType(typeId) {
    selectedType = coreTypes.find(t => t.type_id === typeId);
    if (!selectedType) return;

    renderTypeGrid(
        document.getElementById('type-search').value
            ? coreTypes.filter(t => t.type_name.toLowerCase().includes(document.getElementById('type-search').value.toLowerCase()))
            : coreTypes
    );

    document.getElementById('sel-type-thumb').innerHTML = thumbHtml(selectedType);
    document.getElementById('sel-type-name').textContent = selectedType.type_name;
    document.getElementById('sel-type-stock').textContent =
        `${selectedType.ready_quantity} ready · ${selectedType.drying_quantity} still drying`;
    document.getElementById('qty-input').value = 1;
    showPanel('quantity');
}

document.getElementById('qty-minus').addEventListener('click', () => {
    const input = document.getElementById('qty-input');
    input.value = Math.max(1, Number(input.value) - 1);
});
document.getElementById('qty-plus').addEventListener('click', () => {
    const input = document.getElementById('qty-input');
    input.value = Number(input.value) + 1;
});

// ── Availability check + pick wizard ────────────────────────────────
let errorCountdownTimer = null;

function stopErrorCountdown() {
    clearInterval(errorCountdownTimer);
    errorCountdownTimer = null;
    document.getElementById('error-countdown').style.display = 'none';
    document.getElementById('btn-error-recheck').style.display = 'none';
}

function formatDuration(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
}

function showError(title, desc, { waitSeconds = null, typeId = null, qty = null } = {}) {
    document.getElementById('error-title').textContent = title;
    document.getElementById('error-desc').textContent = desc;
    stopErrorCountdown();

    if (waitSeconds !== null) {
        let remaining = waitSeconds;
        const countdownEl = document.getElementById('error-countdown');
        const numEl = document.getElementById('error-countdown-num');
        const recheckBtn = document.getElementById('btn-error-recheck');
        countdownEl.style.display = 'block';
        numEl.textContent = formatDuration(remaining);

        errorCountdownTimer = setInterval(() => {
            remaining = Math.max(0, remaining - 1);
            numEl.textContent = formatDuration(remaining);
            if (remaining <= 0) {
                clearInterval(errorCountdownTimer);
                recheckBtn.style.display = 'inline-block';
                numEl.textContent = 'Ready now';
            }
        }, 1000);

        recheckBtn.style.display = 'none';
        recheckBtn.onclick = () => startPick(typeId, qty);
    }

    showPanel('error');
}

document.getElementById('btn-check').addEventListener('click', async () => {
    const qty = Number(document.getElementById('qty-input').value);
    if (!selectedType || qty <= 0) return;
    await startPick(selectedType.type_id, qty);
});

document.getElementById('btn-error-back').addEventListener('click', () => {
    stopErrorCountdown();
    showPanel('quantity');
});

// ── Pick wizard ──────────────────────────────────────────────────────
async function startPick(typeId, qty) {
    try {
        const dispatchRes = await fetch('/api/request_dispatch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type_id: typeId, quantity: qty }),
        });
        const dispatchData = await dispatchRes.json();

        if (!dispatchRes.ok) {
            if (dispatchData.status === 'no_stock') {
                showError('No stock of this type', 'Nothing in inventory can cover this — even once everything currently drying is ready. Production needs to make more.');
            } else if (dispatchData.status === 'not_enough_ready') {
                showError(
                    'Not enough ready pieces',
                    `Only ${dispatchData.ready_quantity} pcs have finished the 24h cure. Enough boxes will be ready in:`,
                    { waitSeconds: dispatchData.wait_seconds, typeId, qty }
                );
            } else {
                showError('Could not build a pick plan', dispatchData.error || 'Unknown error.');
            }
            return;
        }

        const rackRes = await fetch('/api/rack_matrix');
        const rackData = await rackRes.json();
        rackGrid = rackData.grid;

        pickPlan = dispatchData.pick_instructions;
        currentStepIndex = 0;
        showPanel('step');
        loadStep();
    } catch (err) {
        console.error('startPick failed:', err);
        showToast('Network error while planning the pick.', true);
    }
}

function renderRowStrip(rowIndex, targetCol) {
    const row = rackGrid ? rackGrid[rowIndex - 1] : null;
    const strip = document.getElementById('row-strip');
    strip.innerHTML = Array.from({ length: 5 }, (_, i) => {
        const col = i + 1;
        const cell = row ? row[i] : null;
        const isTarget = col === targetCol;
        const occupied = cell && cell.occupied;
        return `
            <div class="row-cell ${isTarget ? 'is-target' : ''} ${occupied ? 'is-occupied' : ''}">
                ${isTarget ? '<span class="row-cell-flag">PICK</span>' : ''}
                <span class="row-cell-col">C${col}</span>
                ${occupied ? `<span class="row-cell-qty">${cell.quantity}</span>` : ''}
            </div>`;
    }).join('');
}

function loadStep() {
    const step = pickPlan[currentStepIndex];
    document.getElementById('step-progress').textContent =
        `Step ${currentStepIndex + 1} of ${pickPlan.length}`;
    document.getElementById('step-row-label').textContent =
        `Row ${step.row_index} moving to your level…`;

    renderRowStrip(step.row_index, step.col_index);

    const removeActions = document.getElementById('step-actions-remove');
    const countingStation = document.getElementById('step-counting');

    if (step.action === 'REMOVE_BOX') {
        document.getElementById('step-title').textContent = `Take box #${step.box_id} — full box`;
        document.getElementById('step-desc').textContent =
            `Remove all ${step.take_quantity} pcs from column ${step.col_index}. The slot will be empty once it's gone.`;
        removeActions.style.display = 'flex';
        countingStation.style.display = 'none';
    } else {
        document.getElementById('step-title').textContent = `Partial pick from box #${step.box_id}`;
        document.getElementById('step-desc').textContent =
            `Place this box on the counting station. Remove ${step.take_quantity} of ${step.box_current_quantity} pcs, then return it to column ${step.col_index}.`;
        removeActions.style.display = 'none';
        countingStation.style.display = 'flex';
        startCounting(step);
    }
}

function startCounting(step) {
    counting = {
        boxId: step.box_id,
        startQty: step.box_current_quantity,
        targetRemove: step.take_quantity,
        removed: 0,
        takeQty: step.take_quantity,
    };
    document.getElementById('counter-num').textContent = counting.startQty;
    document.getElementById('counting-hint').textContent =
        `Remove one at a time — ${counting.targetRemove} to go.`;
    document.getElementById('btn-sim-remove').disabled = false;
    document.getElementById('btn-box-returned').disabled = true;
}

document.getElementById('btn-sim-remove').addEventListener('click', () => {
    if (counting.removed >= counting.targetRemove) return;
    counting.removed += 1;
    const remaining = counting.startQty - counting.removed;
    document.getElementById('counter-num').textContent = remaining;

    const toGo = counting.targetRemove - counting.removed;
    if (toGo <= 0) {
        document.getElementById('counting-hint').textContent =
            'Target reached — stop and put the box back exactly where you found it.';
        document.getElementById('btn-sim-remove').disabled = true;
        document.getElementById('btn-box-returned').disabled = false;
    } else {
        document.getElementById('counting-hint').textContent = `${toGo} more to go.`;
    }
});

async function confirmStep(pickedQuantity) {
    const step = pickPlan[currentStepIndex];
    try {
        const res = await fetch('/api/confirm_pick', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ box_id: step.box_id, picked_quantity: pickedQuantity }),
        });
        if (!res.ok) {
            const data = await res.json();
            showToast(data.error || 'Could not confirm this pick.', true);
            return;
        }
    } catch (err) {
        console.error('confirm_pick failed:', err);
        showToast('Network error confirming the pick.', true);
        return;
    }

    currentStepIndex += 1;
    if (currentStepIndex < pickPlan.length) {
        loadStep();
    } else {
        finishPick();
    }
}

document.getElementById('btn-box-removed').addEventListener('click', () => {
    confirmStep(pickPlan[currentStepIndex].take_quantity);
});

document.getElementById('btn-box-returned').addEventListener('click', () => {
    confirmStep(counting.takeQty);
});

function finishPick() {
    const qty = document.getElementById('qty-input').value;
    document.getElementById('done-summary').textContent =
        `${qty} pcs of ${selectedType.type_name} picked and ready for production.`;
    showPanel('done');
}

document.getElementById('btn-dispatch-new').addEventListener('click', () => {
    selectedType = null;
    pickPlan = [];
    currentStepIndex = 0;
    document.getElementById('type-search').value = '';
    renderTypeGrid(coreTypes);
    showPanel('empty');
    loadTypes(); // refresh ready/drying counts
});

loadTypes();