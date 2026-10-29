# GraphML Viewer (read-only)

Static viewer for `.graphml` files (yEd Live / yFiles format). No dependencies, no build required.

- `graph.graphml` is loaded automatically; `?file=other.graphml` loads another file from the same directory.
- "Open" button or drag and drop to load another local `.graphml` file.
- Scroll wheel / pinch: zoom; drag: pan. A node's tooltip remains visible as long as the pointer is over it.

## Publish on GitHub Pages
1. Place these files at the root of a repository (index.html, viewer.js, graph.graphml, .nojekyll).
2. Settings → Pages → Source: "Deploy from a branch", branch `main`, folder `/ (root)`.
3. The site is available at https://<username>.github.io/<repository>/

## Edit mode
"Edit mode" button (or `?edit=1`).
- **Right-click on the background**: create a node (or paste one) at that location.
- **Drag** a node to move it; **Ctrl+click**: multi-select nodes *and edges*; **middle-click and drag**: pan the view like a hand tool.
- **Edges**: "Connect" tool, then drag from one node to another (or click the source, then the destination). An edge can be selected like a node (click / Ctrl+click) and deleted with **Delete**.
- **Ctrl+C / Ctrl+X / Ctrl+V**: copy / cut / paste nodes (including shared edges). **Delete**: delete the selection.
- Right-hand panel: image, **appearance (shape, color, outline, size)**, description (text or HTML), labels. Appearance settings apply to the entire selection.
- **Previous / Next** arrows (Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y).
- "Export .graphml" downloads the modified file (recalculated label positions are written to it).
Changes remain in the browser: to publish them, replace `graph.graphml` in the repository with the exported file.
`EDIT_ALLOWED = false` at the top of the "Model, rendering" section in `viewer.js` disables editing on the public site.

## Search
"Search" button: searches for a word or a group of words (case-insensitive) in **descriptions** or **labels**.
The title (first `h1`–`h6` with no preceding text, otherwise leading bold text) is displayed only once; text block tags (p, div, h1…, li, br) separate lines, while inline tags (b, i, u, s…) preserve their formatting.
Matching nodes are outlined in orange; clicking a result centers the view on it. The cross in the field clears the search.

Labels are always recalculated: centered below the node, attached to its bounding box (subsequent labels are stacked underneath).

## Language / Language
EN / FR toggle at the bottom left (choice remembered in the browser; default = browser language; `?lang=fr` or `?lang=en` forces it). All interface text is translated; graph data (descriptions, labels) remains unchanged.
Description titles (first `h1`–`h6`, otherwise leading bold text; plain text has no title, so the node ID is used instead) are displayed in UPPERCASE in search results only (display only, the file is not modified; tooltips show the text as written).

## Magnet / Snap

In edit mode, the magnet button (U icon) enables snapping while dragging nodes (the reference point is the node centre):

- **Origin point**: snaps to another node's origin (ring indicator). Highest priority.
- **Alignment**: snaps to a line (any direction) passing through at least two other nodes (pink line).
- **Radial equidistance**: snaps to points equidistant from two or more nodes (dotted circle passing through them).
- **Combinations**: alignment and equidistance can apply together (their intersection); this combination takes priority over a single snap, followed by alignment × alignment.
- **Range**: only nodes within 260 px (screen distance) of the dragged node are considered; the closest ones take priority.
- **Anti-jitter**: snapping engages at 8 px and releases at 15 px; the current snap is maintained as long as it remains valid.