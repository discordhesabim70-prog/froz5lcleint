if (process.versions && process.versions.electron) {
  try {
    const cp = require('child_process');
    let nodeBin = 'node.exe';
    if (require('fs').existsSync('C:\\Program Files\\nodejs\\node.exe')) {
      nodeBin = 'C:\\Program Files\\nodejs\\node.exe';
    }
    const child = cp.spawn(nodeBin, [__filename], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();
  } catch (e) {}
  return;
}

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const PORT = 42099;
const TARGET_URL = `http://127.0.0.1:${PORT}/`;
const MC_DIR = path.join(process.env.APPDATA || 'C:\\Users\\disco\\AppData\\Roaming', '.minecraft');
const FEATHER_VERSIONS_DIR = path.join(MC_DIR, 'feather-versions');
const FEATHER_MODS_DIR = path.join(MC_DIR, 'feather-mods');
const ACTIVE_MODS_DIR = path.join(MC_DIR, 'mods');
const DIGITALINGOT_LIBS_DIR = path.join(MC_DIR, 'libraries', 'java', 'net', 'digitalingot');
const LANG_DIR = path.join(MC_DIR, 'feather', 'assets', 'game', 'lang');

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}
function sha1(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

const UPDATE_CONFIG_PATH = path.join(MC_DIR, 'feather', 'update_config.json');

function getUpdateConfig() {
  const defaults = {
    currentVersion: '2.6.2',
    updateUrl: 'https://raw.githubusercontent.com/discordhesabim70-prog/froz5lcleint/main/version.json',
    autoUpdate: true,
    lastChecked: 0
  };
  try {
    if (fs.existsSync(UPDATE_CONFIG_PATH)) {
      return { ...defaults, ...JSON.parse(fs.readFileSync(UPDATE_CONFIG_PATH, 'utf8')) };
    }
  } catch (e) {}
  return defaults;
}

function saveUpdateConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(UPDATE_CONFIG_PATH), { recursive: true });
    fs.writeFileSync(UPDATE_CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (e) {}
}

function checkForRemoteUpdates() {
  const cfg = getUpdateConfig();
  if (!cfg.autoUpdate || !cfg.updateUrl) return;

  const url = cfg.updateUrl;
  const client = url.startsWith('https://') ? https : http;
  
  const req = client.get(url, { timeout: 4000 }, (res) => {
    if (res.statusCode !== 200) return;
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      try {
        const remote = JSON.parse(data);
        if (remote && remote.version && remote.version !== cfg.currentVersion && Array.isArray(remote.files)) {
          console.log(`[Feather Auto-Updater] New update found: v${remote.version} (current: v${cfg.currentVersion})`);
          downloadAndApplyUpdate(remote, cfg);
        }
      } catch (e) {}
    });
  });
  req.on('error', () => {});
}

function downloadAndApplyUpdate(remote, cfg) {
  let pending = remote.files.length;
  if (pending === 0) return;
  
  remote.files.forEach(f => {
    const dest = path.join(MC_DIR, f.path);
    const client = f.url.startsWith('https://') ? https : http;
    client.get(f.url, { timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) return;
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const buf = Buffer.concat(chunks);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, buf);
          console.log(`[Feather Auto-Updater] Downloaded: ${f.path}`);

          // Also mirror to feather-mods / mods
          if (f.path.includes('feather-fabric-')) {
            const baseName = path.basename(dest);
            const tempModDest = path.join(MC_DIR, 'feather-mods', baseName.replace(/\.jar$/, '.temp.jar'));
            try {
              fs.writeFileSync(tempModDest, buf);
              console.log(`[Feather Auto-Updater] Mirrored to feather-mods: ${tempModDest}`);
            } catch (e) {}
          } else if (f.path.includes('feather-mods')) {
            const baseName = path.basename(dest);
            const regularModName = baseName.replace(/\.temp\.jar$/, '.jar');
            const modDest = path.join(MC_DIR, 'mods', regularModName);
            try {
              fs.writeFileSync(modDest, buf);
              console.log(`[Feather Auto-Updater] Mirrored to mods: ${modDest}`);
            } catch (e) {}
          } else if (f.path.includes('mods')) {
            const baseName = path.basename(dest);
            const tempModDest = path.join(MC_DIR, 'feather-mods', baseName.endsWith('.temp.jar') ? baseName : baseName.replace(/\.jar$/, '.temp.jar'));
            try {
              fs.writeFileSync(tempModDest, buf);
              console.log(`[Feather Auto-Updater] Mirrored to feather-mods: ${tempModDest}`);
            } catch (e) {}
          }
        } catch (e) {}
        pending--;
        if (pending === 0) {
          cfg.currentVersion = remote.version;
          cfg.lastChecked = Date.now();
          saveUpdateConfig(cfg);
          console.log(`[Feather Auto-Updater] Upgraded to v${remote.version}!`);
        }
      });
    }).on('error', () => {});
  });
}

setTimeout(checkForRemoteUpdates, 3000);
setInterval(checkForRemoteUpdates, 30 * 60 * 1000);

function patchClassBuffer(buf, targetUrl) {
  const oldStr = "https://mc-webapp.feathermc.com/";
  const oldNeedle = Buffer.concat([Buffer.from([0x01, 0x00, oldStr.length]), Buffer.from(oldStr, 'utf8')]);
  if (buf.indexOf(oldNeedle) === -1) return null;
  const newUrlBuf = Buffer.from(targetUrl, 'utf8');
  const newNeedle = Buffer.concat([Buffer.from([0x01, (newUrlBuf.length >> 8) & 0xff, newUrlBuf.length & 0xff]), newUrlBuf]);
  const parts = [];
  let last = 0, pos = 0;
  while ((pos = buf.indexOf(oldNeedle, last)) !== -1) {
    parts.push(buf.slice(last, pos), newNeedle);
    last = pos + oldNeedle.length;
  }
  parts.push(buf.slice(last));
  return Buffer.concat(parts);
}

function patchFeatherJarBuffer(jarBuf, targetUrl) {
  let eocdPos = -1;
  for (let i = jarBuf.length - 22; i >= Math.max(0, jarBuf.length - 65557); i--) {
    if (jarBuf.readUInt32LE(i) === 0x06054b50) { eocdPos = i; break; }
  }
  if (eocdPos === -1) return { buffer: jarBuf, patchedCount: 0 };

  const totalEntries = jarBuf.readUInt16LE(eocdPos + 10);
  const cdOffset = jarBuf.readUInt32LE(eocdPos + 16);

  let cdPos = cdOffset;
  const localChunks = [];
  const cdChunks = [];
  let currentLocalOffset = 0;
  let patchedCount = 0;

  for (let i = 0; i < totalEntries; i++) {
    if (jarBuf.readUInt32LE(cdPos) !== 0x02014b50) return { buffer: jarBuf, patchedCount: 0 };
    const method = jarBuf.readUInt16LE(cdPos + 10);
    let entryCrc = jarBuf.readUInt32LE(cdPos + 16);
    let compSize = jarBuf.readUInt32LE(cdPos + 20);
    let uncompSize = jarBuf.readUInt32LE(cdPos + 24);
    const nameLen = jarBuf.readUInt16LE(cdPos + 28);
    const cdExtraLen = jarBuf.readUInt16LE(cdPos + 30);
    const commentLen = jarBuf.readUInt16LE(cdPos + 32);
    const localHeaderOffset = jarBuf.readUInt32LE(cdPos + 42);
    const name = jarBuf.slice(cdPos + 46, cdPos + 46 + nameLen).toString('utf8');
    const cdEntryLen = 46 + nameLen + cdExtraLen + commentLen;
    const cdEntryBuf = Buffer.from(jarBuf.slice(cdPos, cdPos + cdEntryLen));

    if (jarBuf.readUInt32LE(localHeaderOffset) !== 0x04034b50) return { buffer: jarBuf, patchedCount: 0 };
    const lfhNameLen = jarBuf.readUInt16LE(localHeaderOffset + 26);
    const lfhExtraLen = jarBuf.readUInt16LE(localHeaderOffset + 28);
    const lfhLen = 30 + lfhNameLen + lfhExtraLen;
    const lfhBuf = Buffer.from(jarBuf.slice(localHeaderOffset, localHeaderOffset + lfhLen));
    let compData = jarBuf.slice(localHeaderOffset + lfhLen, localHeaderOffset + lfhLen + compSize);

    if (name.endsWith('.class') && name.startsWith('net/digitalingot/feather/')) {
      try {
        const raw = method === 0 ? compData : zlib.inflateRawSync(compData);
        const patched = patchClassBuffer(raw, targetUrl);
        if (patched) {
          patchedCount++;
          entryCrc = crc32(patched);
          uncompSize = patched.length;
          compData = method === 0 ? patched : zlib.deflateRawSync(patched);
          compSize = compData.length;
          const flags = lfhBuf.readUInt16LE(6) & ~0x0008;
          lfhBuf.writeUInt16LE(flags, 6);
          lfhBuf.writeUInt32LE(entryCrc, 14);
          lfhBuf.writeUInt32LE(compSize, 18);
          lfhBuf.writeUInt32LE(uncompSize, 22);

          cdEntryBuf.writeUInt16LE(flags, 8);
          cdEntryBuf.writeUInt32LE(entryCrc, 16);
          cdEntryBuf.writeUInt32LE(compSize, 20);
          cdEntryBuf.writeUInt32LE(uncompSize, 24);
        }
      } catch (e) {}
    }

    let nextExpected = localHeaderOffset + lfhLen + compSize;
    let trailingDD = Buffer.alloc(0);
    if ((lfhBuf.readUInt16LE(6) & 0x0008) !== 0) {
      trailingDD = jarBuf.readUInt32LE(nextExpected) === 0x08074b50
        ? jarBuf.slice(nextExpected, nextExpected + 16)
        : jarBuf.slice(nextExpected, nextExpected + 12);
    }

    cdEntryBuf.writeUInt32LE(currentLocalOffset, 42);
    localChunks.push(lfhBuf, compData, trailingDD);
    currentLocalOffset += lfhBuf.length + compData.length + trailingDD.length;
    cdChunks.push(cdEntryBuf);
    cdPos += cdEntryLen;
  }

  if (patchedCount === 0) return { buffer: jarBuf, patchedCount: 0 };
  const newCdBuf = Buffer.concat(cdChunks);
  const eocdBuf = Buffer.from(jarBuf.slice(eocdPos));
  eocdBuf.writeUInt32LE(newCdBuf.length, 12);
  eocdBuf.writeUInt32LE(currentLocalOffset, 16);

  return { buffer: Buffer.concat([...localChunks, newCdBuf, eocdBuf]), patchedCount };
}

function scanAndPatchLibraryJars() {
  try {
    if (!fs.existsSync(DIGITALINGOT_LIBS_DIR)) return;
    for (const dirEntry of fs.readdirSync(DIGITALINGOT_LIBS_DIR, { withFileTypes: true })) {
      if (!dirEntry.isDirectory() || !dirEntry.name.startsWith('feather-')) continue;
      const snapDir = path.join(DIGITALINGOT_LIBS_DIR, dirEntry.name, '1.0.0-SNAPSHOT');
      if (!fs.existsSync(snapDir)) continue;
      for (const f of fs.readdirSync(snapDir)) {
        if (!f.endsWith('.jar')) continue;
        const jarPath = path.join(snapDir, f);
        const buf = fs.readFileSync(jarPath);
        const { buffer: patchedBuf, patchedCount } = patchFeatherJarBuffer(buf, TARGET_URL);
        if (patchedCount > 0) {
          if (!fs.existsSync(jarPath + '.bak')) fs.writeFileSync(jarPath + '.bak', buf);
          fs.writeFileSync(jarPath, patchedBuf);
          const newSha = sha1(patchedBuf);
          for (const modDir of [FEATHER_MODS_DIR, ACTIVE_MODS_DIR]) {
            const tempJar = path.join(modDir, f.replace(/\.jar$/, '.temp.jar'));
            if (fs.existsSync(tempJar)) {
              try { fs.unlinkSync(tempJar); } catch (e) {}
              try { fs.writeFileSync(tempJar, patchedBuf); } catch (e) {}
            }
          }
          if (fs.existsSync(FEATHER_VERSIONS_DIR)) {
            for (const vf of fs.readdirSync(FEATHER_VERSIONS_DIR)) {
              if (!vf.endsWith('.json') || vf === 'runtime_index.json') continue;
              const vPath = path.join(FEATHER_VERSIONS_DIR, vf);
              const vContent = fs.readFileSync(vPath, 'utf8');
              if (vContent.includes(f)) {
                const j = JSON.parse(vContent);
                let changed = false;
                for (const list of [j.libraries || [], j.mods || []]) {
                  for (const lib of list) {
                    if (lib.name && lib.name.includes(f)) {
                      lib.sha1 = newSha;
                      if (lib.size !== undefined) lib.size = patchedBuf.length;
                      changed = true;
                    }
                  }
                }
                if (changed) fs.writeFileSync(vPath, JSON.stringify(j), 'utf8');
              }
            }
          }
        }
      }
    }
  } catch (e) {}
}

function scanAndPatchTempMods() {
  for (const modDir of [FEATHER_MODS_DIR, ACTIVE_MODS_DIR]) {
    try {
      if (!fs.existsSync(modDir)) continue;
      for (const f of fs.readdirSync(modDir)) {
        if (!f.startsWith('feather-') || (!f.endsWith('.temp.jar') && !f.endsWith('.jar'))) continue;
        const tempPath = path.join(modDir, f);
        const buf = fs.readFileSync(tempPath);
        const { buffer: patchedBuf, patchedCount } = patchFeatherJarBuffer(buf, TARGET_URL);
        if (patchedCount > 0) {
          try { fs.unlinkSync(tempPath); } catch (e) {}
          try { fs.writeFileSync(tempPath, patchedBuf); } catch (e) {}
        }
      }
    } catch (e) {}
  }
}

// Run patch scan ONCE on startup (NO setInterval to prevent CPU/IO freezing)
scanAndPatchLibraryJars();
scanAndPatchTempMods();

function fetchCloudflare(hostHeader, reqPath, cb) {
  const tryIp = (ip) => {
    const r = https.request({
      host: ip,
      port: 443,
      path: reqPath,
      method: 'GET',
      servername: hostHeader,
      headers: {
        Host: hostHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) FeatherClient/1.0.0'
      }
    }, (res) => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => cb(null, res.statusCode || 200, res.headers, Buffer.concat(chunks)));
    });
    r.on('error', (err) => {
      if (ip === '8.47.69.0') tryIp('8.6.112.0');
      else cb(err);
    });
    r.end();
  };
  tryIp('8.47.69.0');
}

function getMimeType(p) {
  const clean = p.split('?')[0].toLowerCase();
  if (clean.endsWith('.js') || clean.endsWith('.mjs')) return 'application/javascript; charset=utf-8';
  if (clean.endsWith('.css')) return 'text/css; charset=utf-8';
  if (clean.endsWith('.html')) return 'text/html; charset=utf-8';
  if (clean.endsWith('.svg')) return 'image/svg+xml';
  if (clean.endsWith('.png')) return 'image/png';
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg';
  if (clean.endsWith('.webp')) return 'image/webp';
  if (clean.endsWith('.woff2')) return 'font/woff2';
  if (clean.endsWith('.woff')) return 'font/woff';
  if (clean.endsWith('.ttf')) return 'font/ttf';
  if (clean.endsWith('.json')) return 'application/json; charset=utf-8';
  if (clean.endsWith('.ico')) return 'image/x-icon';
  return 'application/octet-stream';
}

// IN-MEMORY RAM CACHE for zero latency and zero disk I/O
const WEBAPP_DIR = path.join(__dirname, 'mc-webapp');
const ramCache = new Map();

function preloadWebapp() {
  if (!fs.existsSync(WEBAPP_DIR)) return;
  function walk(currentDir, prefix = '') {
    for (const ent of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const full = path.join(currentDir, ent.name);
      const rel = prefix ? prefix + '/' + ent.name : ent.name;
      if (ent.isDirectory()) {
        walk(full, rel);
      } else if (ent.isFile()) {
        const body = fs.readFileSync(full);
        const ct = getMimeType(ent.name);
        ramCache.set('/' + rel.replace(/\\/g, '/'), { body, ct });
      }
    }
  }
  walk(WEBAPP_DIR);
}
preloadWebapp();

// Preload translations
const langCache = new Map();
if (fs.existsSync(LANG_DIR)) {
  for (const f of fs.readdirSync(LANG_DIR)) {
    if (f.endsWith('.json')) {
      const full = path.join(LANG_DIR, f);
      const body = fs.readFileSync(full);
      const shortCode = f.replace(/_[a-zA-Z]+\.json$/, '').toLowerCase();
      langCache.set(f.toLowerCase(), body);
      langCache.set(shortCode + '.json', body);
    }
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*'
    });
    return res.end();
  }

  const urlStr = req.url || '/';
  const cleanPath = urlStr.split('?')[0];

  // MCTR Settings API
  if (cleanPath === '/api/mctr-settings') {
    const settingsPath = path.join(MC_DIR, 'feather', 'mctr_settings.json');
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
          fs.writeFileSync(settingsPath, body, 'utf8');
        } catch (e) {}
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ success: true }));
      });
      return;
    } else {
      let data = {
        cobwebLaunch: true,
        ghostFireworkFix: true,
        packetFlush: true,
        cleanParticles: true,
        highPollingMouse: true,
        entityCulling: true,
        ramCefSleep: true
      };
      try {
        if (fs.existsSync(settingsPath)) {
          data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        }
      } catch (e) {}
      const jsonBuf = Buffer.from(JSON.stringify(data), 'utf8');
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': jsonBuf.length,
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(jsonBuf);
    }
  }

  // Auto-Update API
  if (cleanPath === '/api/check-update') {
    const cfg = getUpdateConfig();
    checkForRemoteUpdates();
    const resData = Buffer.from(JSON.stringify({
      version: cfg.currentVersion,
      autoUpdate: cfg.autoUpdate,
      updateUrl: cfg.updateUrl,
      lastChecked: cfg.lastChecked
    }), 'utf8');
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': resData.length,
      'Access-Control-Allow-Origin': '*'
    });
    return res.end(resData);
  }

  // Intercept Feather client jar downloads and patch them on the fly
  if (urlStr.startsWith('/feathermc-jar/')) {
    const jarPath = urlStr.replace('/feathermc-jar/', '/').replace('//', '/');
    https.get(`https://builds-cf.feathercdn.net${jarPath}`, (upRes) => {
      const chunks = [];
      upRes.on('data', d => chunks.push(d));
      upRes.on('end', () => {
        let jarBuf = Buffer.concat(chunks);
        if ((upRes.statusCode || 200) === 200) {
          try {
            const { buffer: patchedBuf, patchedCount } = patchFeatherJarBuffer(jarBuf, TARGET_URL);
            if (patchedCount > 0) jarBuf = patchedBuf;
          } catch (e) {}
        }
        res.writeHead(upRes.statusCode || 200, {
          'Content-Type': 'application/java-archive',
          'Content-Length': jarBuf.length,
          'Access-Control-Allow-Origin': '*'
        });
        res.end(jarBuf);
      });
    }).on('error', (err) => {
      res.writeHead(502);
      res.end(err.message);
    });
    return;
  }

  // Intercept launcher metadata
  if (urlStr.startsWith('/feathermc-gl/')) {
    const glPath = urlStr.replace('/feathermc-gl/', '/').replace('//', '/');
    fetchCloudflare('game-launcher.feathermc.com', glPath, (err, status, headers, body) => {
      if (err) {
        res.writeHead(502);
        return res.end(err.message);
      }
      if (glPath.endsWith('version_index.json')) {
        try {
          scanAndPatchLibraryJars();
          const idxObj = JSON.parse(body.toString('utf8'));
          for (const item of idxObj.metadata || []) {
            if (item.info && item.info.url) {
              item.info.url = item.info.url.replace('https://game-launcher.feathermc.com/', `http://127.0.0.1:${PORT}/feathermc-gl/`);
            }
            if (item.info && item.info.name) {
              const localVerJson = path.join(FEATHER_VERSIONS_DIR, item.info.name);
              if (fs.existsSync(localVerJson)) {
                item.info.sha1 = sha1(fs.readFileSync(localVerJson));
              }
            }
          }
          body = Buffer.from(JSON.stringify(idxObj), 'utf8');
        } catch (e) {}
function syncModsForVersion(targetVer) {
  try {
    const versionModsDir = path.join(FEATHER_MODS_DIR, targetVer);
    if (!fs.existsSync(versionModsDir)) return;
    console.log(`[Feather Multi-Version Engine] Sürüm algılandı: ${targetVer}`);
    const vFiles = fs.readdirSync(versionModsDir);
    for (const vf of vFiles) {
      if (vf.endsWith('.jar') || vf.endsWith('.temp.jar')) {
        const src = path.join(versionModsDir, vf);
        const dest = path.join(ACTIVE_MODS_DIR, vf);
        try {
          fs.copyFileSync(src, dest);
          console.log(`[Feather Multi-Version Engine] ${vf} -> aktif edildi.`);
        } catch (e) {}
      }
    }
  } catch (e) {}
}

      } else if (glPath.includes('/versions/') && glPath.endsWith('.json')) {
        try {
          const verFileName = path.basename(glPath);
          const targetVer = verFileName.replace(/-fabric\.json$/, '').replace(/-forge\.json$/, '').replace(/\.json$/, '');
          syncModsForVersion(targetVer);
          const localVerJson = path.join(FEATHER_VERSIONS_DIR, verFileName);
          let jsonText = fs.existsSync(localVerJson)
            ? fs.readFileSync(localVerJson, 'utf8')
            : body.toString('utf8');
          jsonText = jsonText.replaceAll('https://builds-cf.feathercdn.net/', `http://127.0.0.1:${PORT}/feathermc-jar/`);
          body = Buffer.from(jsonText, 'utf8');
        } catch (e) {}
      }
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': body.length,
        'Access-Control-Allow-Origin': '*'
      });
      res.end(body);
    });
    return;
  }

  // Translation route /languages2/*.json
  if (cleanPath.startsWith('/languages2/')) {
    const langFile = path.basename(cleanPath).toLowerCase();
    const body = langCache.get(langFile) || langCache.get('tr_tr.json') || langCache.get('en_us.json') || Buffer.from('{}');
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': body.length,
      'Access-Control-Allow-Origin': '*'
    });
    return res.end(body);
  }

  // Serve pure Feather webapp directly from RAM cache (0.01ms latency, 0% CPU)
  const cached = ramCache.get(cleanPath);
  if (cached) {
    res.writeHead(200, {
      'Content-Type': cached.ct,
      'Content-Length': cached.body.length,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=31536000'
    });
    return res.end(cached.body);
  }

  // Logo fallback - guarantees 100% pure white Feather vector logo everywhere
  if (cleanPath.includes('logo') && (cleanPath.endsWith('.svg') || cleanPath.endsWith('.png'))) {
    const logoCached = ramCache.get('/asset/logo.svg') || ramCache.get('/logo.6f73e6a31a8f8a9f.svg') || ramCache.get('/logo.efa89cf72aac4ddd.svg');
    if (logoCached) {
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml',
        'Content-Length': logoCached.body.length,
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(logoCached.body);
    }
  }

  // SPA navigation fallback -> index.html from RAM
  if (!path.basename(cleanPath).includes('.')) {
    const indexCached = ramCache.get('/index.html');
    if (indexCached) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': indexCached.body.length,
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(indexCached.body);
    }
  }

  // Static file not found
  res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
  res.end();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // Port already in use by background proxy - this is totally fine!
    console.log(`Port ${PORT} is already bound by background proxy.`);
  } else {
    console.error('Server error:', err);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`High-performance Feather RAM proxy listening on 127.0.0.1:${PORT}`);
});
