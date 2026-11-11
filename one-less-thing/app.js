// One Less Thing! — page logic. Talks to the data layer only through the
// backend object `B` (see backend-sheets.js), so who can read what is
// enforced by apps-script.gs on Google's servers, not by this file.

const TIME = {lt15:{l:"Under 15 min",h:.15},"15to60":{l:"15–60 min",h:.6},"1to3":{l:"1–3 hours",h:2},"3plus":{l:"3+ hours",h:4}};
const S = {user:null,admin:false,mine:[],list:[],responses:[],dismissed:[],
  listLoaded:false,respLoaded:false,offline:false,
  ui:{open:{},adding:null,knocking:null,editing:null,confirmDel:null},justDone:null};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const rid = () => Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4);
const ago = t => { if(!t) return ""; const d=(Date.now()-t)/864e5; return d<1?"today":d<2?"yesterday":d<30?Math.floor(d)+" days ago":new Date(t).toLocaleDateString(); };
const plural = (n,w) => n+" "+w+(n===1?"":"s");
let B = null;

/* ---------- derived ---------- */
function allResponses(){ const out=[]; for(const r of S.responses) for(const it of (r.items||[])) out.push(it); return out; }
function claimed(){ const m=new Map(); for(const l of S.list) for(const s of (l.sources||[])) m.set(s,l); return m; }
function inbox(){ const c=claimed(), d=new Set(S.dismissed); return allResponses().filter(r=>!c.has(r.id)&&!d.has(r.id)).sort((a,b)=>b.at-a.at); }
function sortedList(){
  const rank={working:0,open:1,done:2};
  return S.list.slice().sort((a,b)=> rank[a.status]-rank[b.status] ||
    (a.status==="done" ? (b.doneAt||0)-(a.doneAt||0) : (b.sources||[]).length-(a.sources||[]).length || a.createdAt-b.createdAt));
}
function hoursFor(l){
  const byId=new Map(allResponses().map(r=>[r.id,r]));
  let h=0,n=0; for(const s of l.sources||[]){const r=byId.get(s); if(r&&TIME[r.time]){h+=TIME[r.time].h;n++;}}
  return n?h:null;
}

/* ---------- tabs ---------- */
function currentTab(){ const h=location.hash.slice(1); return (h==="review"&&!S.admin)?"ask":(["ask","list","review"].includes(h)?h:"ask"); }
function showTab(){
  const t=currentTab();
  for(const a of document.querySelectorAll("#tabs a")) a.dataset.tab===t?a.setAttribute("aria-current","page"):a.removeAttribute("aria-current");
  $("#p-ask").hidden=t!=="ask"; $("#p-list").hidden=t!=="list"; $("#p-review").hidden=t!=="review";
}
addEventListener("hashchange",showTab);

/* ---------- render ---------- */
function busyIn(el){ const a=document.activeElement; return a&&el.contains(a)&&(a.tagName==="INPUT"||a.tagName==="TEXTAREA"||a.tagName==="SELECT"); }
let pending=false;
function render(){
  renderTally(); renderMine(); renderFoot();
  for(const [id,fn] of [["#p-list",renderList],["#p-review",renderReview]]){
    const el=$(id); if(busyIn(el)){pending=true;continue;} el.innerHTML=fn();
  }
  const rv=$('#tabs a[data-tab="review"]'); rv.hidden=!S.admin;
  if(S.admin){ const n=inbox().length; rv.innerHTML="Master list"+(n?`<span class="count">${n}</span>`:""); }
  showTab();
}
document.addEventListener("focusout",()=>setTimeout(()=>{ if(pending){pending=false;render();} },150));

function renderFoot(){
  const lock=$("#lock"), st=$("#admin-status");
  lock.setAttribute("aria-pressed",S.admin?"true":"false");
  lock.setAttribute("aria-label",S.admin?"Open the Master list":"Admin sign-in");
  st.innerHTML=S.admin?`Signed in as admin · <button type="button" class="small link" id="signout">Sign out</button>`:"";
}

function renderTally(){
  const done=S.list.filter(l=>l.status==="done").length, working=S.list.filter(l=>l.status==="working").length;
  const open=S.list.length-done;
  $("#tally").innerHTML = S.listLoaded ? `
    <div class="gone"><b>${done}</b><span class="muted">knocked off</span></div>
    <div><b>${working}</b><span class="muted">in progress</span></div>
    <div><b>${open}</b><span class="muted">still on the list</span></div>` : `<span class="muted">${S.offline?"The list can't be reached right now.":"Loading the list…"}</span>`;
}

function statusFor(id){
  const l=claimed().get(id);
  if(!l) return `<span class="pill open">Received</span>`;
  if(l.status==="done") return `<span class="pill done">Knocked off</span>`;
  if(l.status==="working") return `<span class="pill working">Working on it</span>`;
  return `<span class="pill open">On the list</span>`;
}
function renderMine(){
  $("#mine-card").hidden=!S.mine.length;
  $("#mine").innerHTML=S.mine.slice().reverse().map(m=>`<li><div class="x">${esc(m.text)}<div class="muted" style="font-size:.85rem">${ago(m.at)}</div></div>${statusFor(m.id)}</li>`).join("");
}

function itemHTML(l,{admin,top}){
  const n=(l.sources||[]).length, mineIds=new Set(S.mine.map(m=>m.id));
  const you=(l.sources||[]).some(s=>mineIds.has(s));
  const pill=l.status==="done"?`<span class="pill done">Knocked off ${l.doneAt?ago(l.doneAt):""}</span>`:l.status==="working"?`<span class="pill working">Working on it</span>`:`<span class="pill open">On the list</span>`;
  const hrs=admin?hoursFor(l):null;
  let h=`<li class="item ${l.status}${top?" next":""}${S.justDone===l.id?" justdone":""}"><span class="tick" aria-hidden="true"></span>`;
  if(admin&&S.ui.editing===l.id){
    h+=`<div class="inline" style="grid-column:2;margin:0"><label for="ed-${l.id}" class="eyebrow">Item title</label><input type="text" id="ed-${l.id}" value="${esc(l.title)}" maxlength="200">
      <div class="row"><button class="small primary" data-act="saveTitle" data-id="${l.id}">Save</button><button class="small" data-act="cancel">Cancel</button></div></div>`;
  } else h+=`<div class="t">${top?'<div class="eyebrow" style="text-decoration:none">Up next</div>':""}${esc(l.title)}</div>`;
  h+=`<div class="meta">${pill}<span>${plural(n,"person")} raised this</span>${hrs?`<span>≈ ${hrs.toFixed(1).replace(/\.0$/,"")} hrs/week reported</span>`:""}${you?`<span class="pill you">You raised this</span>`:""}</div>`;
  if(l.status==="done"&&l.note) h+=`<div class="changed" style="grid-column:2"><b>What changed:</b> ${esc(l.note)}</div>`;
  if(admin){
    if(S.ui.knocking===l.id){
      h+=`<div class="inline"><label for="kn-${l.id}">What changed? <span class="opt">(optional, everyone sees this)</span></label>
        <input type="text" id="kn-${l.id}" maxlength="300" placeholder="e.g. Paper duty log retired; online form only from Dec 1">
        <div class="row"><button class="small knock" data-act="knockDo" data-id="${l.id}">Knock it off</button><button class="small" data-act="cancel">Cancel</button></div></div>`;
    } else if(S.ui.confirmDel===l.id){
      h+=`<div class="inline"><span>Delete this item? Its responses go back to the Master list.</span>
        <div class="row"><button class="small knock" data-act="delDo" data-id="${l.id}">Delete</button><button class="small" data-act="cancel">Keep it</button></div></div>`;
    } else {
      h+=`<div class="acts row">`;
      if(l.status==="open") h+=`<button class="small" data-act="status" data-s="working" data-id="${l.id}">Start working on it</button>`;
      if(l.status!=="done") h+=`<button class="small knock" data-act="knock" data-id="${l.id}">Knock it off</button>`;
      else h+=`<button class="small" data-act="status" data-s="open" data-id="${l.id}">Put back on the list</button>`;
      if(l.status==="working") h+=`<button class="small link" data-act="status" data-s="open" data-id="${l.id}">Pause</button>`;
      h+=`<button class="small link" data-act="edit" data-id="${l.id}">Rename</button><button class="small link" data-act="del" data-id="${l.id}">Delete</button>`;
      h+=`<button class="small link" data-act="toggle" data-id="${l.id}">${S.ui.open[l.id]?"Hide":"Show"} responses</button></div>`;
    }
    if(S.ui.open[l.id]){
      const byId=new Map(allResponses().map(r=>[r.id,r]));
      h+=`<ul class="quotes" style="grid-column:2">`+(l.sources||[]).map(s=>{const r=byId.get(s); if(!r) return "";
        return `<li>${esc(r.text)}${r.why?`<div class="why">${esc(r.why)}</div>`:""}<div class="muted" style="font-size:.8rem">${TIME[r.time]?TIME[r.time].l+" a week · ":""}${ago(r.at)} <button class="small link" data-act="unlink" data-id="${l.id}" data-r="${r.id}">Move back to Master list</button></div></li>`;}).join("")+`</ul>`;
    }
  }
  return h+`</li>`;
}

function renderList(){
  if(!S.listLoaded) return `<div class="empty">${S.offline?"<b>Can't reach the list</b>Check your connection; it will appear when it loads.":"Loading…"}</div>`;
  if(!S.list.length) return `<div class="empty"><b>Nothing on the list yet</b>As answers come in, they'll be grouped here and crossed off one at a time.</div>`;
  const L=sortedList(), active=L.filter(l=>l.status!=="done"), done=L.filter(l=>l.status==="done");
  let h="";
  if(active.length) h+=`<div class="group-h"><h2>Still to go</h2><span class="muted">${active.length}</span></div><ul class="items">`+active.map((l,i)=>itemHTML(l,{admin:S.admin,top:i===0})).join("")+`</ul>`;
  else h+=`<div class="note ok">Everything on the list has been knocked off.</div>`;
  if(done.length) h+=`<div class="group-h"><h2>Knocked off</h2><span class="muted">${done.length}</span></div><ul class="items">`+done.map(l=>itemHTML(l,{admin:S.admin})).join("")+`</ul>`;
  return h;
}

function renderReview(){
  if(!S.admin) return "";
  if(!S.respLoaded) return `<div class="empty">Loading responses…</div>`;
  const q=inbox(), open=sortedList().filter(l=>l.status!=="done");
  let h=`<div class="group-h"><h2>Master list</h2><span class="muted">${q.length} waiting</span></div>
    <p class="muted">Every submission lands here first. Only what you move to The list is visible to teachers. If two answers say the same thing, add the second to the first's list item and it moves up the list.</p>`;
  if(!allResponses().length) h+=`<div class="empty"><b>No responses yet</b>Share this page's link with teachers so they can submit. Nothing they send shows up on The list until you move it.</div>`;
  else if(!q.length) h+=`<div class="note ok">All caught up. Every submission is on The list or set aside.</div>`;
  for(const r of q){
    h+=`<div class="resp"><div class="txt">${esc(r.text)}</div>${r.why?`<div class="why">${esc(r.why)}</div>`:""}
      <div class="meta">${TIME[r.time]?`<span>${TIME[r.time].l} a week</span>`:""}<span>${ago(r.at)}</span></div>`;
    if(S.ui.adding===r.id){
      h+=`<div class="inline" style="margin:0"><label for="nt-${r.id}">List item title</label><input type="text" id="nt-${r.id}" maxlength="200" value="${esc(r.text.slice(0,200))}">
        <div class="row"><button class="small primary" data-act="addDo" data-r="${r.id}">Add to the list</button><button class="small" data-act="cancel">Cancel</button></div></div>`;
    } else {
      h+=`<div class="row"><button class="small primary" data-act="add" data-r="${r.id}">Move to the list</button>`;
      if(open.length) h+=`<select id="mg-${r.id}" aria-label="Same as an existing item" style="width:auto;max-width:100%;flex:1 1 200px"><option value="">Same as an item already on the list…</option>${open.map(l=>`<option value="${l.id}">${esc(l.title.slice(0,70))}</option>`).join("")}</select><button class="small" data-act="merge" data-r="${r.id}">Add to that item</button>`;
      h+=`<button class="small link" data-act="dismiss" data-r="${r.id}">Set aside</button></div>`;
    }
    h+=`</div>`;
  }
  const moved=allResponses().filter(r=>claimed().has(r.id)).sort((a,b)=>b.at-a.at);
  if(moved.length) h+=`<details><summary>Already on The list (${moved.length})</summary><div class="panel" style="margin-top:10px">`+moved.map(r=>`<div class="resp"><div class="txt">${esc(r.text)}</div><div class="meta">${statusFor(r.id)}<span>${ago(r.at)}</span></div></div>`).join("")+`</div></details>`;
  const set=allResponses().filter(r=>S.dismissed.includes(r.id));
  if(set.length) h+=`<details><summary>Set aside (${set.length})</summary><div class="panel" style="margin-top:10px">`+set.map(r=>`<div class="resp"><div class="txt">${esc(r.text)}</div><div class="row"><button class="small" data-act="restore" data-r="${r.id}">Move back to Master list</button></div></div>`).join("")+`</div></details>`;
  return h;
}

/* ---------- actions ---------- */
async function run(fn){ try{ await fn(); }catch(e){ console.error(e); flash(e&&e.code==="unauthorized"?"Your admin sign-in has ended. Click the lock to sign in again.":"That didn't save. Try again."); } }
function flash(m){
  const p=$("#p-"+currentTab()); const d=document.createElement("div");
  d.className="note"; d.setAttribute("role","alert"); d.textContent=m; p.prepend(d); setTimeout(()=>d.remove(),6000);
}

document.addEventListener("click",e=>{
  const b=e.target.closest("[data-act]"); if(!b||!B||!S.admin) return;
  const {act,id,r,s}=b.dataset, L=id&&S.list.find(x=>x.id===id);
  const reset=()=>{S.ui.adding=S.ui.knocking=S.ui.editing=S.ui.confirmDel=null;};
  const ui=(k,v)=>{reset();S.ui[k]=v;render();const f=document.querySelector(".inline input");if(f)f.focus();};
  switch(act){
    case "cancel": reset(); render(); break;
    case "add": { const src=allResponses().find(x=>x.id===r); if(!src) return; b.disabled=true;
      run(()=>B.addList({title:src.text.trim().slice(0,200),status:"open",sources:[r],note:"",createdAt:Date.now()})); break; }
    case "knock": ui("knocking",id); break;
    case "edit": ui("editing",id); break;
    case "del": ui("confirmDel",id); break;
    case "toggle": S.ui.open[id]=!S.ui.open[id]; render(); break;
    case "addDo": { const t=$("#nt-"+r).value.trim(); if(!t) return; b.disabled=true; reset();
      run(()=>B.addList({title:t,status:"open",sources:[r],note:"",createdAt:Date.now()})); break; }
    case "merge": { const lid=$("#mg-"+r).value; const tgt=S.list.find(x=>x.id===lid); if(!tgt) return; b.disabled=true;
      run(()=>B.updateList(lid,{sources:[...(tgt.sources||[]),r]})); break; }
    case "unlink": run(()=>B.updateList(id,{sources:(L.sources||[]).filter(x=>x!==r)})); break;
    case "dismiss": run(()=>B.setTriage([...S.dismissed,r])); break;
    case "restore": run(()=>B.setTriage(S.dismissed.filter(x=>x!==r))); break;
    case "status": run(()=>B.updateList(id,s==="open"?{status:"open",doneAt:null}:{status:s})); break;
    case "knockDo": { const note=$("#kn-"+id).value.trim(); reset(); S.justDone=id;
      run(()=>B.updateList(id,{status:"done",doneAt:Date.now(),note})); break; }
    case "saveTitle": { const t=$("#ed-"+id).value.trim(); if(!t) return; reset(); run(()=>B.updateList(id,{title:t})); break; }
    case "delDo": reset(); run(()=>B.deleteList(id)); break;
  }
});
document.addEventListener("keydown",e=>{
  if(e.key!=="Enter"||!e.target.matches(".inline input")) return;
  e.preventDefault(); const b=e.target.closest(".inline").querySelector("button[data-act]"); b&&b.click();
});

$("#form").addEventListener("submit",async e=>{
  e.preventDefault();
  const text=$("#f-text").value.trim(), st=$("#f-status");
  if(!text){ st.textContent="Write the one thing first."; $("#f-text").focus(); return; }
  if(!B||!S.user){ st.textContent="Still connecting. Try again in a moment."; return; }
  const btn=$("#f-submit"); btn.disabled=true; st.textContent="Sending…";
  const item={id:rid(),text,why:$("#f-why").value.trim(),time:(document.querySelector('input[name=time]:checked')||{}).value||"",at:Date.now()};
  try{
    await B.submit(S.user.uid,item);
    $("#form").reset(); st.textContent="Thanks. Got it. Have another? Add it the same way.";
  }catch(err){ console.error(err); st.textContent="That didn't send. Try again."; }
  finally{ btn.disabled=false; }
});

/* ---------- hidden admin sign-in ---------- */
const LOGIN_ERR={"wrong-passcode":"That passcode isn't right.","too-many-tries":"Too many wrong tries. Wait 10 minutes and try again.",
  "not-set-up":"No admin passcode is set in the Apps Script yet."};
$("#lock").addEventListener("click",()=>{
  if(S.admin){ location.hash="review"; return; }
  if(!B) return;
  $("#admin-msg").textContent=""; $("#admin-pass").value=""; $("#admin-dlg").showModal(); $("#admin-pass").focus();
});
$("#admin-cancel").addEventListener("click",()=>$("#admin-dlg").close());
$("#admin-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const pass=$("#admin-pass").value; if(!pass) return;
  const go=$("#admin-go"); go.disabled=true; $("#admin-msg").textContent="Checking…";
  try{ await B.signInAdmin(pass); $("#admin-dlg").close(); /* onAuth takes it from here */ }
  catch(err){ $("#admin-msg").textContent=LOGIN_ERR[err&&err.code]||"Sign-in didn't work. Try again."; $("#admin-pass").select(); }
  finally{ go.disabled=false; }
});
document.addEventListener("click",async e=>{
  if(e.target.id!=="signout") return;
  if(location.hash==="#review") location.hash="list";
  await B.signOut();
});

/* ---------- boot ---------- */
const unsubs={};
function watch(key,subscribe,next){
  if(unsubs[key]) unsubs[key]();
  let t=setTimeout(()=>{S.offline=true;render();},10000);
  unsubs[key]=subscribe(v=>{ clearTimeout(t); S.offline=false; next(v); render(); },
    err=>{ clearTimeout(t); console.error(err); if(err&&err.code!=="permission-denied"){S.offline=true;} render(); });
}
function stop(key){ if(unsubs[key]){unsubs[key]();delete unsubs[key];} }

async function onUser(u){
  S.user=u;
  const wasAdmin=S.admin;
  stop("responses"); stop("triage"); S.admin=false; S.responses=[]; S.dismissed=[]; S.respLoaded=false;
  if(wasAdmin){ // leave no admin controls on screen, even mid-edit
    S.ui={open:{},adding:null,knocking:null,editing:null,confirmDel:null};
    if(document.activeElement&&document.activeElement.closest(".panel")) document.activeElement.blur();
  }
  render();
  if(!u) return;
  watch("mine",(n,er)=>B.watchMine(u.uid,n,er),items=>{S.mine=items;});
  if(u.isAnonymous) return;
  // A real account signed in through the lock. The server decides whether it is an admin.
  if(await B.checkAdmin()){
    S.admin=true;
    watch("responses",B.watchResponses,docs=>{S.responses=docs;S.respLoaded=true;});
    watch("triage",B.watchTriage,d=>{S.dismissed=d;});
    if(location.hash!=="#review") location.hash="review";
    render();
  } else {
    await B.signOut();
    flash("Your admin sign-in has ended. Click the lock to sign in again.");
  }
}

export function start(backend){
  B=backend;
  render();
  watch("list",B.watchList,list=>{S.list=list;S.listLoaded=true;});
  B.onAuth(onUser);
}

export function showSetupNeeded(){
  const n=$("#ask-note"); n.className="note"; n.hidden=false;
  n.textContent="This page isn't connected to its database yet. The admin needs to add the Apps Script URL in main.js.";
  $("#f-submit").disabled=true; S.offline=true; render();
}
