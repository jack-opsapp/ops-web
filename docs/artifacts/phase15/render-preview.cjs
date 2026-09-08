const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const root = process.cwd();
(async () => {
await esbuild.build({
  stdin: { contents: `import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; import { FinancialDocumentPreview } from './src/components/agent/financial-document-preview'; import { resultFixture } from './src/lib/agent-control-plane/services/financial-document/__tests__/financial-fixtures'; import {writeFileSync} from 'fs'; const p=resultFixture().proposal; writeFileSync('docs/artifacts/phase15/preview-body.html',renderToStaticMarkup(React.createElement(FinancialDocumentPreview,{proposal:p})));`, resolveDir: root, loader: 'tsx' },
  outfile:'docs/artifacts/phase15/render-bundle.cjs',bundle:true,platform:'node',format:'cjs',jsx:'automatic',
  plugins:[{name:'proof-hooks',setup(b){
    b.onResolve({filter:/^@\/i18n\/client$/},()=>({path:'hooks',namespace:'proof'}));
    b.onLoad({filter:/.*/,namespace:'proof'},()=>({contents:`export const useLocale=()=>({locale:'en'}); const dict=${fs.readFileSync('src/i18n/dictionaries/en/agent-queue.json','utf8')}; export const useDictionary=()=>({t:k=>dict[k]??k});`,loader:'js'}));
    b.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'empty'}));
    b.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:'',loader:'js'}));
  }}]
});
require(path.resolve('docs/artifacts/phase15/render-bundle.cjs'));
const body=fs.readFileSync('docs/artifacts/phase15/preview-body.html','utf8');
fs.writeFileSync('docs/artifacts/phase15/preview.html',`<!doctype html><html lang="en" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/proof.css"><style>@font-face{font-family:Mohave;src:url('/fonts/Mohave-Regular.ttf')}@font-face{font-family:'JetBrains Mono';src:url('/fonts/JetBrainsMono-Regular.ttf')}@font-face{font-family:'cake-mono';src:url('/fonts/CakeMono-Light.woff2');font-weight:300}</style></head><body class="bg-background text-text"><main class="max-w-3xl mx-auto p-3">${body}</main></body></html>`);
})();
