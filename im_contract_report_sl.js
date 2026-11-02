/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/search','N/file','N/runtime','N/format','N/log'], (search,file,runtime,format,log) => {
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fail = message => {throw Error(message);};
  const number = v => {if(v===''||v==null)return null;const n=Number(v);if(!Number.isFinite(n))fail('Invalid numeric value in a source search.');return n;};
  const date = v => {if(!/^\d{4}-\d{2}-\d{2}$/.test(v||''))fail('Enter a valid date.');const [y,m,d]=v.split('-').map(Number),x=new Date(y,m-1,d);if(x.getFullYear()!==y||x.getMonth()!==m-1||x.getDate()!==d)fail('Invalid calendar date.');return x;};
  const iso = v => {if(!v)return '';const d=format.parse({value:v,type:format.Type.DATE});if(!(d instanceof Date)||isNaN(d))fail('A source date could not be parsed.');return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
  const nsdate = v=>format.format({value:date(v),type:format.Type.DATE});
  function loadRows(c,key,extra=[]) {
    const def=c.datasets[key],s=search.load({id:def.id});
    if(extra.length)s.filterExpression=s.filterExpression.length?[s.filterExpression,'AND',extra]:extra;
    const columns=s.columns,aliases=columns.map(x=>x.label);
    for(const a of def.columns.map(x=>x[0]))if(!aliases.includes(a))fail('Search '+def.id+' is missing column '+a+'.');
    const pages=s.runPaged({pageSize:1000});if(pages.count>c.maxRows)fail('Too many '+key+' rows. Narrow the filters. No partial results were returned.');
    const out=[];
    for(const p of pages.pageRanges){if(runtime.getCurrentScript().getRemainingUsage()<c.minUsage)fail('Report is too large for one request. Narrow the selection.');for(const r of pages.fetch({index:p.index}).data){const row={};columns.forEach(col=>{row[col.label]=r.getValue(col);try{row[col.label+'_text']=r.getText(col)||'';}catch(e){row[col.label+'_text']='';}});out.push(row);}}
    return out;
  }
  function onRequest(ctx){
    let c;
    try{
      const script=runtime.getCurrentScript(),configId=script.getParameter({name:'custscript_im_cr_config'}),templateId=script.getParameter({name:'custscript_im_cr_template'});
      if(!configId||!templateId)fail('The report configuration and HTML template parameters must be set.');
      c=JSON.parse(file.load({id:configId}).getContents());
      if(runtime.accountId!==c.accountId||!c.allowedRoles.map(String).includes(String(runtime.getCurrentUser().role)))fail('This report is restricted to the configured validation roles.');
      const p=ctx.request.parameters;
      if(p.action==='data'){
        const periods=[1,2,3].map(n=>({from:p['from'+n]||'',to:p['to'+n]||''})).filter((r,i)=>i===0||r.from||r.to);
        periods.forEach(r=>{date(r.from);date(r.to);if(r.to<r.from)fail('A period end cannot precede its start.');});
        let headers=loadRows(c,'headers');
        const originalAccounts=new Map(headers.map(h=>[String(h.id),h.account_text]));
        const includes=(v,q)=>!q||String(v||'').toLowerCase().includes(String(q).trim().toLowerCase());
        const selected=(p.rules||'').split(',').map(x=>x.trim()).filter(Boolean);
        headers=headers.filter(h=>(!selected.length||selected.includes(String(h.id)))&&includes(h.account_text,p.account)&&includes(h.group_text,p.group)&&includes(h.rep_text,p.rep)&&(!p.status||h.status_text===p.status)&&(!p.expfrom||iso(h.end)>=p.expfrom)&&(!p.expto||iso(h.end)<=p.expto));
        if(p.expfrom)date(p.expfrom);if(p.expto)date(p.expto);if(p.expfrom&&p.expto&&p.expfrom>p.expto)fail('Expiry range is reversed.');
        if(!headers.length)return json(ctx,{periods,rules:[],uniqueTotals:periods.map(()=>({qty:0,amount:0})),message:'No price rules match these filters.'});
        const ids=headers.map(h=>h.id),items=loadRows(c,'ruleItems',[c.fields.itemParent,'anyof',ids]),members=loadRows(c,'members',[c.fields.memberParent,'anyof',ids]);
        const allowedItems=items.filter(i=>!c.excludedItemStatuses.includes(i.status_text));
        const memberMatches=new Set(members.filter(m=>includes(m.customer_text,p.member)).map(m=>m.rule));
        const itemMatches=new Set(allowedItems.filter(i=>includes(i.item_text+' '+i.description,p.item)&&includes(i.class_text,p.category)&&includes(i.department_text,p.department)).map(i=>i.rule));
        headers=headers.filter(h=>memberMatches.has(h.id)&&itemMatches.has(h.id));
        if(headers.length>c.maxRules)fail('Select at most '+c.maxRules+' rules or narrow the filters.');
        const hs=new Set(headers.map(h=>h.id)),ri=allowedItems.filter(i=>hs.has(i.rule)&&(p.itemScope!=='matching'||(includes(i.item_text+' '+i.description,p.item)&&includes(i.class_text,p.category)&&includes(i.department_text,p.department))));
        const itemIds=[...new Set(ri.map(i=>i.item))],customerIds=[...new Set(members.filter(m=>hs.has(m.rule)).map(m=>m.customer))];
        if(!itemIds.length||!customerIds.length)return json(ctx,{periods,rules:[],uniqueTotals:periods.map(()=>({qty:0,amount:0})),message:'No matching items or customer memberships.'});
        const master=loadRows(c,'itemMaster',['internalid','anyof',itemIds]),masterBy=new Map(master.map(i=>[i.id,i]));
        const min=periods.map(r=>r.from).sort()[0],max=periods.map(r=>r.to).sort().at(-1);
        const sales=loadRows(c,'sales',[[c.fields.salesCustomer,'anyof',customerIds],'AND',[c.fields.salesItem,'anyof',itemIds],'AND',['trandate','within',nsdate(min),nsdate(max)]]);
        sales.forEach(s=>{s.ruleAccount=originalAccounts.get(String(s.rule))||'';});
        const seen=new Map(),clean=[];
        for(const s of sales){if(s.currency_text!==c.currency)fail('A qualifying sale uses '+s.currency_text+'. This validation version requires '+c.currency+' sales; mixed currencies are not combined.');const key=s.id+':'+s.line;if(!s.line)fail('A transaction line has no unique key.');const fingerprint=JSON.stringify(s);if(seen.has(key)){if(seen.get(key)!==fingerprint)fail('Conflicting duplicate transaction line '+key);continue;}seen.set(key,fingerprint);s.dateISO=iso(s.date);s.qty=number(s.qty);s.amount=number(s.amount);s.rate=number(s.rate);if(s.qty===null||s.amount===null)fail('Missing sales quantity or amount.');s.key=key;clean.push(s);}
        const unique=new Map(),rules=headers.map(h=>{
          const memberSet=new Set(members.filter(m=>m.rule===h.id).map(m=>m.customer)),ruleItemRows=ri.filter(i=>i.rule===h.id),used=new Set();
          const rows=ruleItemRows.map(i=>{if(used.has(i.item))fail('Rule '+h.name+' contains duplicate active item '+i.item_text+'. Resolve the overlapping rule lines before reporting.');used.add(i.item);const m=masterBy.get(i.item);if(!m)fail('Item master missing for '+i.item_text);const transactions=clean.filter(s=>s.item===i.item&&memberSet.has(s.customer)&&periods.some(p=>s.dateISO>=p.from&&s.dateISO<=p.to));transactions.forEach(s=>unique.set(s.key,s));return {id:i.item,code:m.code||i.item_text,description:m.description||i.description,listPrice:number(m.list),price:number(i.price),class:i.class_text,department:i.department_text,totals:periods.map(p=>sum(transactions.filter(s=>s.dateISO>=p.from&&s.dateISO<=p.to))),transactions};});
          return {header:h,memberCount:memberSet.size,items:rows,totals:periods.map((_,n)=>sum(rows.map(r=>r.totals[n])))};
        });
        return json(ctx,{periods,rules,currency:c.currency,uniqueTotals:periods.map(p=>sum([...unique.values()].filter(s=>s.dateISO>=p.from&&s.dateISO<=p.to))),uniqueLineCount:unique.size,generated:new Date().toISOString()});
      }
      const headers=loadRows(c,'headers');
      const options=headers.map(h=>({id:h.id,name:h.name||'PR'+h.id,account:h.account_text,group:h.group_text,rep:h.rep_text,status:h.status_text}));
      const boot=JSON.stringify({title:c.title,options,defaults:c.defaults,maxRules:c.maxRules,currency:c.currency}).replace(/</g,'\\u003c');
      ctx.response.write(file.load({id:templateId}).getContents().replace('/*__BOOT__*/',boot));
    }catch(e){log.error({title:'Contract report',details:e});if(ctx.request.parameters.action==='data')json(ctx,{error:e.message});else ctx.response.write('<h2>Contract report unavailable</h2><p>'+esc(e.message)+'</p>');}
  }
  function sum(rows){return {qty:rows.reduce((n,r)=>n+r.qty,0),amount:Math.round(rows.reduce((n,r)=>n+r.amount,0)*100)/100};}
  function json(ctx,value){ctx.response.setHeader({name:'Content-Type',value:'application/json; charset=utf-8'});ctx.response.write(JSON.stringify(value));}
  return {onRequest};
});

