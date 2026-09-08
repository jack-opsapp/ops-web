import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
const project=process.cwd(),root=path.resolve(project,'docs/artifacts/phase16/browser'),fixture=path.join(root,'fixture.ts');
const server=await createServer({root,configFile:false,plugins:[react()],resolve:{alias:[{find:'@/lib/utils/authed-fetch',replacement:fixture},{find:'@/i18n/client',replacement:fixture},{find:'@',replacement:path.join(project,'src')}]},css:{postcss:project},server:{host:'127.0.0.1',port:4176,strictPort:true,fs:{allow:[project,path.resolve(project,'node_modules'),'/Users/jacksonsweet/Projects/OPS/ops-design-system/project']}}});
await server.listen();console.log('Fictional owner UI: http://127.0.0.1:4176');
