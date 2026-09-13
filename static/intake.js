// Load core types for the dropdown on page load
async function loadIntakeCoreTypes() {
    try {
        const res = await fetch('/api/core_types_summary');
        const types = await res.json();
        const select = document.getElementById('intake-core-type');
        
        select.innerHTML = '<option value="">-- Select / Detected Core --</option>';
        types.forEach(t => {
            select.innerHTML += `<option value="${t.type_id}">${t.type_name}</option>`;
        });
    } catch (err) {
        console.error('Failed to load core types:', err);
    }
}

// Register box deposit & trigger slot assignment
async function registerInboundBox() {
    const typeId = document.getElementById('intake-core-type').value;
    const qty = document.getElementById('intake-quantity').value;

    if (!typeId || !qty || qty <= 0) {
        alert('Please select a valid core type and enter a positive quantity.');
        return;
    }

    try {
        const res = await fetch('/api/register_box', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type_id: parseInt(typeId), quantity: parseInt(qty) })
        });

        const data = await res.json();

        if (!res.ok) {
            alert(data.error || 'Failed to deposit box.');
            return;
        }

        // Display assigned slot to operator
        const slotCard = document.getElementById('slot-result-card');
        const slotText = document.getElementById('target-slot-text');
        
        slotText.textContent = `[R${data.assigned_slot.row_index} : C${data.assigned_slot.col_index}]`;
        slotCard.style.display = 'block';

        // Clear quantity input for next scan
        document.getElementById('intake-quantity').value = '';
    } catch (err) {
        console.error('Deposit request error:', err);
    }
}

document.addEventListener('DOMContentLoaded', loadIntakeCoreTypes);