/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 */
define(['N/currentRecord','N/ui/dialog'],(currentRecord,dialog)=>{
    let active=null;
    function pageInit() {}
    function openAvailableStockAllocation() {
        if(active){active.focus();return;}
        const target=currentRecord.get().getValue({fieldId:'custpage_fas_popup_url'});
        if(!target) return dialog.alert({title:'Allocation unavailable',message:'Configure the Suitelet IDs on the button deployment.'});
        const previous=document.activeElement;
        const overlay=document.createElement('div');
        overlay.style.cssText='position:fixed;inset:0;z-index:2147483000;background:#0f172a99;display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box';
        const panel=document.createElement('section');
        panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Allocate Available Stock');panel.tabIndex=-1;
        panel.style.cssText='width:540px;max-width:94vw;height:410px;max-height:90vh;background:white;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;font:14px Arial';
        const header=document.createElement('div');
        header.style.cssText='display:flex;align-items:center;gap:16px;padding:12px 16px;background:#14324f;color:white';
        const title=document.createElement('strong');title.textContent='Allocating items';title.style.flex='1';
        const close=document.createElement('button');close.type='button';close.textContent='Close';
        const frame=document.createElement('iframe');frame.title='Available stock allocation';frame.style.cssText='width:100%;flex:1;border:0;background:white';
        let running=true;
        const message=event=>{
            if(event.origin!==window.location.origin || event.source!==frame.contentWindow || !event.data) return;
            if(event.data.type==='rr-allocation-state') running=event.data.running===true;
            if(event.data.type==='rr-allocation-review') {
                panel.style.width=event.data.enabled?'1000px':'540px';
                panel.style.height=event.data.enabled?'85vh':'410px';
            }
            if(event.data.type==='rr-allocation-complete' && !running) dismiss();
        };
        const dismiss=()=>{
            if(running && !window.confirm('Allocation is still active or waiting for review. Close and stop further processing? Already submitted changes remain saved; inspect commitments before retrying.')) return;
            window.removeEventListener('message',message);
            overlay.remove();active=null;
            if(previous) previous.focus();
        };
        close.addEventListener('click',dismiss);
        panel.addEventListener('keydown',event=>{
            if(event.key==='Escape'){event.preventDefault();dismiss();}
            if(event.key==='Tab' && event.shiftKey && document.activeElement===close){event.preventDefault();frame.focus();}
        });
        header.append(title,close);panel.append(header,frame);overlay.append(panel);document.body.append(overlay);
        window.addEventListener('message',message);active=panel;frame.src=target;close.focus();
    }
    return {pageInit,openAvailableStockAllocation};
});
