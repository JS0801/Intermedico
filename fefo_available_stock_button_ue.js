/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 * Deploy on Sales Order. Place the companion Client Script in the same folder.
 * Free-Form Text script parameters:
 * custscript_fas_sl_script: Suitelet script ID
 * custscript_fas_sl_deploy: Suitelet deployment ID
 */
define(['N/runtime','N/url','N/ui/serverWidget'],(runtime,url,ui)=>{
    function beforeLoad(ctx) {
        if(ctx.type!==ctx.UserEventType.VIEW || runtime.executionContext!==runtime.ContextType.USER_INTERFACE || !ctx.newRecord.id) return;
        const script=runtime.getCurrentScript();
        const scriptId=script.getParameter({name:'custscript_fas_sl_script'});
        const deploymentId=script.getParameter({name:'custscript_fas_sl_deploy'});
        if(!scriptId || !deploymentId) return;
        const target=url.resolveScript({scriptId,deploymentId,params:{soid:String(ctx.newRecord.id)}});
        const field=ctx.form.addField({id:'custpage_fas_popup_url',label:'Available stock allocation URL',type:ui.FieldType.LONGTEXT});
        field.updateDisplayType({displayType:ui.FieldDisplayType.HIDDEN});
        field.defaultValue=target;
        ctx.form.clientScriptModulePath='./fefo_available_stock_popup_client.js';
        ctx.form.addButton({id:'custpage_fas_allocate',label:'Allocate Available Stock',functionName:'openAvailableStockAllocation'});
    }
    return {beforeLoad};
});
