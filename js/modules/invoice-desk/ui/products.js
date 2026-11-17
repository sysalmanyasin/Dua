import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import * as api from '../data/api.js';

const businesses=[['bs-mart','B.S Mart'],['safari-book-land','Safari Book Land'],['best-choice-store','Best Choice Store']];
export async function mount(el){
  const s={businessId:'bs-mart',rows:[],name:'',price:'0.00',editing:null,error:'',busy:false};
  async function load(){try{s.rows=await api.listProducts(s.businessId,{includeInactive:true});s.error='';}catch(e){s.error=e.message||'Could not load products.';s.rows=[];}draw();}
  function draw(){render(el,html`${hero({label:'Invoice Desk',title:'Product Suggestions',sub:'Suggestions and default prices are kept separately for each business.'})}
    <section class="card"><label class="field"><span>Business</span><select id="business">${businesses.map(([id,name])=>html`<option value="${id}" ${s.businessId===id?'selected':''}>${name}</option>`)}</select></label>
      <h2>${s.editing?'Edit product':'Add product'}</h2>
      <label class="field"><span>Product name</span><input id="name" maxlength="240" value="${s.name}" /></label>
      <label class="field"><span>Suggested unit price (PKR)</span><input id="price" inputmode="decimal" value="${s.price}" /></label>
      <div class="actions"><button class="btn btn-primary" data-act="save" ${s.busy?'disabled':''}>Save product</button><button class="btn" data-act="clear">Clear</button></div>
    </section>
    ${s.error?html`<p class="note note-error">${s.error}</p>`:''}
    <section class="card"><h2>Products (${s.rows.length})</h2>${s.rows.map(p=>html`<div class="row"><div><strong>${p.name}</strong><div class="muted small">Rs. ${Number(p.suggested_price).toFixed(2)} · ${p.active?'Active':'Inactive'}</div></div><div class="actions"><button class="btn btn-sm" data-act="edit" data-id="${p.id}">Edit</button><button class="btn btn-sm" data-act="toggle" data-id="${p.id}">${p.active?'Deactivate':'Activate'}</button></div></div>` )}</section>`);}
  el.addEventListener('change',async e=>{if(e.target.id==='business'){s.businessId=e.target.value;s.editing=null;s.name='';s.price='0.00';await load();}});
  el.addEventListener('input',e=>{if(e.target.id==='name')s.name=e.target.value;if(e.target.id==='price')s.price=e.target.value;});
  el.addEventListener('click',async e=>{
    const b=e.target.closest('[data-act]');if(!b)return;
    if(b.dataset.act==='clear'){s.editing=null;s.name='';s.price='0.00';draw();}
    if(b.dataset.act==='edit'){const p=s.rows.find(x=>x.id===b.dataset.id);if(p){s.editing=p.id;s.name=p.name;s.price=Number(p.suggested_price).toFixed(2);draw();}}
    if(b.dataset.act==='save'){
      if(!s.name.trim()||!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(s.price)){s.error='Enter a product name and valid non-negative price.';return draw();}
      s.busy=true;draw();
      try{const {error}=await api.saveProduct({id:s.editing,business_id:s.businessId,name:s.name.trim(),suggested_price:s.price,active:true},crypto.randomUUID());if(error)throw error;s.editing=null;s.name='';s.price='0.00';await load();}
      catch(err){s.error=err.message||'Could not save product.';s.busy=false;draw();}
    }
    if(b.dataset.act==='toggle'){
      const p=s.rows.find(x=>x.id===b.dataset.id);if(!p)return;
      try{const {error}=await api.saveProduct({id:p.id,business_id:s.businessId,name:p.name,suggested_price:p.suggested_price,active:!p.active},crypto.randomUUID());if(error)throw error;await load();}
      catch(err){s.error=err.message||'Could not update product.';draw();}
    }
  });
  await load();
}
