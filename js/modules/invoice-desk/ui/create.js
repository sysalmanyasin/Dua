import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { todayPkt } from '../../../shared/format.js';
import { amountInWords } from '../domain/amount-in-words.js';
import { calculateInvoice, toPaisa } from '../domain/calculations.js';
import { validateInvoiceHeader, validateLine } from '../domain/validation.js';
import { templateForBusiness } from '../domain/templates.js';
import * as api from '../data/api.js';
import { renderInvoice } from './renderers.js';

const BUSINESSES = [
  ['bs-mart','B.S Mart'],['safari-book-land','Safari Book Land'],['best-choice-store','Best Choice Store'],
];
const blankLine = () => ({ description:'', quantity:'1', unitPrice:'0.00', productId:'' });
const escErr = (e) => e?.message || 'The operation could not be completed. Check your connection and access.';
const fmt = (p) => (p / 100).toFixed(2);

export async function mount(el) {
  const state = { businessId:'bs-mart', invoiceNumber:'', invoiceDate:todayPkt(), lines:[blankLine()], discount:'0.00', cash:'', change:'', cashier:'', customer:'', shift:'', time:'', products:[], busy:false, key:crypto.randomUUID(), saved:null, error:'' };
  async function loadProducts() {
    try { state.products = await api.listProducts(state.businessId); }
    catch { state.products = []; }
  }
  const header = () => ({ businessId:state.businessId, invoiceNumber:state.invoiceNumber, invoiceDate:state.invoiceDate });
  function totals() {
    const lines = state.lines.map((l) => ({ description:l.description, quantity:l.quantity, unitPrice:l.unitPrice }));
    return calculateInvoice(lines, state.businessId === 'best-choice-store' ? toPaisa(state.discount || '0') : 0);
  }
  function drawTotals(box) {
    let result=null, calcError='';
    try { result=totals(); } catch(e) { calcError=e.message; }
    render(box, html`<h2>Live total</h2>
      ${result?html`<div class="id-grand"><span>Subtotal</span><strong>Rs. ${fmt(result.subtotalPaisa)}</strong></div>${state.businessId==='best-choice-store'?html`<div class="id-grand"><span>Discount</span><strong>Rs. ${fmt(result.discountPaisa)}</strong></div>`:''}<div class="id-grand"><span>Net payable</span><strong>Rs. ${fmt(result.grandTotalPaisa)}</strong></div><p class="id-words">${amountInWords(result.grandTotalPaisa)}</p>`:html`<p class="note note-error">${calcError}</p>`}`);
  }
  function draw() {
    let result = null, calcError = '';
    try { result = totals(); } catch(e) { calcError = e.message; }
    render(el, html`${hero({label:'Invoice Desk',title:'Create Invoice',sub:'Choose the business, enter the invoice number exactly as printed, and review before saving.'})}
      <section class="card id-form">
        <div class="id-fields">
          <label class="field"><span>Business</span><select id="business">${BUSINESSES.map(([id,name])=>html`<option value="${id}" ${state.businessId===id?'selected':''}>${name}</option>`)}</select></label>
          <label class="field"><span>Invoice number (keeps leading zeros)</span><input id="invoice-number" maxlength="120" value="${state.invoiceNumber}" autocomplete="off" /></label>
          <label class="field"><span>Invoice date</span><input id="invoice-date" type="date" value="${state.invoiceDate}" /></label>
        </div>
      </section>
      <section class="card">
        <div class="id-section-head"><h2>Items</h2><button class="btn btn-sm" data-act="add">Add item</button></div>
        ${state.lines.map((line,i)=>html`<div class="id-line" data-line="${i}">
          <label class="field id-desc"><span>Description</span><input data-field="description" value="${line.description}" list="id-products" autocomplete="off" /></label>
          <label class="field"><span>Qty</span><input data-field="quantity" inputmode="decimal" value="${line.quantity}" /></label>
          <label class="field"><span>Unit price</span><input data-field="unitPrice" inputmode="decimal" value="${line.unitPrice}" /></label>
          <button class="btn btn-sm" data-act="remove" data-index="${i}" ${state.lines.length===1?'disabled':''}>Remove</button>
        </div>`)}
        <datalist id="id-products">${state.products.map(p=>html`<option value="${p.name}"></option>`)}</datalist>
      </section>
      ${state.businessId==='best-choice-store'?html`<section class="card"><label class="field"><span>Discount (PKR)</span><input id="discount" inputmode="decimal" value="${state.discount}" /></label></section>`:''}
      <section class="card">
        <h2>Receipt fields</h2>
        <div class="id-fields">
          ${state.businessId!=='best-choice-store'?html`<label class="field"><span>Cash received</span><input id="cash" inputmode="decimal" value="${state.cash}" /></label><label class="field"><span>Change</span><input id="change" inputmode="decimal" value="${state.change}" /></label>`:html`<label class="field"><span>Customer</span><input id="customer" value="${state.customer}" /></label><label class="field"><span>Shift</span><input id="shift" value="${state.shift}" /></label>`}
          ${state.businessId==='safari-book-land'?html`<label class="field"><span>Cashier</span><input id="cashier" value="${state.cashier}" /></label><label class="field"><span>Time</span><input id="time" value="${state.time}" placeholder="16:35:22 PM" /></label>`:''}
          ${state.businessId==='bs-mart'?html`<label class="field"><span>Cashier</span><input id="cashier" value="${state.cashier}" /></label><label class="field"><span>Shift</span><input id="shift" value="${state.shift}" /></label><label class="field"><span>Time</span><input id="time" value="${state.time}" placeholder="16:45:40 PM" /></label>`:''}
          ${state.businessId==='best-choice-store'?html`<label class="field"><span>Time</span><input id="time" value="${state.time}" placeholder="17:42:15 PM" /></label>`:''}
        </div>
      </section>
      <section class="card id-total-preview">
        <h2>Live total</h2>
        ${result?html`<div class="id-grand"><span>Subtotal</span><strong>Rs. ${fmt(result.subtotalPaisa)}</strong></div>${state.businessId==='best-choice-store'?html`<div class="id-grand"><span>Discount</span><strong>Rs. ${fmt(result.discountPaisa)}</strong></div>`:''}<div class="id-grand"><span>Net payable</span><strong>Rs. ${fmt(result.grandTotalPaisa)}</strong></div><p class="id-words">${amountInWords(result.grandTotalPaisa)}</p>`:html`<p class="note note-error">${calcError}</p>`}
      </section>
      ${state.error?html`<p class="note note-error" role="alert">${state.error}</p>`:''}
      <div class="actions-bar"><button class="btn btn-primary" data-act="save" ${state.busy||!result?'disabled':''}>Save invoice</button></div>
      ${state.saved?html`<section class="card id-saved-card"><p class="note note-ok">Invoice saved. Internal record: ${state.saved.id}</p><div class="actions"><button class="btn" data-act="print">Print invoice</button><button class="btn" data-act="new">New invoice</button></div><div id="id-preview"></div></section>`:''}`);
    if(state.saved) render(el.querySelector('#id-preview'),renderInvoice(state.saved));
  }
  el.addEventListener('input',(e)=>{
    const t=e.target;
    if(t.closest('[data-line]')) { const i=Number(t.closest('[data-line]').dataset.line); if(t.dataset.field) { state.lines[i][t.dataset.field]=t.value; if(t.dataset.field==='description') state.lines[i].productId=''; } }
    else if(t.id==='invoice-number') state.invoiceNumber=t.value;
    else if(t.id==='invoice-date') state.invoiceDate=t.value;
    else if(t.id==='discount') state.discount=t.value;
    else if(t.id==='cash') state.cash=t.value;
    else if(t.id==='change') state.change=t.value;
    else if(t.id==='cashier') state.cashier=t.value;
    else if(t.id==='customer') state.customer=t.value;
    else if(t.id==='shift') state.shift=t.value;
    else if(t.id==='time') state.time=t.value;
    else return;
    state.saved=null; state.error=''; state.key=crypto.randomUUID();
    el.querySelector('.id-saved-card')?.remove();
    const totalBox=el.querySelector('#id-total-preview');
    if(totalBox) drawTotals(totalBox);
  });
  el.addEventListener('change',async(e)=>{
    if(e.target.id==='business') { state.businessId=e.target.value; state.lines=[blankLine()]; state.discount='0.00'; state.cash=''; state.change=''; state.cashier=''; state.customer=''; state.shift=''; state.time=''; state.saved=null; state.key=crypto.randomUUID(); await loadProducts(); draw(); }
    if(e.target.matches('[data-field="description"]')) {
      const line=e.target.closest('[data-line]'); const i=Number(line.dataset.line);
      const p=state.products.find(x=>x.name.toLowerCase()===e.target.value.trim().toLowerCase());
      if(p) { state.lines[i].productId=p.id; state.lines[i].unitPrice=Number(p.suggested_price).toFixed(2); draw(); }
    }
  });
  el.addEventListener('click',async(e)=>{
    const b=e.target.closest('[data-act]'); if(!b)return;
    if(b.dataset.act==='add'){state.lines.push(blankLine());state.saved=null;state.key=crypto.randomUUID();draw();}
    if(b.dataset.act==='remove'){state.lines.splice(Number(b.dataset.index),1);state.saved=null;state.key=crypto.randomUUID();draw();}
    if(b.dataset.act==='new'){state.invoiceNumber='';state.lines=[blankLine()];state.discount='0.00';state.cash='';state.change='';state.cashier='';state.customer='';state.shift='';state.time='';state.saved=null;state.key=crypto.randomUUID();draw();}
    if(b.dataset.act==='print'){printSaved();}
    if(b.dataset.act==='save') await save();
  });
  function printSaved(){
    const root=document.getElementById('print-root')||document.createElement('div');root.id='print-root';
    render(root,renderInvoice(state.saved));document.body.append(root);document.body.classList.add('printing-invoice');
    const done=()=>{document.body.classList.remove('printing-invoice');root.replaceChildren();window.removeEventListener('afterprint',done);};
    window.addEventListener('afterprint',done,{once:true});window.print();
  }
  async function save(){
    const errors=validateInvoiceHeader(header());
    for(const [i,line] of state.lines.entries()) Object.assign(errors, Object.fromEntries(Object.entries(validateLine(line)).map(([k,v])=>[`line${i}.${k}`,v])));
    let result;
    try { result=totals(); } catch(e){state.error=e.message;draw();return;}
    if(Object.keys(errors).length){state.error=Object.values(errors)[0];draw();return;}
    state.busy=true;state.error='';draw();
    const template=templateForBusiness(state.businessId);
    const payload={business_id:state.businessId,invoice_number:state.invoiceNumber,invoice_date:state.invoiceDate,template_id:template.id,template_version:template.version,amount_words:amountInWords(result.grandTotalPaisa),discount:fmt(result.discountPaisa),printed_fields:{cash:state.cash,change:state.change,cashier:state.cashier,customer:state.customer,shift:state.shift,time:state.time}};
    const lines=result.lines.map(l=>({product_id:state.lines[result.lines.indexOf(l)]?.productId||null,description:l.description.trim(),quantity:String(l.quantity),unit_price:fmt(l.unitPricePaisa)}));
    try{
      const {data,error}=await api.saveInvoice(payload,lines,state.key);if(error)throw error;
      const saved=await api.getInvoice(data);state.saved=saved;state.busy=false;draw();
    }catch(e){state.busy=false;state.error=escErr(e);draw();}
  }
  await loadProducts();draw();
}
