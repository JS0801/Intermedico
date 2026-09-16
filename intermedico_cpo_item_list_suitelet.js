/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/search', 'N/query', 'N/log'], function (search, query, log) {
    function onRequest(context) {
        const cpoId = context.request.parameters.id || context.request.parameters.cpoid || '';
        const columns = {
            item: search.createColumn({ name: 'item', label: 'Item' }),
            memo: search.createColumn({ name: 'memo', label: 'Memo' }),
            quantity: search.createColumn({ name: 'quantity', label: 'qty' }),
            rate: search.createColumn({ name: 'fxrate', label: 'Item Rate' }),
            amount: search.createColumn({ name: 'fxamount', label: 'Amount (Foreign Currency)' })
        };
        const itemsByKey = {};
        const items = [];
        let subtotal = 0;
        let tax = 0;
        let total = 0;

        log.audit('CPO item list request', { cpoId: cpoId });

        const purchaseorderSearchObj = search.create({
            type: 'purchaseorder',
            settings: [{ name: 'consolidationtype', value: 'ACCTTYPE' }],
            filters: [
                ['type', 'anyof', 'PurchOrd'],
                'AND',
                ['mainline', 'is', 'F'],
                'AND',
                ['taxline', 'is', 'F'],
                'AND',
                ['shipping', 'is', 'F'],
                'AND',
                ['cogs', 'is', 'F'],
                'AND',
                ['custbody_master_purchase_order', 'anyof', cpoId]
            ],
            columns: [
                columns.item,
                columns.memo,
                columns.quantity,
                columns.rate,
                columns.amount
            ]
        });

        log.debug('CPO item list result count', purchaseorderSearchObj.runPaged().count);

        purchaseorderSearchObj.run().each(function (result) {
            const itemName = result.getText(columns.item) || result.getValue(columns.item) || '';
            const quantity = parseFloat(String(result.getValue(columns.quantity) || '0').replace(/,/g, '')) || 0;
            const rate = parseFloat(String(result.getValue(columns.rate) || '0').replace(/,/g, '')) || 0;
            const amount = Math.abs(parseFloat(String(result.getValue(columns.amount) || '0').replace(/,/g, '')) || 0);
            const description = result.getValue(columns.memo);
            const key = itemName + '-' + rate;

            if (!itemsByKey[key]) {
                itemsByKey[key] = {
                    item: itemName,
                    quantity: 0,
                    description: description,
                    rate: rate,
                    amount: 0
                };
            }

            itemsByKey[key].quantity += quantity;
            itemsByKey[key].amount += amount;

            return true;
        });

        Object.keys(itemsByKey).forEach(function (key) {
            items.push(itemsByKey[key]);
        });
      
        const totalRows = query.runSuiteQL({
            query: [
                'SELECT',
                't.id,',
                't.tranid,',
                'SUM(CASE WHEN tl.mainline = \'F\' AND NVL(tl.taxline, \'F\') = \'F\' THEN ABS(NVL(tl.foreignamount, 0)) ELSE 0 END) AS fxsubtotal,',
                'SUM(CASE WHEN NVL(tl.taxline, \'F\') = \'T\' THEN ABS(NVL(tl.foreignamount, 0)) ELSE 0 END) AS fxtaxtotal,',
                'ABS(NVL(t.foreigntotal, 0)) AS fxtotal',
                'FROM transaction t',
                'INNER JOIN transactionline tl ON tl.transaction = t.id',
                'WHERE t.type = \'PurchOrd\'',
                'AND t.custbody_master_purchase_order = ?',
                'GROUP BY t.id, t.tranid, t.foreigntotal'
            ].join(' '),
            params: [cpoId]
        }).asMappedResults();

        totalRows.forEach(function (row) {
            subtotal += parseFloat(String(row.fxsubtotal || '0').replace(/,/g, '')) || 0;
            tax += parseFloat(String(row.fxtaxtotal || '0').replace(/,/g, '')) || 0;
            total += parseFloat(String(row.fxtotal || '0').replace(/,/g, '')) || 0;
        });

        const responseData = {
            item: items,
            total: {
                subtotal: Number(subtotal.toFixed(2)),
                tax: Number(tax.toFixed(2)),
                total: Number(total.toFixed(2))
            }
        };

        log.audit('CPO item list response', { cpoId: cpoId, itemCount: items.length, responseData: responseData });
      
        var strReturn = "<#assign ObjDetail=" + JSON.stringify(responseData) + " />";
        log.debug('strReturn', strReturn);        
        context.response.writeLine(strReturn);
    }

    return {
        onRequest: onRequest
    };
});
