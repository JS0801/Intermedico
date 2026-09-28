/**
 * Copyright (c) 1998-2025 Oracle-NetSuite, Inc.
 * 2955 Campus Drive, Suite 100, San Mateo, CA, USA 94403-2511
 * All Rights Reserved.
 *
 * This software is the confidential and proprietary information of
 * NetSuite, Inc. ("Confidential Information"). You shall not
 * disclose such Confidential Information and shall use it only in
 * accordance with the terms of the license agreement you entered into
 * with NetSuite.
 *
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope Public
 * @changeLog:   1.0       17 July 2026       Manuel Teodoro       Initial version
 *               1.1       21 July 2026       Manuel Teodoro       Skip partial XEDIT records used for task and status updates.
 *               1.2       01 September 2026  Manuel Teodoro       Persist the Error status by display text when Map/Reduce submission fails.
 *
 */
define(function (require)
{
    const record = require('N/record');
    const task = require('N/task');
    const blanketSchedule = require('./NSTS_MD_BlanketSchedule');

    const FIELD = Object.assign({}, blanketSchedule.CONSTANTS.field, {
        revision: 'custrecord_ns_bs_revision',
        status: 'custrecord_ns_bs_status',
        taskId: 'custrecord_ns_bs_task_id',
        lastError: 'custrecord_ns_bs_last_error'
    });
    const HEADER_TYPE = 'customrecord_ns_blanket_schedule';
    const ITEM_TYPE = 'customrecord_ns_blanket_item_sched';
    const RELEVANT_FIELDS = Object.values(blanketSchedule.CONSTANTS.field);

    const EntryPoint = {};
    const Helper = {};

    // Entry Points
    EntryPoint.beforeSubmit = (context) =>
    {
        let stLogTitle = 'beforeSubmit';
        log.debug(stLogTitle);

        try
        {
            // submitFields invokes an XEDIT with only the submitted fields. It does not include
            // the schedule recurrence fields required by full-record validation.
            if ([context.UserEventType.DELETE, context.UserEventType.XEDIT].includes(context.type)) return;

            const rec = context.newRecord;
            const header = rec.type === HEADER_TYPE
                ? rec
                : record.load({ type: HEADER_TYPE, id: Helper.getHeaderId(rec) });
            const values = rec.type === ITEM_TYPE
                ? blanketSchedule.getEffectiveValues(Helper.getHeaderValues(header), Helper.getItemValues(rec))
                : Helper.getHeaderValues(rec);
            const errors = rec.type === ITEM_TYPE
                ? blanketSchedule.validateValues(values)
                : blanketSchedule.validateHeaderValues(values);

            if (errors.length) throw Error(errors.join(' '));

            if (blanketSchedule.isGenerationRelevantChange(rec, context.oldRecord, RELEVANT_FIELDS)
                && rec.type === HEADER_TYPE)
            {
                rec.setValue({
                    fieldId: FIELD.revision,
                    value: Number(rec.getValue({ fieldId: FIELD.revision }) || 0) + 1
                });
                Helper.setPending(rec);
            }
        }
        catch (error)
        {
            log.error(stLogTitle, error);
            throw error;
        }
    };

    EntryPoint.afterSubmit = (context) =>
    {
        let stLogTitle = 'afterSubmit';
        log.debug(stLogTitle);

        try
        {
            if ([context.UserEventType.DELETE, context.UserEventType.XEDIT].includes(context.type)) return;

            const headerId = Helper.getHeaderId(context.newRecord);
            if (!headerId) return;

            const header = record.load({ type: HEADER_TYPE, id: headerId });
            const status = header.getValue({ fieldId: FIELD.status });
            const statusText = Helper.getSelectTextOrValue(header, FIELD.status);

            if (String(status) === '1' || statusText === 'Error')
            {
                log.debug(stLogTitle, `Blanket Schedule ${headerId} has status ${statusText || status}; MR submission skipped.`);
                return;
            }

            if (header.getValue({ fieldId: FIELD.taskId })) return;

            const mrTask = task.create({
                taskType: task.TaskType.MAP_REDUCE,
                scriptId: 'customscript_ns_mr_blanket_line_sync',
                deploymentId: 'customdeploy_ns_mr_blanket_line_sync',
                params: { custscript_ns_mr_bs_header_id: headerId }
            });
            const taskId = mrTask.submit();

            record.submitFields({
                type: HEADER_TYPE,
                id: headerId,
                values: { [FIELD.taskId]: taskId }
            });
            log.audit(stLogTitle, `Submitted Blanket Line Sync task ${taskId} for Blanket Schedule ${headerId}.`);
        }
        catch (error)
        {
            log.error(stLogTitle, error);
            const headerId = Helper.getHeaderId(context.newRecord);

            if (headerId)
            {
                Helper.setError(headerId, error);
            }
        }
    };

    // Subfunctions
    Helper.getHeaderId = (rec) =>
    {
        let stLogTitle = 'getHeaderId';
        log.debug(stLogTitle);
        return rec.type === HEADER_TYPE ? rec.id : rec.getValue({ fieldId: FIELD.parent });
    };

    Helper.setPending = (rec) =>
    {
        let stLogTitle = 'setPending';
        log.debug(stLogTitle);
        rec.setText({ fieldId: FIELD.status, text: 'Pending Generation' });
    };

    Helper.setError = (headerId, error) =>
    {
        const stLogTitle = 'setError';
        const header = record.load({ type: HEADER_TYPE, id: headerId });

        // custrecord_ns_bs_status is a custom-list field. submitFields needs its
        // internal ID, whereas setText resolves the configured Error option safely.
        header.setValue({
            fieldId: FIELD.lastError,
            value: error && error.message ? error.message : String(error)
        });
        header.setText({ fieldId: FIELD.status, text: 'Error' });
        header.save({ enableSourcing: false, ignoreMandatoryFields: true });
        log.audit(stLogTitle, `Blanket Schedule ${headerId} marked Error.`);
    };

    Helper.getSelectTextOrValue = (rec, fieldId) =>
    {
        let stLogTitle = 'getSelectTextOrValue';
        log.debug(stLogTitle);

        try
        {
            return rec.getText({ fieldId: fieldId });
        }
        catch (error)
        {
            if (error.name !== 'SSS_INVALID_API_USAGE') throw error;
            return rec.getValue({ fieldId: fieldId });
        }
    };

    Helper.getHeaderValues = (header) =>
    {
        let stLogTitle = 'getHeaderValues';
        log.debug(stLogTitle);

        return {
            startDate: header.getValue({ fieldId: FIELD.startDate }),
            endDate: header.getValue({ fieldId: FIELD.endDate }),
            mode: Helper.getSelectTextOrValue(header, FIELD.mode),
            frequencyUnit: Helper.getSelectTextOrValue(header, FIELD.frequencyUnit),
            frequencyInterval: header.getValue({ fieldId: FIELD.frequencyInterval }),
            defaultQuantity: header.getValue({ fieldId: FIELD.defaultQuantity }),
            defaultLocation: header.getValue({ fieldId: FIELD.defaultLocation }),
            defaultShipTo: header.getValue({ fieldId: FIELD.defaultShipTo })
        };
    };

    Helper.getItemValues = (item) =>
    {
        let stLogTitle = 'getItemValues';
        log.debug(stLogTitle);

        return {
            itemId: item.getValue({ fieldId: FIELD.item }),
            quantity: item.getValue({ fieldId: FIELD.quantity }),
            startDate: item.getValue({ fieldId: FIELD.startOverride }),
            endDate: item.getValue({ fieldId: FIELD.endOverride }),
            mode: Helper.getSelectTextOrValue(item, FIELD.modeOverride),
            frequencyUnit: Helper.getSelectTextOrValue(item, FIELD.frequencyUnitOverride),
            frequencyInterval: item.getValue({ fieldId: FIELD.frequencyIntervalOverride }),
            deliveryDate: item.getValue({ fieldId: FIELD.deliveryDate }),
            location: item.getValue({ fieldId: FIELD.locationOverride }),
            shipTo: item.getValue({ fieldId: FIELD.shipToOverride })
        };
    };

    return EntryPoint;
});
