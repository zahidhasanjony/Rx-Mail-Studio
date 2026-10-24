import fs from "node:fs";
import crypto from "node:crypto";
const assets = fs
  .readdirSync("dist/assets")
  .filter((f) => /\.(js|css)$/.test(f))
  .map((f) => "/assets/" + f);
const version =
  "rx-shell-" +
  crypto
    .createHash("sha256")
    .update(assets.join(","))
    .update(fs.readFileSync("dist/Outlook-Emails-Template-v1.xlsm"))
    .digest("hex")
    .slice(0, 12);
const shell = [
  "/",
  "/index.html",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/manifest.webmanifest",
  "/Start-Outlook-Bridge.ps1",
  "/Outlook-Emails-Template-v1.xlsm",
  ...assets,
];
fs.writeFileSync(
  "dist/sw.js",
  `const VERSION=${JSON.stringify(version)},SHELL=${JSON.stringify(shell)};
self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(SHELL)));self.skipWaiting()});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('rx-shell-')&&k!==VERSION).slice(0,-1).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin)return;
if(e.request.mode==='navigate'){e.respondWith((async()=>{
  const cached=await caches.match('/index.html');
  const network=fetch(e.request).catch(error=>{if(cached)return cached;throw error});
  if(!cached)return network;
  let timer;try{return await Promise.race([network,new Promise(resolve=>{timer=setTimeout(()=>resolve(cached),3000)})])}finally{clearTimeout(timer)}
})());return;}
if(SHELL.includes(u.pathname)){e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));}});`,
);
