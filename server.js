const WebSocket = require('ws');
const http = require('http');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();

// Set up SQLite database
const db = new sqlite3.Database('./data.db');

// Create table if not exists
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      \`from\` TEXT,
      text TEXT,
      sentStamp INTEGER,
      receivedStamp INTEGER,
      sim TEXT
    )
  `);
});

// Set up the WebSocket server
const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: PORT });

wss.on('connection', function connection(ws) {
  console.log('WebSocket connected');

  // Send initial message to ESP8266
  ws.send('Connection Established');

  // Example receiving data from ESP8266
  ws.on('message', function incoming(message) {
    console.log('Received from ESP8266:', message);
  });
});

// Manually determine and display IP address
let ipAddress;
const interfaces = os.networkInterfaces();
for (const key in interfaces) {
  const iface = interfaces[key].find(iface => iface.family === 'IPv4' && !iface.internal);
  if (iface) {
    ipAddress = iface.address;
    break;
  }
}
console.log(`WebSocket server listening on ws://${ipAddress}:${PORT}`);

// Set up the HTTP server to accept POST requests
const HTTP_PORT = process.env.HTTP_PORT || 3001;
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/send') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString(); // Convert Buffer to string
    });
    req.on('end', () => {
      console.log('Received body:', body);
      try {
        const json = JSON.parse(body);
        // Extract fields and insert into SQLite
        const { from, text, sentStamp, receivedStamp, sim } = json;
        if (from && text && sentStamp && receivedStamp && sim) {
          db.run(
            `INSERT INTO messages (\`from\`, text, sentStamp, receivedStamp, sim) VALUES (?, ?, ?, ?, ?)`,
            [from, text, sentStamp, receivedStamp, sim],
            err => {
              if (err) {
                console.error('Error inserting into SQLite:', err.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Database error' }));
              } else {
                // Forward the 'text' value to all WebSocket clients
                wss.clients.forEach(function each(client) {
                  if (client.readyState === WebSocket.OPEN) {
                    client.send(json.text);
                    console.log('Forwarded to WebSocket clients:', json.text);
                  } else {
                    console.log('WebSocket client not ready');
                  }
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: 'Message Recieved' }));
              }
            }
          );
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing JSON' }));
        }
      } catch (e) {
        console.error('Error parsing JSON:', e.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(HTTP_PORT, () => {
  console.log(`HTTP server listening on http://${ipAddress}:${HTTP_PORT}`);
});
