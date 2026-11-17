import { html, render } from '../../../shared/html.js';
import { hero } from '../../../shared/ui.js';
import { money, monthLabel, todayPkt } from '../../../shared/format.js';
import * as api from '../data/api.js';
import { monthStart } from '../domain/credit.js';
import { balanceMessage } from '../domain/ledger.js';
import { loadingCard } from './parts.js';
const m=v=>money(Number(v)||0), sum=(a,k)=>(a||[]).reduce((n,r)=>n+(Number(r[k])||0),0), safe=async f=>{try{return await f()}catch{return null}};
export async function mount(el,{ctx}){
 const p=new Set(ctx.permissions), now=monthStart(todayPkt()), can={credit:p.has('credit.view')||p.has('mgmt.credit_manage'),salary:p.has('mgmt.salary')||p.has('mgmt.salary_view'),incentive:p.has('mgmt.incentive'),petty:p.has('mgmt.petty_cash'),ledgers:p.has('mgmt.ledgers'),inbox:p.has('mgmt.inbox_file'),staff:p.has('mgmt.staff_view')||p.has('mgmt.staff_edit')};
 const s={month:now,data:{},loading:true};
 async function load(){s.loading=true;s.data={};paint();const jobs={};if(can.credit)jobs.credit=safe(()=>api.creditMonth(s.month));if(can.salary){jobs.salary=safe(()=>api.salaryMonth(s.month));jobs.generic=safe(()=>api.genericMonth(s.month));}if(can.incentive)jobs.incentive=safe(()=>api.incentiveMonth(s.month));if(can.petty)jobs.petty=safe(()=>api.pettyMonth(s.month));if(can.ledgers)jobs.ledgers=safe(()=>api.ledgersList());if(can.inbox)jobs.inbox=safe(()=>api.inboxCount());s.data=Object.fromEntries(await Promise.all(Object.entries(jobs).map(async([k,v])=>[k,await v])));s.loading=false;paint();}
 const card=(n,v,h)=>html`<a class='md-kpi' href='${h}'><small>${n}</small><strong>${v}</strong><span>Open details ↗</span></a>`;
 const line=(n,v)=>html`<div class='md-line'><span>${n}</span><strong>${v}</strong></div>`;
 const panel=(n,b,h)=>html`<section class='md-panel'><header><h2>${n}</h2><a href='${h}'>View →</a></header>${b}</section>`;
 function paint(){const actions=html`<label class='md-month'>Month<input type='month' data-month value='${s.month.slice(0,7)}' max='${now.slice(0,7)}'></label><button class='btn btn-ghost' data-print>Print / PDF</button>`,head=hero({label:'MANAGER WORKSPACE',title:'Manager Overview',sub:monthLabel(s.month),actions});if(s.loading)return render(el,html`${head}${loadingCard()}`);const d=s.data,c=[];
 if(can.credit)c.push(card('Staff credit outstanding',d.credit?m(sum(d.credit,'net')):'Unavailable','#/manager/credit'));
 if(can.salary){c.push(card('Net salary',d.salary?m(sum(d.salary,'net')):'Unavailable','#/manager/salary'));c.push(card('Generic final',d.generic?m(sum(d.generic,'final')):'Unavailable','#/manager/generic'));}
 if(can.incentive)c.push(card('Net incentive',d.incentive?m(d.incentive.net_inc):'Unavailable','#/manager/incentive'));
 if(can.petty)c.push(card('Petty cash',d.petty?m(d.petty.reduce((n,g)=>n+(g.lines||[]).reduce((a,x)=>a+(Number(x.amount)||0),0),0)):'Unavailable','#/manager/petty'));
 const cr=can.credit?panel('Staff Credit',d.credit?html`${line('Previous balance',m(sum(d.credit,'prev_balance')))}${line('Monthly entries',m(sum(d.credit,'entries_total')))}${line('Net outstanding',m(sum(d.credit,'net')))}`:html`<p>Could not load credit data.</p>`,'#/manager/credit'):'';
 const sal=can.salary?panel('Payroll & Generic',d.salary&&d.generic?html`${line('HO salary',m(sum(d.salary,'ho_salary')))}${line('Advances',m(sum(d.salary,'advance')))}${line('Generic in payroll',m(sum(d.salary,'generic')))}${line('Net salary',m(sum(d.salary,'net')))}${line('Generic final',m(sum(d.generic,'final')))}`:html`<p>Could not load sheets.</p>`,'#/manager/salary'):'';
 const inc=can.incentive?panel('Incentive',d.incentive?html`${line('Sale commission',m(d.incentive.sale_comm))}${line('Generic incentive',m(d.incentive.gen_inc))}${line('Net incentive',m(d.incentive.net_inc))}${line('Owner share',m(d.incentive.owner_net))}`:html`<p>Could not load incentive.</p>`,'#/manager/incentive'):'';
 const pet=can.petty?panel('Petty Cash',d.petty?html`${line('Voucher total',m(d.petty.reduce((n,g)=>n+(g.lines||[]).reduce((a,x)=>a+(Number(x.amount)||0),0),0)))}${line('Voucher groups',d.petty.length)}`:html`<p>Could not load petty cash.</p>`,'#/manager/petty'):'';
 const led=can.ledgers?panel('Live Balances',d.ledgers?html`${d.ledgers.map(l=>{const b=balanceMessage(l,l.balance),h=l.code==='expense'?'#/manager/expenses':l.code==='jazzcash'?'#/manager/jazzcash':'#/manager/misc';return html`<a class='md-balance' href='${h}'><span>${l.name}</span><strong>${b.amount?m(b.amount):'Settled'}</strong><small>${b.text} · ${l.entry_count} entries</small></a>`})}`:html`<p>Could not load ledgers.</p>`,'#/manager/expenses'):'';
 const inbox=can.inbox?panel('Credit Inbox',html`<strong class='md-inbox'>${Number(d.inbox?.[0]?.count??d.inbox?.[0]??d.inbox??0)}</strong><a href='#/manager/inbox'>Review inbox →</a>`,'#/manager/inbox'):'';
 const links=html`<nav class='md-links'>${can.staff?html`<a href='#/manager/staff'>Staff Registry</a>`:''}${can.credit?html`<a href='#/manager/credit'>Staff Credit</a>`:''}${can.salary?html`<a href='#/manager/reports'>Reports</a>`:''}${can.petty?html`<a href='#/manager/petty'>Petty Cash</a>`:''}${can.ledgers?html`<a href='#/manager/misc'>Misc Sections</a>`:''}</nav>`;
 render(el,html`${head}<div class='md-intro'><span>MONTHLY SNAPSHOT</span><h2>Your branch, at a glance.</h2><p>Live figures from existing Manager records.</p></div><div class='md-kpis'>${c}</div><div class='md-columns'>${cr}${sal}${inc}${pet}${led}${inbox}</div>${panel('Quick Access',links,'#/manager')}`);
 }
 el.addEventListener('change',e=>{if(e.target.matches('[data-month]')&&/^\d{4}-\d{2}$/.test(e.target.value)){s.month=e.target.value+'-01';load();}});
 el.addEventListener('click',e=>{if(e.target.closest('[data-print]')){document.body.classList.add('printing-manager-dashboard');window.addEventListener('afterprint',()=>document.body.classList.remove('printing-manager-dashboard'),{once:true});window.print();}});
 await load();
}
