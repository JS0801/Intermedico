/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define([
    'N/error',
    'N/log',
    'N/record',
    'N/runtime',
    'N/search',
    'N/ui/serverWidget',
    'N/url'
], function (
    error,
    log,
    record,
    runtime,
    search,
    serverWidget,
    url
) {
    const CONFIG = {
        pageTitle: 'InterMedico Receiving Tool',
        masterPoRecordType: 'customrecord_consolidated_po',
        masterPoField: 'custbody_master_purchase_order',
        inventoryDetailIconNotFilled: 'https://4382108.app.netsuite.com/core/media/media.nl?id=24231&c=4382108&h=YnSYg6zHZBKBjFQ6yI7HCuuSDbzV1x356tga3ZAREJ8Ix3f3',
        inventoryDetailIconFilled: 'https://4382108.app.netsuite.com/core/media/media.nl?id=24230&c=4382108&h=IH_6SQ4VYeAu0pFkOMmf5qXj8CSBZWAU0A5XLbIcoYkJkseL',
        inventoryDetailIconWidth: 20,
        inventoryDetailIconHeight: 20,
        maxLines: 5000
    };

    function onRequest(context) {
        if (context.request.method === 'POST') {
            const params = context.request.parameters || {};

            try {
                const result = receiveItems(JSON.parse(params.custpage_receive_payload || '{"groups":[]}').groups || []);
                renderPage(context, '', result);
            } catch (ex) {
                log.error({ title: 'Receive failed', details: ex });
                renderPage(context, ex.message || String(ex), []);
            }
            return;
        }

        renderPage(context, '', []);
    }

    function renderPage(context, message, result) {
        const form = serverWidget.createForm({ title: CONFIG.pageTitle });
        const payloadField = form.addField({
            id: 'custpage_receive_payload',
            type: serverWidget.FieldType.LONGTEXT,
            label: 'Receive Payload'
        });
        payloadField.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });

        const htmlField = form.addField({
            id: 'custpage_receive_html',
            type: serverWidget.FieldType.INLINEHTML,
            label: 'Receiving Tool'
        });

        const data = getPageData();
        htmlField.defaultValue = buildHtml({
            data: data.masters,
            statuses: data.statuses,
            message: message || '',
            result: result || [],
            suiteletUrl: url.resolveScript({
                scriptId: runtime.getCurrentScript().id,
                deploymentId: runtime.getCurrentScript().deploymentId,
                returnExternalUrl: false
            })
        });

        context.response.writePage(form);
    }

    function getPageData() {
        const c = {
            master: search.createColumn({ name: CONFIG.masterPoField }),
            poId: search.createColumn({ name: 'internalid' }),
            poNumber: search.createColumn({ name: 'tranid' }),
            poDate: search.createColumn({ name: 'trandate' }),
            vendor: search.createColumn({ name: 'mainname' }),
            vendorId: search.createColumn({ name: 'internalid', join: 'vendor' }),
            status: search.createColumn({ name: 'statusref' }),
            item: search.createColumn({ name: 'item' }),
            memo: search.createColumn({ name: 'memo' }),
            location: search.createColumn({ name: 'location' }),
            locationText: search.createColumn({ name: 'locationnohierarchy' }),
            quantity: search.createColumn({ name: 'quantity' }),
            received: search.createColumn({ name: 'quantityshiprecv' }),
            createdFrom: search.createColumn({ name: 'createdfrom' }),
            billed: search.createColumn({ name: 'quantitybilled' }),
            line: search.createColumn({ name: 'line' }),
            lineKey: search.createColumn({ name: 'lineuniquekey' })
        };
        const masters = {};
        const masterIds = {};
        const itemIds = {};
        const locationIds = {};
        let count = 0;

        const poSearch = search.create({
            type: search.Type.PURCHASE_ORDER,
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
                ['closed', 'is', 'F'],
                'AND',
                ["status","noneof","PurchOrd:H","PurchOrd:G","PurchOrd:F","PurchOrd:A","PurchOrd:C"],
                'AND',
                [CONFIG.masterPoField, 'noneof', '@NONE@']
            ],
            columns: Object.keys(c).map(function (key) { return c[key]; })
        });

        const paged = poSearch.runPaged({ pageSize: 1000 });

        paged.pageRanges.forEach(function (range) {
            if (count >= CONFIG.maxLines) {
                return;
            }

            paged.fetch({ index: range.index }).data.forEach(function (r) {
                if (count >= CONFIG.maxLines) {
                    return;
                }

                const masterId = r.getValue(c.master);
                const poId = r.getValue(c.poId);
                const itemId = r.getValue(c.item);
                const locationId = r.getValue(c.location) || '';
                const lineMemo = r.getValue(c.memo) || '';
                const ordered = Math.abs(num(r.getValue(c.quantity)));
                const received = Math.abs(num(r.getValue(c.received)));
                const billed = Math.abs(num(r.getValue(c.billed)));
                const remaining = Math.max(ordered - received, 0);
                const key = masterId + '|' + itemId + '|' + locationId;

                if (!masterId || !poId || !itemId) {
                    return;
                }

                if (!masters[masterId]) {
                    masters[masterId] = {
                        id: masterId,
                        name: r.getText(c.master) || masterId,
                        url: resolveRecordUrl(CONFIG.masterPoRecordType, masterId),
                        vendorId: r.getValue(c.vendorId) || '',
                        vendor: r.getText(c.vendor) || r.getValue(c.vendor) || '',
                        vendorUrl: resolveRecordUrl(record.Type.VENDOR, r.getValue(c.vendorId)),
                        date: '',
                        poMap: {},
                        locationMap: {},
                        groupsMap: {},
                        groups: [],
                        ordered: 0,
                        received: 0,
                        billed: 0,
                        remaining: 0
                    };
                    masterIds[masterId] = true;
                }

                const master = masters[masterId];
                master.poMap[poId] = {
                    id: poId,
                    tranid: r.getValue(c.poNumber) || poId,
                    url: resolveRecordUrl(record.Type.PURCHASE_ORDER, poId)
                };
                master.locationMap[locationId || 'none'] = r.getText(c.locationText) || r.getValue(c.locationText) || '';

                if (!master.groupsMap[key]) {
                    master.groupsMap[key] = {
                        key: key,
                        masterId: masterId,
                        itemId: itemId,
                        item: r.getText(c.item) || r.getValue(c.item) || '',
                        itemUrl: '/app/common/item/item.nl?id=' + encodeURIComponent(itemId),
                        memo: '',
                        memoMap: {},
                        locationId: locationId,
                        location: r.getText(c.locationText) || r.getValue(c.locationText) || '',
                        ordered: 0,
                        received: 0,
                        billed: 0,
                        remaining: 0,
                        refs: [],
                        useBins: false,
                        needsNumber: false,
                        needsInventoryDetail: false,
                        binOptions: [],
                        preferredBinId: ''
                    };
                    master.groups.push(master.groupsMap[key]);
                    itemIds[itemId] = true;
                    if (locationId) {
                        locationIds[locationId] = true;
                    }
                }

                const group = master.groupsMap[key];
                group.ordered += ordered;
                group.received += received;
                group.billed += billed;
                group.remaining += remaining;
                if (lineMemo) {
                    group.memoMap[lineMemo] = true;
                }
                group.refs.push({
                    poId: poId,
                    poNumber: r.getValue(c.poNumber) || poId,
                    poUrl: resolveRecordUrl(record.Type.PURCHASE_ORDER, poId),
                    line: r.getValue(c.line) || '',
                    lineKey: r.getValue(c.lineKey) || '',
                    ordered: ordered,
                    received: received,
                    billed: billed,
                    remaining: remaining
                });

                master.ordered += ordered;
                master.received += received;
                master.billed += billed;
                master.remaining += remaining;
                count += 1;
            });
        });

        const masterDetails = getMasterDetails(Object.keys(masterIds));
        const flags = getItemFlags(Object.keys(itemIds));
        const bins = getBins(Object.keys(locationIds));
        const preferred = getPreferredBins(Object.keys(itemIds));

        Object.keys(masters).forEach(function (masterId) {
            const master = masters[masterId];
            const detail = masterDetails[masterId] || {};
            master.name = detail.name || master.name;
            master.date = detail.date || '';
            master.vendorId = detail.vendorId || master.vendorId;
            master.vendor = detail.vendor || master.vendor;
            master.vendorUrl = resolveRecordUrl(record.Type.VENDOR, master.vendorId);
            master.poCount = Object.keys(master.poMap).length;
            master.locations = Object.keys(master.locationMap).map(function (id) { return master.locationMap[id]; }).filter(Boolean).join(', ');
            master.pos = Object.keys(master.poMap).map(function (poId) { return master.poMap[poId]; }).sort(function (a, b) { return Number(a.id) - Number(b.id); });
            delete master.poMap;
            delete master.locationMap;
            delete master.groupsMap;

            master.groups.forEach(function (group) {
                const itemFlags = flags[group.itemId] || {};
                const locationBins = bins[group.locationId] || [];
                const preferredBinId = preferred[group.itemId] || '';
                group.ordered = round(group.ordered);
                group.received = round(group.received);
                group.billed = round(group.billed);
                group.remaining = round(group.remaining);
                group.memo = Object.keys(group.memoMap).join(', ');
                group.isLot = !!itemFlags.isLot;
                group.isSerial = !!itemFlags.isSerial;
                group.useBins = !!itemFlags.useBins;
                group.needsNumber = group.isLot || group.isSerial;
                group.needsInventoryDetail = group.needsNumber || group.useBins;
                group.binOptions = locationBins;
                group.preferredBinId = locationBins.some(function (bin) { return String(bin.id) === String(preferredBinId); }) ? preferredBinId : '';
                group.refs.sort(function (a, b) {
                    return Number(a.poId) - Number(b.poId) || Number(a.lineKey || a.line) - Number(b.lineKey || b.line);
                });
                delete group.memoMap;
            });
        });

        log.audit({ title: 'Receiving page loaded', details: { masterCount: Object.keys(masters).length, lineCount: count } });

        return {
            masters: Object.keys(masters).map(function (id) { return masters[id]; }),
            statuses: getInventoryStatuses()
        };
    }

    function receiveItems(groups) {
        if (!groups.length) {
            throw error.create({ name: 'NO_LINES_SELECTED', message: 'Select at least one line to receive.' });
        }

        const itemIds = {};
        const liveLines = getLiveLines(groups);
        const allocationsByPo = {};
        const results = [];

        groups.forEach(function (g) { itemIds[g.itemId] = true; });
        const flags = getItemFlags(Object.keys(itemIds));

        log.audit({ title: 'Receiving submit payload', details: groups });

        groups.forEach(function (group) {
            const qty = round(num(group.qty));
            const itemFlags = flags[group.itemId] || {};
            const needsNumber = !!(itemFlags.isLot || itemFlags.isSerial);
            const useBins = !!itemFlags.useBins;
            const needsDetail = needsNumber || useBins;
            const inventory = (group.inventory || []).map(function (row) {
                return {
                    number: row.number || '',
                    bin: row.bin || '',
                    status: row.status || '',
                    expiryDate: row.expiryDate || '',
                    quantity: round(num(row.quantity))
                };
            }).filter(function (row) { return row.quantity > 0; });

            const lines = liveLines.filter(function (line) {
                return String(line.masterId) === String(group.masterId) &&
                    String(line.itemId) === String(group.itemId) &&
                    String(line.locationId || '') === String(group.locationId || '') &&
                    line.remaining > 0;
            }).sort(function (a, b) {
                return Number(a.poId) - Number(b.poId) || Number(a.lineKey || a.line) - Number(b.lineKey || b.line);
            });

            const available = round(lines.reduce(function (sum, line) { return sum + line.remaining; }, 0));
            const invQty = round(inventory.reduce(function (sum, row) { return sum + row.quantity; }, 0));

            if (qty <= 0) {
                throw error.create({ name: 'MISSING_QTY', message: 'Enter Qty To Receive for ' + group.item + '.' });
            }

            if (qty > available) {
                throw error.create({ name: 'OVER_RECEIVE', message: group.item + ' has only ' + available + ' remaining.' });
            }

            if (needsDetail) {
                if (!inventory.length || Math.abs(invQty - qty) > 0.0001) {
                    throw error.create({ name: 'INVENTORY_DETAIL_REQUIRED', message: 'Inventory detail quantity must match Qty To Receive for ' + group.item + '.' });
                }
                inventory.forEach(function (row) {
                    if (needsNumber && !row.number) {
                        throw error.create({ name: 'MISSING_NUMBER', message: 'Enter Serial/Lot Number for ' + group.item + '.' });
                    }
                    if (useBins && !row.bin) {
                        throw error.create({ name: 'MISSING_BIN', message: 'Select Bin for ' + group.item + '.' });
                    }
                    if (!row.status) {
                        throw error.create({ name: 'MISSING_STATUS', message: 'Select Inventory Status for ' + group.item + '.' });
                    }
                });
            }

            let qtyLeft = qty;
            let invIndex = 0;
            let invLeft = inventory.length ? inventory[0].quantity : 0;

            lines.forEach(function (line) {
                if (qtyLeft <= 0) {
                    return;
                }

                const receiveQty = round(Math.min(qtyLeft, line.remaining));
                const detailRows = [];
                let lineQtyLeft = receiveQty;

                while (needsDetail && lineQtyLeft > 0 && inventory[invIndex]) {
                    const take = round(Math.min(lineQtyLeft, invLeft));
                    detailRows.push({
                        number: inventory[invIndex].number,
                        bin: inventory[invIndex].bin,
                        status: inventory[invIndex].status,
                        expiryDate: inventory[invIndex].expiryDate,
                        quantity: take
                    });
                    lineQtyLeft = round(lineQtyLeft - take);
                    invLeft = round(invLeft - take);
                    if (invLeft <= 0) {
                        invIndex += 1;
                        invLeft = inventory[invIndex] ? inventory[invIndex].quantity : 0;
                    }
                }

                if (!allocationsByPo[line.poId]) {
                    allocationsByPo[line.poId] = [];
                }

                allocationsByPo[line.poId].push({
                    poId: line.poId,
                    poNumber: line.poNumber,
                    itemId: line.itemId,
                    item: line.item,
                    locationId: line.locationId,
                    line: line.line,
                    lineKey: line.lineKey,
                    quantity: receiveQty,
                    salesOrderId: line.salesOrderId || '',
                    useBins: useBins,
                    needsNumber: needsNumber,
                    needsDetail: needsDetail,
                    inventory: detailRows
                });
                qtyLeft = round(qtyLeft - receiveQty);
            });
        });

        log.audit({ title: 'Receiving allocation', details: allocationsByPo });

        Object.keys(allocationsByPo).sort(function (a, b) { return Number(a) - Number(b); }).forEach(function (poId) {
            results.push(createItemReceipt(poId, allocationsByPo[poId]));
        });

        return results;
    }

    function getLiveLines(groups) {
        const masterIds = {};
        const itemIds = {};
        const locationIds = {};
        let hasBlankLocation = false;

        groups.forEach(function (g) {
            if (g.masterId) {
                masterIds[g.masterId] = true;
            }
            if (g.itemId) {
                itemIds[g.itemId] = true;
            }
            if (g.locationId) {
                locationIds[g.locationId] = true;
            } else {
                hasBlankLocation = true;
            }
        });

        const c = {
            master: search.createColumn({ name: CONFIG.masterPoField }),
            poId: search.createColumn({ name: 'internalid' }),
            poNumber: search.createColumn({ name: 'tranid' }),
            item: search.createColumn({ name: 'item' }),
            location: search.createColumn({ name: 'location' }),
            quantity: search.createColumn({ name: 'quantity' }),
            received: search.createColumn({ name: 'quantityshiprecv' }),
            line: search.createColumn({ name: 'line' }),
            lineKey: search.createColumn({ name: 'lineuniquekey' }),
            createdFrom: search.createColumn({ name: 'createdfrom' })
        };
        const filters = [
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
            [CONFIG.masterPoField, 'anyof', Object.keys(masterIds)],
            'AND',
            ['item', 'anyof', Object.keys(itemIds)]
        ];

        if (Object.keys(locationIds).length && !hasBlankLocation) {
            filters.push('AND', ['location', 'anyof', Object.keys(locationIds)]);
        }

        const lines = [];
        const poSearch = search.create({
            type: search.Type.PURCHASE_ORDER,
            settings: [{ name: 'consolidationtype', value: 'ACCTTYPE' }],
            filters: filters,
            columns: Object.keys(c).map(function (key) { return c[key]; })
        });

        poSearch.run().each(function (r) {
            const ordered = Math.abs(num(r.getValue(c.quantity)));
            const received = Math.abs(num(r.getValue(c.received)));
            lines.push({
                masterId: r.getValue(c.master),
                poId: r.getValue(c.poId),
                poNumber: r.getValue(c.poNumber) || r.getValue(c.poId),
                itemId: r.getValue(c.item),
                item: r.getText(c.item) || r.getValue(c.item),
                locationId: r.getValue(c.location) || '',
                line: r.getValue(c.line) || '',
                lineKey: r.getValue(c.lineKey) || '',
                salesOrderId: r.getValue(c.createdFrom) || '',
                remaining: round(Math.max(ordered - received, 0))
            });
            return true;
        });

        return lines;
    }

    function createItemReceipt(poId, allocations) {
        const ir = record.transform({
            fromType: record.Type.PURCHASE_ORDER,
            fromId: poId,
            toType: record.Type.ITEM_RECEIPT,
            isDynamic: true
        });
        const allocationByLine = {};
        const allocationByItemLocation = {};
        const lineCount = ir.getLineCount({ sublistId: 'item' });
        const salesOrders = {};
      
        allocations.forEach(function (a) {
            allocationByLine[String(a.line)] = a;
            if (a.salesOrderId) {
                salesOrders[a.salesOrderId] = true;
            }
            if (a.lineKey) {
                allocationByLine[String(a.lineKey)] = a;
            }
            const key = String(a.itemId) + '|' + String(a.locationId || '');
            allocationByItemLocation[key] = allocationByItemLocation[key] || [];
            allocationByItemLocation[key].push(a);
        });

        for (let i = 0; i < lineCount; i += 1) {
            ir.selectLine({ sublistId: 'item', line: i });
            ir.setCurrentSublistValue({ sublistId: 'item', fieldId: 'itemreceive', value: false, ignoreFieldChange: true });
            ir.commitLine({ sublistId: 'item' });
        }

        for (let i = 0; i < lineCount; i += 1) {
            ir.selectLine({ sublistId: 'item', line: i });

            const orderLine = String(ir.getCurrentSublistValue({ sublistId: 'item', fieldId: 'orderline' }) || '');
            const itemId = String(ir.getCurrentSublistValue({ sublistId: 'item', fieldId: 'item' }) || '');
            const locationId = String(ir.getCurrentSublistValue({ sublistId: 'item', fieldId: 'location' }) || '');
            const itemLocationKey = itemId + '|' + locationId;
            let allocation = allocationByLine[orderLine];

            if (!allocation && allocationByItemLocation[itemLocationKey] && allocationByItemLocation[itemLocationKey].length) {
                while (allocationByItemLocation[itemLocationKey].length && allocationByItemLocation[itemLocationKey][0].used) {
                    allocationByItemLocation[itemLocationKey].shift();
                }
                allocation = allocationByItemLocation[itemLocationKey].shift();
            }

            if (!allocation || allocation.used) {
                ir.commitLine({ sublistId: 'item' });
                continue;
            }

            ir.setCurrentSublistValue({ sublistId: 'item', fieldId: 'itemreceive', value: true, ignoreFieldChange: true });
            ir.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: allocation.quantity, ignoreFieldChange: true });

            if (allocation.needsDetail) {
                const detail = ir.getCurrentSublistSubrecord({ sublistId: 'item', fieldId: 'inventorydetail' });
                allocation.inventory.forEach(function (row) {
                    detail.selectNewLine({ sublistId: 'inventoryassignment' });
                    if (allocation.needsNumber) {
                        detail.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'receiptinventorynumber', value: row.number });
                        if (row.expiryDate) {
                            const expiryDate = toDate(row.expiryDate);
                            if (expiryDate) {
                                detail.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'expirationdate', value: expiryDate });
                            }
                        }
                    }
                    if (allocation.useBins) {
                        detail.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'binnumber', value: row.bin });
                    }
                    detail.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'inventorystatus', value: row.status });
                    detail.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'quantity', value: row.quantity });
                    detail.commitLine({ sublistId: 'inventoryassignment' });
                });
            }

            allocation.used = true;
            ir.commitLine({ sublistId: 'item' });
        }

        const missing = allocations.filter(function (a) { return !a.used; });
        if (missing.length) {
            throw error.create({ name: 'IR_LINE_NOT_FOUND', message: 'Could not find matching item receipt line for PO ' + poId + '.' });
        }

        const irId = ir.save({ enableSourcing: true, ignoreMandatoryFields: false });
        const values = search.lookupFields({ type: record.Type.ITEM_RECEIPT, id: irId, columns: ['tranid'] });

        log.audit({ title: 'Item Receipt created', details: { poId: poId, itemReceiptId: irId } });

        return {
            poId: poId,
            poNumber: allocations[0].poNumber || poId,
            poUrl: resolveRecordUrl(record.Type.PURCHASE_ORDER, poId),
            itemReceiptId: irId,
            itemReceiptNumber: values.tranid || irId,
            itemReceiptUrl: resolveRecordUrl(record.Type.ITEM_RECEIPT, irId),
            salesOrderIds: Object.keys(salesOrders)
        };
    }

    function getMasterDetails(ids) {
        const out = {};
        if (!ids.length) {
            return out;
        }

        search.create({
            type: CONFIG.masterPoRecordType,
            filters: [['internalid', 'anyof', ids]],
            columns: [
                search.createColumn({ name: 'internalid' }),
                search.createColumn({ name: 'name' }),
                search.createColumn({ name: 'custrecord_cpo_date' }),
                search.createColumn({ name: 'custrecord_cpo_vendor' })
            ]
        }).run().each(function (r) {
            const id = r.getValue({ name: 'internalid' });
            const vendorId = r.getValue({ name: 'custrecord_cpo_vendor' }) || '';
            out[id] = {
                name: r.getValue({ name: 'name' }) || id,
                date: r.getValue({ name: 'custrecord_cpo_date' }) || '',
                vendorId: vendorId,
                vendor: r.getText({ name: 'custrecord_cpo_vendor' }) || vendorId
            };
            return true;
        });

        return out;
    }

    function getItemFlags(ids) {
        const out = {};
        ids.forEach(function (id) {
            try {
                const v = search.lookupFields({
                    type: search.Type.ITEM,
                    id: id,
                    columns: ['islotitem', 'isserialitem', 'usebins']
                });
                out[id] = {
                    isLot: yes(v.islotitem),
                    isSerial: yes(v.isserialitem),
                    useBins: yes(v.usebins)
                };
            } catch (ex) {
                log.debug({ title: 'Item flag lookup failed ' + id, details: ex });
                out[id] = { isLot: false, isSerial: false, useBins: false };
            }
        });
        return out;
    }

    function getBins(locationIds) {
        const out = {};
        if (!locationIds.length) {
            return out;
        }

        try {
            search.create({
                type: 'bin',
                filters: [['location', 'anyof', locationIds]],
                columns: [
                    search.createColumn({ name: 'internalid' }),
                    search.createColumn({ name: 'binnumber', sort: search.Sort.ASC }),
                    search.createColumn({ name: 'location' })
                ]
            }).run().each(function (r) {
                const locationId = r.getValue({ name: 'location' }) || '';
                out[locationId] = out[locationId] || [];
                out[locationId].push({
                    id: r.getValue({ name: 'internalid' }),
                    name: r.getValue({ name: 'binnumber' }) || r.getText({ name: 'binnumber' }) || ''
                });
                return true;
            });
        } catch (ex) {
            log.debug({ title: 'Bin lookup failed', details: ex });
        }

        return out;
    }

    function getPreferredBins(itemIds) {
        const out = {};
        if (!itemIds.length) {
            return out;
        }

        try {
            search.create({
                type: search.Type.ITEM,
                filters: [
                    ['internalid', 'anyof', itemIds],
                    'AND',
                    ['preferredbin', 'is', 'T']
                ],
                columns: [
                    search.createColumn({ name: 'internalid' }),
                    search.createColumn({ name: 'binnumber' })
                ]
            }).run().each(function (r) {
                out[r.getValue({ name: 'internalid' })] = r.getValue({ name: 'binnumber' }) || '';
                return true;
            });
        } catch (ex) {
            log.debug({ title: 'Preferred bin lookup failed', details: ex });
        }

        return out;
    }

    function getInventoryStatuses() {
        const out = [];

        try {
            search.create({
                type: 'inventorystatus',
                filters: [['isinactive', 'is', 'F']],
                columns: [
                    search.createColumn({ name: 'internalid' }),
                    search.createColumn({ name: 'name', sort: search.Sort.ASC })
                ]
            }).run().each(function (r) {
                out.push({
                    id: r.getValue({ name: 'internalid' }),
                    name: r.getValue({ name: 'name' }) || ''
                });
                return true;
            });
        } catch (ex) {
            log.debug({ title: 'Inventory status lookup failed', details: ex });
        }

        return out;
    }

    function buildHtml(vm) {
        return [
            '<style>',
            '#div__title,.uir-page-title,.uir-record-name,.uir-page-title-firstline{display:none!important}',
            '.im-master-po *{box-sizing:border-box}',
            '.im-master-po{font-family:Inter,Arial,sans-serif;color:#1f2933;margin-top:16px}',
            '.im-shell{border:1px solid #d7dde7;background:#f7f9fc;border-radius:8px;overflow:hidden}',
            '.im-topbar{position:relative;display:flex;align-items:center;justify-content:center;gap:16px;min-height:58px;padding:14px 180px;background:#ffffff;border-bottom:1px solid #d7dde7;text-align:center}',
            '.im-title{font-size:26px;font-weight:800;color:#12263f}',
            '.im-actions{position:absolute;right:16px;top:50%;transform:translateY(-50%);display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
            '.im-btn{height:32px;border:1px solid #bdc7d8;background:#fff;color:#1f2933;border-radius:6px;padding:0 12px;font-size:12px;font-weight:700;cursor:pointer}',
            '.im-btn:hover{background:#f0f4fa}',
            '.im-btn-primary{background:#1664c0;border-color:#1664c0;color:#fff}',
            '.im-btn-primary:hover{background:#0f57aa}',
            '.im-btn:disabled{opacity:.45;cursor:not-allowed}',
            '.im-alert{margin:12px 16px 0;padding:10px 12px;border-radius:6px;font-size:12px;border:1px solid #efcaca;background:#fff4f4;color:#8d1c1c}',
            '.im-metrics{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:8px;padding:12px 16px;background:#ffffff;border-bottom:1px solid #d7dde7}',
            '.im-metric{border:1px solid #dfe5ee;background:#fbfcfe;border-radius:6px;padding:8px 10px}',
            '.im-metric-label{font-size:10px;text-transform:uppercase;color:#64748b;font-weight:700;letter-spacing:0}',
            '.im-metric-value{font-size:16px;font-weight:800;color:#12263f;margin-top:2px}',
            '.im-filter-panel{display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:10px;padding:12px 16px;background:#fff;border-bottom:1px solid #d7dde7}',
            '.im-filter-cell label{display:block;font-size:11px;font-weight:800;color:#4b5565;margin-bottom:4px}',
            '.im-filter-cell input{width:100%;height:32px;border:1px solid #bdc7d8;border-radius:6px;background:#fff;padding:0 9px;font-size:12px;color:#1f2933}',
            '.im-table-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;background:#fff;border-bottom:1px solid #d7dde7}',
            '.im-table-buttons{display:flex;align-items:center;gap:8px;margin-left:auto}',
            '.im-link{color:#165ba7;font-weight:800;text-decoration:none}',
            '.im-link:hover{text-decoration:underline}',
            '.im-table-wrap{max-height:650px;overflow:auto;background:#fff}',
            '.im-table,.im-line-table{border-collapse:separate;border-spacing:0;width:100%;font-size:12px}',
            '.im-table th,.im-line-table th{position:sticky;top:0;z-index:2;background:#e8eef7;color:#24364b;border-bottom:1px solid #cad4e3;border-right:1px solid #d8e0ea;text-align:left;padding:0;white-space:nowrap}',
            '.im-table th button{width:100%;height:34px;border:0;background:transparent;text-align:left;padding:0 9px;font-size:11px;font-weight:800;color:#24364b;cursor:pointer}',
            '.im-table td,.im-line-table td{border-bottom:1px solid #e6ebf2;border-right:1px solid #edf1f6;padding:8px 9px;vertical-align:middle;background:#fff}',
            '.im-table tr:hover td{background:#f8fbff}',
            '.im-details-row td{background:#f9fbfd!important;padding:0}',
            '.im-details{padding:12px 14px 16px;overflow:auto}',
            '.im-detail-title{font-size:12px;font-weight:800;color:#12263f;margin-bottom:8px}',
            '.im-details .im-line-table{min-width:1120px}',
            '.im-dialog .im-line-table{min-width:0}',
            '.im-line-table th{position:static;padding:7px 8px;font-size:11px}',
            '.im-line-table input{height:28px;border:1px solid #bdc7d8;border-radius:5px;padding:0 7px;font-size:12px;width:92px}',
            '.im-line-table .im-qty-head{width:82px;text-align:right!important;white-space:normal!important;line-height:1.15}',
            '.im-line-table .im-qty-col{width:82px}',
            '.im-line-table input.im-qty-input{width:76px}',
            '.im-check{appearance:none;-webkit-appearance:none;width:14px!important;height:14px!important;min-width:14px;border:1px solid #9aa8ba;border-radius:4px;background:#fff;margin:0;vertical-align:middle;cursor:pointer;position:relative}',
            '.im-check:checked{background:#1664c0;border-color:#1664c0}',
            '.im-check:checked:after{content:"";position:absolute;left:4px;top:1px;width:4px;height:8px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}',
            '.im-inv-btn{display:inline-flex;align-items:center;justify-content:center;position:relative;width:' + (num(CONFIG.inventoryDetailIconWidth) + 8) + 'px;min-width:' + (num(CONFIG.inventoryDetailIconWidth) + 8) + 'px;height:' + (num(CONFIG.inventoryDetailIconHeight) + 8) + 'px;padding:0;border:0;background:transparent;border-radius:4px}',
            '.im-inv-icon{display:block;width:' + num(CONFIG.inventoryDetailIconWidth) + 'px;height:' + num(CONFIG.inventoryDetailIconHeight) + 'px;object-fit:contain}',
            '.im-inv-btn.im-filled,.im-inv-btn.im-empty-detail{background:transparent;border-color:transparent;color:inherit}',
            '.im-inv-btn.im-filled:hover,.im-inv-btn.im-empty-detail:hover{background:#f0f4fa}',
            '.im-po-cell{display:flex;align-items:center;gap:8px;font-weight:800;color:#163b63}',
            '.im-expander{width:22px;height:22px;border:1px solid #bcc9da;border-radius:5px;background:#fff;color:#19324f;font-weight:800;cursor:pointer;line-height:20px;text-align:center;padding:0}',
            '.im-badge{display:inline-flex;align-items:center;height:22px;border-radius:999px;padding:0 8px;font-size:11px;font-weight:800;border:1px solid #bfd4ed;background:#eef6ff;color:#154e86}',
            '.im-badge-muted{background:#f5f6f8;border-color:#d5dbe4;color:#667085}',
            '.im-right{text-align:right}',
            '.im-muted{color:#667085}',
            '.im-empty{padding:48px 20px;text-align:center;color:#667085;background:#fff}',
            '.im-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;background:#fff;border-top:1px solid #d7dde7;font-size:12px;color:#5b677a}',
            '.im-modal{position:fixed;inset:0;z-index:999999;display:none;align-items:center;justify-content:center;background:rgba(15,23,42,.38)}',
            '.im-modal.im-open{display:flex}',
            '.im-dialog{width:min(980px,calc(100vw - 32px));max-height:calc(100vh - 44px);overflow:auto;background:#fff;border:1px solid #c9d4e4;border-radius:8px;box-shadow:0 24px 70px rgba(15,23,42,.24)}',
            '.im-dialog-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#e8eef7;border-bottom:1px solid #cad4e3}',
            '.im-dialog-title{font-size:14px;font-weight:800;color:#12263f}',
            '.im-dialog-body{padding:14px}',
            '.im-inv-grid{display:grid;grid-template-columns:repeat(5,minmax(120px,1fr));gap:8px;align-items:end}',
            '.im-inv-field label{display:block;font-size:11px;font-weight:800;color:#4b5565;margin-bottom:4px}',
            '.im-inv-field input,.im-inv-field select{width:100%;height:32px;border:1px solid #bdc7d8;border-radius:6px;background:#fff;padding:0 9px;font-size:12px;color:#1f2933}',
            '.im-dialog-actions{display:flex;justify-content:flex-end;gap:8px;padding:12px 14px;border-top:1px solid #d7dde7}',
            '.im-progress-card{width:min(380px,calc(100vw - 32px));border:1px solid #c9d4e4;background:#fff;border-radius:8px;box-shadow:0 24px 70px rgba(15,23,42,.24);padding:22px}',
            '.im-progress-title{font-size:15px;font-weight:800;color:#12263f;text-align:center}',
            '.im-progress-subtitle{font-size:12px;color:#667085;text-align:center;margin-top:6px}',
            '.im-progress-track{height:10px;overflow:hidden;border-radius:999px;background:#e6edf6;margin-top:18px}',
            '.im-progress-bar{height:100%;width:45%;border-radius:999px;background:#1664c0;animation:imProgress 1.05s ease-in-out infinite}',
            '@keyframes imProgress{0%{transform:translateX(-120%)}50%{transform:translateX(80%)}100%{transform:translateX(240%)}}',
            '@media(max-width:1100px){.im-filter-panel,.im-inv-grid{grid-template-columns:repeat(3,minmax(120px,1fr))}}',
            '@media(max-width:900px){.im-metrics{grid-template-columns:repeat(2,minmax(120px,1fr))}.im-topbar{padding:14px 16px;flex-direction:column}.im-actions{position:static;transform:none}.im-footer,.im-table-actions{align-items:flex-start;flex-direction:column}.im-filter-panel,.im-inv-grid{grid-template-columns:repeat(2,minmax(120px,1fr))}.im-table-wrap{max-height:560px}}',
            '</style>',
            '<div class="im-modal" id="im-progress"><div class="im-progress-card"><div class="im-progress-title">Receiving Items</div><div class="im-progress-subtitle">Please wait while NetSuite creates Item Receipts.</div><div class="im-progress-track"><div class="im-progress-bar"></div></div></div></div>',
            '<div class="im-modal" id="im-inv-modal"></div>',
            '<div class="im-modal" id="im-result-modal"></div>',
            '<div class="im-master-po"><div class="im-shell">',
            '<div class="im-topbar"><div class="im-title">' + esc(CONFIG.pageTitle) + '</div><div class="im-actions"><button type="button" class="im-btn im-btn-primary" id="im-receive" disabled>Receive</button></div></div>',
            vm.message ? '<div class="im-alert">' + esc(vm.message) + '</div>' : '',
            '<div class="im-filter-panel">',
            '<div class="im-filter-cell"><label>Master PO</label><input id="f-master" list="dl-master" placeholder="Enter or select Master PO"><datalist id="dl-master"></datalist></div>',
            '<div class="im-filter-cell"><label>Vendor</label><input id="f-vendor" list="dl-vendor" placeholder="Enter or select vendor"><datalist id="dl-vendor"></datalist></div>',
            '<div class="im-filter-cell"><label>PO Number</label><input id="f-po" list="dl-po" placeholder="Enter or select PO"><datalist id="dl-po"></datalist></div>',
            '<div class="im-filter-cell"><label>Location</label><input id="f-location" list="dl-location" placeholder="Enter or select location"><datalist id="dl-location"></datalist></div>',
            '<div class="im-filter-cell"><label>Date From</label><input id="f-date-from" type="date"></div>',
            '<div class="im-filter-cell"><label>Date To</label><input id="f-date-to" type="date"></div>',
            '</div>',
            '<div class="im-metrics"><div class="im-metric"><div class="im-metric-label">No. of Master POs</div><div class="im-metric-value" id="m-count">0</div></div><div class="im-metric"><div class="im-metric-label">Selected Lines</div><div class="im-metric-value" id="m-selected">0</div></div><div class="im-metric"><div class="im-metric-label">Qty To Receive</div><div class="im-metric-value" id="m-qty">0</div></div><div class="im-metric"><div class="im-metric-label">Remaining Qty</div><div class="im-metric-value" id="m-remain">0</div></div></div>',
            '<div class="im-table-actions"><div class="im-muted" id="im-warning"></div><div class="im-table-buttons"><button type="button" class="im-btn" id="im-mark">Mark All</button><button type="button" class="im-btn" id="im-unmark">Unmark All</button><button type="button" class="im-btn" id="im-reset">Reset Filters</button></div></div>',
            '<div class="im-table-wrap"><table class="im-table"><thead><tr><th style="width:48px"></th><th style="width:180px"><button type="button" data-sort="name">Master PO</button></th><th style="width:230px"><button type="button" data-sort="vendor">Vendor</button></th><th style="width:110px"><button type="button" data-sort="date">Date</button></th><th style="width:110px"><button type="button" data-sort="poCount">POs</button></th><th style="width:230px"><button type="button" data-sort="locations">Locations</button></th><th style="width:130px"><button type="button" data-sort="remaining">Remaining Qty</button></th></tr></thead><tbody id="im-body"></tbody></table><div class="im-empty" id="im-empty" style="display:none">No Master POs match the current filters.</div></div>',
            '<div class="im-footer"><div>Loaded ' + vm.data.length + ' Master POs.</div><div>Expand a Master PO, enter Qty To Receive, then add inventory detail when required.</div></div>',
            '</div></div>',
            '<script>',
            '(function(){',
            'var masters=' + safeJson(vm.data) + ';',
            'var statuses=' + safeJson(vm.statuses) + ';',
            'var results=' + safeJson(vm.result) + ';',
            'var suiteletUrl=' + safeJson(vm.suiteletUrl || '') + ';',
            'var inventoryIconNotFilled=' + safeJson(CONFIG.inventoryDetailIconNotFilled) + ';',
            'var inventoryIconFilled=' + safeJson(CONFIG.inventoryDetailIconFilled) + ';',
            'var state={expanded:{},selected:{},qty:{},details:{},sort:"date",dir:"desc",modalKey:"",filters:{master:null,vendor:null,po:null,location:null,dateFrom:"",dateTo:""}};',
            'var body=document.getElementById("im-body"),empty=document.getElementById("im-empty"),receiveBtn=document.getElementById("im-receive"),warning=document.getElementById("im-warning");',
            'function esc(v){return String(v==null?"":v).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]||c;});}',
            'function num(v){var n=parseFloat(String(v||"0").replace(/,/g,""));return isFinite(n)?n:0;}',
            'function roundQty(v){return Math.round(num(v)*10000)/10000;}',
            'function fmt(v){return num(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});}',
            'function link(u,t){return u?"<a class=\\"im-link\\" target=\\"_blank\\" href=\\""+esc(u)+"\\">"+esc(t)+"</a>":esc(t);}',
            'function icon(src){return "<img class=\\"im-inv-icon\\" src=\\""+esc(src)+"\\" alt=\\"\\">";}',
            'function option(id,name){return {id:String(id||""),name:String(name||id||"")};}',
            'function optVal(o){return String(o.id||"")+"|"+String(o.name||"");}',
            'function dataValue(el,name){while(el&&el!==document){if(el.getAttribute&&el.getAttribute(name)!=null)return el.getAttribute(name);el=el.parentNode;}return null;}',
            'function invQtySum(key){return roundQty((state.details[key]||[]).reduce(function(t,r){return t+num(r.quantity);},0));}',
            'function checkLineQty(key,field){var g=groupByKey(key),q=num(state.qty[key]);if(g&&q>num(g.remaining)){alert("Cannot receive more than what is remaining.");state.qty[key]=String(g.remaining);if(field)field.value=g.remaining;return false;}return true;}',
            'function writeList(id,opts){var seen={},html="";opts.forEach(function(o){var k=optVal(o);if(!seen[k]&&o.name){seen[k]=true;html+="<option value=\\""+esc(o.name)+"\\"></option>";}});document.getElementById(id).innerHTML=html;}',
            'function makeOptions(){var master=[],vendor=[],po=[],loc=[];masters.forEach(function(m){master.push(option(m.id,m.name));vendor.push(option(m.vendorId,m.vendor));(m.pos||[]).forEach(function(p){po.push(option(p.id,p.tranid));});(m.groups||[]).forEach(function(g){loc.push(option(g.locationId,g.location));});});writeList("dl-master",master);writeList("dl-vendor",vendor);writeList("dl-po",po);writeList("dl-location",loc);window.imOpts={master:master,vendor:vendor,po:po,location:loc};}',
            'function exact(inputId,opts){var text=String(document.getElementById(inputId).value||"").replace(/^\\s+|\\s+$/g,"");if(!text)return null;for(var i=0;i<opts.length;i++){if(opts[i].name===text||String(opts[i].id)===text)return opts[i];}return false;}',
            'function readFilters(){state.filters.master=exact("f-master",window.imOpts.master);state.filters.vendor=exact("f-vendor",window.imOpts.vendor);state.filters.po=exact("f-po",window.imOpts.po);state.filters.location=exact("f-location",window.imOpts.location);state.filters.dateFrom=document.getElementById("f-date-from").value;state.filters.dateTo=document.getElementById("f-date-to").value;}',
            'function parseDate(v){var s=String(v||"");var i=s.match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);if(i)return new Date(+i[1],+i[2]-1,+i[3]).getTime();var u=s.match(/^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})$/);if(u)return new Date(+u[3],+u[1]-1,+u[2]).getTime();return null;}',
            'function match(m){var f=state.filters;if(f.master&&String(m.id)!==String(f.master.id))return false;if(f.vendor&&String(m.vendorId)!==String(f.vendor.id))return false;if(f.po&&!(m.pos||[]).some(function(p){return String(p.id)===String(f.po.id);}))return false;if(f.location&&!(m.groups||[]).some(function(g){return String(g.locationId)===String(f.location.id);}))return false;var d=parseDate(m.date),df=parseDate(f.dateFrom),dt=parseDate(f.dateTo);if(df!==null&&(d===null||d<df))return false;if(dt!==null&&(d===null||d>dt))return false;return true;}',
            'function rows(){var r=masters.filter(match);r.sort(function(a,b){var av=a[state.sort],bv=b[state.sort];if(["poCount","remaining"].indexOf(state.sort)>=0){return (state.dir==="asc"?1:-1)*(num(av)-num(bv));}av=String(av||"").toLowerCase();bv=String(bv||"").toLowerCase();return av===bv?0:(av>bv?1:-1)*(state.dir==="asc"?1:-1);});return r;}',
            'function render(){readFilters();var list=rows();body.innerHTML="";empty.style.display=list.length?"none":"block";list.forEach(function(m){body.appendChild(masterRow(m));if(state.expanded[m.id])body.appendChild(detailRow(m));});metrics(list);}',
            'function masterRow(m){var tr=document.createElement("tr");tr.innerHTML="<td><button type=\\"button\\" class=\\"im-expander\\" data-expand=\\""+esc(m.id)+"\\">"+(state.expanded[m.id]?"-":"+")+"</button></td><td>"+link(m.url,m.name)+"</td><td>"+link(m.vendorUrl,m.vendor)+"</td><td>"+esc(m.date)+"</td><td class=\\"im-right\\">"+esc(m.poCount)+"</td><td>"+esc(m.locations)+"</td><td class=\\"im-right\\">"+fmt(m.remaining)+"</td>";return tr;}',
            'function detailRow(m){var tr=document.createElement("tr");tr.className="im-details-row";var td=document.createElement("td");td.colSpan=7;var html="<div class=\\"im-details\\"><div class=\\"im-detail-title\\">Receiving lines for "+esc(m.name)+"</div><table class=\\"im-line-table\\"><thead><tr><th style=\\"width:34px;text-align:center\\">Sel</th><th style=\\"min-width:220px\\">Item</th><th style=\\"min-width:190px\\">Line Memo</th><th style=\\"min-width:140px\\">Location</th><th class=\\"im-qty-head\\">Quantity</th><th class=\\"im-qty-head\\">Quantity<br>Received</th><th class=\\"im-qty-head\\">Quantity<br>Billed</th><th class=\\"im-qty-head\\">Quantity<br>Remaining</th><th class=\\"im-qty-head\\">Quantity<br>to Receive</th><th style=\\"width:74px;text-align:center\\">Detail</th></tr></thead><tbody>";(m.groups||[]).forEach(function(g){var d=state.details[g.key]||[],invClass=d.length?" im-filled":" im-empty-detail",title=d.length?"Inventory Detail Added":"Add Inventory Detail",iconHtml=icon(d.length?inventoryIconFilled:inventoryIconNotFilled);html+="<tr><td style=\\"text-align:center\\"><input class=\\"im-check\\" type=\\"checkbox\\" data-check=\\""+esc(g.key)+"\\" "+(state.selected[g.key]?"checked":"")+"></td><td>"+link(g.itemUrl,g.item)+"</td><td>"+esc(g.memo||"")+"</td><td>"+esc(g.location)+"</td><td class=\\"im-right im-qty-col\\">"+fmt(g.ordered)+"</td><td class=\\"im-right im-qty-col\\">"+fmt(g.received)+"</td><td class=\\"im-right im-qty-col\\">"+fmt(g.billed)+"</td><td class=\\"im-right im-qty-col\\">"+fmt(g.remaining)+"</td><td class=\\"im-qty-col\\"><input class=\\"im-qty-input\\" type=\\"number\\" min=\\"0\\" step=\\"0.0001\\" data-qty=\\""+esc(g.key)+"\\" value=\\""+esc(state.qty[g.key]||"")+"\\"></td><td style=\\"text-align:center\\">"+(g.needsInventoryDetail?"<button type=\\"button\\" class=\\"im-btn im-inv-btn"+invClass+"\\" title=\\""+title+"\\" aria-label=\\""+title+"\\" data-inv=\\""+esc(g.key)+"\\">"+iconHtml+"</button>":"<span class=\\"im-badge im-badge-muted\\">&#8212;</span>")+"</td></tr>";});td.innerHTML=html+"</tbody></table></div>";tr.appendChild(td);return tr;}',
            'function groupByKey(key){for(var i=0;i<masters.length;i++){for(var j=0;j<(masters[i].groups||[]).length;j++){if(masters[i].groups[j].key===key)return masters[i].groups[j];}}return null;}',
            'function metrics(list){var selected=Object.keys(state.selected),qty=0,remain=0;list.forEach(function(m){remain+=num(m.remaining);});selected.forEach(function(k){qty+=num(state.qty[k]);});document.getElementById("m-count").textContent=list.length;document.getElementById("m-selected").textContent=selected.length;document.getElementById("m-qty").textContent=fmt(qty);document.getElementById("m-remain").textContent=fmt(remain);receiveBtn.disabled=!selected.length;}',
            'function showInv(key){var g=groupByKey(key),lineQty=num(state.qty[key]);if(!g||!g.needsInventoryDetail)return;if(lineQty<=0){alert("Please fill the Qty To Receive first.");return;}if(!checkLineQty(key)){render();return;}state.modalKey=key;var rows=state.details[key]||[];var modal=document.getElementById("im-inv-modal");var binOptions=(g.binOptions||[]).map(function(b){return "<option value=\\""+esc(b.id)+"\\" "+(String(b.id)===String(g.preferredBinId)?"selected":"")+">"+esc(b.name)+"</option>";}).join("");var statusOptions=statuses.map(function(s){return "<option value=\\""+esc(s.id)+"\\">"+esc(s.name)+"</option>";}).join("");var numberFields=g.needsNumber?"<div class=\\"im-inv-field\\"><label>Serial/Lot Number</label><input id=\\"inv-number\\"></div><div class=\\"im-inv-field\\"><label>Expiry Date</label><input id=\\"inv-expiry\\" type=\\"date\\"></div>":"";var binField=g.useBins?"<div class=\\"im-inv-field\\"><label>Bin</label><select id=\\"inv-bin\\"><option value=\\"\\"></option>"+binOptions+"</select></div>":"";var numberHead=g.needsNumber?"<th>Serial/Lot</th><th>Expiry Date</th>":"",binHead=g.useBins?"<th>Bin</th>":"";var tableRows=rows.map(function(r,i){return "<tr>"+(g.needsNumber?"<td>"+esc(r.number)+"</td><td>"+esc(r.expiryDate||"")+"</td>":"")+(g.useBins?"<td>"+esc(r.binText||"")+"</td>":"")+"<td>"+esc(r.statusText||"")+"</td><td class=\\"im-right\\">"+fmt(r.quantity)+"</td><td><button type=\\"button\\" class=\\"im-btn\\" data-remove-inv=\\""+i+"\\">Remove</button></td></tr>";}).join("");modal.innerHTML="<div class=\\"im-dialog\\"><div class=\\"im-dialog-head\\"><div class=\\"im-dialog-title\\">Inventory Detail - "+esc(g.item)+"</div><button type=\\"button\\" class=\\"im-btn\\" id=\\"im-inv-x\\">Close</button></div><div class=\\"im-dialog-body\\"><div class=\\"im-inv-grid\\">"+numberFields+binField+"<div class=\\"im-inv-field\\"><label>Status</label><select id=\\"inv-status\\"><option value=\\"\\"></option>"+statusOptions+"</select></div><div class=\\"im-inv-field\\"><label>Quantity</label><input id=\\"inv-qty\\" type=\\"number\\" min=\\"0\\" step=\\"0.0001\\"></div><div><button type=\\"button\\" class=\\"im-btn im-btn-primary\\" id=\\"inv-add\\">Add Row</button></div></div><table class=\\"im-line-table\\" style=\\"margin-top:12px\\"><thead><tr>"+numberHead+binHead+"<th>Status</th><th class=\\"im-right\\">Qty</th><th></th></tr></thead><tbody>"+tableRows+"</tbody></table></div><div class=\\"im-dialog-actions\\"><button type=\\"button\\" class=\\"im-btn\\" id=\\"inv-cancel\\">Cancel</button><button type=\\"button\\" class=\\"im-btn im-btn-primary\\" id=\\"inv-ok\\">OK</button></div></div>";modal.className="im-modal im-open";}',
            'function addInvRow(){var g=groupByKey(state.modalKey),rows=state.details[state.modalKey]||[],numberEl=document.getElementById("inv-number"),expiryEl=document.getElementById("inv-expiry"),binEl=document.getElementById("inv-bin"),statusEl=document.getElementById("inv-status"),qtyEl=document.getElementById("inv-qty");var q=roundQty(qtyEl&&qtyEl.value),lineQty=num(state.qty[state.modalKey]),current=invQtySum(state.modalKey),number=numberEl?String(numberEl.value||"").replace(/^\\s+|\\s+$/g,""):"",expiry=expiryEl?expiryEl.value:"",bin=binEl?binEl.value:"",binText=binEl&&binEl.selectedIndex>=0?binEl.options[binEl.selectedIndex].text:"",status=statusEl?statusEl.value:"",statusText=statusEl&&statusEl.selectedIndex>=0?statusEl.options[statusEl.selectedIndex].text:"";if(lineQty<=0){alert("Please fill the Qty To Receive first.");return;}if(g.needsNumber&&!number){alert("Enter Serial/Lot Number.");return;}if(g.useBins&&!bin){alert("Select Bin.");return;}if(!status){alert("Select Status.");return;}if(q<=0){alert("Enter Quantity.");return;}if(roundQty(current+q)>roundQty(lineQty)+0.0001){alert("Inventory detail quantity cannot be more than Qty To Receive.");return;}if(g.needsNumber){for(var i=0;i<rows.length;i++){if(String(rows[i].number||"").toLowerCase()===number.toLowerCase()){if(!confirm("This lot number already exists. Click OK to merge and add the quantity."))return;rows[i].quantity=roundQty(num(rows[i].quantity)+q);if(!rows[i].expiryDate)rows[i].expiryDate=expiry;if(g.useBins&&!rows[i].bin){rows[i].bin=bin;rows[i].binText=binText;}if(!rows[i].status){rows[i].status=status;rows[i].statusText=statusText;}state.details[state.modalKey]=rows;state.selected[state.modalKey]=true;showInv(state.modalKey);return;}}}rows.push({number:number,expiryDate:expiry,bin:bin,binText:binText,status:status,statusText:statusText,quantity:q});state.details[state.modalKey]=rows;state.selected[state.modalKey]=true;showInv(state.modalKey);}',
            'function closeInv(save){var key=state.modalKey;if(save&&key){var lineQty=num(state.qty[key]),sum=invQtySum(key);if(lineQty<=0){alert("Please fill the Qty To Receive first.");return;}if(Math.abs(sum-lineQty)>0.0001){alert("Inventory detail quantity must match Qty To Receive.");return;}state.selected[key]=true;}document.getElementById("im-inv-modal").className="im-modal";state.modalKey="";render();}',
            'function validate(){var out=[];Object.keys(state.selected).forEach(function(key){var g=groupByKey(key),qty=num(state.qty[key]),details=state.details[key]||[],sum=details.reduce(function(t,r){return t+num(r.quantity);},0);if(!g)return;if(qty<=0)out.push("Enter Qty To Receive for "+g.item+".");if(qty>num(g.remaining))out.push(g.item+" has only "+fmt(g.remaining)+" remaining.");if(g.needsInventoryDetail&&Math.abs(sum-qty)>0.0001)out.push("Inventory detail quantity must match Qty To Receive for "+g.item+".");});return out;}',
            'function getField(name){return document.getElementById(name)||(document.forms[0]&&document.forms[0].elements?document.forms[0].elements[name]:null);}',
            'function getSuiteletForm(){return (receiveBtn&&receiveBtn.form)||document.getElementById("main_form")||document.forms[0]||null;}',
            'function writeFormValue(form,name,value){var field=getField(name)||(form&&form.elements?form.elements[name]:null);if(!field&&form){field=document.createElement("input");field.type="hidden";field.id=name;field.name=name;form.appendChild(field);}if(field)field.value=value;return field;}',
            'function ensurePostForm(){var form=getSuiteletForm();if(!form){form=document.createElement("form");form.method="post";form.action=suiteletUrl||window.location.href;document.body.appendChild(form);}if(!form.method||String(form.method).toLowerCase()!=="post")form.method="post";if(suiteletUrl)form.action=suiteletUrl;return form;}',
            'function showProgress(){document.getElementById("im-progress").className="im-modal im-open";receiveBtn.disabled=true;receiveBtn.textContent="Receiving...";}',
            'function hideProgress(){document.getElementById("im-progress").className="im-modal";receiveBtn.disabled=false;receiveBtn.textContent="Receive";}',
            'function submitForm(form){if(window.HTMLFormElement&&HTMLFormElement.prototype.submit){HTMLFormElement.prototype.submit.call(form);return;}form.submit();}',
            'function submitReceive(){var errors=validate();if(errors.length){alert(errors.join("\\n"));return;}var groups=Object.keys(state.selected).map(function(key){var g=groupByKey(key);return {masterId:g.masterId,itemId:g.itemId,item:g.item,locationId:g.locationId,location:g.location,qty:num(state.qty[key]),refs:g.refs,inventory:state.details[key]||[]};});showProgress();window.setTimeout(function(){try{var form=ensurePostForm();writeFormValue(form,"custpage_receive_payload",JSON.stringify({groups:groups}));submitForm(form);}catch(ex){hideProgress();alert("Could not submit the receiving request: "+(ex&&ex.message?ex.message:ex));}},60);}',
            'function showResult(){if(!results.length)return;var rows=results.map(function(r){return "<tr><td>"+link(r.poUrl,r.poNumber)+"</td><td>"+link(r.itemReceiptUrl,r.itemReceiptNumber)+"</td></tr>";}).join("");var modal=document.getElementById("im-result-modal");modal.innerHTML="<div class=\\"im-dialog\\"><div class=\\"im-dialog-head\\"><div class=\\"im-dialog-title\\">Item Receipts Created</div></div><div class=\\"im-dialog-body\\"><table class=\\"im-line-table\\"><thead><tr><th>Purchase Order</th><th>Item Receipt</th></tr></thead><tbody>"+rows+"</tbody></table></div><div class=\\"im-dialog-actions\\"><button type=\\"button\\" class=\\"im-btn im-btn-primary\\" id=\\"result-ok\\">OK</button></div></div>";modal.className="im-modal im-open";}',
            'function callSalesOrderAllocation(){var called={};results.forEach(function(r){(r.salesOrderIds||[]).forEach(function(soId){if(!soId||called[soId])return;called[soId]=true;var frame=document.createElement("iframe");frame.style.display="none";frame.src="/app/accounting/transactions/salesord.nl?_execute_action_=allocatesalesorder&id="+encodeURIComponent(soId);document.body.appendChild(frame);});});}',
            'body.addEventListener("click",function(e){var exp=dataValue(e.target,"data-expand"),inv=dataValue(e.target,"data-inv");if(exp){state.expanded[exp]=!state.expanded[exp];render();}if(inv){showInv(inv);}});',
            'body.addEventListener("change",function(e){var k=e.target.getAttribute("data-check"),q=e.target.getAttribute("data-qty");if(k){if(e.target.checked)state.selected[k]=true;else delete state.selected[k];render();}if(q){state.qty[q]=e.target.value;if(!checkLineQty(q,e.target)){if(warning)warning.textContent="Cannot receive more than what is remaining.";}else if((state.details[q]||[]).length&&Math.abs(invQtySum(q)-num(state.qty[q]))>0.0001){alert("Inventory detail quantity must match Qty To Receive. Please update inventory detail.");}render();}});',
            'body.addEventListener("input",function(e){var k=e.target.getAttribute("data-qty");if(k){var g=groupByKey(k);state.qty[k]=e.target.value;if(num(e.target.value)>0){state.selected[k]=true;var row=e.target.parentNode&&e.target.parentNode.parentNode;var check=row?row.querySelector("[data-check]"):null;if(check)check.checked=true;}if(warning)warning.textContent=g&&num(e.target.value)>num(g.remaining)?"Cannot receive more than what is remaining.":"";metrics(rows());}});',
            'document.getElementById("im-inv-modal").addEventListener("click",function(e){var rem=dataValue(e.target,"data-remove-inv");if(e.target.id==="im-inv-x"||e.target.id==="inv-cancel")closeInv(false);if(e.target.id==="inv-add")addInvRow();if(e.target.id==="inv-ok")closeInv(true);if(rem!=null){(state.details[state.modalKey]||[]).splice(Number(rem),1);showInv(state.modalKey);}});',
            'document.getElementById("im-result-modal").addEventListener("click",function(e){if(e.target.id==="result-ok")document.getElementById("im-result-modal").className="im-modal";});',
            '[].slice.call(document.querySelectorAll("[data-sort]")).forEach(function(b){b.addEventListener("click",function(){var s=b.getAttribute("data-sort");if(state.sort===s)state.dir=state.dir==="asc"?"desc":"asc";else{state.sort=s;state.dir="asc";}render();});});',
            '["f-master","f-vendor","f-po","f-location"].forEach(function(id){var el=document.getElementById(id);el.addEventListener("input",function(){var key=id.replace("f-","");if(el.value===""||exact(id,window.imOpts[key]))render();});el.addEventListener("change",function(){if(el.value===""||exact(id,window.imOpts[id.replace("f-","")]))render();});});',
            '["f-date-from","f-date-to"].forEach(function(id){document.getElementById(id).addEventListener("input",render);});',
            'document.getElementById("im-reset").addEventListener("click",function(){["f-master","f-vendor","f-po","f-location","f-date-from","f-date-to"].forEach(function(id){document.getElementById(id).value="";});render();});',
            'document.getElementById("im-mark").addEventListener("click",function(){rows().forEach(function(m){(m.groups||[]).forEach(function(g){state.selected[g.key]=true;});});render();});',
            'document.getElementById("im-unmark").addEventListener("click",function(){state.selected={};render();});',
            'receiveBtn.addEventListener("click",submitReceive);',
            'makeOptions();render();callSalesOrderAllocation();showResult();',
            '}());',
            '</script>'
        ].join('');
    }

    function resolveRecordUrl(type, id) {
        if (!id) {
            return '';
        }

        try {
            return url.resolveRecord({ recordType: type, recordId: id, isEditMode: false });
        } catch (ex) {
            return '';
        }
    }

    function yes(value) {
        return value === true || value === 'T' || value === 'true';
    }

    function num(value) {
        const n = parseFloat(String(value || '0').replace(/,/g, ''));
        return Number.isFinite(n) ? n : 0;
    }

    function round(value) {
        return Math.round(num(value) * 10000) / 10000;
    }

    function toDate(value) {
        const text = String(value || '');
        const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        const ns = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

        if (iso) {
            return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
        }
        if (ns) {
            return new Date(Number(ns[3]), Number(ns[1]) - 1, Number(ns[2]));
        }
        return null;
    }

    function esc(value) {
        return String(value || '').replace(/[&<>"]/g, function (ch) {
            return {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;'
            }[ch];
        });
    }

    function safeJson(value) {
        return JSON.stringify(value || null).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
    }

    return {
        onRequest: onRequest
    };
});
