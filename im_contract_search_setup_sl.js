/**
 * Creates dedicated searches separately from the report. Does not modify existing searches.
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/search','N/file','N/runtime'],(search,file,runtime)=>{
  const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function onRequest(ctx){
    if(String(runtime.getCurrentUser().role)!=='3')throw Error('Administrator only.');
    const id=runtime.getCurrentScript().getParameter({name:'custscript_im_cr_setupcfg'});if(!id){ctx.response.write('Set the configuration file parameter.');return;}
    const c=JSON.parse(file.load({id}).getContents());if(runtime.accountId!==c.accountId)throw Error('Wrong account.');
    if(ctx.request.method==='GET'){ctx.response.write('<h2>Create contract report saved searches</h2><p>Creates five private searches. Existing IDs are skipped, never overwritten.</p><ul>'+Object.values(c.datasets).map(d=>'<li>'+esc(d.id)+' — '+esc(d.type)+'</li>').join('')+'</ul><form method="post"><button name="install" value="yes">Create dedicated searches</button></form>');return;}
    if(ctx.request.parameters.install!=='yes')throw Error('Invalid setup request.');
    const results=[];for(const [key,d] of Object.entries(c.datasets)){let existing;try{existing=search.load({id:d.id});}catch(e){if(!['INVALID_SEARCH','INVALID_SEARCH_ID','SSS_INVALID_SRCH_ID'].includes(e.name))throw e;}if(existing){results.push(key+': existing '+d.id);continue;}const cols=d.columns.map(([label,name,join,sort])=>search.createColumn({name,label,...(join?{join}:{}),...(sort?{sort}: {})}));const s=search.create({type:d.type,title:d.title,id:d.id,isPublic:false,filters:d.filters,columns:cols});s.run().getRange({start:0,end:1});results.push(key+': created '+s.save());}
    ctx.response.write('<h2>Saved searches prepared</h2><pre>'+esc(results.join('\n'))+'</pre>');
  }return {onRequest};
});
