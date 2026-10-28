import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
let input='';for await (const chunk of process.stdin)input+=chunk;
const op=JSON.parse(input);
function safe(name){if(typeof name!=='string'||name.includes('\0')||name.split('/').some(p=>p==='.git'||p==='..')||path.isAbsolute(name))throw Error('Unsafe path');const full=path.resolve('/work',name);if(!full.startsWith('/work/'))throw Error('Unsafe path');return full;}
if(op.type==='write'){for(const [name,content]of Object.entries(op.files)){const dest=safe(name);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,content,{flag:'w'});}console.log('Files written');}
else if(op.type==='read'){console.log((await fs.readFile(safe(op.path),'utf8')).slice(0,60000));}
else if(op.type==='list'){async function walk(dir){const all=[];for(const item of await fs.readdir(dir,{withFileTypes:true})){if(['.git','node_modules'].includes(item.name))continue;const full=path.join(dir,item.name);if(item.isDirectory())all.push(...await walk(full));else if(item.isFile())all.push(path.relative('/work',full));if(all.length>2000)break;}return all;}console.log(JSON.stringify(await walk('/work')));}
else if(op.type==='test'){const result=await new Promise(resolve=>execFile('/bin/sh',['-c',op.command],{cwd:'/work',timeout:60000,maxBuffer:128000,env:{PATH:process.env.PATH,HOME:'/tmp',CI:'true'}},(error,stdout,stderr)=>resolve({exitCode:error?error.code??1:0,stdout,stderr})));console.log(JSON.stringify(result));}
else throw Error('Unknown operation');
