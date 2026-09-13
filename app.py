from flask import Flask, jsonify, request, render_template
from flask_cors import CORS
import mysql.connector
import datetime
from datetime import timedelta


app = Flask(__name__)
CORS(app)

GRID_ROWS = 5 
GRID_COLS = 5

def get_db_connection():
    connection = mysql.connector.connect(
        host="127.0.0.1",
        user="root",
        password="zeineb",  
        database="smart_core_warehouse"
    )
    return connection

@app.route('/api/inventory', methods=['GET'])
def get_inventory():
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    
    query = """
        SELECT b.box_id, b.type_id, t.type_name, b.quantity, b.row_index, b.col_index, b.stored_at 
        FROM inventory_boxes b 
        JOIN core_types t ON b.type_id = t.type_id 
        WHERE b.is_present = TRUE
    """
    cursor.execute(query)
    boxes = cursor.fetchall()
    
    cursor.close()
    conn.close()
    
    current_time = datetime.datetime.now()
    
    for box in boxes:
        time_diff = current_time - box['stored_at']
        box['is_ready'] = time_diff >= timedelta(hours=24)
        box['stored_at'] = box['stored_at'].strftime('%Y-%m-%d %H:%M:%S')
        
    return jsonify(boxes)

@app.route('/api/request_production', methods=['POST'])
def request_production():
    data = request.get_json()
    type_id = data.get('type_id')
    requested_qty = data.get('requested_qty')

    if not type_id or not requested_qty or requested_qty <= 0:
        return jsonify({'error': 'Invalid type_id or requested_qty'}), 400

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    # 1. Get all ready boxes for this core type sorted by oldest first (FIFO)
    fifo_query = """
        SELECT box_id, quantity, row_index, col_index, stored_at
        FROM inventory_boxes
        WHERE type_id = %s 
          AND is_present = TRUE 
          AND stored_at <= (NOW() - INTERVAL 24 HOUR)
        ORDER BY stored_at ASC
    """
    cursor.execute(fifo_query, (type_id,))
    available_boxes = cursor.fetchall()

    total_available = sum(b['quantity'] for b in available_boxes)
    if total_available < requested_qty:
        cursor.close()
        conn.close()
        return jsonify({
            'error': f'Not enough ready cores. Requested: {requested_qty}, Available: {total_available}'
        }), 400

    # 2. Calculate pick plan across multiple boxes
    remaining_to_pick = requested_qty
    instructions = []

    for box in available_boxes:
        if remaining_to_pick == 0:
            break

        box_id = box['box_id']
        current_qty = box['quantity']

        if current_qty <= remaining_to_pick:
            # Take full box
            take_qty = current_qty
            remaining_to_pick -= take_qty
            
            cursor.execute("UPDATE inventory_boxes SET is_present = FALSE WHERE box_id = %s", (box_id,))
            
            instructions.append({
                'box_id': box_id,
                'row_index': box['row_index'],
                'col_index': box['col_index'],
                'action': 'TAKE_FULL_BOX',
                'take_qty': take_qty,
                'remaining_in_box': 0
            })
        else:
            # Take partial box
            take_qty = remaining_to_pick
            new_box_qty = current_qty - take_qty
            remaining_to_pick = 0

            cursor.execute("UPDATE inventory_boxes SET quantity = %s WHERE box_id = %s", (new_box_qty, box_id))

            instructions.append({
                'box_id': box_id,
                'row_index': box['row_index'],
                'col_index': box['col_index'],
                'action': 'TAKE_PARTIAL_BOX',
                'take_qty': take_qty,
                'remaining_in_box': new_box_qty
            })

    conn.commit()
    cursor.close()
    conn.close()

    return jsonify({
        'message': 'Pick sequence calculated successfully',
        'requested_qty': requested_qty,
        'instructions': instructions
    }), 200


@app.route('/api/calculate_count', methods=['POST'])
def calculate_count():
    data = request.get_json()
    type_id = data.get('type_id')
    current_weight_g = data.get('current_weight_g')

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT unit_weight_g FROM core_types WHERE type_id = %s", (type_id,))
    core_type = cursor.fetchone()
    cursor.close()
    conn.close()

    if not core_type:
        return jsonify({'error': 'Type not found'}), 404

    unit_weight = float(core_type['unit_weight_g'])
    current_count = int(round(float(current_weight_g) / unit_weight))

    return jsonify({'current_count': current_count}), 200


@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/core_types_summary', methods=['GET'])
def get_core_types_summary():
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    query = """
        SELECT 
            ct.type_id,
            ct.type_name,
            ct.unit_weight_g,
            ct.image_path,
            COALESCE(SUM(ib.quantity), 0) AS total_quantity,
            COALESCE(SUM(CASE WHEN ib.stored_at <= (NOW() - INTERVAL 24 HOUR) THEN ib.quantity ELSE 0 END), 0) AS ready_quantity,
            COALESCE(SUM(CASE WHEN ib.stored_at > (NOW() - INTERVAL 24 HOUR) THEN ib.quantity ELSE 0 END), 0) AS drying_quantity
        FROM core_types ct
        LEFT JOIN inventory_boxes ib ON ct.type_id = ib.type_id AND ib.is_present = TRUE
        GROUP BY ct.type_id, ct.type_name, ct.unit_weight_g, ct.image_path
    """
    cursor.execute(query)
    summary = cursor.fetchall()

    cursor.close()
    conn.close()
    s=0
    return jsonify(summary), 200

@app.route('/api/request_dispatch', methods=['POST'])
def request_dispatch():
    data = request.get_json()
    type_id = data.get('type_id')
    req_qty = int(data.get('quantity', 0))

    if not type_id or req_qty <= 0:
        return jsonify({'error': 'Invalid core type or quantity requested.'}), 400

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    # Fetch available ready boxes (>= 24h drying time), ordered by oldest first (FIFO)
    query = """
        SELECT ib.box_id, ib.row_index, ib.col_index, ib.quantity
        FROM inventory_boxes ib
        WHERE ib.type_id = %s 
          AND ib.is_present = TRUE
          AND ib.stored_at <= (NOW() - INTERVAL 24 HOUR)
        ORDER BY ib.stored_at ASC
    """
    cursor.execute(query, (type_id,))
    boxes = cursor.fetchall()

    total_available = sum(b['quantity'] for b in boxes)
    if total_available < req_qty:
        # NEW: not enough READY stock. Walk the FIFO queue across ALL
        # present boxes of this type (ready + still drying) to find how
        # long until enough of them cross the 24h mark to cover req_qty.
        cursor.execute("""
            SELECT box_id, quantity, stored_at
            FROM inventory_boxes
            WHERE type_id = %s AND is_present = TRUE
            ORDER BY stored_at ASC
        """, (type_id,))
        all_boxes = cursor.fetchall()
        total_all = sum(b['quantity'] for b in all_boxes)

        cursor.close()
        conn.close()

        if total_all < req_qty:
            # Not enough stock even after everything currently in the
            # rack finishes drying — production needs to make more.
            return jsonify({
                'status': 'no_stock',
                'error': f'Not enough total stock. Needed: {req_qty}, In inventory (incl. drying): {total_all}'
            }), 400

        # Accumulate in FIFO order until quantity covers the request;
        # the box that tips it over is the one whose 24h mark we wait on.
        cumulative = 0
        ready_at = None
        for b in all_boxes:
            cumulative += b['quantity']
            if cumulative >= req_qty:
                ready_at = b['stored_at'] + timedelta(hours=24)
                break

        wait_seconds = max(0, int((ready_at - datetime.datetime.now()).total_seconds()))

        return jsonify({
            'status': 'not_enough_ready',
            'error': f'Not enough ready cores yet. Ready: {total_available}, Needed: {req_qty}',
            'ready_quantity': total_available,
            'wait_seconds': wait_seconds,
            'ready_at': ready_at.strftime('%Y-%m-%d %H:%M:%S')
        }), 400

    pick_instructions = []
    needed = req_qty

    for b in boxes:
        if needed <= 0:
            break
        
        box_qty = b['quantity']
        if box_qty <= needed:
            # Full box pick: Empty and remove box entirely
            take_qty = box_qty
            needed -= take_qty
            action = "REMOVE_BOX"
            remaining = 0
        else:
            # Partial pick: Take what you need, put box back in exact slot
            take_qty = needed
            remaining = box_qty - needed
            needed = 0
            action = "PICK_AND_RETURN_BOX"

        pick_instructions.append({
            'box_id': b['box_id'],
            'row_index': b['row_index'],
            'col_index': b['col_index'],
            'take_quantity': take_qty,
            'box_current_quantity': box_qty,
            'remaining_in_box': remaining,
            'action': action
        })

    cursor.close()
    conn.close()

    return jsonify({
        'requested_quantity': req_qty,
        'pick_instructions': pick_instructions
    }), 200


@app.route('/api/confirm_pick', methods=['POST'])
def confirm_pick():
    data = request.get_json()
    box_id = data.get('box_id')
    picked_qty = int(data.get('picked_quantity', 0))

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("SELECT quantity FROM inventory_boxes WHERE box_id = %s AND is_present = TRUE", (box_id,))
    box = cursor.fetchone()

    if not box:
        cursor.close()
        conn.close()
        return jsonify({'error': 'Box not found'}), 404

    new_qty = box['quantity'] - picked_qty

    if new_qty <= 0:
        # Box is completely empty -> mark slot as free
        cursor.execute("UPDATE inventory_boxes SET is_present = FALSE, quantity = 0 WHERE box_id = %s", (box_id,))
    else:
        # Partial pick -> Box stays in slot with remaining items
        cursor.execute("UPDATE inventory_boxes SET quantity = %s WHERE box_id = %s", (new_qty, box_id))

    conn.commit()
    cursor.close()
    conn.close()

    return jsonify({'message': 'Success', 'remaining_in_box': max(0, new_qty)}), 200

@app.route('/dispatch')
def dispatch_page():
    return render_template('dispatch.html')


@app.route('/api/register_box', methods=['POST'])
def register_box():
    data = request.get_json()
    type_id = data.get('type_id')
    quantity = data.get('quantity')

    if not type_id or not quantity or quantity <= 0:
        return jsonify({'error': 'Invalid core type or quantity.'}), 400

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    # 1. Find all currently occupied slots
    cursor.execute("SELECT row_index, col_index FROM inventory_boxes WHERE is_present = TRUE")
    occupied = {(b['row_index'], b['col_index']) for b in cursor.fetchall()}

    # 2. Determine first available empty slot in 5x5 matrix
    target_slot = None
    for r in range(1, 6):
        for c in range(1, 6):
            if (r, c) not in occupied:
                target_slot = (r, c)
                break
        if target_slot:
            break

    if not target_slot:
        cursor.close()
        conn.close()
        return jsonify({'error': 'Rack matrix is 100% full!'}), 400

    row_idx, col_idx = target_slot

    # 3. Save new box with current timestamp (stored_at = NOW())
    insert_query = """
        INSERT INTO inventory_boxes (type_id, row_index, col_index, quantity, is_present, stored_at)
        VALUES (%s, %s, %s, %s, TRUE, NOW())
    """
    cursor.execute(insert_query, (type_id, row_idx, col_idx, quantity))
    conn.commit()

    box_id = cursor.lastrowid
    cursor.close()
    conn.close()

    # 4. Return slot coordinates to tablet and hardware
    return jsonify({
        'message': 'Box registered successfully',
        'box_id': box_id,
        'assigned_slot': {
            'row_index': row_idx,
            'col_index': col_idx
        }
    }), 201

@app.route('/intake')
def intake_page():
    return render_template('intake.html')

@app.route('/admin')
def admin_page():
    return render_template('admin.html')

@app.route('/api/rack_matrix', methods=['GET'])
def get_rack_matrix():
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    query = """
        SELECT ib.box_id, ib.row_index, ib.col_index, ib.quantity, ib.stored_at,
               ct.type_name,
               (ib.stored_at <= (NOW() - INTERVAL 24 HOUR)) AS is_ready
        FROM inventory_boxes ib
        JOIN core_types ct ON ib.type_id = ct.type_id
        WHERE ib.is_present = TRUE
    """
    cursor.execute(query)
    boxes = cursor.fetchall()
    
    occupied_map = {f"{b['row_index']}_{b['col_index']}": b for b in boxes}
    current_time = datetime.datetime.now()

    grid = []
    for r in range(1, 6):
        row_cells = []
        for c in range(1, 6):
            cell = occupied_map.get(f"{r}_{c}")
            if cell:
                ready_time = cell['stored_at'] + timedelta(hours=24)
                
                remaining_time_str = ""
                ready_at_str = ""

                if not cell['is_ready']:
                    # Calculate countdown
                    diff = ready_time - current_time
                    hours, remainder = divmod(diff.seconds, 3600)
                    minutes, _ = divmod(remainder, 60)
                    if diff.days > 0:
                        hours += diff.days * 24
                    remaining_time_str = f"{hours}h {minutes}m"
                else:
                    # Format timestamp showing exactly when it became ready (FIFO evidence)
                    ready_at_str = ready_time.strftime('%H:%M:%S')

                row_cells.append({
                    'row': r,
                    'col': c,
                    'occupied': True,
                    'box_id': cell['box_id'],
                    'type_name': cell['type_name'],
                    'quantity': cell['quantity'],
                    'is_ready': bool(cell['is_ready']),
                    'remaining_time': remaining_time_str,
                    'ready_at_str': ready_at_str
                })
            else:
                row_cells.append({
                    'row': r,
                    'col': c,
                    'occupied': False
                })
        grid.append(row_cells)

    cursor.close()
    conn.close()

    return jsonify({'grid': grid}), 200

#hi there

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True, use_reloader=True)