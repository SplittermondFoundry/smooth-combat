import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const types = { ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
    ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".jpg": "image/jpeg" };
const server = http.createServer(async (request, response) => {
    try {
        const url = new URL(request.url, "http://localhost");
        const local = decodeURIComponent(url.pathname === "/" ? "/demo/character-focus.html" : url.pathname).replace(/^\/modules\//, "/Modul/");
        const file = path.resolve(root, "." + local);
        if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
        response.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream");
        response.end(await fs.readFile(file));
    } catch { response.writeHead(404).end(); }
});
const port = Number(process.env.PORT || 4267);
server.listen(port, "127.0.0.1", () => console.log(`Charakterwahl: http://127.0.0.1:${port}/demo/character-focus.html?gm=1`));
