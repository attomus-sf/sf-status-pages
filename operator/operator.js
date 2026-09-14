'use strict';
const $ = id => document.getElementById(id);
const storeKey = 'attomus-staging-operator-v1';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
let catalog, incidents, pending, timer, previewRequest, checking = false;
function save(value) { try { localStorage.setItem(storeKey, JSON.stringify(value)); } catch { $('notice').textContent = 'Browser storage is unavailable. Keep this page open to retain your draft.'; } }
function stored() { try { return JSON.parse(localStorage.getItem(storeKey)) || {}; } catch { return {}; } }
function draft() { return {operation:$('operation').value, incident:$('incident').value, title:$('title').value, text:$('text').value, severity:$('severity').value, state:$('state').value, components:[...document.querySelectorAll('#services input:checked')].map(e=>e.value)}; }
function persist() { save({draft:draft(), pending}); }
async function bytes(path) { const url = new URL(path, location.href); url.searchParams.set('check', crypto.randomUUID()); const response = await fetch(url, {cache:'no-store',signal:AbortSignal.timeout(15000)}); if (!response.ok) throw new Error('Not available yet'); return new Uint8Array(await response.arrayBuffer()); }
async function json(path) { return JSON.parse(new TextDecoder().decode(await bytes(path))); }
async function digest(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))].map(b=>b.toString(16).padStart(2,'0')).join(''); }
function chosen() { return incidents.find(i=>i.id===$('incident').value); }
function layout() {
  const op = $('operation').value;
  $('create').hidden = op !== 'create'; $('existing').hidden = op === 'create'; $('progress').hidden = op !== 'update';
  const item = chosen(); $('latest').textContent = item ? 'Latest update: '+item.updates.at(-1).text : incidents.some(i=>i.state!=='resolved') ? 'Choose an incident to read its latest update.' : 'No active incidents. Choose “Report a new incident” to begin.';
}
async function load() {
  [catalog, incidents] = await Promise.all([json('../api/components.json').then(x=>x.components),json('../api/incidents.json').then(x=>x.incidents)]);
  $('services').replaceChildren(); $('incident').replaceChildren();
  for (const c of catalog) { const label=document.createElement('label'),input=document.createElement('input'); input.type='checkbox';input.value=c.id;label.append(input,document.createTextNode(c.name));$('services').append(label); }
  const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Choose an active incident';$('incident').append(placeholder);
  for (const i of incidents.filter(i=>i.state!=='resolved')) { const option=document.createElement('option');option.value=i.id;option.textContent=i.title;$('incident').append(option); }
  const saved = stored().draft;
  if (saved) { for (const key of ['operation','incident','title','text','severity','state']) if (typeof saved[key]==='string') $(key).value=saved[key]; for(const input of document.querySelectorAll('#services input')) input.checked=(saved.components||[]).includes(input.value); }
  layout(); $('notice').textContent = saved ? 'Draft restored. Review it before publishing.' : 'Ready. Only fictional updates are published in staging.';
}
function request() {
  const d=draft(),r={request_id:crypto.randomUUID(),operation:d.operation,text:d.text.trim()};
  if (!r.text) throw {field:'text',message:'Enter the public message before continuing.'};
  if (r.operation==='create') {
    if (!d.title.trim()) throw {field:'title',message:'Enter a public headline.'};
    if (!d.components.length) throw {field:'services',message:'Choose at least one affected service.'};
    Object.assign(r,{title:d.title.trim(),components:d.components,severity:d.severity});
  } else {
    const item=chosen(); if (!item || item.state==='resolved') throw {field:'incident',message:'Choose an active incident, or report a new one.'};
    Object.assign(r,{incident_id:item.id,expected_latest:item.updates.at(-1).at});
    if(r.operation==='update') r.state=d.state;
  }
  return r;
}
function githubURL(r) {
  const encoded=btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(r)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  const back=new URL('./',location.href);back.searchParams.set('request',r.request_id);
  // Code fences keep all user-entered Markdown, links and mentions literal in GitHub's preview.
  const fence='`'.repeat(Math.max(3,...[...r.text.matchAll(/`+/g),...(r.title||'').matchAll(/`+/g)].map(m=>m[0].length+1)));
  const body=`Fictional staging status publication. Click Create to submit this exact request.\n\n${fence}\n${$('preview-title').textContent}\n${$('preview-context').textContent}\n\n${r.text}\n${fence}\n\n[Check publication](${back.href})\n\n<!-- STATUS_REQUEST_V1:${encoded} -->`;
  const url=new URL('https://github.com/attomus-sf/sf-status/issues/new');url.searchParams.set('title','Status publication '+r.request_id);url.searchParams.set('body',body);
  if(url.href.length>7800) throw {field:'text',message:'This message is too long for the GitHub handoff. Please shorten it.'};
  const login = new URL('https://github.com/login');
  login.searchParams.set('return_to', url.pathname + url.search);
  if(login.href.length>12000) throw {field:'text',message:'Please shorten this message for the GitHub handoff.'};
  return login.href;
}
$('editor').addEventListener('input',()=>{layout();persist();});
$('editor').addEventListener('submit',async event=>{
  event.preventDefault();$('error').textContent='';
  try {
    const r=request();
    $('preview-title').textContent=r.title||chosen().title;
    $('preview-context').textContent=r.operation==='create' ? r.components.map(id=>catalog.find(c=>c.id===id).name).join(', ')+' · '+$('severity').selectedOptions[0].textContent : r.operation==='resolve' ? 'Resolved' : $('state').selectedOptions[0].textContent;
    $('preview-text').textContent=r.text;
    const url=githubURL(r);previewRequest={request_id:r.request_id,digest:await digest(new TextEncoder().encode(JSON.stringify(r))),url};
    $('publish').href=url;$('editor').hidden=true;$('preview').hidden=false;$('preview').scrollIntoView({block:'start'});persist();
  } catch(error) { $('error').textContent=error.message||'Could not prepare this request. Your draft is retained.'; const field=$(error.field);if(field) (field.querySelector('input')||field).focus(); }
});
$('edit').addEventListener('click',()=>{$('preview').hidden=true;$('editor').hidden=false;$('text').focus();});
$('publish').addEventListener('click',()=>{pending=previewRequest;persist();});
function track() {
  $('editor').hidden=true;$('preview').hidden=true;$('tracking').hidden=false;
  $('tracking-title').textContent='Awaiting publication';
  $('tracking-message').textContent='After clicking Create in GitHub, this page checks for your exact update on the public website. Publication usually takes a few minutes. Your draft is retained.';
  $('retry').hidden=!pending.url;if(pending.url) $('retry').href=pending.url;
  $('live-link').hidden=true;
  clearInterval(timer);timer=setInterval(check,15000);check();
}
async function check() {
  if(checking||!pending) return;checking=true;
  try {
    const manifest=await json('../integrity.json');
    const receiptBytes=await bytes('../api/operator-receipts.json');
    if(await digest(receiptBytes)!==manifest.files['api/operator-receipts.json']) throw new Error('Publication is still propagating');
    const receipt=JSON.parse(new TextDecoder().decode(receiptBytes))[pending.request_id];
    if(!receipt) throw new Error('Awaiting GitHub confirmation or publication');
    if(pending.digest && receipt.digest!==pending.digest) throw new Error('Request does not match this draft. Publication has not been verified');
    if(receipt.outcome==='rejected') {
      $('tracking-title').textContent='Not published';$('tracking-message').textContent=receipt.message;$('retry').hidden=true;clearInterval(timer);return;
    }
    if(receipt.outcome!=='accepted'||!/^STAGING-[A-Za-z0-9-]+$/.test(receipt.incident_id)) throw new Error('Unrecognised publication receipt');
    const apiPath='api/incidents/'+receipt.incident_id+'.json',htmlPath='incidents/'+receipt.incident_id+'/index.html';
    const [api,html]=await Promise.all([bytes('../'+apiPath),bytes('../'+htmlPath)]);
    if(await digest(api)!==manifest.files[apiPath]||await digest(html)!==manifest.files[htmlPath]) throw new Error('Publication is still propagating');
    const incident=JSON.parse(new TextDecoder().decode(api));
    if(!incident.updates.some(u=>u.at===receipt.at&&u.state===receipt.state)) throw new Error('Update not yet present on the public page');
    $('tracking-title').textContent='Live';$('tracking-message').textContent='Verified on the public website. Update recorded '+new Date(receipt.at).toLocaleString()+'.';
    $('live-link').href='../incidents/'+receipt.incident_id+'/';$('live-link').hidden=false;$('retry').hidden=true;clearInterval(timer);
  } catch(error) { $('tracking-title').textContent='Publication not yet verified'; $('tracking-message').textContent=error.message+'. Your draft is retained. If you already clicked Create in GitHub, wait here or check again. Opening the same request again is safe.'; }
  finally {checking=false;}
}
$('check').addEventListener('click',check);
$('fresh').addEventListener('click',async()=>{clearInterval(timer);pending=null;history.replaceState(null,'',location.pathname);persist();$('tracking').hidden=true;try{await load();$('editor').hidden=false;}catch{$('notice').textContent='Could not refresh current incidents. Reload to try again; your draft is retained.';}});
(async()=>{
  const saved=stored();pending=saved.pending;
  const id=new URL(location.href).searchParams.get('request');
  if(id&&uuidPattern.test(id)&&id!==pending?.request_id) pending={request_id:id};
  try {await load();if(pending&&uuidPattern.test(pending.request_id)) track();else $('editor').hidden=false;}
  catch {$('notice').textContent='Could not load current services. Reload to try again; your draft is retained.';if(pending) track();}
})();
