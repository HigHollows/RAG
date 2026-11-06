'use strict';
// Serveur de développement de l'interface (hors Electron) : sert src/ui et relaie window.app.call vers le noyau.
// Usage : node tests/ui-dev-server.js [port] [--llm]   (jeux de données dans un dossier temporaire)

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Core } = require('../src/core/core');
const { METHODS } = require('../src/methods');

const port = Number(process.argv[2]) || 5178;
const useMock = process.argv.includes('--llm');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grag-ui-'));
const vault = path.join(tmp, 'vault');
fs.cpSync(path.join(__dirname, 'fixtures', 'vault_test'), vault, { recursive: true });

const KNOWN = ['Claire Dubois', 'Marc Lefèvre', 'Projet Phoenix', 'Nordtech', 'Migration Cloud', 'Sophie Martin'];
const transport = async ({ prompt, system, onToken }) => {
  if (system.includes('Tu extrais')) {
    const text = /<texte>\n([\s\S]*?)\n<\/texte>/.exec(prompt)[1];
    const found = KNOWN.filter((k) => text.includes(k) || text.includes(`[[${k}`));
    const entities = found.map((name) => ({ name, type: /Projet|Migration/.test(name) ? 'Projet' : name === 'Nordtech' ? 'Organisation' : 'Personne', description: name }));
    const relations = found.length >= 2 ? [{ subject: found[0], predicate: 'lié_à', object: found[1], quote: (text.split('\n').find((l) => l.includes(found[0])) || '').slice(0, 80).trim(), confidence: 0.8 }] : [];
    return { text: JSON.stringify({ entities, relations }), usage: { in: 400, out: 100 } };
  }
  if (prompt.startsWith('Résume')) return { text: 'Ce groupe rassemble des éléments liés par des projets communs et leurs responsables.', usage: { in: 200, out: 30 } };
  const t = 'Claire Dubois pilote le Projet Phoenix [1], avec l’appui de Marc Lefèvre [2]. Le projet dépend de la Migration Cloud, retardée à septembre [1][3].';
  if (onToken) for (const w of t.split(' ')) { onToken(w + ' '); await new Promise((r) => setTimeout(r, 15)); }
  return { text: t, usage: { in: 900, out: 60 } };
};

const core = new Core(path.join(tmp, 'data'), { transport: useMock ? transport : undefined });
core.config.update({ vaults: [{ name: 'Démo', path: vault, exclude: [], writeGraphNotes: false }] });
if (!useMock) core.config.data.llm.enabled = false;

const shim = `
const cbs=[];window.app={
 call:(m,...a)=>fetch('/rpc',{method:'POST',body:JSON.stringify({m,a})}).then(r=>r.json()).then(j=>{if(j.error)throw new Error(j.error);return j.result}),
 on:(cb)=>{cbs.push(cb);return()=>{const i=cbs.indexOf(cb);if(i>=0)cbs.splice(i,1)}},
 pickFolder:async()=>null,saveFile:async(n,c)=>{console.log('save',n,String(c).length);return n},openFile:async()=>null,
 openExternal:async(u)=>console.log('open',u),showItem:async()=>{},info:async()=>({exe:'C:\\\\Program Files\\\\GraphRAG Studio\\\\GraphRAG Studio.exe',version:'dev',dataDir:'${tmp.replace(/\\/g, '\\\\')}'})};
let last='';setInterval(async()=>{try{const s=await window.app.call('status');const k=JSON.stringify(s.progress);if(k!==last){last=k;cbs.slice().forEach(cb=>cb('progress',s.progress))}}catch{}},600);`;

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
http.createServer(async (req, res) => {
  if (req.url === '/rpc') {
    let b = ''; for await (const c of req) b += c;
    const { m, a } = JSON.parse(b);
    try {
      const args = a.map((x) => x);
      if (m === 'ask' && args[1] && args[1].stream) delete args[1].stream;
      res.end(JSON.stringify({ result: await METHODS[m].run(core, ...args) ?? null }));
    } catch (e) { res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  if (req.url === '/shim.js') { res.setHeader('content-type', 'text/javascript'); return res.end(shim); }
  const f = req.url === '/' ? 'index.html' : req.url.slice(1).split('?')[0];
  const p = path.join(__dirname, '..', 'src', 'ui', f);
  if (!fs.existsSync(p)) { res.statusCode = 404; return res.end(); }
  let body = fs.readFileSync(p);
  if (f === 'index.html') body = body.toString().replace('<script src="graphview.js">', '<script src="/shim.js"></script><script src="graphview.js">');
  res.setHeader('content-type', types[path.extname(f)] || 'text/plain');
  res.end(body);
}).listen(port, '127.0.0.1', () => console.log('UI dev : http://127.0.0.1:' + port + (useMock ? ' (LLM simulé)' : ' (hors-ligne)')));
