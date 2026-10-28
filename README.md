GraphML Viewer (Read-Only)

A static viewer for .graphml files (yEd Live / yFiles format). No dependencies, no build step required.

adding "?file=<filename>.graphml" loads a file from the same directory.
Use the Open button or drag and drop a file to load another local .graphml file.
Mouse wheel / pinch: zoom; drag: pan. A node's tooltip remains visible as long as the pointer is hovering over it.

Click the Edit Mode button (or use ?edit=1).

Right-click the background: create a node (or paste one) at that location.
Drag a node to move it; Ctrl+click: select multiple nodes and edges; middle-click and drag: pan the view as if using a hand tool.
Edges: select the Connect tool, then drag from one node to another (or click the source node, then the target node). An edge can be selected just like a node (click / Ctrl+click) and deleted using Delete.
Ctrl+C / Ctrl+X / Ctrl+V: copy / cut / paste nodes (including shared edges). Delete: delete the selection.
Right-hand panel: image, appearance (shape, color, outline, size), description (text or HTML), and labels. Appearance settings apply to the entire selection.
Undo / Redo arrows (Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y).
Export .graphml downloads the modified file (recalculated label positions are saved in the exported file).

Changes remain in the browser. To publish them, replace graph.graphml in the repository with the exported file.

Setting EDIT_ALLOWED = false at the top of the Model, Rendering section in viewer.js disables editing on the public site.

Search

The Search button searches for a word or phrase (case-insensitive) in descriptions or labels.

The title (the first h1–h6 heading with no preceding text, or otherwise the leading bold text) is displayed only once. Text-level elements (p, div, h1…, li, br) separate lines, while inline elements (b, i, u, s…) preserve their formatting.

Matching nodes are outlined in orange. Clicking a result centers the view on that node. The × button in the search field clears the search.

Labels are always recalculated: they are centered below the node and aligned with its bounding box (additional labels are stacked underneath).