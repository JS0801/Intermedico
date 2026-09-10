/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/search', 'N/record', 'N/log'], (search, record, log) => {
    const afterSubmit = (context) => {
        if (context.type === context.UserEventType.DELETE) return;

        const salesOrderId = context.newRecord.id;
        if (!salesOrderId) return;
        log.debug('salesOrderId', salesOrderId)
        try {
            const allocationColumn = search.createColumn({
                name: 'defaultallocationstrategy',
                join: 'item'
            });
            const mismatchSearch = search.create({
                type: search.Type.SALES_ORDER,
                settings: [{ name: 'consolidationtype', value: 'ACCTTYPE' }],
                filters: [
                    ['type', 'anyof', 'SalesOrd'],
                    'AND', ['internalid', 'anyof', String(salesOrderId)],
                    'AND', ['mainline', 'is', 'F'],
                    'AND', ['taxline', 'is', 'F'],
                    'AND', ['shipping', 'is', 'F'],
                    'AND', ['formulanumeric: CASE WHEN {item.defaultallocationstrategy} IS NOT NULL AND ({orderallocationstrategy} IS NULL OR {orderallocationstrategy} != {item.defaultallocationstrategy}) THEN 1 ELSE 0 END', 'equalto', '1']
                ],
                columns: [
                    search.createColumn({ name: 'internalid' }),
                    allocationColumn,
                    search.createColumn({ name: 'lineuniquekey', sort: search.Sort.ASC })
                ]
            });

            const desiredByKey = new Map();
            const paged = mismatchSearch.runPaged({ pageSize: 1000 });
            paged.pageRanges.forEach((pageRange) => {
                const page = paged.fetch({ index: pageRange.index });
                page.data.forEach((result) => {
                    const resultOrderId = result.getValue({ name: 'internalid' });
                    const lineKey = result.getValue({ name: 'lineuniquekey' });
                    // getValue returns the strategy internal ID, not its display name.
                    const strategyId = result.getValue(allocationColumn);
                    if (String(resultOrderId) === String(salesOrderId) &&
                        lineKey !== '' && lineKey != null &&
                        strategyId !== '' && strategyId != null) {
                        desiredByKey.set(String(lineKey), String(strategyId));
                    }
                });
            });

            if (desiredByKey.size === 0) return;

            const salesOrder = record.load({
                type: record.Type.SALES_ORDER,
                id: salesOrderId,
                isDynamic: false
            });
            let updatedLines = 0;
            const lineCount = salesOrder.getLineCount({ sublistId: 'item' });
            for (let line = 0; line < lineCount; line++) {
                const lineKey = salesOrder.getSublistValue({
                    sublistId: 'item', fieldId: 'lineuniquekey', line
                });
                const strategyId = desiredByKey.get(String(lineKey));
                if (strategyId === undefined) continue;

                const currentStrategy = salesOrder.getSublistValue({
                    sublistId: 'item', fieldId: 'orderallocationstrategy', line
                });
                if (String(currentStrategy) === strategyId) continue;

                salesOrder.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'orderallocationstrategy',
                    line,
                    value: strategyId
                });
                updatedLines++;
            }

            if (updatedLines > 0) {
                salesOrder.save({ enableSourcing: false, ignoreMandatoryFields: false });
                log.audit({
                    title: 'Sales order allocation strategies updated',
                    details: { salesOrderId, updatedLines }
                });
            }
        } catch (error) {
            log.error({
                title: 'Sales order allocation strategy update failed',
                details: { salesOrderId, name: error.name, message: error.message, stack: error.stack }
            });
            throw error;
        }
    };

    return { afterSubmit };
});
