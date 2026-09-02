/**
 * Copyright (c) 2026, Oracle and/or its affiliates. All rights reserved.
 *
 *
 * Change Log
 * 1.0  Jan 14 2026  zephaniah.donato  Initial design.
 * 1.1  Jul 21 2026  Manuel Teodoro    Apply active Price Rules in supported server contexts and
 *                                     retain Other Charge processing only for non-Blanket Sales Orders.
 * 1.2  Jul 21 2026  Manuel Teodoro    Restore Base Price and clear an expired Price Rule on repriced lines.
 * 1.3  Jul 21 2026  Manuel Teodoro    Clear stale Price Rule-derived charge values when no rule remains.
 * 1.4  Jul 21 2026  Manuel Teodoro    Skip picked, packed, and fulfillment-linked Sales Order lines.
 * 1.5  Jul 21 2026  Manuel Teodoro    Read protected quantities from the persisted old Sales Order.
 * 1.6  Jul 21 2026  Manuel Teodoro    Protect lines with a persisted Item Fulfillment link.
 * 1.7  Jul 21 2026  Manuel Teodoro    Read Item Fulfillment order-line values to protect Sales Order lines.
 * 1.8  Jul 21 2026  Manuel Teodoro    Apply Blanket Price Refresh only to eligible generated product lines.
 * 1.9  Jul 23 2026  Manuel Teodoro    Read the Company fallback Minimum Order Charge and Value preferences.
 * 2.0  Aug 25 2026  Manuel Teodoro    Clear Price Rule references on manually overridden Sales Order lines.
 */

/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(function (require) {
    let runtime = require('N/runtime');
    let commonLibrary = require('../library/NSTS_MD_CommonLibrary');

    const SUBLIST = {
        item: 'item'
    };
    const FIELD = {
        customer: 'entity',
        item: 'item',
        priceLevel: 'price',
        rate: 'rate',
        priceRule: 'custcol_ns_price_rule',
        freight: 'custcol_ns_freight',
        handling: 'custcol_ns_handling',
        dangerousGoods: 'custcol_ns_dangerous_goods',
        dryIce: 'custcol_ns_dryice',
        minimumOrderCharge: 'custcol_ns_min_order_charge',
        minimumOrderValue: 'custcol_ns_min_order_value',
        closed: 'isclosed',
        quantityPicked: 'quantitypicked',
        quantityPacked: 'quantitypacked',
        quantityFulfilled: 'quantityfulfilled',
        quantityBilled: 'quantitybilled',
        fulfillmentStatusLine: 'shiprecvstatusline',
        salesOrderLineNumber: 'line',
        blanketOrder: 'custbody_ns_bso_order',
        blanketPriceRefreshEligible: 'custbody_ns_bso_price_refresh',
        blanketPriceRefreshPending: 'custbody_ns_bso_price_refresh_pending',
        blanketGenerated: 'custcol_ns_bso_generated',
        blanketFulfillmentCharge: 'custcol_ns_bso_fulfill_charge',
        manualPriceOverride: 'custcol_ns_bso_price_override',
        linePriceRefresh: 'custcol_ns_bso_last_price_refresh',
        headerPriceRefresh: 'custbody_ns_bso_last_price_refresh'
    };
    const PARAMETER = {
        priceRuleSearch: 'custscript_ns_cs_mpr_price_rule_search',
        freight: 'custscript_ns_cs_mpr_freight',
        handling: 'custscript_ns_cs_mpr_handling',
        dangerousGoods: 'custscript_ns_cs_mpr_dangerous_goods',
        dryIce: 'custscript_ns_cs_mpr_dryice',
        minimumOrderCharge: 'custscript_ns_cs_mpr_min_order_charge',
        // CHANGE 1.9: Company preferences used only when no eligible product line has a Price Rule.
        defaultMinimumOrderCharge: 'custscript_prdb_dflt_minordercharge',
        defaultMinimumOrderValue: 'custscript_prdb_dflt_minordervalue',
        skippedDeliveryTerms: 'custscript_ns_cs_mpr_skipped_del_terms'
    };
    const SERVER_PRICE_RULE_CONTEXTS = [
        runtime.ContextType.MAP_REDUCE,
        runtime.ContextType.CSV_IMPORT,
        runtime.ContextType.RESTLET,
        runtime.ContextType.REST_WEBSERVICES,
        runtime.ContextType.WEBSERVICES
    ];

    let EntryPoint = {};
    let Helper = {};

    // Entry Points
    EntryPoint.beforeSubmit = function (scriptContext) {
        let stLogTitle = 'beforeSubmit';

        try {
            if (Helper.isDelete(scriptContext)) {
                return;
            }

            const salesOrder = scriptContext.newRecord;
            const isBlanketOrder = commonLibrary.isBlanketSalesOrder(salesOrder, FIELD.blanketOrder);
            const isBlanketPriceRefresh = Helper.isBlanketPriceRefresh({
                salesOrder: salesOrder,
                isBlanketOrder: isBlanketOrder
            });
            const scriptParameters = commonLibrary.getParameters(PARAMETER, true);

            // CHANGE 2.0: A manual rate must no longer appear to be governed by a
            // Price Rule. This also covers non-UI entry contexts that do not run the
            // client script.
            Helper.clearPriceRuleForManualOverrides(salesOrder);

            // CHANGE 1.1: UI pricing remains exclusively in NSTS_CS_manage_price_rule.js.
            // Server-created/updated Sales Orders receive one bulk Price Rule lookup per customer.
            if (Helper.isServerPriceRuleContext(runtime.executionContext)) {
                Helper.applyServerPriceRules({
                    salesOrder: salesOrder,
                    oldSalesOrder: scriptContext.oldRecord,
                    scriptParameters: scriptParameters,
                    isBlanketOrder: isBlanketOrder,
                    isBlanketPriceRefresh: isBlanketPriceRefresh
                });

                if (isBlanketPriceRefresh) {
                    salesOrder.setValue({
                        fieldId: FIELD.blanketPriceRefreshPending,
                        value: false
                    });
                }
            }

            // CHANGE 1.1: Other Charge lines are never generated on Blanket Sales Orders.
            // Standard Sales Orders retain the existing charge-line behavior in every supported entry flow.
            if (!isBlanketOrder) {
                commonLibrary.addOtherChargesItems(scriptParameters, salesOrder, SUBLIST.item);
            }
        } catch (error) {
            log.error({
                title: 'Error at [' + stLogTitle + '] function',
                details: Helper.getErrorDetails(error)
            });
            throw error;
        }
    };

    // Subfunctions
    Helper.clearPriceRuleForManualOverrides = function (salesOrder) {
        let stLogTitle = 'clearPriceRuleForManualOverrides';
        const lineCount = salesOrder.getLineCount({ sublistId: SUBLIST.item });

        for (let line = 0; line < lineCount; line++) {
            const isManualPriceOverride = commonLibrary.isValueTrue(salesOrder.getSublistValue({
                sublistId: SUBLIST.item,
                fieldId: FIELD.manualPriceOverride,
                line: line
            }));
            const priceRuleId = salesOrder.getSublistValue({
                sublistId: SUBLIST.item,
                fieldId: FIELD.priceRule,
                line: line
            });

            if (!isManualPriceOverride || priceRuleId === null || priceRuleId === undefined || String(priceRuleId).trim() === '') {
                continue;
            }

            salesOrder.setSublistValue({
                sublistId: SUBLIST.item,
                fieldId: FIELD.priceRule,
                line: line,
                value: ''
            });
            log.audit({
                title: stLogTitle,
                details: { line: line, clearedPriceRuleId: priceRuleId }
            });
        }
    };

    Helper.applyServerPriceRules = function (objValues) {
        let stLogTitle = 'applyServerPriceRules';
        const customerId = objValues.salesOrder.getValue({ fieldId: FIELD.customer });

        if (!customerId) {
            log.debug({
                title: stLogTitle,
                details: 'Skipping Price Rule lookup because the Sales Order customer is blank.'
            });
            return;
        }

        // CHANGE 1.6: This persisted line relationship remains available even when NetSuite
        // returns zero/undefined for the Sales Order's calculated Picked/Packed columns.
        const fulfillmentBySalesOrderLine = objValues.salesOrder.id
            ? commonLibrary.getSalesOrderFulfillmentLineNumbers(objValues.salesOrder.id)
            : {};
        const eligibleLines = Helper.getEligibleLines({
            salesOrder: objValues.salesOrder,
            oldSalesOrder: objValues.oldSalesOrder,
            scriptParameters: objValues.scriptParameters,
            fulfillmentBySalesOrderLine: fulfillmentBySalesOrderLine,
            isBlanketPriceRefresh: objValues.isBlanketPriceRefresh
        });
        if (!eligibleLines.length) {
            return;
        }

        const itemIds = eligibleLines.map(function (line) {
            return line.itemId;
        });
        const itemPriceRules = commonLibrary.getItemPriceRule(
            objValues.scriptParameters,
            customerId,
            itemIds
        );
        const refreshDateTime = new Date();
        let hasEligibleBlanketLine = false;

        eligibleLines.forEach(function (line) {
            const itemPriceRule = itemPriceRules[line.itemId];

            if (itemPriceRule) {
                Helper.applyPriceRuleToLine({
                    salesOrder: objValues.salesOrder,
                    line: line.line,
                    itemPriceRule: itemPriceRule
                });
            } else if (Helper.hasPriceRuleDerivedValues(line)) {
                // CHANGE 1.3: An existing Price Rule that is no longer active must not retain
                // its custom rate or charge values. Restore Base Price and clear all derived values.
                Helper.resetExpiredPriceRuleLine({
                    salesOrder: objValues.salesOrder,
                    line: line.line,
                    itemId: line.itemId
                });
            } else {
                log.audit({
                    title: stLogTitle + ' - No active Price Rule found',
                    details: {
                        customerId: customerId,
                        itemId: line.itemId
                    }
                });
            }

            if (objValues.isBlanketOrder) {
                // CHANGE 1.1: Stamp each eligible Blanket product line after it is evaluated.
                objValues.salesOrder.setSublistValue({
                    sublistId: SUBLIST.item,
                    fieldId: FIELD.linePriceRefresh,
                    line: line.line,
                    value: refreshDateTime
                });
                hasEligibleBlanketLine = true;
            }
        });

        if (objValues.isBlanketOrder && hasEligibleBlanketLine) {
            objValues.salesOrder.setValue({
                fieldId: FIELD.headerPriceRefresh,
                value: refreshDateTime
            });
        }
    };

    Helper.getEligibleLines = function (objValues) {
        let stLogTitle = 'getEligibleLines';
        const eligibleLines = [];
        const chargeItemIds = commonLibrary.getConfiguredChargeItemIds(objValues.scriptParameters);
        const lineCount = objValues.salesOrder.getLineCount({ sublistId: SUBLIST.item });

        for (let line = 0; line < lineCount; line++) {
            // CHANGE 1.5: In a beforeSubmit triggered by Map/Reduce, NetSuite can return zero
            // for calculated Picked/Packed fields on newRecord. oldRecord preserves the saved
            // fulfillment state and is therefore the source of line-protection values.
            const protectionRecord = Helper.getProtectionRecord({
                salesOrder: objValues.salesOrder,
                oldSalesOrder: objValues.oldSalesOrder,
                line: line
            });
            const salesOrderLineNumber = objValues.salesOrder.getSublistValue({
                sublistId: SUBLIST.item,
                fieldId: FIELD.salesOrderLineNumber,
                line: line
            });
            const fulfillmentId = (objValues.fulfillmentBySalesOrderLine || {})[String(salesOrderLineNumber)];
            const lineValues = {
                itemId: objValues.salesOrder.getSublistValue({
                    sublistId: SUBLIST.item,
                    fieldId: FIELD.item,
                    line: line
                }),
                isClosed: objValues.salesOrder.getSublistValue({
                    sublistId: SUBLIST.item,
                    fieldId: FIELD.closed,
                    line: line
                }),
                generated: objValues.salesOrder.getSublistValue({
                    sublistId: SUBLIST.item,
                    fieldId: FIELD.blanketGenerated,
                    line: line
                }),
                fulfillmentCharge: objValues.salesOrder.getSublistValue({
                    sublistId: SUBLIST.item,
                    fieldId: FIELD.blanketFulfillmentCharge,
                    line: line
                }),
                quantityPicked: protectionRecord.getSublistValue({
                    sublistId: SUBLIST.item,
                    fieldId: FIELD.quantityPicked,
                    line: line
                }),
                quantityPacked: protectionRecord.getSublistValue({
                    sublistId: SUBLIST.item,
                    fieldId: FIELD.quantityPacked,
                    line: line
                }),
                quantityFulfilled: protectionRecord.getSublistValue({
                    sublistId: SUBLIST.item,
                    fieldId: FIELD.quantityFulfilled,
                    line: line
                }),
                quantityBilled: protectionRecord.getSublistValue({
                    sublistId: SUBLIST.item,
                    fieldId: FIELD.quantityBilled,
                    line: line
                }),
                fulfillmentStatusLine: protectionRecord.getSublistValue({
                    sublistId: SUBLIST.item,
                    fieldId: FIELD.fulfillmentStatusLine,
                    line: line
                }),
                hasItemFulfillment: Boolean(fulfillmentId),
                fulfillmentId: fulfillmentId,
                manualPriceOverride: objValues.salesOrder.getSublistValue({
                    sublistId: SUBLIST.item,
                    fieldId: FIELD.manualPriceOverride,
                    line: line
                }),
                priceRuleId: objValues.salesOrder.getSublistValue({
                    sublistId: SUBLIST.item,
                    fieldId: FIELD.priceRule,
                    line: line
                }),
                freight: objValues.salesOrder.getSublistValue({
                    sublistId: SUBLIST.item,
                    fieldId: FIELD.freight,
                    line: line
                }),
                handling: objValues.salesOrder.getSublistValue({
                    sublistId: SUBLIST.item,
                    fieldId: FIELD.handling,
                    line: line
                }),
                dangerousGoods: objValues.salesOrder.getSublistValue({
                    sublistId: SUBLIST.item,
                    fieldId: FIELD.dangerousGoods,
                    line: line
                }),
                dryIce: objValues.salesOrder.getSublistValue({
                    sublistId: SUBLIST.item,
                    fieldId: FIELD.dryIce,
                    line: line
                }),
                minimumOrderCharge: objValues.salesOrder.getSublistValue({
                    sublistId: SUBLIST.item,
                    fieldId: FIELD.minimumOrderCharge,
                    line: line
                }),
                minimumOrderValue: objValues.salesOrder.getSublistValue({
                    sublistId: SUBLIST.item,
                    fieldId: FIELD.minimumOrderValue,
                    line: line
                })
            };

            if (!commonLibrary.isPriceRuleEligibleLine(lineValues, chargeItemIds)
                || (objValues.isBlanketPriceRefresh && !Helper.isEligibleBlanketRefreshLine(lineValues))) {
                continue;
            }

            eligibleLines.push({
                line: line,
                itemId: lineValues.itemId,
                priceRuleId: lineValues.priceRuleId,
                freight: lineValues.freight,
                handling: lineValues.handling,
                dangerousGoods: lineValues.dangerousGoods,
                dryIce: lineValues.dryIce,
                minimumOrderCharge: lineValues.minimumOrderCharge,
                minimumOrderValue: lineValues.minimumOrderValue
            });
        }

        log.debug({
            title: stLogTitle,
            details: { eligibleLineCount: eligibleLines.length }
        });
        return eligibleLines;
    };

    Helper.getProtectionRecord = function (objValues) {
        let stLogTitle = 'getProtectionRecord';
        const oldSalesOrder = objValues.oldSalesOrder;
        const canUseOldLine = oldSalesOrder
            && objValues.line < oldSalesOrder.getLineCount({ sublistId: SUBLIST.item });
        log.debug({ title: stLogTitle, details: { line: objValues.line, source: canUseOldLine ? 'oldRecord' : 'newRecord' } });
        return canUseOldLine ? oldSalesOrder : objValues.salesOrder;
    };

    Helper.isBlanketPriceRefresh = function (objValues) {
        let stLogTitle = 'isBlanketPriceRefresh';
        const salesOrder = objValues.salesOrder;
        const isBlanketPriceRefresh = objValues.isBlanketOrder
            && commonLibrary.isValueTrue(salesOrder.getValue({ fieldId: FIELD.blanketPriceRefreshEligible }))
            && commonLibrary.isValueTrue(salesOrder.getValue({ fieldId: FIELD.blanketPriceRefreshPending }));
        log.debug({ title: stLogTitle, details: { isBlanketPriceRefresh: isBlanketPriceRefresh } });
        return isBlanketPriceRefresh;
    };

    Helper.isEligibleBlanketRefreshLine = function (lineValues) {
        let stLogTitle = 'isEligibleBlanketRefreshLine';
        const isEligible = commonLibrary.isValueTrue(lineValues.generated)
            && !commonLibrary.isValueTrue(lineValues.fulfillmentCharge);
        log.debug({ title: stLogTitle, details: { isEligible: isEligible } });
        return isEligible;
    };

    Helper.applyPriceRuleToLine = function (objValues) {
        let stLogTitle = 'applyPriceRuleToLine';
        const fieldValues = objValues.itemPriceRule;

        objValues.salesOrder.setSublistValue({
            sublistId: SUBLIST.item,
            fieldId: FIELD.priceLevel,
            line: objValues.line,
            value: -1
        });

        Object.keys(fieldValues).forEach(function (fieldId) {
            if (fieldValues[fieldId] === undefined || fieldId === FIELD.item) {
                return;
            }

            objValues.salesOrder.setSublistValue({
                sublistId: SUBLIST.item,
                fieldId: fieldId,
                line: objValues.line,
                value: fieldValues[fieldId]
            });
        });

        log.debug({
            title: stLogTitle,
            details: { line: objValues.line, rate: fieldValues[FIELD.rate] }
        });
    };

    Helper.resetExpiredPriceRuleLine = function (objValues) {
        let stLogTitle = 'resetExpiredPriceRuleLine';
        const basePrice = commonLibrary.getItemBasePrice(objValues.itemId);

        objValues.salesOrder.setSublistValue({
            sublistId: SUBLIST.item,
            fieldId: FIELD.priceLevel,
            line: objValues.line,
            value: 1
        });
        objValues.salesOrder.setSublistValue({
            sublistId: SUBLIST.item,
            fieldId: FIELD.rate,
            line: objValues.line,
            value: basePrice
        });
        objValues.salesOrder.setSublistValue({
            sublistId: SUBLIST.item,
            fieldId: FIELD.priceRule,
            line: objValues.line,
            value: ''
        });
        [
            FIELD.freight,
            FIELD.handling,
            FIELD.dangerousGoods,
            FIELD.dryIce,
            FIELD.minimumOrderCharge,
            FIELD.minimumOrderValue
        ].forEach(function (fieldId) {
            objValues.salesOrder.setSublistValue({
                sublistId: SUBLIST.item,
                fieldId: fieldId,
                line: objValues.line,
                value: ''
            });
        });

        log.audit({
            title: stLogTitle,
            details: {
                line: objValues.line,
                itemId: objValues.itemId,
                restoredBasePrice: basePrice
            }
        });
    };

    Helper.hasPriceRuleDerivedValues = function (line) {
        let stLogTitle = 'hasPriceRuleDerivedValues';
        const values = [
            line.priceRuleId,
            line.freight,
            line.handling,
            line.dangerousGoods,
            line.dryIce,
            line.minimumOrderCharge,
            line.minimumOrderValue
        ];
        const hasValues = values.some(function (value) {
            return value !== null && value !== undefined && value !== '';
        });
        log.debug({ title: stLogTitle, details: { hasValues: hasValues } });
        return hasValues;
    };

    Helper.isServerPriceRuleContext = function (executionContext) {
        let stLogTitle = 'isServerPriceRuleContext';
        const isSupportedContext = SERVER_PRICE_RULE_CONTEXTS.includes(executionContext);
        log.debug({ title: stLogTitle, details: { executionContext: executionContext, isSupportedContext: isSupportedContext } });
        return isSupportedContext;
    };

    Helper.isDelete = function (scriptContext) {
        let stLogTitle = 'isDelete';
        const isDelete = scriptContext.type === scriptContext.UserEventType.DELETE;
        log.debug({ title: stLogTitle, details: { isDelete: isDelete } });
        return isDelete;
    };

    Helper.getErrorDetails = function (error) {
        let stLogTitle = 'getErrorDetails';
        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
            logTitle: stLogTitle
        };
    };

    return EntryPoint;
});
