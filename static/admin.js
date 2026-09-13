// View Navigation
function switchView(viewId) {
    document.querySelectorAll('.admin-view').forEach(el => el.classList.remove('is-active'));
    document.getElementById(`view-${viewId}`).classList.add('is-active');

    if (viewId === 'grid') fetchRackMatrix();
    if (viewId === 'types') fetchTypesSummary();
}

// Grid View Logic
async function fetchRackMatrix() {
    try {
        const res = await fetch('/api/rack_matrix');
        const data = await res.json();
        if (res.ok) renderGrid(data.grid);
    } catch (err) {
        console.error('Network error fetching grid:', err);
    }
}

function renderGrid(gridData) {
    const container = document.getElementById('rack-matrix-container');
    container.innerHTML = '';

    gridData.forEach(row => {
        row.forEach(cell => {
            const card = document.createElement('div');
            
            if (!cell.occupied) {
                card.className = 'slot-card';
                card.innerHTML = `
                    <div class="slot-coord">R${cell.row} : C${cell.col}</div>
                    <div style="color: var(--text-muted); margin: auto; font-weight: 700; font-size: 0.85rem;">EMPTY</div>
                `;
            } else {
                const isReady = cell.is_ready;
                card.className = `slot-card ${isReady ? 'occupied-ready' : 'occupied-drying'}`;
                
                let timingHtml = '';
                if (isReady && cell.ready_duration_str) {
                    timingHtml = `<div class="timing-info" style="color: var(--status-ready);">${cell.ready_duration_str}</div>`;
                } else if (!isReady && cell.remaining_time) {
                    timingHtml = `<div class="timing-info" style="color: var(--status-drying);">Drying...<br/>⏱ ${cell.remaining_time}</div>`;
                }
                
                card.innerHTML = `
                    <div class="slot-coord">R${cell.row} : C${cell.col}</div>
                    <div class="slot-title">${cell.type_name}</div>
                    <div class="slot-qty" style="color: ${isReady ? 'var(--status-ready)' : 'var(--status-drying)'}">${cell.quantity} pcs</div>
                    <div>
                        <span class="status-badge ${isReady ? 'badge-ready' : 'badge-drying'}" style="margin-bottom: 4px;">
                            ${isReady ? 'READY' : 'DRYING'}
                        </span>
                        ${timingHtml}
                    </div>
                `;
            }
            
            container.appendChild(card);
        });
    });
}

// Types View Logic
async function fetchTypesSummary() {
    try {
        const res = await fetch('/api/core_types_summary');
        const data = await res.json();
        if (res.ok) renderTypes(data);
    } catch (err) {
        console.error('Network error fetching types:', err);
    }
}

function renderTypes(typesData) {
    const container = document.getElementById('types-grid-container');
    container.innerHTML = '';

    typesData.forEach(type => {
        const card = document.createElement('div');
        card.className = 'type-card';
        
        // Handle image path presentation
        let imageHtml = `<div class="type-photo-placeholder">[ No Image ]</div>`;
        if (type.image_path) {
            imageHtml = `<img src="${type.image_path}" alt="${type.type_name}" onerror="this.outerHTML='<div class=\'type-photo-placeholder\'>[ Image Error ]</div>'">`;
        }

        card.innerHTML = `
            <div>
                <h3 style="font-size: 1.2rem; font-weight: 800; color: var(--text-primary);">${type.type_name}</h3>
                <div style="font-size: 0.8rem; color: var(--text-muted);">Unit Weight: ${type.unit_weight_g}g</div>
            </div>
            
            <div class="type-photo-container">
                ${imageHtml}
            </div>

            <div style="display: flex; flex-direction: column; gap: 8px;">
                <div class="type-stat-row">
                    <span class="stat-label">Total Inventory</span>
                    <span class="stat-value">${type.total_quantity} pcs</span>
                </div>
                <div class="type-stat-row">
                    <span class="stat-label">Ready / Dried</span>
                    <span class="stat-value" style="color: var(--status-ready);">${type.ready_quantity} pcs</span>
                </div>
                <div class="type-stat-row">
                    <span class="stat-label">Currently Drying</span>
                    <span class="stat-value" style="color: var(--status-drying);">${type.drying_quantity} pcs</span>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

// Handle Submitting New Core Type
async function submitNewType(event) {
    event.preventDefault();
    
    const formData = new FormData();
    formData.append('type_name', document.getElementById('new_type_name').value);
    formData.append('unit_weight', document.getElementById('new_unit_weight').value);
    formData.append('image', document.getElementById('new_type_image').files[0]);

    try {
        const res = await fetch('/api/add_core_type', {
            method: 'POST',
            body: formData
        });
        
        const data = await res.json();
        
        if (res.ok) {
            document.getElementById('add-type-form').reset();
            showToast('Core type registered successfully.', false);
            switchView('types');
        } else {
            showToast(data.error || 'Failed to save core type.', true);
        }
    } catch (err) {
        showToast('Network error saving core type.', true);
    }
}

function showToast(message, isError) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast is-visible ${isError ? 'toast-error' : ''}`;
    setTimeout(() => {
        toast.classList.remove('is-visible');
    }, 3000);
}

// Initial fetch and auto-refresh for grid
document.addEventListener('DOMContentLoaded', () => {
    fetchRackMatrix();
    setInterval(() => {
        if (document.getElementById('view-grid').classList.contains('is-active')) {
            fetchRackMatrix();
        }
    }, 5000);
});