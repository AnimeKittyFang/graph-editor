// Lecteur GraphML (yFiles / yEd Live) en lecture seule. Aucune dépendance.
(() => {
'use strict';
const SVGNS = 'http://www.w3.org/2000/svg';
const $ = (id) => document.getElementById(id);
const stage = $('stage'), world = $('world'), gEdges = $('edges'), gNodes = $('nodes');
const tip = $('tooltip'), msg = $('msg');

// ---------- Parsing helpers ----------
const kids = (el) => Array.from(el.children);
const kid = (el, name) => kids(el).find((c) => c.localName === name);
const dataOf = (el, key) => kids(el).find((c) => c.localName === 'data' && c.getAttribute('key') === key);
const first = (el) => el && kids(el)[0];
const refRe = /^\{\s*y:GraphMLReference\s+(\d+)\s*\}$/;

let resources = new Map();
function indexResources(doc) {
  resources = new Map();
  for (const el of doc.getElementsByTagName('*')) {
    for (const a of el.attributes) {
      if (a.localName === 'Key' && a.namespaceURI && a.namespaceURI.endsWith('markup/3.0')) resources.set(a.value, el);
    }
  }
}
const resEl = (k) => resources.get(String(k));

// Value d'attribut ou d'élément-propriété (Style.prop), références résolues
function prop(el, name) {
  if (!el) return undefined;
  if (el.hasAttribute(name)) return el.getAttribute(name);
  const c = kids(el).find((k) => k.localName === el.localName + '.' + name);
  if (c) { const f = first(c); return f || c.textContent.trim(); }
  return undefined;
}
function deref(v) {            // string "{y:GraphMLReference N}" | element | string
  if (typeof v === 'string') { const m = refRe.exec(v.trim()); return m ? resEl(m[1]) : v; }
  if (v && v.localName === 'GraphMLReference') return resEl(v.getAttribute('ResourceKey'));
  return v;
}
function argb(s) {
  const m = /^#([0-9a-f]{8})$/i.exec(s || '');
  if (!m) return s;
  const h = m[1], a = parseInt(h.slice(0, 2), 16) / 255;
  return `rgba(${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${parseInt(h.slice(6, 8), 16)},${a.toFixed(3)})`;
}
function colorOf(v) {          // Color / CssFill / SolidColorFill / literal → css
  v = deref(v);
  if (v == null) return undefined;
  if (typeof v === 'string') return argb(v);
  if (v.localName === 'Color') return argb(v.getAttribute('value'));
  if (v.localName === 'CssFill') return v.getAttribute('cssString');
  if (v.hasAttribute('color')) return colorOf(v.getAttribute('color'));
  if (v.hasAttribute('fill')) return colorOf(v.getAttribute('fill'));
  return undefined;
}
function strokeOf(v) {
  v = deref(v);
  if (v == null) return null;
  if (typeof v === 'string') return { color: argb(v), width: 1 };
  if (v.localName !== 'Stroke') return null;
  const fill = prop(v, 'fill');
  return { color: colorOf(fill) || '#888', width: parseFloat(v.getAttribute('thickness') || '1'),
           dash: v.getAttribute('dashStyle') || '', cap: (v.getAttribute('lineCap') || '').toLowerCase() };
}
const DASH = { Dot: '1 3', Dash: '4 3', DashDot: '4 3 1 3', DashDotDot: '4 3 1 3 1 3' };
function imageHref(style) {
  const h = prop(style, 'href');
  if (!h) return null;
  if (typeof h === 'string') return h.trim();
  const t = deref(h);
  return t ? t.textContent.trim() : h.textContent.trim();
}

// ---------- Rendering ----------
function make(tag, attrs, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
const sanitize = (html) => {
  const d = new DOMParser().parseFromString(html, 'text/html');
  d.querySelectorAll('script,iframe,object,embed,link,meta,style,form,input,button,svg,math').forEach((n) => n.remove());
  d.querySelectorAll('*').forEach((n) => { for (const a of Array.from(n.attributes)) {
    const k = a.name.toLowerCase(); if (k.startsWith('on') || (k !== 'style' && k !== 'class')) n.removeAttribute(a.name);
    else if (k === 'style' && /url\s*\(|expression|@import/i.test(a.value)) n.removeAttribute(a.name);
  } });
  return d.body.innerHTML;
};


// ---------- Étiquettes ----------
function labelText(l) {
  let raw = l.getAttribute('Text');
  if (raw == null) { const t = kid(l, 'Label.Text'); raw = t ? t.textContent : ''; }
  let bold = false, italic = false, txt = raw;
  if (/<[a-z][^>]*>/i.test(raw)) {              // balisage HTML (MarkupLabelStyle)
    const d = new DOMParser().parseFromString(raw, 'text/html');
    bold = !!d.querySelector('b,strong'); italic = !!d.querySelector('i,em');
    txt = d.body.textContent;
  }
  return { txt: txt.trim(), bold, italic };
}
const labelBox = new WeakMap();          // label → position (relative au nœud) calculée au rendu
// Position recalculée à chaque rendu : centrée sous le nœud, collée à sa boîte ; les suivantes s'empilent dessous.
function drawLabel(l, local, g, yOff) {
  const { txt, bold, italic } = labelText(l);
  if (!txt) return 0;
  const ls = kids(l).map((c) => first(c)).find((c) => c && /LabelStyle$/.test(c.localName));
  const bg = colorOf(ls && prop(ls, 'backgroundFill')), bs = strokeOf(ls && prop(ls, 'backgroundStroke'));
  const fillTxt = colorOf(ls && prop(ls, 'textFill')) || '#fff';
  const font = deref(ls && prop(ls, 'font'));
  const size = parseFloat(ls && ls.getAttribute('textSize')) || (font && parseFloat(font.getAttribute('fontSize'))) || 12;
  const family = (font && font.getAttribute('fontFamily')) || 'Roboto';
  const t = make('text', { 'font-size': size, 'font-family': `${family}, system-ui, sans-serif`, fill: fillTxt,
    'font-weight': bold || (font && /bold/i.test(font.getAttribute('fontWeight') || '')) ? '700' : '400',
    'font-style': italic ? 'italic' : 'normal', 'dominant-baseline': 'central', 'text-anchor': 'middle' }, g);
  t.textContent = txt;
  const bb = t.getBBox(), padX = 4, padY = 2;
  const w = bb.width + padX * 2, h = bb.height + padY * 2;
  const ax = (local.w - w) / 2, ay = local.h + yOff;
  t.setAttribute('x', ax + w / 2); t.setAttribute('y', ay + h / 2);
  const shape = ls && (ls.getAttribute('shape') || '');
  const rect = make('rect', { x: ax, y: ay, width: w, height: h, rx: /ROUND/.test(shape) ? 4 : 0,
    fill: bg || 'none', stroke: bs ? bs.color : 'none', 'stroke-width': bs ? bs.width : 0 });
  g.insertBefore(rect, t);
  labelBox.set(l, { ox: ax, oy: ay, w, h });
  return h;
}


// ======================================================================
//  Internationalisation (EN / FR)
// ======================================================================
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const I18N = {
  en: {
    openFile: 'Open a .graphml', zoomIn: 'Zoom in', zoomOut: 'Zoom out', fit: 'Fit', fitTitle: 'Fit to screen',
    search: 'Search', searchTitle: 'Search in descriptions or labels', edit: 'Edit mode', editTitle: 'Turn edit mode on / off',
    select: 'Select', selectTitle: 'Move / select', link: 'Link', linkTitle: 'Create a link between two nodes',
    undoLabel: 'Previous', undoTitle: 'Previous (Ctrl+Z)', redoLabel: 'Next', redoTitle: 'Next (Ctrl+Shift+Z)',
    export: 'Export .graphml', exportTitle: 'Download the edited .graphml', loading: 'Loading…', drop: 'Drop a .graphml file',
    qPlaceholder: 'Search a word or a block of words…', clearSearch: 'Clear search', descs: 'Descriptions', labelsMode: 'Labels',
    invalidFile: 'Invalid GraphML file.', openHint: 'Open a .graphml file (button at the top left) or drop it here.',
    confirmLoss: 'Unexported changes will be lost. Continue?',
    nothingUndo: 'Nothing to undo', undone: 'Undone', nothingRedo: 'Nothing to redo', redone: 'Redone',
    magnetTitle: 'Magnet: snap while dragging (origin points, alignments, equidistance)', magnetOn: 'Magnet on', magnetOff: 'Magnet off',
    linkToolToast: 'Drag from one node to another (or click the start node, then the end node)',
    exported: 'File exported', linkExists: 'This link already exists', linkCreated: 'Link created', nodeCreated: 'Node created',
    cut: 'Cut', clipEmpty: 'Clipboard is empty', imageChanged: 'Image changed', imageBad: 'Unreadable image',
    nodesN: (n) => plural(n, 'node', 'nodes'), linksN: (n) => plural(n, 'link', 'links'),
    deleted: (parts, total) => parts.join(' and ') + ' deleted',
    copied: (n) => plural(n, 'node', 'nodes') + ' copied', pasted: (n) => plural(n, 'node', 'nodes') + ' pasted',
    newNode: 'NEW NODE',
    panelTitle: 'Editing', linkHintEnd: 'Now click the end node (Esc to cancel).', linkHintStart: 'Link tool: drag from one node to another, or click the start node, then the end node.',
    delSel: 'Delete selection', linkOne: (s, t) => `Link ${s} → ${t}`, linksSel: (n) => `${n} links selected`,
    hintLinks: 'Ctrl+click: add / remove\nDel: delete',
    mixSel: (nN, nE) => `${plural(nN, 'node', 'nodes')}${nE ? ' and ' + plural(nE, 'link', 'links') : ''} selected`,
    hintMulti: 'Drag: move the group\nCtrl+click: add / remove\nCtrl+C / Ctrl+X / Ctrl+V: copy / cut / paste\nDel: delete',
    hintNone: 'Drag a node to move it (middle button: pan the view).\nClick a node or a link to select it (Ctrl+click: multi-select).\nRight-click the background: create a node.\nCtrl+C / Ctrl+X / Ctrl+V: copy / cut / paste.\nLink tool: drag from one node to another.',
    nodeTitle: (id) => 'Node ' + id, changeImage: 'Change image…', descLabel: 'Description (text or HTML, shown on hover)',
    labelsLabel: 'Labels', remove: 'Delete', addLabel: '+ Add a label',
    appearance: 'Appearance', mixed: 'Mixed', imageOpt: 'Image (icon)', fill: 'Color', stroke: 'Outline', sizePx: 'Size (px)',
    colorHint: 'Color and outline: available for shapes (pick a shape above).',
    shape_ELLIPSE: 'Round', shape_RECTANGLE: 'Square / rectangle', shape_ROUND_RECTANGLE: 'Rounded square', shape_DIAMOND: 'Diamond',
    shape_TRIANGLE: 'Triangle', shape_HEXAGON: 'Hexagon', shape_OCTAGON: 'Octagon', shape_STAR5: '5-point star', shape_STAR6: '6-point star', shape_STAR8: '8-point star',
    createHere: 'Create a node here', pasteHere: 'Paste here',
    found: (n) => `${plural(n, 'node', 'nodes')} found`, noResult: 'No results', limited: '… display limited to the first 200 results',
  },
  fr: {
    openFile: 'Ouvrir un .graphml', zoomIn: 'Zoom +', zoomOut: 'Zoom −', fit: 'Ajuster', fitTitle: 'Ajuster à l’écran',
    search: 'Recherche', searchTitle: 'Rechercher dans les descriptions ou les labels', edit: 'Mode édition', editTitle: 'Activer / désactiver le mode édition',
    select: 'Sélection', selectTitle: 'Déplacer / sélectionner', link: 'Lier', linkTitle: 'Créer un lien entre deux nœuds',
    undoLabel: 'Précédent', undoTitle: 'Précédent (Ctrl+Z)', redoLabel: 'Suivant', redoTitle: 'Suivant (Ctrl+Maj+Z)',
    export: 'Exporter .graphml', exportTitle: 'Télécharger le .graphml modifié', loading: 'Chargement…', drop: 'Dépose un fichier .graphml',
    qPlaceholder: 'Rechercher un mot ou un bloc de mots…', clearSearch: 'Effacer la recherche', descs: 'Descriptions', labelsMode: 'Labels',
    invalidFile: 'Fichier GraphML invalide.', openHint: 'Ouvre un fichier .graphml (bouton en haut à gauche) ou dépose-le ici.',
    confirmLoss: 'Des modifications non exportées seront perdues. Continuer ?',
    nothingUndo: 'Rien à annuler', undone: 'Annulé', nothingRedo: 'Rien à rétablir', redone: 'Rétabli',
    magnetTitle: 'Aimant : accrochage au déplacement (points d’origine, alignements, équidistance)', magnetOn: 'Aimant activé', magnetOff: 'Aimant désactivé',
    linkToolToast: 'Glisse d’un nœud à l’autre (ou clique départ puis arrivée)',
    exported: 'Fichier exporté', linkExists: 'Ce lien existe déjà', linkCreated: 'Lien créé', nodeCreated: 'Nœud créé',
    cut: 'Coupé', clipEmpty: 'Presse-papiers vide', imageChanged: 'Image changée', imageBad: 'Image illisible',
    nodesN: (n) => plural(n, 'nœud', 'nœuds'), linksN: (n) => plural(n, 'lien', 'liens'),
    deleted: (parts, total) => parts.join(' et ') + (total > 1 ? ' supprimés' : ' supprimé'),
    copied: (n) => plural(n, 'nœud', 'nœuds') + (n > 1 ? ' copiés' : ' copié'), pasted: (n) => plural(n, 'nœud', 'nœuds') + (n > 1 ? ' collés' : ' collé'),
    newNode: 'NOUVEAU NŒUD',
    panelTitle: 'Édition', linkHintEnd: 'Clique maintenant le nœud d’arrivée (Échap pour annuler).', linkHintStart: 'Outil lien : glisse d’un nœud à l’autre, ou clique le nœud de départ puis le nœud d’arrivée.',
    delSel: 'Supprimer la sélection', linkOne: (s, t) => `Lien ${s} → ${t}`, linksSel: (n) => `${n} liens sélectionnés`,
    hintLinks: 'Ctrl+clic : ajouter / retirer\nSuppr : supprimer',
    mixSel: (nN, nE) => `${plural(nN, 'nœud', 'nœuds')}${nE ? ' et ' + plural(nE, 'lien', 'liens') : ''} sélectionné${nN + nE > 1 ? 's' : ''}`,
    hintMulti: 'Glisser : déplacer le groupe\nCtrl+clic : ajouter / retirer\nCtrl+C / Ctrl+X / Ctrl+V : copier / couper / coller\nSuppr : supprimer',
    hintNone: 'Glisse un nœud pour le déplacer (molette : déplacer la vue).\nClique un nœud ou un lien pour le sélectionner (Ctrl+clic : sélection multiple).\nClic droit sur le fond : créer un nœud.\nCtrl+C / Ctrl+X / Ctrl+V : copier / couper / coller.\nOutil « Lier » : glisse d’un nœud à l’autre.',
    nodeTitle: (id) => 'Nœud ' + id, changeImage: 'Changer l’image…', descLabel: 'Description (texte ou HTML, affichée au survol)',
    labelsLabel: 'Étiquettes', remove: 'Supprimer', addLabel: '+ Ajouter une étiquette',
    appearance: 'Apparence', mixed: 'Mixte', imageOpt: 'Image (icône)', fill: 'Couleur', stroke: 'Contour', sizePx: 'Taille (px)',
    colorHint: 'Couleur et contour : disponibles pour les formes (choisis une forme ci-dessus).',
    shape_ELLIPSE: 'Rond', shape_RECTANGLE: 'Carré / rectangle', shape_ROUND_RECTANGLE: 'Carré arrondi', shape_DIAMOND: 'Losange',
    shape_TRIANGLE: 'Triangle', shape_HEXAGON: 'Hexagone', shape_OCTAGON: 'Octogone', shape_STAR5: 'Étoile à 5 branches', shape_STAR6: 'Étoile à 6 branches', shape_STAR8: 'Étoile à 8 branches',
    createHere: 'Créer un nœud ici', pasteHere: 'Coller ici',
    found: (n) => plural(n, 'nœud trouvé', 'nœuds trouvés'), noResult: 'Aucun résultat', limited: '… affichage limité aux 200 premiers résultats',
  },
};
let lang = 'en';
try { const q = new URLSearchParams(location.search).get('lang'), st = localStorage.getItem('gv-lang'); lang = [q, st].find((v) => v === 'en' || v === 'fr') || ((navigator.language || '').toLowerCase().startsWith('fr') ? 'fr' : 'en'); } catch (_) { lang = (navigator.language || '').toLowerCase().startsWith('fr') ? 'fr' : 'en'; }
const tr = (k, ...a) => { const v = I18N[lang][k] ?? I18N.en[k] ?? k; return typeof v === 'function' ? v(...a) : v; };
function applyI18n() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((e) => { e.textContent = tr(e.dataset.i18n); });
  document.querySelectorAll('[data-i18n-title]').forEach((e) => { e.title = tr(e.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-aria]').forEach((e) => { e.setAttribute('aria-label', tr(e.dataset.i18nAria)); });
  document.querySelectorAll('[data-i18n-ph]').forEach((e) => { e.placeholder = tr(e.dataset.i18nPh); });
  document.querySelectorAll('#lang button').forEach((b) => b.classList.toggle('on', b.dataset.l === lang));
}
function setLang(l) {
  lang = l; try { localStorage.setItem('gv-lang', l); } catch (_) {}
  applyI18n(); if (typeof refreshPanel === 'function' && model) refreshPanel(); if (model) computeSearch();
}
const setMsg = (key) => { msg.setAttribute('data-i18n', key); msg.textContent = tr(key); msg.classList.remove('hide'); };
document.querySelectorAll('#lang button').forEach((b) => { b.onclick = () => setLang(b.dataset.l); });

// ======================================================================
//  Modèle, rendu
// ======================================================================
const EDIT_ALLOWED = true;               // false : masque tout le mode édition
const XMLNS = {
  graphml: 'http://graphml.graphdrawing.org/xmlns',
  x: 'http://www.yworks.com/xml/yfiles-common/markup/3.0',
  y: 'http://www.yworks.com/xml/yfiles-common/3.0',
  yjs: 'http://www.yworks.com/xml/yfiles-for-html/3.0/xaml',
};
let doc = null, fileName = 'graph.graphml';
let model = null;                         // { nodes: Map, edges: [], adj: Map, bounds }
let editMode = false, tool = 'select', linkFrom = null;
let selNodes = new Set(), selEdges = new Set();   // ids de nœuds | éléments <edge>
let linkDrag = null; const imageStash = new Map();
let clip = null, lastWorld = null, ctrlAdded = false;
let dirty = false;
const undoStack = [], redoStack = [];

const toast = (t) => { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2200); };

function parseDoc(text) {
  const d = new DOMParser().parseFromString(text, 'application/xml');
  if (d.querySelector('parsererror') || !d.documentElement || d.documentElement.localName !== 'graphml') return null;
  return d;
}
function setDoc(d, name) {
  doc = d; if (name) fileName = name;
  indexResources(doc);
  selNodes = new Set(); selEdges = new Set(); linkFrom = null;
}

function buildModel() {
  const graph = Array.from(doc.getElementsByTagName('graph'))[0];
  const nodes = new Map(), edges = [], adj = new Map();
  kids(graph).filter((c) => c.localName === 'node').forEach((n, idx) => {
    const r = first(dataOf(n, 'd5')); if (!r) return;
    const ports = new Map();
    kids(n).filter((c) => c.localName === 'port').forEach((p) => {
      const loc = dataOf(p, 'd16'); const prm = loc && first(loc);
      const m = prm && /([-\d.eE]+)\s*,\s*([-\d.eE]+)/.exec(prm.getAttribute('Ratio') || '');
      ports.set(p.getAttribute('name'), m ? { rx: +m[1], ry: +m[2] } : { rx: 0.5, ry: 0.5 });
    });
    const id = n.getAttribute('id');
    nodes.set(id, { id, el: n, rect: r, x: +r.getAttribute('X'), y: +r.getAttribute('Y'), w: +r.getAttribute('Width'), h: +r.getAttribute('Height'),
      z: parseFloat((dataOf(n, 'd0') || {}).textContent ?? idx), idx, ports, desc: (dataOf(n, 'd3') || {}).textContent || '' });
    adj.set(id, []);
  });
  kids(graph).filter((c) => c.localName === 'edge').forEach((e) => {
    const s = nodes.get(e.getAttribute('source')), t = nodes.get(e.getAttribute('target'));
    if (!s || !t) return;
    const d13 = dataOf(e, 'd13'); const st = d13 ? deref(first(d13)) : null;
    const rec = { el: e, s, t, sp: e.getAttribute('sourceport'), tp: e.getAttribute('targetport'), st };
    edges.push(rec); adj.get(s.id).push(rec); adj.get(t.id).push(rec);
  });
  return { nodes, edges, adj };
}
const portPt = (nd, name) => { const p = nd.ports.get(name) || { rx: 0.5, ry: 0.5 }; return { x: nd.x + nd.w * p.rx, y: nd.y + nd.h * p.ry }; };
function edgeD(rec) {
  const a = portPt(rec.s, rec.sp), b = portPt(rec.t, rec.tp);
  if (rec.st && rec.st.localName === 'ArcEdgeStyle') {
    const hgt = parseFloat(rec.st.getAttribute('height')) || 0;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    return `M${a.x} ${a.y}Q${(a.x + b.x) / 2 - (dy / len) * hgt * 2} ${(a.y + b.y) / 2 + (dx / len) * hgt * 2} ${b.x} ${b.y}`;
  }
  return `M${a.x} ${a.y}L${b.x} ${b.y}`;
}

function shapePts(shape, w, h) {
  const cx = w / 2, cy = h / 2;
  switch (shape) {
    case 'DIAMOND': case 'DIAMOND2': return [[cx, 0], [w, cy], [cx, h], [0, cy]];
    case 'TRIANGLE': return [[cx, 0], [w, h], [0, h]];
    case 'TRIANGLE2': return [[0, 0], [w, 0], [cx, h]];
    case 'HEXAGON': return [[w * .25, 0], [w * .75, 0], [w, cy], [w * .75, h], [w * .25, h], [0, cy]];
    case 'OCTAGON': { const a = .29; return [[w * a, 0], [w * (1 - a), 0], [w, h * a], [w, h * (1 - a)], [w * (1 - a), h], [w * a, h], [0, h * (1 - a)], [0, h * a]]; }
    case 'STAR5': case 'STAR6': case 'STAR8': {
      const n = +shape.slice(4), ir = { 5: .4, 6: .5, 8: .62 }[n], pts = [];
      for (let i = 0; i < n * 2; i++) { const r = i % 2 ? ir : 1, a = -Math.PI / 2 + i * Math.PI / n; pts.push([cx + Math.cos(a) * cx * r, cy + Math.sin(a) * cy * r]); }
      return pts;
    }
  }
  return null;
}
function drawShape(shape, w, h, common, g) {
  if (shape === 'ELLIPSE') return make('ellipse', { cx: w / 2, cy: h / 2, rx: w / 2, ry: h / 2, ...common }, g);
  const pts = shapePts(shape, w, h);
  if (pts) return make('polygon', { points: pts.map((q) => q.join(',')).join(' '), 'stroke-linejoin': 'round', ...common }, g);
  return make('rect', { x: 0, y: 0, width: w, height: h, rx: shape === 'ROUND_RECTANGLE' ? Math.min(8, Math.min(w, h) * .25) : 0, ...common }, g);
}
function render() {
  hideTip();
  gEdges.replaceChildren(); gNodes.replaceChildren();
  model = buildModel();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  model.nodes.forEach((n) => { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h); });
  model.bounds = { minX, minY, maxX, maxY };

  model.edges.forEach((rec) => {
    const sk = (rec.st && strokeOf(prop(rec.st, 'stroke'))) || { color: '#888', width: 1 };
    const g = make('g', {}, gEdges);
    rec.hit = make('path', { class: 'hit', d: edgeD(rec), fill: 'none', stroke: 'transparent', 'stroke-width': 12 }, g);
    rec.path = make('path', { d: edgeD(rec), fill: 'none', stroke: sk.color, 'stroke-width': sk.width, 'stroke-linecap': sk.cap === 'square' ? 'square' : 'round', 'pointer-events': 'none' }, g);
    rec.base = sk;
    if (sk.dash && DASH[sk.dash]) rec.path.setAttribute('stroke-dasharray', DASH[sk.dash].split(' ').map((v) => v * Math.max(1, sk.width)).join(' '));
    styleEdge(rec);
    rec.hit.addEventListener('click', (ev) => {
      if (!editMode || moved) return; ev.stopPropagation();
      if (ev.ctrlKey || ev.metaKey) { if (selEdges.has(rec.el)) selEdges.delete(rec.el); else selEdges.add(rec.el); }
      else { selEdges = new Set([rec.el]); selNodes = new Set(); }
      model.edges.forEach(styleEdge); applySel(); refreshPanel();
    });
  });

  Array.from(model.nodes.values()).sort((a, b) => a.z - b.z || a.idx - b.idx).forEach((nd) => {
    const g = make('g', { class: 'node', 'data-id': nd.id, transform: `translate(${nd.x} ${nd.y})` }, gNodes);
    nd.g = g;
    const style = first(dataOf(nd.el, 'd7') || document.createElement('x'));
    const ln = style && style.localName;
    if (ln === 'ImageNodeStyle') {
      const href = imageHref(style);
      if (href) make('image', { href, x: 0, y: 0, width: nd.w, height: nd.h, preserveAspectRatio: 'none' }, g);
    } else if (ln === 'ShapeNodeStyle') {
      const shape = (style.getAttribute('shape') || 'RECTANGLE').toUpperCase();
      const sk = strokeOf(prop(style, 'stroke')); const fill = colorOf(prop(style, 'fill')) || 'none';
      const common = { fill, stroke: sk ? sk.color : 'none', 'stroke-width': sk ? sk.width : 0 };
      drawShape(shape, nd.w, nd.h, common, g);
    } else make('rect', { x: 0, y: 0, width: nd.w, height: nd.h, fill: '#555', stroke: '#888' }, g);
    make('rect', { x: 0, y: 0, width: nd.w, height: nd.h, fill: 'transparent' }, g);
    const local = { x: 0, y: 0, w: nd.w, h: nd.h };
    let yOff = 0; labelsOf(nd).forEach((l) => { yOff += drawLabel(l, local, g, yOff); });
    g.addEventListener('pointerenter', (ev) => { if (!drag && !nodeDrag && !linkDrag && ev.pointerType !== 'touch') showTip(nd, g); });
    g.addEventListener('pointerleave', (ev) => { if (ev.pointerType !== 'touch') hideTip(g); });
    g.addEventListener('pointerdown', (ev) => onNodeDown(ev, nd));
    g.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (moved) return;
      if (editMode) return onNodeClick(nd, ev);
      if (tipOwner === g) hideTip(); else showTip(nd, g);
    });
  });
  applySel();
  computeSearch();
}
function styleEdge(rec) {
  const sk = rec.base;
  if (selEdges.has(rec.el)) { rec.path.setAttribute('stroke', '#ffd54a'); rec.path.setAttribute('stroke-width', Math.max(3, sk.width + 1.5)); }
  else { rec.path.setAttribute('stroke', sk.color); rec.path.setAttribute('stroke-width', sk.width); }
}
function applySel() {
  if (!model) return;
  model.nodes.forEach((nd) => {
    if (!nd.g) return;
    nd.g.querySelectorAll('.selring').forEach((r) => r.remove());
    const on = selNodes.has(nd.id), lk = linkFrom === nd.id;
    if (on || lk) make('rect', { class: 'selring', x: -4, y: -4, width: nd.w + 8, height: nd.h + 8, rx: 6, fill: 'none', stroke: lk ? '#4dd0e1' : '#ffd54a',
      'stroke-width': 1.5, 'stroke-dasharray': '4 3', 'pointer-events': 'none' }, nd.g);
  });
}

function load(text, name) {
  const d = parseDoc(text);
  if (!d) { setMsg('invalidFile'); return; }
  setDoc(d, name); undoStack.length = 0; redoStack.length = 0; clip = null; dirty = false;
  render(); msg.classList.add('hide');
  document.title = (name ? name + ' – ' : '') + 'GraphML Viewer';
  fit(); refreshPanel(); updateBar();
}

// ======================================================================
//  Infobulle : reste affichée tant que le pointeur est sur le nœud
// ======================================================================
let tipOwner = null;
function showTip(nd, g) {
  if (!nd.desc.trim()) return;
  const isHtml = /^\s*</.test(nd.desc);
  tip.className = isHtml ? 'show' : 'show plain';
  if (isHtml) tip.innerHTML = sanitize(nd.desc);
  else tip.textContent = nd.desc.trim();
  tipOwner = g; placeTip(g);
}
function placeTip(g) {
  const r = g.getBoundingClientRect(), gap = 12, vw = innerWidth - (editMode ? PANEL_W : 0), vh = innerHeight;
  tip.style.left = '0px'; tip.style.top = '0px';
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let x = r.right + gap; if (x + tw > vw - 8) x = r.left - gap - tw; if (x < 8) x = Math.max(8, Math.min(vw - tw - 8, r.left));
  let y = r.top + r.height / 2 - th / 2; y = Math.max(8, Math.min(vh - th - 8, y));
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
function hideTip(g) { if (g && tipOwner !== g) return; tipOwner = null; tip.classList.remove('show'); }

// ======================================================================
//  Vue : pan / zoom
// ======================================================================
const PANEL_W = 340;
let view = { x: 0, y: 0, k: 1 }, drag = null, moved = false, nodeDrag = null;
const apply = () => { world.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`); if (tipOwner) placeTip(tipOwner); };
function fit() {
  if (!model || !model.nodes.size) return;
  const b = model.bounds, pad = 40, W = innerWidth - (editMode ? PANEL_W : 0), H = innerHeight;
  const k = Math.min((W - pad * 2) / (b.maxX - b.minX || 1), (H - pad * 2) / (b.maxY - b.minY || 1));
  view = { k, x: W / 2 - ((b.minX + b.maxX) / 2) * k, y: H / 2 - ((b.minY + b.maxY) / 2) * k };
  apply();
}
function zoomAt(f, cx, cy) {
  const k = Math.max(0.05, Math.min(30, view.k * f)), r = k / view.k;
  view.x = cx - (cx - view.x) * r; view.y = cy - (cy - view.y) * r; view.k = k; apply();
}
const toWorld = (cx, cy) => ({ x: (cx - view.x) / view.k, y: (cy - view.y) / view.k });
const pts = new Map(); let pinch = 0;
stage.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015)), e.clientX, e.clientY); }, { passive: false });
stage.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.button !== 1) return;   // clic gauche ou molette = main ; le clic droit ne déplace pas
  if (e.button === 1) e.preventDefault();
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = false;
  if (pts.size === 1) drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); drag = null; }
});
stage.addEventListener('pointermove', (e) => {
  lastWorld = toWorld(e.clientX, e.clientY);
  if (rubber && linkFrom) { const p = toWorld(e.clientX, e.clientY); rubber.setAttribute('x2', p.x); rubber.setAttribute('y2', p.y); }
  if (!pts.has(e.pointerId)) return;
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pts.size === 2) {
    const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch) zoomAt(d / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2); pinch = d; moved = true; return;
  }
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!moved && Math.hypot(dx, dy) < 4) return;
  if (!moved) { moved = true; stage.classList.add('dragging'); hideTip(); try { stage.setPointerCapture(e.pointerId); } catch (_) {} }
  view.x = drag.vx + dx; view.y = drag.vy + dy; apply();
});
const end = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; if (!pts.size) { drag = null; stage.classList.remove('dragging'); setTimeout(() => { moved = false; }, 0); } };
stage.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
stage.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
stage.addEventListener('click', (e) => {
  if (moved) return; hideTip();
  if (!editMode) return;
  if (tool === 'link') return cancelLink();
  if (e.ctrlKey || e.metaKey) return;
  const had = selEdges.size; selNodes = new Set(); selEdges = new Set();
  if (had) model.edges.forEach(styleEdge);
  applySel(); refreshPanel();
});
$('zin').onclick = () => zoomAt(1.3, (innerWidth - (editMode ? PANEL_W : 0)) / 2, innerHeight / 2);
$('zout').onclick = () => zoomAt(1 / 1.3, (innerWidth - (editMode ? PANEL_W : 0)) / 2, innerHeight / 2);
$('fit').onclick = fit;
addEventListener('resize', () => { if (model) apply(); });

// ======================================================================
//  Mode édition
// ======================================================================
function serialize() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' + new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, '');
}
function normaliseLabels() {                  // reporte dans le fichier les positions calculées (sous le nœud, centrées)
  if (!model) return;
  const refs = new Map();
  Array.from(doc.getElementsByTagName('*')).filter((e) => e.localName === 'Label' && e.namespaceURI === XMLNS.y).forEach((l) => {
    const m = refRe.exec(l.getAttribute('LayoutParameter') || ''); if (m) refs.set(m[1], (refs.get(m[1]) || 0) + 1);
  });
  const isFree = (e) => e && e.localName === 'CompositeLabelModelParameter' && Array.from(e.getElementsByTagName('*')).some((x) => x.localName === 'FreeNodeLabelModelParameter');
  let maxKey = 0, freeTpl = null;
  resources.forEach((r, k) => { maxKey = Math.max(maxKey, parseInt(k, 10) || 0); if (!freeTpl && isFree(r)) freeTpl = r; });
  model.nodes.forEach((nd) => labelsOf(nd).forEach((lab) => {
    const box = labelBox.get(lab); if (!box) return;
    const m = refRe.exec(lab.getAttribute('LayoutParameter') || ''); let res = m && resEl(m[1]);
    if (!isFree(res) || refs.get(m[1]) > 1) {
      const src = isFree(res) ? res : freeTpl; if (!src) return;
      res = src.cloneNode(true); const key = String(++maxKey);
      res.setAttributeNS(XMLNS.x, 'x:Key', key); src.parentNode.appendChild(res); resources.set(key, res);
      if (m) refs.set(m[1], refs.get(m[1]) - 1);
      lab.setAttribute('LayoutParameter', `{y:GraphMLReference ${key}}`); refs.set(key, 1);
    }
    const f = Array.from(res.getElementsByTagName('*')).find((x) => x.localName === 'FreeNodeLabelModelParameter');
    f.setAttribute('LayoutOffset', `${box.ox},${box.oy}`);
  }));
}
function checkpoint() { undoStack.push(serialize()); if (undoStack.length > 15) undoStack.shift(); redoStack.length = 0; dirty = true; updateBar(); }
function restore(str) {
  const d = parseDoc(str.replace(/^<\?xml[^>]*\?>\s*/, '')); if (!d) return false;
  setDoc(d); render(); refreshPanel(); return true;
}
function undo() {
  if (!undoStack.length) return toast(tr('nothingUndo'));
  const cur = serialize(), st = undoStack.pop();
  if (restore(st)) { redoStack.push(cur); dirty = true; toast(tr('undone')); } updateBar();
}
function redo() {
  if (!redoStack.length) return toast(tr('nothingRedo'));
  const cur = serialize(), st = redoStack.pop();
  if (restore(st)) { undoStack.push(cur); dirty = true; toast(tr('redone')); } updateBar();
}
function updateBar() {
  $('undo').disabled = !undoStack.length; $('redo').disabled = !redoStack.length;
  document.body.classList.toggle('edit', editMode); document.body.classList.toggle('linking', tool === 'link');
  $('edit').setAttribute('aria-pressed', String(editMode));
  $('magnet').setAttribute('aria-pressed', String(magnet)); $('magnet').classList.toggle('on', magnet);
  $('tool-select').classList.toggle('on', tool === 'select'); $('tool-link').classList.toggle('on', tool === 'link');
}
function setEdit(on) {
  editMode = !!on && EDIT_ALLOWED; if (!editMode) { tool = 'select'; cancelLink(true); selNodes = new Set(); selEdges = new Set(); }
  updateBar(); if (model) { render(); refreshPanel(); apply(); }
}
$('edit').onclick = () => setEdit(!editMode);
$('undo').onclick = undo;
$('redo').onclick = redo;
let magnet = false;
$('magnet').onclick = () => { magnet = !magnet; updateBar(); toast(tr(magnet ? 'magnetOn' : 'magnetOff')); };
$('tool-select').onclick = () => { tool = 'select'; cancelLink(true); updateBar(); };
$('tool-link').onclick = () => { tool = 'link'; selNodes = new Set(); selEdges = new Set(); render(); refreshPanel(); updateBar(); toast(tr('linkToolToast')); };
$('export').onclick = () => {
  const a = document.createElement('a'); const base = fileName.replace(/^.*\//, '').replace(/\.graphml$/i, '');
  normaliseLabels();
  a.href = URL.createObjectURL(new Blob([serialize()], { type: 'application/xml' })); a.download = base + '-edited.graphml';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  dirty = false; toast(tr('exported'));
};
addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

// ----- sélection -----

// ----- déplacement de nœuds (un ou plusieurs) / liaison par glisser -----
function onNodeDown(ev, nd) {
  if (!editMode || ev.button !== 0) return;
  if (tool === 'link') { ev.stopPropagation(); moved = false; linkDrag = { from: nd, sx: ev.clientX, sy: ev.clientY, started: false, id: ev.pointerId }; return; }
  if (tool !== 'select') return;
  ev.stopPropagation(); moved = false; ctrlAdded = false;
  const ctrl = ev.ctrlKey || ev.metaKey; let changed = false;
  if (!selNodes.has(nd.id)) { if (ctrl) { selNodes.add(nd.id); ctrlAdded = true; } else selNodes = new Set([nd.id]); changed = true; }
  if (!ctrl && selEdges.size) { selEdges = new Set(); model.edges.forEach(styleEdge); changed = true; }
  if (changed) { applySel(); refreshPanel(); }
  const starts = [...selNodes].map((id) => model.nodes.get(id)).filter(Boolean).map((n) => ({ n, ox: n.x, oy: n.y }));
  nodeDrag = { nd, sx: ev.clientX, sy: ev.clientY, started: false, id: ev.pointerId, starts };
}
addEventListener('pointermove', (e) => {
  if (!nodeDrag || e.pointerId !== nodeDrag.id) return;
  const dx = (e.clientX - nodeDrag.sx) / view.k, dy = (e.clientY - nodeDrag.sy) / view.k;
  if (!nodeDrag.started) {
    if (Math.hypot(e.clientX - nodeDrag.sx, e.clientY - nodeDrag.sy) < 4) return;
    nodeDrag.started = true; moved = true; checkpoint(); hideTip(); stage.classList.add('moving');
  }
  let sdx = dx, sdy = dy;
  if (magnet && editMode) { const r = magnetSnap(dx, dy); sdx = r.dx; sdy = r.dy; } else clearGuides();
  const touched = new Set();
  nodeDrag.starts.forEach(({ n, ox, oy }) => {
    n.x = ox + sdx; n.y = oy + sdy; n.g.setAttribute('transform', `translate(${n.x} ${n.y})`);
    (model.adj.get(n.id) || []).forEach((r) => touched.add(r));
  });
  touched.forEach((r) => { const d = edgeD(r); r.path.setAttribute('d', d); r.hit.setAttribute('d', d); });
});
// ----- aimant (snap) -----
const SNAP_IN = 8, SNAP_OUT = 15; // seuils d'entrée / sortie, en pixels écran (hystérésis)
const SNAP_RANGE = 260, SNAP_NEAR = 16; // périmètre d'activation (px écran) et nb max d'objets voisins pris en compte
let guides = null;
function clearGuides() { if (guides) { guides.remove(); guides = null; } }
// Lignes de contrainte : alignement (droite passant par ≥2 objets, toute direction) et
// équidistance radiale (médiatrice de 2 objets). Un snap = projection sur 1 ligne ou intersection de 2 lignes.
function magnetSnap(dx, dy) {
  const d = nodeDrag, P = d.nd;
  if (!d.mag) {
    const sel = new Set(d.starts.map((q) => q.n.id)), st = d.starts.find((q) => q.n === P);
    d.mag = { others: [...model.nodes.values()].filter((n) => !sel.has(n.id)).map((n) => ({ id: n.id, x: n.x + n.w / 2, y: n.y + n.h / 2 })),
      cx0: st.ox + P.w / 2, cy0: st.oy + P.h / 2, pt: null, act: null };
  }
  const m = d.mag, tIn = SNAP_IN / view.k, tOut = SNAP_OUT / view.k, rng = SNAP_RANGE / view.k;
  const rx = m.cx0 + dx, ry = m.cy0 + dy; let px = rx, py = ry;
  const dist = (o) => Math.hypot(o.x - rx, o.y - ry);
  // périmètre : seuls les objets proches de l'origine du nœud déplacé comptent, les plus proches d'abord
  const near = m.others.map((o) => ({ o, dd: dist(o) })).filter((q) => q.dd < rng).sort((a, b) => a.dd - b.dd).slice(0, SNAP_NEAR);
  const marks = [];
  // 1) coïncidence des origines (priorité maximale)
  const keep = m.pt && m.others.find((o) => o.id === m.pt && dist(o) < tOut);
  m.pt = keep ? keep.id : (near.length && near[0].dd < tIn ? near[0].o.id : null);
  const pt = m.pt && m.others.find((o) => o.id === m.pt);
  if (pt) { px = pt.x; py = pt.y; m.act = null; marks.push({ t: 'ring', x: pt.x, y: pt.y }); drawGuides(marks); return { dx: dx + px - rx, dy: dy + py - ry }; }
  // 2) lignes candidates
  const lines = new Map();
  const sd = (l) => Math.abs((rx - l.x0) * l.uy - (ry - l.y0) * l.ux); // distance de l'origine à la ligne
  for (let a = 0; a < near.length; a++) for (let b = a + 1; b < near.length; b++) {
    const A = near[a].o, B = near[b].o, L = Math.hypot(B.x - A.x, B.y - A.y); if (L < 1) continue;
    const ux = (B.x - A.x) / L, uy = (B.y - A.y) / L;
    // alignement : droite (A,B) ; objets colinéaires
    const col = near.filter((q) => Math.abs((q.o.x - A.x) * uy - (q.o.y - A.y) * ux) < 0.5);
    const kA = 'A:' + col.map((q) => q.o.id).sort().join(',');
    if (!lines.has(kA)) lines.set(kA, { key: kA, kind: 'A', x0: A.x, y0: A.y, ux, uy, objs: col.map((q) => q.o), prox: Math.min(...col.map((q) => q.dd)) });
    // équidistance : médiatrice (A,B)
    const kR = 'R:' + [A.id, B.id].sort().join(',');
    lines.set(kR, { key: kR, kind: 'R', x0: (A.x + B.x) / 2, y0: (A.y + B.y) / 2, ux: -uy, uy: ux, objs: [A, B], prox: Math.max(near[a].dd, near[b].dd) });
  }
  const prevKeys = new Set(m.act || []);
  const cands = [...lines.values()].filter((l) => { l.d = sd(l); return l.d < (prevKeys.has(l.key) ? tOut : tIn); });
  const inter = (a, b) => { // intersection de deux lignes
    const cr = a.ux * b.uy - a.uy * b.ux; if (Math.abs(cr) < 0.25) return null;
    const t = ((b.x0 - a.x0) * b.uy - (b.y0 - a.y0) * b.ux) / cr; return { x: a.x0 + a.ux * t, y: a.y0 + a.uy * t };
  };
  const opts = [];
  for (let a = 0; a < cands.length; a++) for (let b = a + 1; b < cands.length; b++) {
    const A = cands[a], B = cands[b], X = inter(A, B); if (!X) continue;
    const dd = Math.hypot(X.x - rx, X.y - ry); if (dd > tOut * 1.5) continue;
    const tier = A.kind !== B.kind ? 1 : 2; // combo alignement × équidistance en premier
    opts.push({ tier, ls: [A, B], x: X.x, y: X.y, score: Math.min(A.prox, B.prox) + dd });
  }
  cands.forEach((l) => opts.push({ tier: 3, ls: [l], score: l.prox + l.d }));
  let pick = null;
  if (m.act) { // stabilité : on garde la sélection précédente tant qu'elle reste valide
    pick = opts.find((o) => o.ls.length === m.act.length && o.ls.every((l) => prevKeys.has(l.key)));
    if (pick && pick.ls.length === 2 && Math.hypot(pick.x - rx, pick.y - ry) > tOut * 1.5) pick = null;
  }
  if (!pick) pick = opts.sort((a, b) => a.tier - b.tier || a.score - b.score)[0] || null;
  m.act = pick ? pick.ls.map((l) => l.key) : null;
  if (pick) {
    if (pick.ls.length === 2) { px = pick.x; py = pick.y; }
    else { const l = pick.ls[0], t = (rx - l.x0) * l.ux + (ry - l.y0) * l.uy; px = l.x0 + l.ux * t; py = l.y0 + l.uy * t; }
    pick.ls.forEach((l) => {
      if (l.kind === 'A') marks.push({ t: 'l', l, pts: [...l.objs, { x: px, y: py }] });
      else { const R = Math.hypot(l.objs[0].x - px, l.objs[0].y - py); marks.push({ t: 'c', x: px, y: py, r: R, on: near.map((q) => q.o).filter((o) => Math.abs(Math.hypot(o.x - px, o.y - py) - R) < 0.75) }); }
    });
  }
  drawGuides(marks);
  return { dx: dx + px - rx, dy: dy + py - ry };
}
function drawGuides(marks) {
  clearGuides(); if (!marks.length) return;
  guides = make('g', { 'pointer-events': 'none' }, world);
  const col = '#ff4fa3', base = { stroke: col, 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke', fill: 'none' };
  const ext = 24 / view.k;
  marks.forEach((q) => {
    if (q.t === 'l') {
      const l = q.l, ts = q.pts.map((o) => (o.x - l.x0) * l.ux + (o.y - l.y0) * l.uy), t0 = Math.min(...ts) - ext, t1 = Math.max(...ts) + ext;
      make('line', { ...base, x1: l.x0 + l.ux * t0, y1: l.y0 + l.uy * t0, x2: l.x0 + l.ux * t1, y2: l.y0 + l.uy * t1 }, guides);
    } else if (q.t === 'c') {
      make('circle', { ...base, cx: q.x, cy: q.y, r: q.r, 'stroke-dasharray': '1 6', 'stroke-linecap': 'round', 'stroke-width': 2.5 }, guides);
      q.on.forEach((o) => make('circle', { ...base, cx: o.x, cy: o.y, r: 5 / view.k, fill: col, stroke: 'none' }, guides));
    } else make('circle', { ...base, cx: q.x, cy: q.y, r: 10 / view.k }, guides);
  });
}
function endNodeDrag(e) {
  if (!nodeDrag || e.pointerId !== nodeDrag.id) return;
  const { starts, started } = nodeDrag; nodeDrag = null; stage.classList.remove('moving'); clearGuides();
  if (started) {
    starts.forEach(({ n: nd }) => {
      nd.x = Math.round(nd.x * 1000) / 1000; nd.y = Math.round(nd.y * 1000) / 1000;
      writePos(nd);
    });
    ctrlAdded = false; recomputeBounds(); setTimeout(() => { moved = false; }, 0);
  }
}
function writePos(nd) {
  nd.rect.setAttribute('X', nd.x); nd.rect.setAttribute('Y', nd.y);
  for (const f of nd.el.getElementsByTagName('*')) if (f.localName === 'FolderNodeState') f.setAttribute('Layout', `${nd.x},${nd.y},${nd.w},${nd.h}`);
}
addEventListener('pointerup', endNodeDrag); addEventListener('pointercancel', endNodeDrag);
addEventListener('pointermove', (e) => {
  if (!linkDrag || e.pointerId !== linkDrag.id) return;
  if (!linkDrag.started) {
    if (Math.hypot(e.clientX - linkDrag.sx, e.clientY - linkDrag.sy) < 4) return;
    linkDrag.started = true; moved = true; hideTip(); cancelLink(true); linkFrom = linkDrag.from.id; startRubber(linkDrag.from); applySel();
  }
  const q = toWorld(e.clientX, e.clientY); rubber.setAttribute('x2', q.x); rubber.setAttribute('y2', q.y);
});
function endLinkDrag(e) {
  if (!linkDrag || e.pointerId !== linkDrag.id) return;
  const { from, started } = linkDrag; linkDrag = null;
  if (!started) return;
  const hit = document.elementFromPoint(e.clientX, e.clientY), g = hit && hit.closest && hit.closest('.node'), tid = g && g.dataset.id;
  cancelLink(true); applySel(); setTimeout(() => { moved = false; }, 0);
  if (tid && tid !== from.id) tryLink(from.id, tid);
}
addEventListener('pointerup', endLinkDrag); addEventListener('pointercancel', endLinkDrag);
function recomputeBounds() { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; model.nodes.forEach((n) => { a = Math.min(a, n.x); b = Math.min(b, n.y); c = Math.max(c, n.x + n.w); d = Math.max(d, n.y + n.h); }); model.bounds = { minX: a, minY: b, maxX: c, maxY: d }; }

// ----- liens -----
let rubber = null;
function cancelLink(silent) {
  linkFrom = null; if (rubber) { rubber.remove(); rubber = null; }
  if (model && !silent) render();
}
function startRubber(nd) {
  const c = { x: nd.x + nd.w / 2, y: nd.y + nd.h / 2 };
  rubber = make('line', { x1: c.x, y1: c.y, x2: c.x, y2: c.y, stroke: '#4dd0e1', 'stroke-width': 2, 'stroke-dasharray': '5 4', 'pointer-events': 'none' }, world);
}
function tryLink(a, b) {
  if (model.edges.some((r) => (r.s.id === a && r.t.id === b) || (r.s.id === b && r.t.id === a))) return toast(tr('linkExists'));
  createEdge(a, b);
}
function onNodeClick(nd, ev) {
  if (tool === 'link') {
    if (!linkFrom) { linkFrom = nd.id; applySel(); startRubber(nd); return; }
    if (linkFrom === nd.id) return cancelLink();
    const a = linkFrom; cancelLink(true); applySel(); tryLink(a, nd.id); return;
  }
  const ctrl = ev && (ev.ctrlKey || ev.metaKey);
  if (ctrl) { if (ctrlAdded) ctrlAdded = false; else if (selNodes.has(nd.id)) selNodes.delete(nd.id); else selNodes.add(nd.id); }
  else selNodes = new Set([nd.id]);
  if (!ctrl && selEdges.size) { selEdges = new Set(); model.edges.forEach(styleEdge); }
  applySel(); refreshPanel();
}
function createEdge(a, b) {
  checkpoint();
  const graph = Array.from(doc.getElementsByTagName('graph'))[0];
  const existing = kids(graph).filter((c) => c.localName === 'edge');
  const tpl = existing.find((e) => { const d = dataOf(e, 'd13'); const s = d && deref(first(d)); return s && s.localName !== 'ArcEdgeStyle'; }) || existing[0];
  const ids = new Set(existing.map((e) => e.getAttribute('id')));
  let n = existing.length; while (ids.has('e' + n)) n++;
  let el;
  if (tpl) { el = tpl.cloneNode(true); }
  else {
    el = doc.createElementNS(XMLNS.graphml, 'edge');
  }
  el.setAttribute('id', 'e' + n); el.setAttribute('source', a); el.setAttribute('target', b);
  el.removeAttribute('sourceport'); el.removeAttribute('targetport');
  graph.appendChild(el);
  selEdges = new Set([el]); selNodes = new Set(); render(); refreshPanel(); toast(tr('linkCreated'));
}
function deleteSelection() {
  if (!selNodes.size && !selEdges.size) return;
  checkpoint();
  const graph = Array.from(doc.getElementsByTagName('graph'))[0], ids = new Set(selNodes), nN = ids.size, nE = selEdges.size;
  selEdges.forEach((e) => e.remove());
  kids(graph).filter((e) => e.localName === 'edge' && (ids.has(e.getAttribute('source')) || ids.has(e.getAttribute('target')))).forEach((e) => e.remove());
  ids.forEach((id) => { const n = model.nodes.get(id); if (n) n.el.remove(); });
  selNodes = new Set(); selEdges = new Set(); render(); refreshPanel();
  toast(tr('deleted', [nN && tr('nodesN', nN), nE && tr('linksN', nE)].filter(Boolean), nN + nE));
}
function deleteNodes(ids) {
  if (!ids.size) return;
  checkpoint();
  const graph = Array.from(doc.getElementsByTagName('graph'))[0];
  kids(graph).filter((e) => e.localName === 'edge' && (ids.has(e.getAttribute('source')) || ids.has(e.getAttribute('target')))).forEach((e) => e.remove());
  ids.forEach((id) => { const n = model.nodes.get(id); if (n) n.el.remove(); });
  selNodes = new Set(); selEdges = new Set(); render(); refreshPanel();
}
function copySel() {
  const ids = new Set(selNodes); if (!ids.size) return false;
  const graph = Array.from(doc.getElementsByTagName('graph'))[0];
  const nodes = [...ids].map((id) => model.nodes.get(id)).filter(Boolean);
  const edges = kids(graph).filter((e) => e.localName === 'edge' && ids.has(e.getAttribute('source')) && ids.has(e.getAttribute('target')));
  clip = { nodes: nodes.map((n) => ({ el: n.el.cloneNode(true), id: n.id, x: n.x, y: n.y })), edges: edges.map((e) => e.cloneNode(true)), pastes: 0 };
  toast(tr('copied', nodes.length)); return true;
}
function cutSel() { if (copySel()) { deleteNodes(new Set(selNodes)); toast(tr('cut')); } }
function pasteClip(at) {
  if (!clip || !clip.nodes.length) return toast(tr('clipEmpty'));
  checkpoint();
  const graph = Array.from(doc.getElementsByTagName('graph'))[0];
  const nodeIds = new Set(), edgeIds = new Set(); let maxN = -1, maxE = -1, maxZ = 0;
  kids(graph).forEach((c) => {
    const id = c.getAttribute('id') || '';
    if (c.localName === 'node') { nodeIds.add(id); const m = /^n(\d+)$/.exec(id); if (m) maxN = Math.max(maxN, +m[1]); const z = parseFloat((dataOf(c, 'd0') || {}).textContent); if (!isNaN(z)) maxZ = Math.max(maxZ, z); }
    if (c.localName === 'edge') { edgeIds.add(id); const m = /^e(\d+)$/.exec(id); if (m) maxE = Math.max(maxE, +m[1]); }
  });
  const minX = Math.min(...clip.nodes.map((n) => n.x)), minY = Math.min(...clip.nodes.map((n) => n.y));
  const k = clip.pastes++;
  const pos = at || lastWorld;
  const ax = pos ? pos.x + k * 20 : minX + 30 * (k + 1), ay = pos ? pos.y + k * 20 : minY + 30 * (k + 1);
  const firstEdge = kids(graph).find((c) => c.localName === 'edge') || null;
  const map = new Map(); const created = new Set();
  clip.nodes.forEach((c, i) => {
    let nid; do { nid = 'n' + (++maxN); } while (nodeIds.has(nid));
    map.set(c.id, nid); nodeIds.add(nid);
    const el = doc.importNode(c.el, true); el.setAttribute('id', nid);
    const z = dataOf(el, 'd0'); if (z) z.textContent = String(++maxZ);
    const r = first(dataOf(el, 'd5')); const w = +r.getAttribute('Width'), h = +r.getAttribute('Height');
    const nx = Math.round((ax + (c.x - minX)) * 1000) / 1000, ny = Math.round((ay + (c.y - minY)) * 1000) / 1000;
    r.setAttribute('X', nx); r.setAttribute('Y', ny);
    for (const f of el.getElementsByTagName('*')) if (f.localName === 'FolderNodeState') f.setAttribute('Layout', `${nx},${ny},${w},${h}`);
    graph.insertBefore(el, firstEdge); created.add(nid);
  });
  clip.edges.forEach((c) => {
    let eid; do { eid = 'e' + (++maxE); } while (edgeIds.has(eid));
    edgeIds.add(eid);
    const el = doc.importNode(c, true); el.setAttribute('id', eid);
    el.setAttribute('source', map.get(c.getAttribute('source'))); el.setAttribute('target', map.get(c.getAttribute('target')));
    graph.appendChild(el);
  });
  selNodes = created; selEdges = new Set(); render(); refreshPanel();
  toast(tr('pasted', created.size));
}

function nextNodeIds() {
  const graph = Array.from(doc.getElementsByTagName('graph'))[0]; let maxN = -1, maxZ = 0;
  kids(graph).forEach((c) => { if (c.localName !== 'node') return; const m = /^n(\d+)$/.exec(c.getAttribute('id') || ''); if (m) maxN = Math.max(maxN, +m[1]); const z = parseFloat((dataOf(c, 'd0') || {}).textContent); if (!isNaN(z)) maxZ = Math.max(maxZ, z); });
  return { graph, maxN, maxZ };
}
function createNodeAt(pos) {
  checkpoint();
  const { graph, maxN, maxZ } = nextNodeIds(), id = 'n' + (maxN + 1), size = 30;
  const node = doc.createElementNS(XMLNS.graphml, 'node'); node.setAttribute('id', id);
  const mk = (key) => { const d = doc.createElementNS(XMLNS.graphml, 'data'); d.setAttribute('key', key); node.append(d); return d; };
  mk('d0').textContent = String(maxZ + 1);
  setCdata(mk('d3'), tr('newNode'));
  const r = doc.createElementNS(XMLNS.y, 'y:RectD');
  r.setAttribute('X', Math.round((pos.x - size / 2) * 1000) / 1000); r.setAttribute('Y', Math.round((pos.y - size / 2) * 1000) / 1000);
  r.setAttribute('Width', size); r.setAttribute('Height', size); mk('d5').append(r);
  const st = doc.createElementNS(XMLNS.yjs, 'yjs:ShapeNodeStyle'); st.setAttribute('shape', 'ELLIPSE');
  st.setAttribute('stroke', '#FFE8E8EC'); st.setAttribute('fill', `{y:GraphMLReference ${colorRes('#FF6B5B95')}}`); mk('d7').append(st);
  graph.insertBefore(node, kids(graph).find((c) => c.localName === 'edge') || null);
  selNodes = new Set([id]); selEdges = new Set(); render(); refreshPanel(); toast(tr('nodeCreated'));
}
// ----- apparence : forme, couleurs, taille -----
const SHAPES = ['ELLIPSE', 'RECTANGLE', 'ROUND_RECTANGLE', 'DIAMOND', 'TRIANGLE', 'HEXAGON', 'OCTAGON', 'STAR5', 'STAR6', 'STAR8'].map((v) => [v, 'shape_' + v]);
const sharedData = () => Array.from(doc.getElementsByTagName('*')).find((e) => e.localName === 'SharedData');
function colorRes(argbStr) {                         // ressource <yjs:Color> partagée (réutilise une identique)
  const up = argbStr.toUpperCase();
  const found = Array.from(resources.entries()).find(([, r]) => r.localName === 'Color' && (r.getAttribute('value') || '').toUpperCase() === up);
  if (found) return found[0];
  let max = 0; resources.forEach((_, k) => { max = Math.max(max, parseInt(k, 10) || 0); });
  const key = String(max + 1), c = doc.createElementNS(XMLNS.yjs, 'yjs:Color');
  c.setAttributeNS(XMLNS.x, 'x:Key', key); c.setAttribute('value', up); sharedData().appendChild(c); resources.set(key, c); return key;
}
const toArgb = (hex) => '#FF' + hex.slice(1).toUpperCase();
function toHex(css) {
  const c = document.createElement('canvas').getContext('2d'); c.fillStyle = '#000'; c.fillStyle = css || '#888888';
  const v = c.fillStyle; if (v[0] === '#') return v;
  const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(v) || [0, 136, 136, 136];
  return '#' + [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join('');
}
const styleOf = (n) => first(dataOf(n.el, 'd7') || document.createElement('x'));
const kindOf = (n) => { const st = styleOf(n); return st && st.localName === 'ImageNodeStyle' ? 'IMAGE' : ((st && st.getAttribute && st.getAttribute('shape')) || 'RECTANGLE').toUpperCase(); };
function setShape(n, shape) {
  const d = ensureData(n, 'd7'), st = styleOf(n);
  if (st && st.localName === 'ShapeNodeStyle') { st.setAttribute('shape', shape); return; }
  if (st && st.localName === 'ImageNodeStyle') imageStash.set(n.id, st.cloneNode(true));
  const ns = doc.createElementNS(XMLNS.yjs, 'yjs:ShapeNodeStyle'); ns.setAttribute('shape', shape);
  ns.setAttribute('stroke', '#FFE8E8EC'); ns.setAttribute('fill', `{y:GraphMLReference ${colorRes('#FF6B5B95')}}`); d.replaceChildren(ns);
}
function restoreImage(n) { const st = imageStash.get(n.id); if (st) ensureData(n, 'd7').replaceChildren(doc.importNode(st, true)); }
function setShapeColors(n, { fill, stroke }) {
  const st = styleOf(n); if (!st || st.localName !== 'ShapeNodeStyle') return;
  kids(st).filter((c) => /^ShapeNodeStyle\.(fill|stroke)$/.test(c.localName)).forEach((c) => c.remove());
  if (fill) st.setAttribute('fill', `{y:GraphMLReference ${colorRes(toArgb(fill))}}`);
  if (stroke) st.setAttribute('stroke', toArgb(stroke));
}
function resizeNode(n, size) {                        // garde le centre et le rapport largeur/hauteur
  const ratio = n.h / n.w, cx = n.x + n.w / 2, cy = n.y + n.h / 2, w = size, h = Math.round(size * ratio * 1000) / 1000;
  n.w = w; n.h = h; n.x = Math.round((cx - w / 2) * 1000) / 1000; n.y = Math.round((cy - h / 2) * 1000) / 1000;
  n.rect.setAttribute('Width', w); n.rect.setAttribute('Height', h); writePos(n);
}
function appearanceBox(ids) {
  const live = () => ids.map((id) => model.nodes.get(id)).filter(Boolean);
  const nds = live(), kinds = new Set(nds.map(kindOf)), wrap = el('div', { class: 'appearance' }, el('label', {}, tr('appearance')));
  const sel = el('select', {});
  if (kinds.size > 1) sel.append(el('option', { value: '', disabled: '' }, tr('mixed')));
  if (nds.every((n) => kindOf(n) === 'IMAGE' || imageStash.has(n.id))) sel.append(el('option', { value: 'IMAGE' }, tr('imageOpt')));
  const known = new Set(SHAPES.map((x) => x[0]));
  kinds.forEach((k) => { if (k !== 'IMAGE' && !known.has(k)) sel.append(el('option', { value: k }, k)); });
  SHAPES.forEach(([v, l]) => sel.append(el('option', { value: v }, tr(l))));
  sel.value = kinds.size === 1 ? [...kinds][0] : '';
  sel.onchange = () => { const v = sel.value; checkpoint(); live().forEach((n) => { if (v === 'IMAGE') restoreImage(n); else setShape(n, v); }); render(); refreshPanel(); };
  wrap.append(sel);
  if (nds.every((n) => kindOf(n) !== 'IMAGE')) {
    const st0 = styleOf(nds[0]);
    const fi = el('input', { type: 'color' }), si = el('input', { type: 'color' });
    fi.value = toHex(colorOf(prop(st0, 'fill'))); const sk = strokeOf(prop(st0, 'stroke')); si.value = toHex(sk && sk.color);
    let armedC = false;
    const upd = (o) => { if (!armedC) { checkpoint(); armedC = true; } live().forEach((n) => setShapeColors(n, o)); render(); };
    fi.oninput = () => upd({ fill: fi.value }); si.oninput = () => upd({ stroke: si.value });
    fi.onchange = si.onchange = () => { armedC = false; };
    wrap.append(el('div', { class: 'row' }, el('span', { class: 'lbl' }, tr('fill')), fi, el('span', { class: 'lbl' }, tr('stroke')), si));
  } else wrap.append(el('p', { class: 'hint' }, tr('colorHint')));
  const sz = el('input', { type: 'number', min: '6', max: '400', step: '1' }); sz.value = String(Math.round(nds[0].w * 10) / 10);
  let armedS = false;
  sz.oninput = () => { const v = parseFloat(sz.value); if (!(v >= 6 && v <= 400)) return; if (!armedS) { checkpoint(); armedS = true; } live().forEach((n) => resizeNode(n, v)); render(); };
  sz.onchange = () => { armedS = false; };
  wrap.append(el('div', { class: 'row' }, el('span', { class: 'lbl' }, tr('sizePx')), sz));
  return wrap;
}
// ----- menu contextuel (clic droit) -----
const ctx = $('ctx');
const hideCtx = () => ctx.classList.remove('show');
stage.addEventListener('contextmenu', (e) => {
  e.preventDefault(); hideCtx(); if (!editMode) return; hideTip();
  const pos = toWorld(e.clientX, e.clientY);
  ctx.replaceChildren(el('button', { onclick: () => { hideCtx(); createNodeAt(pos); } }, tr('createHere')),
    ...(clip ? [el('button', { onclick: () => { hideCtx(); pasteClip(pos); } }, tr('pasteHere'))] : []));
  ctx.classList.add('show');
  ctx.style.left = Math.min(e.clientX, innerWidth - ctx.offsetWidth - 8) + 'px'; ctx.style.top = Math.min(e.clientY, innerHeight - ctx.offsetHeight - 8) + 'px';
});
addEventListener('pointerdown', (e) => { if (!ctx.contains(e.target)) hideCtx(); }, true);
addEventListener('keydown', (e) => { if (e.key === 'Escape') hideCtx(); });
addEventListener('wheel', hideCtx, { passive: true });

// ----- description / étiquettes / image -----
function setCdata(el, text) {
  el.replaceChildren(text.includes(']]>') ? doc.createTextNode(text) : doc.createCDATASection(text));
}
function ensureData(nd, key) {
  let d = dataOf(nd.el, key);
  if (!d) { d = doc.createElementNS(XMLNS.graphml, 'data'); d.setAttribute('key', key); nd.el.insertBefore(d, nd.el.children[0] ? nd.el.children[0] : null); }
  return d;
}
function setDescription(nd, text) {
  const d = ensureData(nd, 'd3'); setCdata(d, text); nd.desc = text;
  if (tipOwner === nd.g) showTip(nd, nd.g);
}
function labelList(nd, create) {
  let d = dataOf(nd.el, 'd4');
  if (!d && create) { d = doc.createElementNS(XMLNS.graphml, 'data'); d.setAttribute('key', 'd4'); nd.el.insertBefore(d, dataOf(nd.el, 'd5') || null); }
  if (!d) return null;
  let list = kids(d).find((c) => c.localName === 'List');
  if (!list && create) { list = doc.createElementNS(XMLNS.x, 'x:List'); d.appendChild(list); }
  return list;
}
function labelsOf(nd) { const l = labelList(nd); return l ? kids(l).filter((c) => c.localName === 'Label') : []; }
function setLabelText(lab, text) {
  if (lab.hasAttribute('Text')) { lab.setAttribute('Text', text); return; }
  let t = kid(lab, 'Label.Text');
  if (!t) { t = doc.createElementNS(XMLNS.y, 'y:Label.Text'); lab.insertBefore(t, lab.firstChild); }
  const raw = t.textContent;
  if (/<[a-z][^>]*>/i.test(raw)) {              // conserve gras / italique du balisage existant
    const d = new DOMParser().parseFromString(raw, 'text/html');
    const w = document.createTreeWalker(d.body, NodeFilter.SHOW_TEXT); const n = w.nextNode();
    if (n) { n.data = text; t.textContent = d.body.innerHTML; return; }
  }
  t.textContent = text;
}
function newLabel(nd, text) {
  const tpl = Array.from(doc.getElementsByTagName('*')).find((e) => e.localName === 'Label' && e.namespaceURI === XMLNS.y);
  let lab;
  if (tpl) { lab = tpl.cloneNode(true); setLabelText(lab, text); }
  else {
    lab = doc.createElementNS(XMLNS.y, 'y:Label'); lab.setAttribute('Text', text);
    const st = doc.createElementNS(XMLNS.y, 'y:Label.Style'); const ls = doc.createElementNS(XMLNS.yjs, 'yjs:LabelStyle');
    ls.setAttribute('backgroundFill', '#B7A53232'); ls.setAttribute('textFill', 'white'); ls.setAttribute('shape', 'ROUND_RECTANGLE');
    ls.setAttribute('verticalTextAlignment', 'CENTER'); ls.setAttribute('horizontalTextAlignment', 'CENTER');
    st.appendChild(ls); lab.appendChild(st);
  }
  return lab;
}
function resizeToPng(file, max) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.naturalWidth || max, img.naturalHeight || max));
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round((img.naturalWidth || max) * k)); c.height = Math.max(1, Math.round((img.naturalHeight || max) * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('image illisible')); };
    img.src = url;
  });
}
function setNodeImage(nd, dataUri) {
  const d = ensureData(nd, 'd7');
  const st = doc.createElementNS(XMLNS.yjs, 'yjs:ImageNodeStyle'); st.setAttribute('backgroundShape', 'RECTANGLE');
  const h = doc.createElementNS(XMLNS.yjs, 'yjs:ImageNodeStyle.href'); h.textContent = dataUri; st.appendChild(h);
  d.replaceChildren(st);
}

// ----- icônes plates (currentColor) -----
const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  magnet: '<path d="M6 15V4h4v11a2 2 0 0 0 4 0V4h4v11a6 6 0 0 1-12 0Z"/><path d="M6 8h4M14 8h4"/>',
};
function icon(name) {
  const w = document.createElement('span'); w.className = 'ic';
  w.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`; return w;
}
document.querySelectorAll('[data-icon]').forEach((b) => b.prepend(icon(b.dataset.icon)));

// ----- panneau -----
const panel = $('panel');
function el(tag, attrs, ...ch) { const e = document.createElement(tag); for (const k in attrs || {}) { if (k === 'class') e.className = attrs[k]; else if (k.startsWith('on')) e[k] = attrs[k]; else e.setAttribute(k, attrs[k]); } ch.forEach((c) => e.append(c)); return e; }
function refreshPanel() {
  panel.replaceChildren();
  if (!editMode) return;
  panel.append(el('h2', {}, tr('panelTitle')));
  if (tool === 'link') { panel.append(el('p', { class: 'hint' }, tr(linkFrom ? 'linkHintEnd' : 'linkHintStart'))); return; }
  const nN = selNodes.size, nE = selEdges.size;
  const delBtn = el('button', { class: 'danger', onclick: deleteSelection }, tr('delSel'));
  if (nE && !nN) {
    const one = nE === 1 ? [...selEdges][0] : null;
    panel.append(el('h3', {}, one ? tr('linkOne', one.getAttribute('source'), one.getAttribute('target')) : tr('linksSel', nE)),
      el('p', { class: 'hint' }, tr('hintLinks')), delBtn);
    return;
  }
  if (nN > 1 || (nN && nE)) {
    panel.append(el('h3', {}, tr('mixSel', nN, nE)),
      el('p', { class: 'hint' }, tr('hintMulti')),
      appearanceBox([...selNodes]), delBtn);
    return;
  }
  const nd = nN === 1 ? model.nodes.get([...selNodes][0]) : null;
  if (!nd) { panel.append(el('p', { class: 'hint' }, tr('hintNone'))); return; }
  panel.append(el('h3', {}, tr('nodeTitle', nd.id)));
  // image
  const prev = el('img', { class: 'thumb', alt: '' }); const st = first(dataOf(nd.el, 'd7') || document.createElement('x')); const href = st && st.localName === 'ImageNodeStyle' ? imageHref(st) : null; if (href) prev.src = href;
  const pick = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  pick.onchange = async () => { const f = pick.files[0]; if (!f) return; try { const uri = await resizeToPng(f, 128); checkpoint(); setNodeImage(nd, uri); render(); refreshPanel(); toast(tr('imageChanged')); } catch (e) { toast(tr('imageBad')); } };
  panel.append(el('div', { class: 'row' }, prev, el('button', { onclick: () => pick.click() }, tr('changeImage')), pick));
  panel.append(appearanceBox([nd.id]));
  // description
  const ta = el('textarea', { rows: 12, spellcheck: 'false' }); ta.value = nd.desc;
  let armed = false;
  ta.oninput = () => { if (!armed) { checkpoint(); armed = true; } setDescription(nd, ta.value); };
  ta.onblur = () => { armed = false; };
  panel.append(el('label', {}, tr('descLabel')), ta);
  // étiquettes
  panel.append(el('label', {}, tr('labelsLabel')));
  const box = el('div', { class: 'labels' }); panel.append(box);
  const drawRows = () => {
    box.replaceChildren();
    labelsOf(nd).forEach((lab) => {
      const inp = el('input', { type: 'text' }); inp.value = labelText(lab).txt; let armedL = false, tm;
      inp.oninput = () => { if (!armedL) { checkpoint(); armedL = true; } setLabelText(lab, inp.value); clearTimeout(tm); tm = setTimeout(render, 150); };
      inp.onblur = () => { armedL = false; };
      box.append(el('div', { class: 'row' }, inp, el('button', { title: tr('remove'), onclick: () => { checkpoint(); lab.remove(); const l = labelList(nd); if (l && !l.children.length) l.parentNode.remove(); render(); drawRows(); } }, icon('close'))));
    });
    box.append(el('button', { onclick: () => { checkpoint(); { labelList(nd, true).appendChild(newLabel(nd, 'NEW!')); } render(); drawRows(); } }, tr('addLabel')));
  };
  drawRows();
  panel.append(delBtn);
}

// ======================================================================
//  Recherche (descriptions « débalisées » sur une ligne, ou labels)
// ======================================================================
const searchBox = $('search'), qInput = $('q'), resultsEl = $('results'), scountEl = $('scount');
let searchHits = new Map();              // id → { title, text?, labels? }
const normQ = () => qInput.value.trim().replace(/\s+/g, ' ');
const searchMode = () => (document.querySelector('input[name="smode"]:checked') || {}).value || 'desc';
const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'br', 'hr', 'tr', 'table', 'blockquote', 'pre', 'section', 'article', 'header', 'footer', 'dl', 'dt', 'dd', 'figure', 'form', 'address']);
// → { title, lines: [[{t,b,i,u,s}…]…] } ; une ligne par balise « de texte », les balises en ligne (b, i, u, s…) ne coupent pas.
function parseDesc(nd) {
  if (nd._src === nd.desc) return nd._parsed;
  const desc = nd.desc; let title = '', lines = [];
  if (!/<[a-z!/][^>]*>/i.test(desc)) {
    const ls = desc.split('\n').map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
    lines = ls.map((t) => [{ t }]);                     // texte brut : pas de titre → l'id du nœud sert de repli
  } else {
    const d = new DOMParser().parseFromString(desc, 'text/html');
    let cur = [], titleSet = false, sawText = false;
    const flush = () => {
      cur = cur.filter((sg) => sg.t.length);
      if (cur.length) { cur[0].t = cur[0].t.replace(/^\s+/, ''); cur[cur.length - 1].t = cur[cur.length - 1].t.replace(/\s+$/, ''); }
      cur = cur.filter((sg) => sg.t.length);
      if (cur.length) lines.push(cur); cur = [];
    };
    const walk = (n, f) => {
      if (n.nodeType === 3) {
        let t = n.data.replace(/\s+/g, ' '); if (!t.trim()) { if (cur.length && t) { t = ' '; } else return; } else sawText = true;
        const prev = cur[cur.length - 1]; if (prev && /\s$/.test(prev.t)) t = t.replace(/^\s+/, '');
        if (t) cur.push({ t, ...f }); return;
      }
      if (n.nodeType !== 1) return;
      const tag = n.localName;
      if (tag === 'script' || tag === 'style') return;
      if (/^h[1-6]$/.test(tag) && !titleSet && !sawText) { title = n.textContent.replace(/\s+/g, ' ').trim(); titleSet = true; sawText = true; flush(); return; }
      if (tag === 'br') { flush(); return; }
      const blk = BLOCK.has(tag); if (blk) flush();
      const g = { ...f };
      if (tag === 'b' || tag === 'strong' || /^h[1-6]$/.test(tag)) g.b = true;
      if (/^(i|em|cite|dfn|var)$/.test(tag)) g.i = true;
      if (tag === 'u' || tag === 'ins') g.u = true;
      if (/^(s|del|strike)$/.test(tag)) g.s = true;
      n.childNodes.forEach((c) => walk(c, g));
      if (blk) flush();
    };
    d.body.childNodes.forEach((c) => walk(c, {})); flush();
  }
  if (!title && lines[0] && lines[0][0] && lines[0][0].b) {            // repli : texte en gras en tête = titre
    title = lines[0][0].t.trim(); lines[0].shift();
    if (lines[0].length) lines[0][0].t = lines[0][0].t.replace(/^\s+/, ''); else lines.shift();
  }
  nd._parsed = { title: title ? title.toUpperCase() : nd.id, lines }; nd._src = desc;
  return nd._parsed;
}
function renderSegs(parent, segs, q) {
  const full = segs.map((sg) => sg.t).join(''), lo = full.toLowerCase(), ql = q.toLowerCase(), ranges = [];
  if (q) { let i = 0, p; while ((p = lo.indexOf(ql, i)) >= 0) { ranges.push([p, p + ql.length]); i = p + ql.length; } }
  let pos = 0;
  for (const sg of segs) {
    const a0 = pos, b0 = pos + sg.t.length; pos = b0;
    const cuts = [a0, b0]; ranges.forEach(([ra, rb]) => { if (ra > a0 && ra < b0) cuts.push(ra); if (rb > a0 && rb < b0) cuts.push(rb); });
    cuts.sort((x, y) => x - y);
    for (let k = 0; k < cuts.length - 1; k++) {
      const a = cuts[k], b = cuts[k + 1]; if (a === b) continue;
      let n = document.createTextNode(sg.t.slice(a - a0, b - a0));
      const wrap = (tag, on) => { if (on) { const w = document.createElement(tag); w.append(n); n = w; } };
      wrap('b', sg.b); wrap('i', sg.i); wrap('u', sg.u); wrap('s', sg.s);
      wrap('mark', ranges.some(([ra, rb]) => a >= ra && b <= rb));
      parent.append(n);
    }
  }
}
function highlightInto(parent, text, q) {
  const lo = text.toLowerCase(), ql = q.toLowerCase(); let i = 0, p;
  while ((p = lo.indexOf(ql, i)) >= 0) {
    if (p > i) parent.append(text.slice(i, p));
    parent.append(el('mark', {}, text.slice(p, p + q.length))); i = p + q.length;
  }
  if (i < text.length) parent.append(text.slice(i));
}
function computeSearch() {
  searchHits = new Map();
  const q = normQ(), mode = searchMode();
  if (model && q) {
    const ql = q.toLowerCase();
    model.nodes.forEach((nd) => {
      const pd = parseDesc(nd);
      if (mode === 'desc') {
        if (pd.title.toLowerCase().includes(ql) || pd.lines.some((ln) => ln.map((sg) => sg.t).join('').toLowerCase().includes(ql))) searchHits.set(nd.id, { title: pd.title, lines: pd.lines });
      } else {
        const ls = labelsOf(nd).map((l) => labelText(l).txt).filter((t) => t && t.toLowerCase().includes(ql));
        if (ls.length) searchHits.set(nd.id, { title: pd.title, labels: ls });
      }
    });
  }
  applyRings(); renderResults(q, mode);
  $('search-btn').classList.toggle('on', !!q);
}
function applyRings() {
  if (!model) return;
  model.nodes.forEach((nd) => {
    if (!nd.g) return;
    nd.g.querySelectorAll('.ring').forEach((r) => r.remove());
    if (searchHits.has(nd.id)) make('ellipse', { class: 'ring', cx: nd.w / 2, cy: nd.h / 2, rx: nd.w / 2 + 5, ry: nd.h / 2 + 5 }, nd.g);
  });
}
function renderResults(q, mode) {
  const top = resultsEl.scrollTop; resultsEl.replaceChildren();
  if (!q) { scountEl.textContent = ''; return; }
  scountEl.textContent = searchHits.size ? tr('found', searchHits.size) : tr('noResult');
  let n = 0;
  for (const [id, h] of searchHits) {
    if (n++ >= 200) { resultsEl.append(el('div', { class: 'more' }, tr('limited'))); break; }
    const body = el('div', { class: 'snip' });
    const head = el('div', { class: 'rtitle' });
    if (mode === 'desc') { renderSegs(head, [{ t: h.title, b: true }], q); h.lines.forEach((ln) => { const d = el('div', { class: 'line' }); renderSegs(d, ln, q); body.append(d); }); }
    else { head.textContent = h.title; h.labels.forEach((t) => { const chip = el('span', { class: 'chip' }); highlightInto(chip, t, q); body.append(chip); }); }
    const item = el('div', { class: 'result', tabindex: '0', onclick: () => focusNode(id), onkeydown: (e) => { if (e.key === 'Enter') focusNode(id); } }, head, body);
    resultsEl.append(item);
  }
  resultsEl.scrollTop = top;
}
function focusNode(id) {
  const nd = model && model.nodes.get(id); if (!nd) return;
  const left = searchBox.classList.contains('show') ? searchBox.getBoundingClientRect().right + 12 : 0;
  const right = editMode ? PANEL_W : 0, W = innerWidth - left - right, H = innerHeight;
  const k = Math.max(view.k, 1.6);
  view = { k, x: left + W / 2 - (nd.x + nd.w / 2) * k, y: H / 2 - (nd.y + nd.h / 2) * k }; apply();
  const ring = nd.g && nd.g.querySelector('.ring');
  if (ring) { ring.classList.remove('pulse'); void ring.getBoundingClientRect(); ring.classList.add('pulse'); }
}
function openSearch(on) {
  searchBox.classList.toggle('show', on);
  if (on) { searchBox.style.top = ($('bar').getBoundingClientRect().bottom + 8) + 'px'; qInput.focus(); qInput.select(); }
}
function clearSearch() { qInput.value = ''; computeSearch(); openSearch(false); }
$('search-btn').onclick = () => openSearch(!searchBox.classList.contains('show'));
$('qclear').onclick = clearSearch;
qInput.addEventListener('input', computeSearch);
qInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); clearSearch(); } });
document.querySelectorAll('input[name="smode"]').forEach((r) => r.addEventListener('change', computeSearch));
addEventListener('resize', () => { if (searchBox.classList.contains('show')) searchBox.style.top = ($('bar').getBoundingClientRect().bottom + 8) + 'px'; });

// ----- clavier -----
addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA)$/.test((e.target || {}).tagName);
  if (!editMode) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && k === 'z' && !typing) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
  else if (mod && k === 'y' && !typing) { e.preventDefault(); redo(); }
  else if (mod && k === 'c' && !typing && selNodes.size) { e.preventDefault(); copySel(); }
  else if (mod && k === 'x' && !typing && selNodes.size) { e.preventDefault(); cutSel(); }
  else if (mod && k === 'v' && !typing && clip) { e.preventDefault(); pasteClip(); }
  else if (e.key === 'Escape') { if (tool === 'link') { cancelLink(); refreshPanel(); } else { selNodes = new Set(); selEdges = new Set(); render(); refreshPanel(); } }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing) {
    if (selNodes.size || selEdges.size) { e.preventDefault(); deleteSelection(); }
  }
});

// ======================================================================
//  Chargement de fichiers
// ======================================================================
const readFile = (f) => { if (dirty && !confirm(tr('confirmLoss'))) return; f.text().then((t) => load(t, f.name)); };
$('file').addEventListener('change', (e) => { if (e.target.files[0]) readFile(e.target.files[0]); e.target.value = ''; });
const dropEl = $('drop');
addEventListener('dragover', (e) => { e.preventDefault(); dropEl.classList.add('show'); });
addEventListener('dragleave', (e) => { if (!e.relatedTarget) dropEl.classList.remove('show'); });
addEventListener('drop', (e) => { e.preventDefault(); dropEl.classList.remove('show'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });

if (!EDIT_ALLOWED) $('edit').style.display = 'none';
const params = new URLSearchParams(location.search);
const src = params.get('file') || 'graph.graphml';
fetch(src).then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); }).then((t) => { load(t, src); if (params.get('edit') === '1') setEdit(true); })
  .catch(() => { setMsg('openHint'); });
applyI18n();
updateBar();
})();
