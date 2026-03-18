'use strict';
  const fs    = require('fs');
  const path  = require('path');
  const https = require('https');

  const LOG        = path.join(__dirname, 'startup.log');
  const BUNDLE     = path.join(__dirname, 'app.cjs');
  const BUNDLE_URL = 'https://raw.githubusercontent.com/tyhordhg70-code/rgodmain/main/app.cjs';
  const MIN_SIZE   = 1_000_000;

  const log = (m) => {
    try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + m + '\n'); } catch(_){}
    process.stdout.write(m + '\n');
  };

  process.on('uncaughtException',  (e) => { log('UNCAUGHT: ' + e.message + '\n' + (e.stack||'')); process.exit(1); });
  process.on('unhandledRejection', (r) => { log('UNHANDLED REJECTION: ' + r); process.exit(1); });
  process.on('exit', (code)       => { log('Process exit: ' + code); });

  function startApp() {
    log('Loading bundle (Node ' + process.version + ' PORT=' + (process.env.PORT||'?') + ')');
    process.env.STATIC_FILES_PATH = path.join(__dirname, 'public');
    try {
      require(BUNDLE);
      log('Bundle required OK — app starting async...');
    } catch (e) {
      log('REQUIRE CRASH: ' + e.message + '\n' + (e.stack||''));
      process.exit(1);
    }
  }

  function cleanup(tmp) { try { fs.unlinkSync(tmp); } catch(_){} }

  function handleResponse(res, tmp, file) {
    if (res.statusCode === 301 || res.statusCode === 302) {
      log('Redirect to ' + res.headers.location);
      const req2 = https.get(res.headers.location, { headers: { 'User-Agent': 'Node' } }, (r2) => handleResponse(r2, tmp, file));
      req2.setTimeout(30000, () => { log('Redirect timeout'); req2.destroy(); cleanup(tmp); process.exit(1); });
      req2.on('error', (e) => { log('Redirect error: ' + e.message); cleanup(tmp); process.exit(1); });
      return;
    }
    if (res.statusCode !== 200) {
      log('Download HTTP ' + res.statusCode);
      cleanup(tmp); process.exit(1); return;
    }
    res.on('error', (e) => { log('Response stream error: ' + e.message); cleanup(tmp); process.exit(1); });
    file.on('error', (e) => { log('File write error: ' + e.message); cleanup(tmp); process.exit(1); });
    res.pipe(file);
    file.on('finish', () => file.close(() => {
      const size = fs.statSync(tmp).size;
      log('Downloaded ' + size + ' bytes');
      if (size < MIN_SIZE) { log('Bundle too small, aborting'); cleanup(tmp); process.exit(1); return; }
      fs.renameSync(tmp, BUNDLE);
      startApp();
    }));
  }

  function download() {
    log('Downloading bundle from GitHub...');
    const tmp  = BUNDLE + '.tmp';
    const file = fs.createWriteStream(tmp);
    const req  = https.get(BUNDLE_URL, { headers: { 'User-Agent': 'Node' } }, (res) => handleResponse(res, tmp, file));
    req.setTimeout(60000, () => { log('Download timeout'); req.destroy(); cleanup(tmp); process.exit(1); });
    req.on('error', (e) => { log('Request error: ' + e.message); cleanup(tmp); process.exit(1); });
  }

  const stat = fs.existsSync(BUNDLE) && fs.statSync(BUNDLE);
  if (stat && stat.size >= MIN_SIZE) {
    log('Bundle exists (' + stat.size + ' bytes), loading...');
    startApp();
  } else {
    if (stat) { log('Bundle corrupt (' + stat.size + ' bytes), re-downloading...'); fs.unlinkSync(BUNDLE); }
    download();
  }
  