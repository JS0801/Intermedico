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
 *
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope Public
 * @changeLog:   1.0       17 July 2026       Manuel Teodoro       Initial version
 * @changeLog:   1.1       21 July 2026       Manuel Teodoro       Use SuiteQL for schedule expansion and line reconciliation
 * @changeLog:   1.2       21 July 2026       Manuel Teodoro       Apply Price Rule charge values and protect picked or packed lines
 * @changeLog:   1.3       21 July 2026       Manuel Teodoro       Audit available Sales Order fulfillment protection fields
 * @changeLog:   1.4       21 July 2026       Manuel Teodoro       Protect every Sales Order line linked to an Item Fulfillment
 * @changeLog:   1.5       21 July 2026       Manuel Teodoro       Read Item Fulfillment order-line values to protect Sales Order lines
 * @changeLog:   1.6       10 August 2026     Manuel Teodoro       Apply Schedule Sales Channel and Create PO for Sequester Orders
 * @changeLog:   1.7       28 August 2026     Manuel Teodoro       Configure the Sequester Sales Channel through a company-level script parameter
 * @changeLog:   1.8       01 September 2026  Manuel Teodoro       Initialize new Sales Orders with the customer to source required header defaults
 *
 */
define(function (require)
{
    const format = require('N/format');
    const query = require('N/query');
    const record = require('N/record');
    const runtime = require('N/runtime');
    const blanketSchedule = require('./NSTS_MD_BlanketSchedule');
    const commonLibrary = require('../library/NSTS_MD_CommonLibrary');

    const FIELD = Object.assign({}, blanketSchedule.CONSTANTS.field, {
        salesOrder: 'custrecord_ns_bs_sales_order',
        status: 'custrecord_ns_bs_status',
        taskId: 'custrecord_ns_bs_task_id',
        lastError: 'custrecord_ns_bs_last_error',
        lastGenerated: 'custrecord_ns_bs_last_generated',
        blanketOrder: 'custbody_ns_bso_order',
        blanketSchedule: 'custbody_ns_bso_schedule',
        salesChannel: 'saleschannel',
        scheduleSalesChannel: 'custrecord_ns_bs_sales_channel',
        sequesterSalesChannel: 'custscript_ns_mr_bs_sequester_channel',
        createPurchaseOrder: 'createpo',
        toBeEmailed: 'tobeemailed',
        blanketStartDate: 'custbody_ns_bso_start_date',
        blanketEndDate: 'custbody_ns_bso_end_date',
        blanketPriceRefresh: 'custbody_ns_bso_price_refresh',
        generated: 'custcol_ns_bso_generated',
        itemSchedule: 'custcol_ns_bso_item_schedule',
        occurrenceKey: 'custcol_ns_bso_occurrence_key',
        deliveryDate: 'custcol_ns_bso_delivery_date',
        originalDeliveryDate: 'custcol_ns_bso_orig_delivery_date',
        revision: 'custcol_ns_bso_revision',
        priceLevel: 'price',
        rate: 'rate',
        priceRule: 'custcol_ns_price_rule',
        freight: 'custcol_ns_freight',
        handling: 'custcol_ns_handling',
        dangerousGoods: 'custcol_ns_dangerous_goods',
        dryIce: 'custcol_ns_dryice',
        minimumOrderCharge: 'custcol_ns_min_order_charge',
        minimumOrderValue: 'custcol_ns_min_order_value',
        fulfillmentStatusLine: 'shiprecvstatusline'
    });
    const HEADER_TYPE = 'customrecord_ns_blanket_schedule';
    const ITEM_SUBLIST = 'item';
    const PRICE_RULE_FIELD_IDS = [
        FIELD.rate,
        FIELD.priceRule,
        FIELD.freight,
        FIELD.handling,
        FIELD.dangerousGoods,
        FIELD.dryIce,
        FIELD.minimumOrderCharge,
        FIELD.minimumOrderValue
    ];
    const PRICE_RULE_PARAMETER = {
        priceRuleSearch: 'custscript_ns_cs_mpr_price_rule_search'
    };

    const EntryPoint = {};
    const Helper = {};

    // Entry Points
    EntryPoint.getInputData = () =>
    {
        let stLogTitle = 'getInputData';
        log.debug(stLogTitle);

        const headerId = runtime.getCurrentScript().getParameter({
            name: 'custscript_ns_mr_bs_header_id'
        });
        return headerId ? [String(headerId)] : [];
    };

    EntryPoint.map = (mapContext) =>
    {
        let stLogTitle = 'map';
        log.debug(stLogTitle);

        try
        {
            const result = Helper.syncOrder(JSON.parse(mapContext.value));
            mapContext.write({ key: String(result.headerId), value: JSON.stringify(result.counts) });
        }
        catch (error)
        {
            const headerId = JSON.parse(mapContext.value);
            Helper.updateHeaderError(headerId, error);
            log.error(stLogTitle, error);
            throw error;
        }
    };

    EntryPoint.summarize = (summaryContext) =>
    {
        let stLogTitle = 'summarize';
        const totals = {
            created: 0,
            updated: 0,
            closed: 0,
            duplicate: 0,
            protectedSkipped: 0,
            failed: 0
        };

        summaryContext.output.iterator().each((key, value) =>
        {
            const counts = JSON.parse(value);
            Object.keys(totals).forEach((countKey) =>
            {
                totals[countKey] += Number(counts[countKey] || 0);
            });
            return true;
        });

        summaryContext.mapSummary.errors.iterator().each((key, error) =>
        {
            totals.failed += 1;
            log.error(`Blanket Line Sync ${key}`, error);
            return true;
        });

        log.audit(stLogTitle, {
            usage: summaryContext.usage,
            yields: summaryContext.yields,
            created: totals.created,
            updated: totals.updated,
            closed: totals.closed,
            duplicate: totals.duplicate,
            protectedSkipped: totals.protectedSkipped,
            failed: totals.failed
        });
    };

    // Subfunctions
    Helper.syncOrder = (headerId) =>
    {
        let stLogTitle = 'syncOrder';
        log.debug(stLogTitle);

        const header = record.load({ type: HEADER_TYPE, id: headerId });
        const headerValues = Helper.getHeaderValues(header);
        const itemSchedules = Helper.getItemSchedules(headerId);
        const desiredLines = blanketSchedule.buildDesiredLines(headerValues, itemSchedules);
        const itemScheduleById = {};

        itemSchedules.forEach((itemSchedule) =>
        {
            itemScheduleById[itemSchedule.id] = itemSchedule;
        });

        desiredLines.forEach((desiredLine) =>
        {
            desiredLine.revision = headerValues.revision;
            desiredLine.salesChannel = headerValues.salesChannel;
            desiredLine.sequesterSalesChannel = headerValues.sequesterSalesChannel;
            desiredLine.itemName = (itemScheduleById[desiredLine.itemScheduleId] || {}).itemName;
        });
        // CHANGE 1.2: Resolve every unique item once, then carry Price Rule values directly
        // onto generated Sales Order lines. This avoids relying on User Event execution alone.
        Helper.applyPriceRulesToDesiredLines(desiredLines, headerValues.customer);
        Helper.sortDesiredLines(desiredLines);
        const orderId = header.getValue({ fieldId: FIELD.salesOrder });
        const order = orderId
            ? record.load({ type: record.Type.SALES_ORDER, id: orderId, isDynamic: false })
            : record.create({
                type: record.Type.SALES_ORDER,
                isDynamic: false,
                // Sales Order supports entity as a record.create default value. Initializing
                // it here sources customer defaults (subsidiary, terms, addresses, sales rep,
                // and header location) before generated lines are added.
                defaultValues: { entity: headerValues.customer }
            });
        const counts = {
            created: 0,
            updated: 0,
            closed: 0,
            duplicate: 0,
            protectedSkipped: 0,
            failed: 0
        };

        if (!orderId && !desiredLines.length)
        {
            throw Error('At least one active Blanket Item Schedule with valid recurrence data is required to create a Sales Order.');
        }

        if (!orderId)
        {
            Helper.setNewOrderHeader(order, headerId, headerValues);
        }

        // CHANGE 1.4: Read persisted Sales Order-to-Item Fulfillment links. NetSuite does not
        // reliably expose the UI Picked/Packed display values through getSublistValue here.
        const fulfillmentBySalesOrderLine = orderId
            ? commonLibrary.getSalesOrderFulfillmentLineNumbers(orderId)
            : {};
        const existing = Helper.getExistingLines(order, fulfillmentBySalesOrderLine);
        counts.duplicate = existing.duplicate;
        const desiredKeys = {};

        desiredLines.forEach((desiredLine) =>
        {
            desiredKeys[desiredLine.occurrenceKey] = true;
            const currentLine = existing.byKey[desiredLine.occurrenceKey];

            if (!currentLine)
            {
                Helper.setLine(order, order.getLineCount({ sublistId: ITEM_SUBLIST }), desiredLine, true);
                counts.created += 1;
                return;
            }

            if (!Helper.isEligibleGeneratedLine(currentLine))
            {
                counts.protectedSkipped += 1;
                return;
            }

            if (Helper.isLineChanged(currentLine, desiredLine))
            {
                Helper.setLine(order, currentLine.line, desiredLine, false);
                counts.updated += 1;
            }
        });

        Object.keys(existing.byKey).forEach((occurrenceKey) =>
        {
            const currentLine = existing.byKey[occurrenceKey];
            if (desiredKeys[occurrenceKey]) return;

            if (!Helper.isEligibleGeneratedLine(currentLine))
            {
                counts.protectedSkipped += 1;
                return;
            }

            order.setSublistValue({
                sublistId: ITEM_SUBLIST,
                fieldId: 'isclosed',
                line: currentLine.line,
                value: true
            });
            counts.closed += 1;
        });

        Helper.validateOrderForSave(order, headerId, headerValues, desiredLines);
        const saveDiagnostic = Helper.getSaveDiagnostic(order, headerId, headerValues, desiredLines, orderId);
        log.audit(`${stLogTitle} Sales Order Save Attempt`, saveDiagnostic);
        let savedOrderId;

        try
        {
            savedOrderId = order.save({ enableSourcing: true, ignoreMandatoryFields: false });
        }
        catch (error)
        {
            // NetSuite can return UNEXPECTED_ERROR when validation or a Sales Order User Event/
            // workflow fails during record.save(). Preserve the native error, but write the exact
            // generated transaction context needed to identify the failing header or line.
            log.error(`${stLogTitle} Sales Order Save Failed`, Object.assign({}, saveDiagnostic, {
                errorName: error.name || '',
                errorMessage: error.message || String(error),
                errorId: error.id || '',
                errorStack: error.stack || ''
            }));
            throw error;
        }
        Helper.updateHeaderSuccess(header, savedOrderId);
        log.audit(stLogTitle, `Blanket Schedule ${headerId} synchronized to Sales Order ${savedOrderId}.`);

        return { headerId: headerId, counts: counts };
    };

    Helper.getHeaderValues = (header) =>
    {
        let stLogTitle = 'getHeaderValues';
        log.debug(stLogTitle);
        const salesChannelFieldIds = header.getFields().filter((fieldId) => fieldId.toLowerCase().includes('channel'));
        log.audit(stLogTitle, {
            blanketScheduleId: header.id,
            configuredSalesChannelFieldId: FIELD.scheduleSalesChannel,
            matchingFieldIds: salesChannelFieldIds
        });

        return {
            customer: header.getValue({ fieldId: 'custrecord_ns_bs_customer' }),
            startDate: header.getValue({ fieldId: FIELD.startDate }),
            endDate: header.getValue({ fieldId: FIELD.endDate }),
            mode: header.getText({ fieldId: FIELD.mode }),
            frequencyUnit: header.getText({ fieldId: FIELD.frequencyUnit }),
            frequencyInterval: header.getValue({ fieldId: FIELD.frequencyInterval }),
            defaultQuantity: header.getValue({ fieldId: FIELD.defaultQuantity }),
            defaultLocation: header.getValue({ fieldId: FIELD.defaultLocation }),
            defaultShipTo: header.getValue({ fieldId: FIELD.defaultShipTo }),
            orderType: header.getValue({ fieldId: FIELD.orderType }),
            salesChannel: header.getValue({ fieldId: FIELD.scheduleSalesChannel }),
            sequesterSalesChannel: runtime.getCurrentScript().getParameter({ name: FIELD.sequesterSalesChannel }),
            priceRefresh: header.getValue({ fieldId: FIELD.priceRefresh }),
            revision: header.getValue({ fieldId: 'custrecord_ns_bs_revision' })
        };
    };

    Helper.getItemSchedules = (headerId) =>
    {
        let stLogTitle = 'getItemSchedules';
        log.debug(stLogTitle);

        const sql = `
            SELECT
                itemSchedule.id AS id,
                itemSchedule.custrecord_ns_bsi_item AS itemid,
                BUILTIN.DF(itemSchedule.custrecord_ns_bsi_item) AS itemname,
                itemSchedule.custrecord_ns_bsi_qty AS quantity,
                itemSchedule.custrecord_ns_bsi_start_override AS startdate,
                itemSchedule.custrecord_ns_bsi_end_override AS enddate,
                BUILTIN.DF(itemSchedule.custrecord_ns_bsi_mode_override) AS mode,
                BUILTIN.DF(itemSchedule.custrecord_ns_bsi_freq_unit_override) AS frequencyunit,
                itemSchedule.custrecord_ns_bsi_freq_int_override AS frequencyinterval,
                itemSchedule.custrecord_ns_bsi_delivery_date AS deliverydate,
                itemSchedule.custrecord_ns_bsi_location_override AS location,
                itemSchedule.custrecord_ns_bsi_ship_to_override AS shipto,
                BUILTIN.DF(itemSchedule.custrecord_ns_bsi_status) AS statustext
            FROM customrecord_ns_blanket_item_sched AS itemSchedule
            WHERE itemSchedule.custrecord_ns_bsi_parent = ?
              AND itemSchedule.isinactive = 'F'
            ORDER BY itemSchedule.id`;
        const rows = [];
        const pagedResults = query.runSuiteQLPaged({ query: sql, params: [headerId], pageSize: 1000 });

        pagedResults.pageRanges.forEach((pageRange) =>
        {
            pagedResults.fetch({ index: pageRange.index }).data.asMappedResults().forEach((row) =>
            {
                if (row.statustext !== 'Active') return;

                rows.push({
                    id: row.id,
                    itemId: row.itemid,
                    itemName: row.itemname,
                    quantity: row.quantity,
                    startDate: Helper.parseDate(row.startdate),
                    endDate: Helper.parseDate(row.enddate),
                    mode: row.mode,
                    frequencyUnit: row.frequencyunit,
                    frequencyInterval: row.frequencyinterval,
                    deliveryDate: Helper.parseDate(row.deliverydate),
                    location: row.location,
                    shipTo: row.shipto
                });
            });
        });

        return rows;
    };

    Helper.parseDate = (value) =>
    {
        let stLogTitle = 'parseDate';
        log.debug(stLogTitle);

        if (!value) return null;
        if (value instanceof Date) return value;

        try
        {
            return format.parse({ value: value, type: format.Type.DATE });
        }
        catch (error)
        {
            const parsedDate = new Date(value);
            if (Number.isNaN(parsedDate.getTime())) throw error;
            return parsedDate;
        }
    };

    Helper.setNewOrderHeader = (order, headerId, headerValues) =>
    {
        let stLogTitle = 'setNewOrderHeader';
        log.debug(stLogTitle);

        log.audit(`${stLogTitle} Input`, {
            blanketScheduleId: headerId,
            customerId: headerValues.customer || '',
            orderType: headerValues.orderType || '',
            salesChannel: headerValues.salesChannel || '',
            startDate: Helper.getDateKey(headerValues.startDate),
            endDate: Helper.getDateKey(headerValues.endDate)
        });
        if (String(order.getValue({ fieldId: 'entity' }) || '') !== String(headerValues.customer || ''))
        {
            order.setValue({ fieldId: 'entity', value: headerValues.customer });
        }
        log.audit(stLogTitle, {
            blanketScheduleId: headerId,
            salesChannelValue: headerValues.salesChannel,
            salesChannelValueType: typeof headerValues.salesChannel
        });
        order.setValue({ fieldId: FIELD.salesChannel, value: headerValues.salesChannel });
        // Generated Blanket Sales Orders are not order-email transactions. Prevent a customer
        // default from requiring an email address while the Map/Reduce saves the new order.
        order.setValue({ fieldId: FIELD.toBeEmailed, value: false });
        order.setValue({ fieldId: FIELD.blanketOrder, value: true });
        order.setValue({ fieldId: FIELD.blanketSchedule, value: headerId });
        order.setValue({ fieldId: FIELD.blanketStartDate, value: headerValues.startDate });
        order.setValue({ fieldId: FIELD.blanketEndDate, value: headerValues.endDate });
        order.setValue({ fieldId: FIELD.blanketPriceRefresh, value: Helper.isTrue(headerValues.priceRefresh) });

        if (headerValues.orderType)
        {
            order.setValue({ fieldId: 'custbody_im_order_type', value: headerValues.orderType });
        }
    };

    Helper.setLine = (order, line, desiredLine, isNew) =>
    {
        let stLogTitle = 'setLine';
        log.debug(stLogTitle);

        const values = {
            item: desiredLine.itemId,
            quantity: Number(desiredLine.quantity),
            location: desiredLine.location,
            expectedshipdate: desiredLine.deliveryDate,
            requesteddate: desiredLine.deliveryDate,
            [FIELD.itemSchedule]: desiredLine.itemScheduleId,
            [FIELD.occurrenceKey]: desiredLine.occurrenceKey,
            [FIELD.deliveryDate]: desiredLine.deliveryDate,
            [FIELD.generated]: true,
            [FIELD.revision]: desiredLine.revision
        };

        if (isNew) values[FIELD.originalDeliveryDate] = desiredLine.deliveryDate;

        Object.assign(values, Helper.getPriceRuleLineValues(desiredLine));

        // Create PO is a select field. SpecOrd instructs NetSuite to create a linked
        // Special Order purchase order for the Sales Channel configured on the script deployment.
        if (desiredLine.sequesterSalesChannel
            && String(desiredLine.salesChannel) === String(desiredLine.sequesterSalesChannel)) {
            values[FIELD.createPurchaseOrder] = 'SpecOrd';
        }

        Object.keys(values).forEach((fieldId) =>
        {
            if (values[fieldId] === null || values[fieldId] === undefined) return;
            if (values[fieldId] === '' && !PRICE_RULE_FIELD_IDS.includes(fieldId)) return;

            order.setSublistValue({
                sublistId: ITEM_SUBLIST,
                fieldId: fieldId,
                line: line,
                value: values[fieldId]
            });
        });
    };

    Helper.validateOrderForSave = (order, headerId, headerValues, desiredLines) =>
    {
        const validationErrors = [];

        if (!order.getValue({ fieldId: 'entity' }))
        {
            validationErrors.push('Sales Order customer is required.');
        }

        const lineCount = order.getLineCount({ sublistId: ITEM_SUBLIST });
        if (!lineCount)
        {
            validationErrors.push('At least one Sales Order item line is required.');
        }

        for (let line = 0; line < lineCount; line += 1)
        {
            const itemId = order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: 'item', line: line });
            const quantity = Number(order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: 'quantity', line: line }));

            if (!itemId) validationErrors.push(`Line ${line + 1}: item is required.`);
            if (!Number.isFinite(quantity) || quantity <= 0)
            {
                validationErrors.push(`Line ${line + 1}: quantity must be greater than zero.`);
            }
        }

        if (validationErrors.length)
        {
            log.error('Sales Order Save Validation Failed', {
                blanketScheduleId: headerId,
                customerId: headerValues.customer,
                errors: validationErrors,
                desiredLineCount: desiredLines.length
            });
            throw Error(`Blanket Schedule ${headerId} cannot save its Sales Order: ${validationErrors.join(' ')}`);
        }
    };

    Helper.getSaveDiagnostic = (order, headerId, headerValues, desiredLines, orderId) =>
    {
        const script = runtime.getCurrentScript();
        const generatedLines = desiredLines.slice(0, 25).map((desiredLine) =>
        {
            const priceRuleValues = desiredLine.priceRuleValues || {};
            const isSequesterLine = desiredLine.sequesterSalesChannel
                && String(desiredLine.salesChannel) === String(desiredLine.sequesterSalesChannel);

            return {
                occurrenceKey: desiredLine.occurrenceKey,
                itemScheduleId: desiredLine.itemScheduleId,
                itemId: desiredLine.itemId,
                quantity: desiredLine.quantity,
                location: desiredLine.location,
                deliveryDate: Helper.getDateKey(desiredLine.deliveryDate),
                salesChannel: desiredLine.salesChannel,
                createsSpecialOrderPo: Boolean(isSequesterLine),
                priceLevel: priceRuleValues[FIELD.priceLevel] || (desiredLine.priceRuleValues ? -1 : 1),
                rate: priceRuleValues[FIELD.rate] || desiredLine.basePrice || '',
                priceRule: priceRuleValues[FIELD.priceRule] || '',
                resolvedPriceRuleValues: priceRuleValues
            };
        });
        const salesOrderLines = [];
        const salesOrderLineCount = order.getLineCount({ sublistId: ITEM_SUBLIST });

        for (let line = 0; line < Math.min(salesOrderLineCount, 25); line += 1)
        {
            salesOrderLines.push({
                line: line,
                itemId: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: 'item', line: line }),
                quantity: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: 'quantity', line: line }),
                location: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: 'location', line: line }),
                expectedShipDate: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: 'expectedshipdate', line: line }),
                requestedDate: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: 'requesteddate', line: line }),
                priceLevel: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: FIELD.priceLevel, line: line }),
                rate: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: FIELD.rate, line: line }),
                priceRule: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: FIELD.priceRule, line: line }),
                createPurchaseOrder: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: FIELD.createPurchaseOrder, line: line }),
                purchaseOrderVendor: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: 'povendor', line: line }),
                allocationStrategy: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: 'allocationstrategy', line: line }),
                commitInventory: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: 'commitinventory', line: line })
            });
        }

        return {
            accountId: runtime.accountId,
            scriptId: script.id,
            deploymentId: script.deploymentId,
            blanketScheduleId: headerId,
            existingSalesOrderId: orderId || '',
            salesOrderCustomer: order.getValue({ fieldId: 'entity' }),
            salesOrderSalesChannel: order.getValue({ fieldId: FIELD.salesChannel }),
            salesOrderHeader: Helper.getHeaderDiagnostic(order),
            scheduleSalesChannel: headerValues.salesChannel || '',
            sequesterSalesChannel: headerValues.sequesterSalesChannel || '',
            salesOrderLineCount: salesOrderLineCount,
            desiredLineCount: desiredLines.length,
            generatedLinesTruncated: desiredLines.length > generatedLines.length,
            generatedLines: generatedLines,
            salesOrderLinesTruncated: salesOrderLineCount > salesOrderLines.length,
            salesOrderLines: salesOrderLines
        };
    };

    Helper.getHeaderDiagnostic = (order) =>
    {
        const fieldIds = [
            'customform', 'subsidiary', 'currency', 'terms', 'taxitem', 'location',
            'shipaddresslist', 'billaddresslist', 'shipmethod', 'paymentmethod',
            'salesrep', 'department', 'class', 'tobeemailed', 'email', 'orderstatus'
        ];
        const values = {};

        fieldIds.forEach((fieldId) =>
        {
            try
            {
                values[fieldId] = order.getValue({ fieldId: fieldId });
            }
            catch (error)
            {
                values[fieldId] = '[unavailable]';
            }
        });

        return values;
    };

    Helper.getExistingLines = (order, fulfillmentBySalesOrderLine) =>
    {
        let stLogTitle = 'getExistingLines';
        log.debug(stLogTitle);

        const byKey = {};
        let duplicate = 0;
        const count = order.getLineCount({ sublistId: ITEM_SUBLIST });

        for (let line = 0; line < count; line += 1)
        {
            const occurrenceKey = order.getSublistValue({
                sublistId: ITEM_SUBLIST,
                fieldId: FIELD.occurrenceKey,
                line: line
            });
            if (!occurrenceKey) continue;

            if (byKey[occurrenceKey])
            {
                duplicate += 1;
                continue;
            }

            const salesOrderLineNumber = order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: 'line', line: line });
            const fulfillmentId = (fulfillmentBySalesOrderLine || {})[String(salesOrderLineNumber)];
            byKey[occurrenceKey] = {
                line: line,
                salesOrderLineNumber: salesOrderLineNumber,
                occurrenceKey: occurrenceKey,
                hasItemFulfillment: Boolean(fulfillmentId),
                fulfillmentId: fulfillmentId,
                generated: Helper.isTrue(order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: FIELD.generated, line: line })),
                closed: Helper.isTrue(order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: 'isclosed', line: line })),
                quantity: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: 'quantity', line: line }),
                location: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: 'location', line: line }),
                deliveryDate: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: FIELD.deliveryDate, line: line }),
                expectedShipDate: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: 'expectedshipdate', line: line }),
                requestedDate: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: 'requesteddate', line: line }),
                quantityFulfilled: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: 'quantityfulfilled', line: line }),
                quantityBilled: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: 'quantitybilled', line: line }),
                quantityPicked: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: 'quantitypicked', line: line }),
                quantityPacked: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: 'quantitypacked', line: line }),
                fulfillmentStatusLine: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: FIELD.fulfillmentStatusLine, line: line }),
                priceLevel: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: FIELD.priceLevel, line: line }),
                rate: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: FIELD.rate, line: line }),
                priceRule: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: FIELD.priceRule, line: line }),
                freight: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: FIELD.freight, line: line }),
                handling: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: FIELD.handling, line: line }),
                dangerousGoods: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: FIELD.dangerousGoods, line: line }),
                dryIce: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: FIELD.dryIce, line: line }),
                minimumOrderCharge: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: FIELD.minimumOrderCharge, line: line }),
                minimumOrderValue: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: FIELD.minimumOrderValue, line: line }),
                createPurchaseOrder: order.getSublistValue({ sublistId: ITEM_SUBLIST, fieldId: FIELD.createPurchaseOrder, line: line })
            };
        }

        return { byKey: byKey, duplicate: duplicate };
    };

    Helper.isLineChanged = (currentLine, desiredLine) =>
    {
        let stLogTitle = 'isLineChanged';
        log.debug(stLogTitle);

        return Number(currentLine.quantity) !== Number(desiredLine.quantity)
            || String(currentLine.location || '') !== String(desiredLine.location || '')
            || Helper.getDateKey(currentLine.deliveryDate) !== Helper.getDateKey(desiredLine.deliveryDate)
            || Helper.getDateKey(currentLine.expectedShipDate) !== Helper.getDateKey(desiredLine.deliveryDate)
            || Helper.getDateKey(currentLine.requestedDate) !== Helper.getDateKey(desiredLine.deliveryDate)
            || (desiredLine.sequesterSalesChannel
                && String(desiredLine.salesChannel) === String(desiredLine.sequesterSalesChannel)
                && String(currentLine.createPurchaseOrder || '') !== 'SpecOrd')
            || Helper.isPriceRuleChanged(currentLine, desiredLine);
    };

    Helper.sortDesiredLines = (desiredLines) =>
    {
        let stLogTitle = 'sortDesiredLines';
        log.debug(stLogTitle);

        desiredLines.sort((firstLine, secondLine) =>
        {
            const dateComparison = Helper.getDateKey(firstLine.deliveryDate)
                .localeCompare(Helper.getDateKey(secondLine.deliveryDate));

            if (dateComparison !== 0) return dateComparison;

            return String(firstLine.itemName || firstLine.itemId)
                .localeCompare(String(secondLine.itemName || secondLine.itemId));
        });
    };

    Helper.isEligibleGeneratedLine = (line) =>
    {
        let stLogTitle = 'isEligibleGeneratedLine';
        const isEligible = blanketSchedule.isEligibleGeneratedLine(line);

        // CHANGE 1.4: Audit the persisted Item Fulfillment relationship along with the native
        // values. hasItemFulfillment must be false before this line can be changed or closed.
        log.audit(stLogTitle, {
            occurrenceKey: line.occurrenceKey,
            salesOrderLine: line.line,
            salesOrderLineNumber: line.salesOrderLineNumber,
            generated: line.generated,
            closed: line.closed,
            hasItemFulfillment: line.hasItemFulfillment,
            fulfillmentId: line.fulfillmentId,
            fulfillmentStatusLine: line.fulfillmentStatusLine,
            quantityPicked: line.quantityPicked,
            quantityPacked: line.quantityPacked,
            quantityFulfilled: line.quantityFulfilled,
            quantityBilled: line.quantityBilled,
            isEligible: isEligible
        });
        return isEligible;
    };

    Helper.applyPriceRulesToDesiredLines = (desiredLines, customerId) =>
    {
        let stLogTitle = 'applyPriceRulesToDesiredLines';
        log.debug(stLogTitle);

        if (!desiredLines.length) return;

        const scriptParameters = commonLibrary.getParameters(PRICE_RULE_PARAMETER, true);
        if (!scriptParameters.priceRuleSearch)
        {
            throw Error('The configured Price Rule search is required to generate Blanket Sales Order lines.');
        }

        const itemPriceRules = commonLibrary.getItemPriceRule(
            scriptParameters,
            customerId,
            desiredLines.map((desiredLine) => desiredLine.itemId)
        );
        const basePriceByItem = {};

        desiredLines.forEach((desiredLine) =>
        {
            desiredLine.priceRuleValues = itemPriceRules[desiredLine.itemId] || null;
            if (desiredLine.priceRuleValues) return;

            if (basePriceByItem[desiredLine.itemId] === undefined)
            {
                basePriceByItem[desiredLine.itemId] = commonLibrary.getItemBasePrice(desiredLine.itemId);
            }
            desiredLine.basePrice = basePriceByItem[desiredLine.itemId];
        });
    };

    Helper.getPriceRuleLineValues = (desiredLine) =>
    {
        let stLogTitle = 'getPriceRuleLineValues';
        log.debug(stLogTitle);

        if (desiredLine.priceRuleValues)
        {
            return Object.assign({ [FIELD.priceLevel]: -1 }, desiredLine.priceRuleValues);
        }

        // CHANGE 1.2: When a previously applied rule is no longer active, restore Base Price
        // and explicitly clear every Price Rule-derived value instead of leaving stale charges.
        return {
            [FIELD.priceLevel]: 1,
            [FIELD.rate]: desiredLine.basePrice,
            [FIELD.priceRule]: '',
            [FIELD.freight]: '',
            [FIELD.handling]: '',
            [FIELD.dangerousGoods]: '',
            [FIELD.dryIce]: '',
            [FIELD.minimumOrderCharge]: '',
            [FIELD.minimumOrderValue]: ''
        };
    };

    Helper.isPriceRuleChanged = (currentLine, desiredLine) =>
    {
        let stLogTitle = 'isPriceRuleChanged';
        log.debug(stLogTitle);

        const desiredValues = Helper.getPriceRuleLineValues(desiredLine);
        const currentValues = {
            [FIELD.priceLevel]: currentLine.priceLevel,
            [FIELD.rate]: currentLine.rate,
            [FIELD.priceRule]: currentLine.priceRule,
            [FIELD.freight]: currentLine.freight,
            [FIELD.handling]: currentLine.handling,
            [FIELD.dangerousGoods]: currentLine.dangerousGoods,
            [FIELD.dryIce]: currentLine.dryIce,
            [FIELD.minimumOrderCharge]: currentLine.minimumOrderCharge,
            [FIELD.minimumOrderValue]: currentLine.minimumOrderValue
        };

        return Object.keys(desiredValues).some((fieldId) =>
        {
            return !Helper.areLineValuesEqual(currentValues[fieldId], desiredValues[fieldId]);
        });
    };

    Helper.areLineValuesEqual = (currentValue, desiredValue) =>
    {
        let stLogTitle = 'areLineValuesEqual';
        log.debug(stLogTitle);

        if (String(currentValue || '') === String(desiredValue || '')) return true;
        if (currentValue === '' || currentValue === null || currentValue === undefined
            || desiredValue === '' || desiredValue === null || desiredValue === undefined) return false;
        return Number(currentValue) === Number(desiredValue);
    };

    Helper.isTrue = (value) =>
    {
        let stLogTitle = 'isTrue';
        log.debug(stLogTitle);
        return value === true || value === 'T';
    };

    Helper.getDateKey = (value) =>
    {
        let stLogTitle = 'getDateKey';
        log.debug(stLogTitle);
        return blanketSchedule.getDateKey(Helper.parseDate(value));
    };

    Helper.updateHeaderSuccess = (header, salesOrderId) =>
    {
        let stLogTitle = 'updateHeaderSuccess';
        log.debug(stLogTitle);

        header.setValue({ fieldId: FIELD.salesOrder, value: salesOrderId });
        header.setValue({ fieldId: FIELD.lastGenerated, value: new Date() });
        header.setValue({ fieldId: FIELD.lastError, value: '' });
        header.setText({ fieldId: FIELD.status, text: 'Active' });
        header.save({ enableSourcing: false, ignoreMandatoryFields: true });

        record.submitFields({
            type: HEADER_TYPE,
            id: header.id,
            values: { [FIELD.taskId]: '', [FIELD.lastError]: '' }
        });
    };

    Helper.updateHeaderError = (headerId, error) =>
    {
        let stLogTitle = 'updateHeaderError';
        log.debug(stLogTitle);

        if (!headerId) return;

        try
        {
            const header = record.load({ type: HEADER_TYPE, id: headerId });
            header.setText({ fieldId: FIELD.status, text: 'Error' });
            header.save({ enableSourcing: false, ignoreMandatoryFields: true });
            record.submitFields({
                type: HEADER_TYPE,
                id: headerId,
                values: {
                    [FIELD.taskId]: '',
                    [FIELD.lastError]: String(error.message || error).slice(0, 300)
                }
            });
        }
        catch (updateError)
        {
            log.error(stLogTitle, updateError);
        }
    };

    return EntryPoint;
});
