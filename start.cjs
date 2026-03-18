'use strict';
  const fs    = require('fs');
  const path  = require('path');
  const https = require('https');

  const LOG    = path.join(__dirname, 'startup.log');
  const BUNDLE = path.join(__dirname, 'app.cjs');
  const URL    = 'https://raw.githubusercontent.com/tyhordhg70-code/rgodmain/main/app.cjs';
  const MIN_SIZE = 1_000_000; // 1 MB — corrupt/partial downloads are smaller

  const log = (m) => {
    try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + m + '\n'); } catch(_){}
    process.stdout.write(m + '\n');
  };

  // Catch async crashes that happen after require() returns
  process.on('uncaughtException',  (e) => { log('UNCAUGHT: ' + e.message + '\n' + (e.stack||'')); process.exit(1); });
  process.on('unhandledRejection', (r) => { log('UNHANDLED REJECTION: ' + r); process.exit(1); });
  process.on('exit', (code)       => { log('Process exit code: ' + code); });

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

  function download() {
    log('Downloading bundle from GitHub...');
    const tmp = BUNDLE + '.tmp';
    const file = fs.createWriteStream(tmp);
    https.get(URL, { headers: { 'User-Agent': 'Node' } }, (res) => {
      if (res.statusCode !== 200) {
        log('Download HTTP ' + res.statusCode);
        try { fs.unlinkSync(tmp); } catch(_){}
        process.exit(1);
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => {
        const size = fs.statSync(tmp).size;
        log('Downloaded ' + size + ' bytes');
        if (size < MIN_SIZE) {
          log('ERROR: bundle too small (' + size + '), download may be truncated');
          try { fs.unlinkSync(tmp); } catch(_){}
          process.exit(1);
          return;
        }
        fs.renameSync(tmp, BUNDLE);
        startApp();
      }));
    }).on('error', (err) => {
      log('Download error: ' + err.message);
      try { fs.unlinkSync(tmp); } catch(_){}
      process.exit(1);
    });
  }

  // If bundle exists and is large enough, use it; otherwise download
  if (fs.existsSync(BUNDLE) && fs.statSync(BUNDLE).size >= MIN_SIZE) {
    log('Bundle exists (' + fs.statSync(BUNDLE).size + ' bytes), loading...');
    startApp();
  } else {
    if (fs.existsSync(BUNDLE)) {
      log('Bundle too small/corrupt, re-downloading...');
      fs.unlinkSync(BUNDLE);
    }
    download();
  }
  