'use strict';
const fs  = require('fs');
const http = require('http');

const logFile = __dirname + '/startup.log';
const log = (msg) => {
  const line = new Date().toISOString() + '  ' + msg + '\n';
  try { fs.appendFileSync(logFile, line); } catch(_) {}
  console.log(msg);
};

log('=== STARTUP ===');
log('Node.js version : ' + process.version);
log('PORT env        : ' + (process.env.PORT || '(not set)'));
log('NODE_ENV        : ' + (process.env.NODE_ENV || '(not set)'));
log('DATABASE_URL    : ' + (process.env.DATABASE_URL ? 'SET (' + process.env.DATABASE_URL.slice(0,30) + '...)' : 'NOT SET'));
log('SESSION_SECRET  : ' + (process.env.SESSION_SECRET ? 'SET' : 'NOT SET'));
log('__dirname       : ' + __dirname);

const port = parseInt(process.env.PORT || '3000', 10);

const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('Diagnostic OK - Node ' + process.version + ' on port ' + port + '\n');
});

server.on('error', (err) => {
  log('SERVER ERROR: ' + err.message);
  process.exit(1);
});

server.listen(port, '0.0.0.0', () => {
  log('Listening on port ' + port + ' — diagnostic server running');
});
