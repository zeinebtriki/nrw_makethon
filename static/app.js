const GRID_ROWS = 5;
const GRID_COLS = 5;
const POLL_INTERVAL_MS = 3000; // Refreshes data every 3 seconds

async function fetchAndRenderGrid() {
    try {
        const response = await fetch('/api/inventory');
        if (!response.ok) throw new Error('Failed to fetch inventory');
        
        const boxes = await response.json();

        // 1. Map existing boxes by coordinate string "row_col" for quick lookup
        const boxMap = {};
        boxes.forEach(box => {
            boxMap[`${box.row_index}_${box.col_index}`] = box;
        });

        const gridContainer = document.getElementById('grid');
        gridContainer.innerHTML = ''; // Clear current grid UI

        // 2. Build the 5x5 matrix dynamically
        for (let r = 1; r <= GRID_ROWS; r++) {
            for (let c = 1; c <= GRID_COLS; c++) {
                const key = `${r}_${c}`;
                const box = boxMap[key];

                const slot = document.createElement('div');
                slot.className = 'rack-slot';

                if (box) {
                    // Spot occupied: set drying vs ready styles
                    const isReady = box.is_ready;
                    slot.classList.add(isReady ? 'ready' : 'drying');

                    slot.innerHTML = `
                        <div class="slot-coord">[R${r} : C${c}]</div>
                        <div class="slot-title">${box.type_name}</div>
                        <div class="slot-qty">${box.quantity} pcs</div>
                        <span class="slot-status ${isReady ? 'status-ready' : 'status-drying'}">
                            ${isReady ? 'READY' : 'DRYING'}
                        </span>
                    `;
                } else {
                    // Empty spot
                    slot.innerHTML = `
                        <div class="slot-coord">[R${r} : C${c}]</div>
                        <div class="slot-title" style="color: #64748b;">Empty</div>
                    `;
                }

                gridContainer.appendChild(slot);
            }
        }
    } catch (error) {
        console.error('Error updating live grid:', error);
    }
}

// Initial fetch on page load + polling setup
document.addEventListener('DOMContentLoaded', () => {
    fetchAndRenderGrid();
    setInterval(fetchAndRenderGrid, POLL_INTERVAL_MS);
});