const fs = require('fs');
let s = fs.readFileSync('src/ui/app.js', 'utf8');
const a = "    if (!item || !item.r) { side.append(h('div', { class: 'empty' }, 'Les sources d’une réponse apparaissent ici.')); return; }";
if (!s.includes(a)) throw new Error('nf');
s = s.replace(a, "    if (side.parentElement) side.parentElement.classList.toggle('nosrc', !(item && item.r));\n    if (!item || !item.r) return;");
fs.writeFileSync('src/ui/app.js', s);
let c = fs.readFileSync('src/ui/styles.css', 'utf8');
c = c.replace('.chat .conv {', '.chat.nosrc { grid-template-columns: 1fr; }\n.chat.nosrc .side { display: none; }\n.chat .conv {');
fs.writeFileSync('src/ui/styles.css', c);
