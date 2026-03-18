'use strict';
  const fs    = require('fs');
  const path  = require('path');
  const https = require('https');

  const LOG    = path.join(__dirname, 'startup.log');
  const BUNDLE = path.join(__dirname, 'app.cjs');
  const URL    = 'https://raw.githubusercontent.com/tyhordhg70-code/rgodmain/main/app.cjs';

  const log = (m) => {
    try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + m + '\n'); } catch(_){}
    console.log(m);
  };

  function startApp() {
    log('Starting app (Node ' + process.version + ', PORT=' + (process.env.PORT||'?') + ')');
    process.env.STATIC_FILES_PATH = path.join(__dirname, 'public');
    try {
      require(BUNDLE);
      log('App loaded OK');
    } catch (e) {
      log('CRASH: ' + e.message + '\n' + (e.stack||''));
      process.exit(1);
    }
  }

  if (fs.existsSync(BUNDLE)) {
    startApp();
  } else {
    log('Downloading bundle from GitHub...');
    const file = fs.createWriteStream(BUNDLE);
    https.get(URL, { headers: { 'User-Agent': 'Node' } }, (res) => {
      res.pipe(file);
      file.on('finish', () => file.close(() => {
        log('Downloaded ' + fs.statSync(BUNDLE).size + ' bytes');
        startApp();
      }));
    }).on('error', (err) => {
      log('Download failed: ' + err.message);
      try { fs.unlinkSync(BUNDLE); } catch(_){}
      process.exit(1);
    });
  }
  