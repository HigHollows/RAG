'use strict';
// Point d'entrée MCP (stdio) sans interface graphique.
// Usage : ELECTRON_RUN_AS_NODE=1 "GraphRAG Studio.exe" "<...>/resources/app.asar/src/mcp-main.js"   (ou : node src/mcp-main.js)
const path = require('path');
const os = require('os');

const dataDir = process.env.GRAPHRAG_DATA || path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'GraphRAG Studio');
require('./mcp').startMcp(dataDir);
