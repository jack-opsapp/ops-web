const http=require('http');const fs=require('fs');const path=require('path');
const allowed=new Map([['/', ['docs/artifacts/phase15/preview.html','text/html']],['/proof.css',['docs/artifacts/phase15/proof.css','text/css']]]);
for(const name of ['Mohave-Regular.ttf','JetBrainsMono-Regular.ttf','CakeMono-Light.woff2']) allowed.set('/fonts/'+name,['public/fonts/'+name,name.endsWith('.woff2')?'font/woff2':'font/ttf']);
http.createServer((req,res)=>{const file=allowed.get(req.url);if(!file){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':file[1]});res.end(fs.readFileSync(file[0]));}).listen(3415,'127.0.0.1',()=>console.log('Financial preview http://127.0.0.1:3415'));
