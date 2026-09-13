// ── Intake Terminal ──────────────────────────────────────────────────
// UI state machine: idle -> scan -> success / problem -> idle
//
// TODO(vision): getDetection() below is MOCKED. Once vision_service.py
// (IntakeVisionScanner.capture_part_type) and the ESP32 serial weight
// stream are wired into Flask, replace it with a real fetch to whatever
// endpoint exposes { type_id, type_name, weight_g }. Everything else
// here already talks to your real /api/calculate_count and
// /api/register_box routes.

const COUNTDOWN_SECONDS = 8;
const RING_CIRCUMFERENCE = 2 * Math.PI * 90; // r=90 from the SVG

let countdownTimer = null;
let secondsLeft = COUNTDOWN_SECONDS;
let currentDetection = null; // { type_id, type_name, quantity }

const panels = {
    idle: document.getElementById('state-idle'),
    scan: document.getElementById('state-scan'),
    success: document.getElementById('state-success'),
    problem: document.getElementById('state-problem'),
};

function showState(name) {
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

// ── Mocked vision + scale read ──────────────────────────────────────
async function getDetection() {
    // Simulated latency for the "scan"
    await new Promise(r => setTimeout(r, 700));

    // Mock camera + scale output — swap for real serial/vision call later
    const mockTypes = [
        { type_id: 1, type_name: 'Type 1', weight_g: 2500 },
    ];
    return mockTypes[Math.floor(Math.random() * mockTypes.length)];
}



async function runDetection() {
    document.getElementById('detect-type').textContent = 'Scanning…';
    document.getElementById('detect-qty').textContent = '—';

    const reading = await getDetection();

    // Real backend call: convert weight -> piece count
    let quantity = null;
    try {
        const res = await fetch('/api/calculate_count', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type_id: reading.type_id,
                current_weight_g: reading.weight_g,
            }),
        });
        const data = await res.json();
        if (res.ok) quantity = data.current_count;
    } catch (err) {
        console.error('calculate_count failed:', err);
    }

    currentDetection = {
        type_id: reading.type_id,
        type_name: reading.type_name,
        quantity: quantity ?? '—',
    };

    document.getElementById('detect-type').textContent = currentDetection.type_name;
    document.getElementById('detect-qty').textContent =
        quantity !== null ? `${quantity} pcs` : 'Could not calculate';
}

// ── Countdown ring ───────────────────────────────────────────────────
function startCountdown() {
    secondsLeft = COUNTDOWN_SECONDS;
    const ring = document.getElementById('ring-progress');
    const numEl = document.getElementById('countdown-num');
    const ringWrap = document.getElementById('ring-wrap');

    ring.style.transition = 'none';
    ring.style.strokeDasharray = RING_CIRCUMFERENCE;
    ring.style.strokeDashoffset = 0;
    ringWrap.classList.remove('is-urgent');
    // force reflow so the transition below actually animates
    // eslint-disable-next-line no-unused-expressions
    ring.getBoundingClientRect();
    ring.style.transition = `stroke-dashoffset ${COUNTDOWN_SECONDS}s linear`;
    ring.style.strokeDashoffset = RING_CIRCUMFERENCE;

    numEl.textContent = secondsLeft;

    clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
        secondsLeft -= 1;
        numEl.textContent = Math.max(secondsLeft, 0);
        if (secondsLeft <= 3) ringWrap.classList.add('is-urgent');
        if (secondsLeft <= 0) {
            clearInterval(countdownTimer);
            confirmStock(); // auto-stock on timeout
        }
    }, 1000);
}

function stopCountdown() {
    clearInterval(countdownTimer);
}

// ── Actions ──────────────────────────────────────────────────────────
async function confirmStock() {
    stopCountdown();
    if (!currentDetection || currentDetection.quantity === '—') {
        showToast('No valid reading yet — cannot stock this box.', true);
        showState('idle');
        return;
    }

    try {
        const res = await fetch('/api/register_box', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type_id: currentDetection.type_id,
                quantity: currentDetection.quantity,
            }),
        });
        const data = await res.json();

        if (!res.ok) {
            showToast(data.error || 'Could not register box.', true);
            showState('idle');
            return;
        }

        document.getElementById('success-slot').textContent =
            `R${data.assigned_slot.row_index} : C${data.assigned_slot.col_index}`;
        document.getElementById('success-box').textContent = `#${data.box_id}`;
        showState('success');
    } catch (err) {
        console.error('register_box failed:', err);
        showToast('Network error while registering the box.', true);
        showState('idle');
    }
}

function submitProblem(reason) {
    // TODO(backend): no /api/report_problem route yet — log for now.
    console.warn('Problem reported:', reason, currentDetection);
    showToast(`Reported: ${reason}`);
    showState('idle');
}

// ── Wiring ───────────────────────────────────────────────────────────
document.getElementById('btn-start').addEventListener('click', async () => {
    showState('scan');
    startCountdown();
    await runDetection();
});

document.getElementById('btn-confirm').addEventListener('click', confirmStock);

document.getElementById('btn-report').addEventListener('click', () => {
    stopCountdown();
    showState('problem');
});

document.getElementById('btn-cancel-report').addEventListener('click', () => {
    showState('scan');
    startCountdown();
});

document.querySelectorAll('.problem-choice').forEach(btn => {
    btn.addEventListener('click', () => submitProblem(btn.dataset.reason));
});

document.getElementById('btn-new').addEventListener('click', () => {
    currentDetection = null;
    showState('idle');
});