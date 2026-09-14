// Local stand-in for the Supabase HTTP surface used by ops-web's service-role
// client: forwards /rest/v1/* to PostgREST and stores /storage/v1 objects on
// disk. Adapted from the Instagram rehearsal shim with HEAD support, because
// the journal worker verifies a hero plate is publicly readable before it
// promises a preview. Throwaway rehearsal tooling only; never used in production.
import http from "node:http";
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";

const [, , portArg, restPortArg, storageDir] = process.argv;
const port = Number(portArg);
const restPort = Number(restPortArg);
if (!port || !restPort || !storageDir) throw new Error("usage: shim.mjs <port> <postgrestPort> <storageDir>");
mkdirSync(storageDir, { recursive: true });

const TYPES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

function safePath(bucket, key) {
  const target = normalize(join(storageDir, bucket, key));
  if (!target.startsWith(join(storageDir, bucket))) throw new Error("path escape");
  return target;
}

function store(req, res, target, bucket, key) {
  mkdirSync(dirname(target), { recursive: true });
  const type = req.headers["content-type"] ?? "";
  const done = () => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ Key: `${bucket}/${key}`, Id: key }));
  };
  if (type.startsWith("multipart/form-data")) {
    // supabase-js uploads Buffers as multipart; extract the file part bytes.
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const boundary = "--" + type.split("boundary=")[1];
      const headerEnd = body.indexOf("\r\n\r\n", body.indexOf(boundary + "\r\n"));
      const file = body.subarray(headerEnd + 4, body.lastIndexOf("\r\n" + boundary));
      createWriteStream(target).end(file, done);
    });
    return;
  }
  const out = createWriteStream(target);
  req.pipe(out);
  out.on("finish", done);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (url.pathname.startsWith("/rest/v1/")) {
    const proxied = http.request(
      {
        host: "127.0.0.1",
        port: restPort,
        method: req.method,
        path: url.pathname.slice("/rest/v1".length) + url.search,
        headers: { ...req.headers, host: `127.0.0.1:${restPort}` },
      },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(res);
      }
    );
    proxied.on("error", (error) => {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: `postgrest unreachable: ${error.message}` }));
    });
    req.pipe(proxied);
    return;
  }
  const upload = url.pathname.match(/^\/storage\/v1\/object\/([a-z0-9-]+)\/(.+)$/);
  if (upload && !url.pathname.includes("/object/public/") && (req.method === "POST" || req.method === "PUT")) {
    const key = decodeURIComponent(upload[2]);
    store(req, res, safePath(upload[1], key), upload[1], key);
    return;
  }
  const download = url.pathname.match(/^\/storage\/v1\/object\/public\/([a-z0-9-]+)\/(.+)$/);
  if (download && (req.method === "GET" || req.method === "HEAD")) {
    const target = safePath(download[1], decodeURIComponent(download[2]));
    if (!existsSync(target)) {
      res.writeHead(404);
      res.end(req.method === "HEAD" ? undefined : "not found");
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[extname(target).toLowerCase()] ?? "application/octet-stream",
      "content-length": statSync(target).size,
      "cache-control": "no-store",
    });
    if (req.method === "HEAD") res.end();
    else createReadStream(target).pipe(res);
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ message: `shim has no route for ${req.method} ${url.pathname}` }));
});
server.listen(port, "127.0.0.1", () =>
  console.log(`shim listening on ${port} -> postgrest ${restPort}, storage ${storageDir}`)
);
