// Populate dropdown options on page load
async function loadCoreTypes() {
    try {
        const res = await fetch('/api/core_types_summary');
        const types = await res.json();
        const select = document.getElementById('core-type-select');
        select.innerHTML = '<option value="">-- Select Core Type --</option>';
        types.forEach(t => {
            select.innerHTML += `<option value="${t.type_id}">${t.type_name} (${t.ready_quantity} ready)</option>`;
        });
    } catch (err) {
        console.error('Failed to load core types:', err);
    }
}

// Request pick instructions from backend
async function submitDispatchOrder() {
    const typeId = document.getElementById('core-type-select').value;
    const qty = document.getElementById('quantity-input').value;

    if (!typeId || !qty || qty <= 0) {
        alert('Please select a core type and valid quantity.');
        return;
    }

    try {
        const res = await fetch('/api/request_dispatch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type_id: typeId, quantity: qty })
        });
        const data = await res.json();

        if (!res.ok) {
            alert(data.error || 'Dispatch request failed');
            return;
        }

        renderPickInstructions(data.pick_instructions);
    } catch (err) {
        console.error('Dispatch request failed:', err);
    }
}

// Render instructions clearly on screen
function renderPickInstructions(instructions) {
    const container = document.getElementById('pick-instructions-list');
    container.innerHTML = '<h2 style="margin-top: 20px;">Pick Instructions (FIFO Order)</h2>';

    instructions.forEach((step, idx) => {
        const isPartial = step.action === 'PICK_AND_RETURN_BOX';
        const card = document.createElement('div');
        card.className = `instruction-card ${isPartial ? 'partial' : ''}`;
        card.id = `step-card-${step.box_id}`;

        const actionText = isPartial 
            ? `Take <strong>${step.take_quantity}</strong> pcs and <strong>RETURN box</strong> to slot [R${step.row_index} : C${step.col_index}] (${step.remaining_in_box} pcs left inside)`
            : `Take <strong>FULL BOX</strong> (${step.take_quantity} pcs) from slot [R${step.row_index} : C${step.col_index}] and leave slot empty`;

        card.innerHTML = `
            <div class="badge-loc">Step ${idx + 1}: Slot [R${step.row_index} : C${step.col_index}]</div>
            <p style="margin: 10px 0; color: #cbd5e1;">${actionText}</p>
            <button class="btn" onclick="confirmStep(${step.box_id}, ${step.take_quantity})">Confirm Picked</button>
        `;
        container.appendChild(card);
    });
}

// Confirm step completion and update DB
async function confirmStep(boxId, qty) {
    try {
        const res = await fetch('/api/confirm_pick', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ box_id: boxId, picked_quantity: qty })
        });

        if (res.ok) {
            const card = document.getElementById(`step-card-${boxId}`);
            card.style.opacity = '0.5';
            card.innerHTML = '<b style="color: #10b981;">✓ Step Completed & DB Updated</b>';
        }
    } catch (err) {
        console.error('Pick confirmation failed:', err);
    }
}

document.addEventListener('DOMContentLoaded', loadCoreTypes);