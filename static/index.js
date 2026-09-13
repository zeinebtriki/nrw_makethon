let activeBoxes = [];

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const content = document.getElementById('content-wrapper');
    sidebar.classList.toggle('collapsed');
    content.classList.toggle('expanded');
}

async function fetchInventoryTable() {
    try {
        const res = await fetch('/api/rack_matrix');
        const data = await res.json();
        
        if (!res.ok) return;

        activeBoxes = [];
        data.grid.forEach(row => {
            row.forEach(cell => {
                if (cell.occupied) {
                    activeBoxes.push(cell);
                }
            });
        });

        renderTable(activeBoxes);
    } catch (err) {
        console.error('Error fetching inventory table data:', err);
    }
}

function renderTable(boxes) {
    const tbody = document.getElementById('inventory-table-body');
    
    if (boxes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="padding: 20px; text-align: center; color: var(--text-muted);">No active boxes found in rack.</td></tr>`;
        return;
    }

    tbody.innerHTML = boxes.map(b => `
        <tr style="border-bottom: 1px solid var(--border);">
            <td style="padding: 10px 12px; font-weight: 600;">#${b.box_id}</td>
            <td style="padding: 10px 12px;">${b.type_name}</td>
            <td style="padding: 10px 12px;"><code style="background: var(--bg-main); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border);">R${b.row} : C${b.col}</code></td>
            <td style="padding: 10px 12px; font-weight: 600;">${b.quantity} pcs</td>
            <td style="padding: 10px 12px;">
                <span style="padding: 3px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 700; background: ${b.is_ready ? 'var(--status-ready-bg)' : 'var(--status-drying-bg)'}; color: ${b.is_ready ? 'var(--status-ready)' : 'var(--status-drying)'};">
                    ${b.is_ready ? 'READY' : 'DRYING'}
                </span>
            </td>
        </tr>
    `).join('');
}

function filterInventoryTable() {
    const query = document.getElementById('inventory-search').value.toLowerCase();
    const filtered = activeBoxes.filter(b => 
        b.type_name.toLowerCase().includes(query) || 
        b.box_id.toString().includes(query)
    );
    renderTable(filtered);
}

document.addEventListener('DOMContentLoaded', fetchInventoryTable);