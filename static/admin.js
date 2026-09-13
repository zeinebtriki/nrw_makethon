async function fetchRackMatrix() {
    try {
        const res = await fetch('/api/rack_matrix');
        const data = await res.json();

        if (!res.ok) {
            console.error('Failed to fetch rack matrix data');
            return;
        }

        renderGrid(data.grid);
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
                    <div style="color: #475569; margin: auto;">EMPTY</div>
                `;
            } else {
                const isReady = cell.is_ready;
                card.className = `slot-card ${isReady ? 'occupied-ready' : 'occupied-drying'}`;
                
                card.innerHTML = `
                    <div class="slot-coord">R${cell.row} : C${cell.col}</div>
                    <div class="slot-title">${cell.type_name}</div>
                    <div class="slot-qty" style="color: ${isReady ? '#34d399' : '#fbbf24'}">${cell.quantity} pcs</div>
                    <div>
                        <span class="status-badge ${isReady ? 'badge-ready' : 'badge-drying'}">
                            ${isReady ? 'READY' : 'DRYING'}
                        </span>
                    </div>
                `;
            }
            
            container.appendChild(card);
        });
    });
}

// Initial fetch and auto-refresh every 5 seconds
document.addEventListener('DOMContentLoaded', () => {
    fetchRackMatrix();
    setInterval(fetchRackMatrix, 5000);
});