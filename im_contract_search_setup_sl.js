/**
 * Creates dedicated searches separately from the report. Does not modify existing searches.
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/search','N/file','N/runtime'],(search,file,runtime)=>{
  const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function validation(c){
    function rows(key,parent){const def=c.datasets[key],s=search.load({id:def.id});s.filterExpression=[s.filterExpression,'AND',[parent,'anyof','5444']];const out=[];const paged=s.runPaged({pageSize:1000});for(const page of paged.pageRanges)for(const r of paged.fetch({index:page.index}).data){const o={};for(const col of s.columns){o[col.label]=r.getValue(col);try{o[col.label+'_text']=r.getText(col);}catch(e){}}out.push(o);}return out;}
    const items=[...new Set(rows('ruleItems',c.fields.itemParent).filter(r=>!c.excludedItemStatuses.includes(r.status_text)).map(r=>r.item))];
    const customers=[...new Set(rows('members',c.fields.memberParent).map(r=>r.customer))];
    if(!items.length||!customers.length)throw Error('Validation rule has no items or members.');
    const filters=[c.datasets.sales.filters,'AND',['entity','anyof',customers],'AND',['item','anyof',items],'AND',['trandate','within','9/1/2026','9/30/2026']];
    const col=(name,label,summary,formula)=>search.createColumn({name,label,...(summary?{summary}:{}),...(formula?{formula}: {})});
    const totals=[col('lineuniquekey','Invoice lines','COUNT'),col('quantity','P1 quantity','SUM'),col('amount','P1 sales CAD','SUM'),col('formulanumeric','P2 quantity','SUM',"CASE WHEN {trandate} <= TO_DATE('2026-09-15','YYYY-MM-DD') THEN {quantity} ELSE 0 END"),col('formulacurrency','P2 sales CAD','SUM',"CASE WHEN {trandate} <= TO_DATE('2026-09-15','YYYY-MM-DD') THEN {amount} ELSE 0 END"),col('formulanumeric','P3 quantity','SUM',"CASE WHEN {trandate} >= TO_DATE('2026-09-16','YYYY-MM-DD') THEN {quantity} ELSE 0 END"),col('formulacurrency','P3 sales CAD','SUM',"CASE WHEN {trandate} >= TO_DATE('2026-09-16','YYYY-MM-DD') THEN {amount} ELSE 0 END")];
    const definitions=[{id:'customsearch_im_cr_val5444_totals',title:'IM | Validation | PR5444 | Sep 2026 totals',columns:totals},{id:'customsearch_im_cr_val5444_items',title:'IM | Validation | PR5444 | Sep 2026 by item',columns:[col('item','Item','GROUP'),...totals]}];
    let html='<h2>Independent saved-search validation</h2><p>PR5444; '+items.length+' items; '+customers.length+' customers. P1: Sep 1–30 2026; P2: Sep 1–15; P3: Sep 16–30. Invoice customer/item/date matching, no original-price-rule restriction. Private searches only.</p>';
    for(const d of definitions){let s;try{s=search.load({id:d.id});}catch(e){if(!['INVALID_SEARCH','INVALID_SEARCH_ID','SSS_INVALID_SRCH_ID'].includes(e.name))throw e;}
      if(!s){s=search.create({type:'transaction',id:d.id,title:d.title,isPublic:false,filters,columns:d.columns});s.save();}
      const results=s.run().getRange({start:0,end:1000});html+='<h3>'+esc(d.title)+'</h3><p>'+esc(d.id)+'</p><table border="1" cellpadding="6"><tr>'+s.columns.map(c=>'<th>'+esc(c.label)+'</th>').join('')+'</tr>'+results.map(r=>'<tr>'+s.columns.map(c=>{let v=r.getValue(c);if(c.name==='item'){try{v=r.getText(c)||v;}catch(e){}}return '<td>'+esc(v??'')+'</td>';}).join('')+'</tr>').join('')+'</table>';
    }return html;
  }
  function onRequest(ctx){
    if(String(runtime.getCurrentUser().role)!=='3')throw Error('Administrator only.');
    const id=runtime.getCurrentScript().getParameter({name:'custscript_im_cr_setupcfg'});if(!id){ctx.response.write('Set the configuration file parameter.');return;}
    const c=JSON.parse(file.load({id}).getContents());if(runtime.accountId!==c.accountId)throw Error('Wrong account.');
    if(ctx.request.method==='POST'&&ctx.request.parameters.install==='validate5444'){ctx.response.write(validation(c));return;}
    if(ctx.request.method==='GET'){ctx.response.write('<h2>Create contract report saved searches</h2><p>Creates five private searches. Existing IDs are skipped, never overwritten.</p><ul>'+Object.values(c.datasets).map(d=>'<li>'+esc(d.id)+' — '+esc(d.type)+'</li>').join('')+'</ul><form method="post"><button name="install" value="yes">Create dedicated searches</button> <button name="install" value="validate5444">Create PR5444 validation searches</button></form>');return;}
    if(ctx.request.parameters.install!=='yes')throw Error('Invalid setup request.');
    const results=[];for(const [key,d] of Object.entries(c.datasets)){let existing;try{existing=search.load({id:d.id});}catch(e){if(!['INVALID_SEARCH','INVALID_SEARCH_ID','SSS_INVALID_SRCH_ID'].includes(e.name))throw e;}if(existing){results.push(key+': existing '+d.id);continue;}const cols=d.columns.map(([label,name,join,sort])=>search.createColumn({name,label,...(join?{join}:{}),...(sort?{sort}: {})}));const s=search.create({type:d.type,title:d.title,id:d.id,isPublic:false,filters:d.filters,columns:cols});s.run().getRange({start:0,end:1});results.push(key+': created '+s.save());}
    ctx.response.write('<h2>Saved searches prepared</h2><pre>'+esc(results.join('\n'))+'</pre>');
  }return {onRequest};
});
