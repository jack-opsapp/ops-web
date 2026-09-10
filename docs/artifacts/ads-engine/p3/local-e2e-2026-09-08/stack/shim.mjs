// Local stand-in for the Supabase HTTP surface used by ops-web's service-role
// client: forwards /rest/v1/* to PostgREST and stores /storage/v1 objects on
// disk. Throwaway rehearsal tooling only; never used in production.
import http from "node:http";
import { createWriteStream, existsSync, mkdirSync, statSync, createReadStream } from "node:fs";
import { dirname, join, normalize } from "node:path";

const [, , portArg, restPortArg, storageDir] = process.argv;
const port = Number(portArg);
const restPort = Number(restPortArg);
if (!port || !restPort || !storageDir) throw new Error("usage: shim.mjs <port> <postgrestPort> <storageDir>");
mkdirSync(storageDir, { recursive: true });

function safePath(bucket, key) {
  const target = normalize(join(storageDir, bucket, key));
  if (!target.startsWith(join(storageDir, bucket))) throw new Error("path escape");
  return target;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (url.pathname.startsWith("/rest/v1/")) {
    const proxied = http.request(
      { host: "127.0.0.1", port: restPort, method: req.method, path: url.pathname.slice("/rest/v1".length) + url.search, headers: { ...req.headers, host: `127.0.0.1:${restPort}` } },
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
  if (upload && (req.method === "POST" || req.method === "PUT")) {
    const target = safePath(upload[1], decodeURIComponent(upload[2]));
    mkdirSync(dirname(target), { recursive: true });
    const type = req.headers["content-type"] ?? "";
    if (type.startsWith("multipart/form-data")) {
      // supabase-js uploads Buffers as multipart; extract the file part bytes.
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        const boundary = "--" + type.split("boundary=")[1];
        const headerEnd = body.indexOf("\r\n\r\n", body.indexOf(boundary + "\r\n"));
        const fileStart = headerEnd + 4;
        const fileEnd = body.lastIndexOf("\r\n" + boundary);
        const file = body.subarray(fileStart, fileEnd);
        createWriteStream(target).end(file, () => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ Key: `${upload[1]}/${upload[2]}`, Id: upload[2] }));
        });
      });
      return;
    }
    const out = createWriteStream(target);
    req.pipe(out);
    out.on("finish", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ Key: `${upload[1]}/${upload[2]}`, Id: upload[2] }));
    });
    return;
  }
  const download = url.pathname.match(/^\/storage\/v1\/object\/public\/([a-z0-9-]+)\/(.+)$/);
  if (download && req.method === "GET") {
    const target = safePath(download[1], decodeURIComponent(download[2]));
    if (!existsSync(target)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": "image/jpeg", "content-length": statSync(target).size, "cache-control": "no-store" });
    createReadStream(target).pipe(res);
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ message: `shim has no route for ${req.method} ${url.pathname}` }));
});
server.listen(port, "127.0.0.1", () => console.log(`shim listening on ${port} -> postgrest ${restPort}, storage ${storageDir}`));
