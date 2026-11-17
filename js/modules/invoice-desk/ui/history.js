import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { shortDate, money } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { renderInvoice } from './renderers.js';

const names={'bs-mart':'B.S Mart','safari-book-land':'Safari Book Land','best-choice-store':'Best Choice Store'};
export async function mount(el){
  const state={businessId:'',from:'',to:'',search:'',rows:[],selected:null,error:''};
  render(el,html`<div class="card"><p class="muted">Loading invoice history…</p></div>`);
  async function load(){
    state.error='';
    try{state.rows=await api.listInvoices({businessId:state.businessId||null,from:state.from||null,to:state.to||null,search:state.search});}
    catch(e){state.error=e.message||'Could not load history.';state.rows=[];}
    draw();
  }
  function draw(){
    render(el,html`${hero({label:'Invoice Desk',title:'Invoice History',sub:'Search saved invoices and reopen their original template snapshot.'})}
      <section class="card"><div class="id-fields">
        <label class="field"><span>Business</span><select id="business"><option value="">All businesses</option>${Object.entries(names).map(([k,v])=>html`<option value="${k}" ${state.businessId===k?'selected':''}>${v}</option>`)}</select></label>
        <label class="field"><span>Invoice number</span><input id="search" value="${state.search}" placeholder="Search exact or partial number" /></label>
        <label class="field"><span>From</span><input id="from" type="date" value="${state.from}" /></label>
        <label class="field"><span>To</span><input id="to" type="date" value="${state.to}" /></label>
      </div><button class="btn btn-primary" data-act="search">Search</button></section>
      ${state.error?html`<p class="note note-error">${state.error}</p>`:''}
      <section class="card"><h2>Saved invoices (${state.rows.length})</h2>
        ${state.rows.length?state.rows.map(r=>html`<div class="row id-history-row"><div><strong>${names[r.business_id]} · #${r.invoice_number}</strong><div class="muted small">${shortDate(r.invoice_date)} · ${r.template_id} v${r.template_version}</div></div><strong>Rs. ${money(r.grand_total,{decimals:true})}</strong><button class="btn btn-sm" data-act="open" data-id="${r.id}">Open / Print</button></div>`):html`<p class="muted">No invoices match these filters.</p>`}
      </section>
      ${state.selected?html`<section class="card"><div class="id-section-head"><h2>Historical invoice</h2><button class="btn btn-sm" data-act="close">Close</button></div><div class="actions"><button class="btn btn-primary" data-act="print">Print saved snapshot</button></div><div id="id-history-preview"></div></section>`:''}`);
    if(state.selected)render(el.querySelector('#id-history-preview'),renderInvoice(state.selected));
  }
  el.addEventListener('change',e=>{if(e.target.id==='business')state.businessId=e.target.value;else if(e.target.id==='from')state.from=e.target.value;else if(e.target.id==='to')state.to=e.target.value;});
  el.addEventListener('input',e=>{if(e.target.id==='search')state.search=e.target.value;});
  el.addEventListener('click',async e=>{
    const b=e.target.closest('[data-act]');if(!b)return;
    if(b.dataset.act==='search')return load();
    if(b.dataset.act==='close'){state.selected=null;return draw();}
    if(b.dataset.act==='open'){
      try{state.selected=await api.getInvoice(b.dataset.id);draw();}catch(err){state.error=err.message||'Could not open invoice.';draw();}
    }
    if(b.dataset.act==='print'&&state.selected){
      const root=document.getElementById('print-root')||document.createElement('div');root.id='print-root';
      render(root,renderInvoice(state.selected));document.body.append(root);document.body.classList.add('printing-invoice');
      window.addEventListener('afterprint',()=>{document.body.classList.remove('printing-invoice');root.replaceChildren();},{once:true});window.print();
    }
  });
  await load();
}
