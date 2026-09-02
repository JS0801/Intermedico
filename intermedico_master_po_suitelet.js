/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * InterMedico Master PO Suitelet
 *
 * Lists Purchase Orders by vendor with Excel-style filtering/sorting,
 * expandable PO line details, checkbox selection, and Master PO creation.
 */
define([
    'N/error',
    'N/log',
    'N/record',
    'N/redirect',
    'N/runtime',
    'N/search',
    'N/ui/serverWidget',
    'N/url'
], function (
    error,
    log,
    record,
    redirect,
    runtime,
    search,
    serverWidget,
    url
) {
    const CONFIG = {
        pageTitle: 'InterMedico Master PO Builder',
        maxSearchLines: 4000,

        masterPoRecordType: 'customrecord_consolidated_po',
        sourcePoUpdateField: 'custbody_master_purchase_order',

        bodyFields: {
            vendor: 'custrecord_cpo_vendor',
            subsidiary: 'custrecord_cpo_subsidiary',
            transactionDate: 'custrecord_cpo_date',
            currency: 'custrecord_cpo_currency',
            exchangeRate: 'custrecord_cpo_exchange_rate',
            memo: 'custrecord_cpo_memo',
            createdBy: 'custrecord_cpo_created_by'
        }
    };

    function onRequest(context) {
        if (context.request.method === 'POST') {
            handlePost(context);
            return;
        }

        renderPage(context, null);
    }

    function handlePost(context) {
        const params = context.request.parameters || {};

        if (params.custpage_action !== 'create_master_po') {
            renderPage(context, null);
            return;
        }

        try {
            const selectedPoIds = parseSelectedPoIds(params.custpage_selected_po_ids);
            const createdRecord = createMasterPo(selectedPoIds);

            redirect.toRecord({
                type: CONFIG.masterPoRecordType,
                id: createdRecord.id,
                isEditMode: false
            });
        } catch (ex) {
            log.error({
                title: 'Master PO creation failed',
                details: ex
            });
            renderPage(context, ex.message || String(ex));
        }
    }

    function renderPage(context, message) {
        const request = context.request;
        const params = normalizeParams(request.parameters || {});
        let loadMessage = message || '';
        let data;

        try {
            data = getPurchaseOrderData(params);
        } catch (ex) {
            log.error({
                title: 'Purchase Order search failed',
                details: ex
            });
            data = {
                purchaseOrders: [],
                lineCount: 0,
                truncated: false
            };
            loadMessage = loadMessage ||
                'PO search failed. Check the deployment log for the exact NetSuite search field error.';
        }

        const vendorOptions = getVendorOptions(params.vendor, params.vendorText);
        const poOptions = getPoOptions(params.po, params.poText);
        const locationOptions = getLocationOptions(params.location, params.locationText);
        const form = serverWidget.createForm({
            title: CONFIG.pageTitle
        });

        const vendorField = form.addField({
            id: 'custpage_vendor',
            type: serverWidget.FieldType.TEXT,
            label: 'Vendor'
        });
        vendorField.defaultValue = params.vendor || '';
        vendorField.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.HIDDEN
        });

        const vendorTextField = form.addField({
            id: 'custpage_vendor_text',
            type: serverWidget.FieldType.TEXT,
            label: 'Vendor Text'
        });
        vendorTextField.defaultValue = params.vendorText || '';
        vendorTextField.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.HIDDEN
        });

        const poField = form.addField({
            id: 'custpage_po',
            type: serverWidget.FieldType.TEXT,
            label: 'Purchase Order'
        });
        poField.defaultValue = params.po || '';
        poField.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.HIDDEN
        });

        const poTextField = form.addField({
            id: 'custpage_po_text',
            type: serverWidget.FieldType.TEXT,
            label: 'PO Number Contains'
        });
        poTextField.defaultValue = params.poText || '';
        poTextField.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.HIDDEN
        });

        const locationField = form.addField({
            id: 'custpage_location',
            type: serverWidget.FieldType.TEXT,
            label: 'Location'
        });
        locationField.defaultValue = params.location || '';
        locationField.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.HIDDEN
        });

        const locationTextField = form.addField({
            id: 'custpage_location_text',
            type: serverWidget.FieldType.TEXT,
            label: 'Location Contains'
        });
        locationTextField.defaultValue = params.locationText || '';
        locationTextField.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.HIDDEN
        });

        const dateFromField = form.addField({
            id: 'custpage_date_from',
            type: serverWidget.FieldType.DATE,
            label: 'Date From'
        });
        dateFromField.defaultValue = params.dateFrom || '';
        dateFromField.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.HIDDEN
        });

        const dateToField = form.addField({
            id: 'custpage_date_to',
            type: serverWidget.FieldType.DATE,
            label: 'Date To'
        });
        dateToField.defaultValue = params.dateTo || '';
        dateToField.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.HIDDEN
        });

        const soOnlyField = form.addField({
            id: 'custpage_so_only',
            type: serverWidget.FieldType.TEXT,
            label: 'Only POs Created From Sales Order'
        });
        soOnlyField.defaultValue = params.soOnly ? 'T' : 'F';
        soOnlyField.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.HIDDEN
        });

        const selectedField = form.addField({
            id: 'custpage_selected_po_ids',
            type: serverWidget.FieldType.LONGTEXT,
            label: 'Selected PO IDs'
        });
        selectedField.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.HIDDEN
        });

        const actionField = form.addField({
            id: 'custpage_action',
            type: serverWidget.FieldType.TEXT,
            label: 'Action'
        });
        actionField.updateDisplayType({
            displayType: serverWidget.FieldDisplayType.HIDDEN
        });

        const htmlField = form.addField({
            id: 'custpage_master_po_html',
            type: serverWidget.FieldType.INLINEHTML,
            label: 'Master PO Workspace'
        });

        htmlField.defaultValue = buildHtml({
            data: data.purchaseOrders,
            searchSummary: {
                lineCount: data.lineCount,
                poCount: data.purchaseOrders.length,
                truncated: data.truncated,
                maxSearchLines: CONFIG.maxSearchLines
            },
            filters: params,
            vendorOptions: vendorOptions,
            poOptions: poOptions,
            locationOptions: locationOptions,
            message: loadMessage,
            suiteletUrl: url.resolveScript({
                scriptId: runtime.getCurrentScript().id,
                deploymentId: runtime.getCurrentScript().deploymentId,
                returnExternalUrl: false
            })
        });

        context.response.writePage(form);
    }

    function normalizeParams(params) {
        const dateFromIso = params.im_date_from || params.custpage_date_from_iso || '';
        const dateToIso = params.im_date_to || params.custpage_date_to_iso || '';

        return {
            vendor: params.im_vendor || params.custpage_vendor || '',
            vendorText: trim(params.im_vendor_text || params.custpage_vendor_text),
            po: params.im_po || params.custpage_po || '',
            poText: trim(params.im_po_text || params.custpage_po_text),
            location: params.im_location || params.custpage_location || '',
            locationText: trim(params.im_location_text || params.custpage_location_text),
            dateFrom: toNetSuiteDate(dateFromIso) || toNetSuiteDate(params.custpage_date_from) || params.custpage_date_from || '',
            dateFromIso: dateFromIso || toIsoDate(params.custpage_date_from) || normalizeIsoDate(params.custpage_date_from),
            dateTo: toNetSuiteDate(dateToIso) || toNetSuiteDate(params.custpage_date_to) || params.custpage_date_to || '',
            dateToIso: dateToIso || toIsoDate(params.custpage_date_to) || normalizeIsoDate(params.custpage_date_to),
            soOnly: (params.im_so_only || params.custpage_so_only) === 'T'
        };
    }

    function buildMainSearchFilters(params) {
        const filters = [
            ['type', 'anyof', 'PurchOrd'],
            'AND',
            ['mainline', 'is', 'F'],
            'AND',
            ['status', 'anyof', 'PurchOrd:F', 'PurchOrd:D', 'PurchOrd:E', 'PurchOrd:B', 'PurchOrd:A'],
            'AND',
            ['taxline', 'is', 'F'],
            'AND',
            ['shipping', 'is', 'F'],
            'AND',
            ['cogs', 'is', 'F']
        ];

        function andFilter(filter) {
            filters.push('AND', filter);
        }

        if (params && params.vendorText) {
            andFilter(['formulatext: {mainname}', 'contains', params.vendorText]);
        }

        if (params && params.po) {
            andFilter(['internalidnumber', 'equalto', params.po]);
        } else if (params && params.poText) {
            andFilter(['tranid', 'contains', params.poText]);
        }

        if (params && params.location) {
            andFilter(['location', 'anyof', params.location]);
        } else if (params && params.locationText) {
            andFilter(['formulatext: {location}', 'contains', params.locationText]);
        }

        if (params && params.dateFrom) {
            andFilter(['trandate', 'onorafter', params.dateFrom]);
        }

        if (params && params.dateTo) {
            andFilter(['trandate', 'onorbefore', params.dateTo]);
        }

        return filters;
    }

    function getPurchaseOrderData(params) {
        const filters = buildMainSearchFilters(params);
        const columns = getPoSearchColumns();
        const poSearch = search.create({
            type: search.Type.PURCHASE_ORDER,
            settings: [{
                name: 'consolidationtype',
                value: 'ACCTTYPE'
            }],
            filters: filters,
            columns: [
                columns.internalId,
                columns.tranid,
                columns.trandate,
                columns.vendorInternalId,
                columns.mainName,
                columns.memoMain,
                columns.status,
                columns.currency,
                columns.exchangeRate,
                columns.createdFrom,
                columns.item,
                columns.lineMemo,
                columns.locationInternalId,
                columns.location,
                columns.subsidiaryInternalId,
                columns.department,
                columns.subsidiary,
                columns.quantity,
                columns.rate,
                columns.amount,
                columns.total,
                columns.expectedReceiptDate,
                columns.line,
                columns.lineUniqueKey
            ]
        });

        const poMap = {};
        const order = [];
        let lineCount = 0;
        let truncated = false;
        const paged = poSearch.runPaged({
            pageSize: 1000
        });

        for (let pageIndex = 0; pageIndex < paged.pageRanges.length; pageIndex += 1) {
            const page = paged.fetch({
                index: pageIndex
            });

            for (let i = 0; i < page.data.length; i += 1) {
                if (lineCount >= CONFIG.maxSearchLines) {
                    truncated = true;
                    break;
                }

                addResultToPoMap(page.data[i], columns, poMap, order);
                lineCount += 1;
            }

            if (truncated) {
                break;
            }
        }

        let purchaseOrders = order.map(function (poId) {
            const po = poMap[poId];
            po.total = roundCurrency(po.total);
            po.sourceSalesOrders = Object.keys(po.sourceSalesOrderMap).map(function (soId) {
                return po.sourceSalesOrderMap[soId];
            });
            po.sourceSalesOrderText = po.sourceSalesOrders.map(function (so) {
                return so.tranid;
            }).join(', ');
            po.hasSalesOrder = po.sourceSalesOrders.length > 0;
            delete po.sourceSalesOrderMap;
            delete po.totalFromTransaction;
            return po;
        });

        if (params.soOnly) {
            purchaseOrders = purchaseOrders.filter(function (po) {
                return po.hasSalesOrder;
            });
        }

        return {
            purchaseOrders: purchaseOrders,
            lineCount: lineCount,
            truncated: truncated || paged.count > CONFIG.maxSearchLines
        };
    }

    function getPoSearchColumns() {
        return {
            internalId: search.createColumn({
                name: 'internalid'
            }),
            tranid: search.createColumn({
                name: 'tranid'
            }),
            trandate: search.createColumn({
                name: 'trandate',
                sort: search.Sort.DESC
            }),
            mainName: search.createColumn({
                name: 'mainname'
            }),
            vendorInternalId: search.createColumn({
                name: 'internalid',
                join: 'vendor',
                label: 'Internal ID'
            }),
            memoMain: search.createColumn({
                name: 'memomain'
            }),
            status: search.createColumn({
                name: 'statusref'
            }),
            currency: search.createColumn({
                name: 'currency'
            }),
            exchangeRate: search.createColumn({
                name: 'exchangerate'
            }),
            subsidiaryInternalId: search.createColumn({
                name: 'subsidiary'
            }),
            subsidiary: search.createColumn({
                name: 'subsidiarynohierarchy'
            }),
            locationInternalId: search.createColumn({
                name: 'location'
            }),
            location: search.createColumn({
                name: 'locationnohierarchy'
            }),
            department: search.createColumn({
                name: 'departmentnohierarchy'
            }),
            line: search.createColumn({
                name: 'line'
            }),
            lineUniqueKey: search.createColumn({
                name: 'lineuniquekey'
            }),
            item: search.createColumn({
                name: 'item'
            }),
            lineMemo: search.createColumn({
                name: 'memo'
            }),
            quantity: search.createColumn({
                name: 'quantity'
            }),
            rate: search.createColumn({
                name: 'rate'
            }),
            amount: search.createColumn({
                name: 'amount'
            }),
            total: search.createColumn({
                name: 'total'
            }),
            expectedReceiptDate: search.createColumn({
                name: 'expectedreceiptdate'
            }),
            createdFrom: search.createColumn({
                name: 'createdfrom'
            })
        };
    }

    function getVendorOptions(selectedVendorId) {
        const options = [];
        const seen = {};

        if (selectedVendorId) {
            const selectedName = lookupEntityName(search.Type.VENDOR, selectedVendorId);
            options.push({
                id: selectedVendorId,
                name: selectedName || selectedVendorId
            });
            seen[selectedVendorId] = true;
        }

        try {
            const vendorSearch = search.create({
                type: search.Type.VENDOR,
                filters: [
                    search.createFilter({
                        name: 'isinactive',
                        operator: search.Operator.IS,
                        values: 'F'
                    })
                ],
                columns: [
                    search.createColumn({
                        name: 'entityid',
                        sort: search.Sort.ASC
                    }),
                    search.createColumn({
                        name: 'companyname'
                    }),
                    search.createColumn({
                        name: 'altname'
                    })
                ]
            });
            const paged = vendorSearch.runPaged({
                pageSize: 1000
            });

            for (let pageIndex = 0; pageIndex < paged.pageRanges.length && options.length < 1000; pageIndex += 1) {
                const page = paged.fetch({
                    index: pageIndex
                });

                page.data.forEach(function (result) {
                    const id = result.id;

                    if (seen[id] || options.length >= 1000) {
                        return;
                    }

                    const entityId = result.getValue({
                        name: 'entityid'
                    }) || '';
                    const companyName = result.getValue({
                        name: 'companyname'
                    }) || result.getValue({
                        name: 'altname'
                    }) || '';
                    options.push({
                        id: id,
                        name: trim(entityId + (companyName ? ' - ' + companyName : '')) || id
                    });
                    seen[id] = true;
                });
            }
        } catch (ex) {
            log.debug({
                title: 'Vendor options unavailable',
                details: ex.message || ex
            });
        }

        return options;
    }

    function getPoOptions(selectedPoId, poText) {
        const options = [];
        const seen = {};

        if (selectedPoId) {
            addOption(options, seen, selectedPoId, lookupTransactionName(search.Type.PURCHASE_ORDER, selectedPoId) || selectedPoId);
        }

        try {
            const filters = [
                ['type', 'anyof', 'PurchOrd'],
                'AND',
                ['mainline', 'is', 'T'],
                'AND',
                ['status', 'anyof', 'PurchOrd:F', 'PurchOrd:D', 'PurchOrd:E', 'PurchOrd:B', 'PurchOrd:A']
            ];

            if (poText) {
                filters.push('AND', ['tranid', 'contains', poText]);
            }

            const columns = {
                internalId: search.createColumn({
                    name: 'internalid'
                }),
                tranid: search.createColumn({
                    name: 'tranid',
                    sort: search.Sort.DESC
                }),
                mainName: search.createColumn({
                    name: 'mainname'
                }),
                trandate: search.createColumn({
                    name: 'trandate'
                })
            };
            const poSearch = search.create({
                type: search.Type.PURCHASE_ORDER,
                settings: [{
                    name: 'consolidationtype',
                    value: 'ACCTTYPE'
                }],
                filters: filters,
                columns: [columns.internalId, columns.tranid, columns.mainName, columns.trandate]
            });
            const paged = poSearch.runPaged({
                pageSize: 1000
            });

            for (let pageIndex = 0; pageIndex < paged.pageRanges.length && options.length < 1000; pageIndex += 1) {
                const page = paged.fetch({
                    index: pageIndex
                });

                page.data.forEach(function (result) {
                    const id = result.getValue(columns.internalId);
                    const tranid = result.getValue(columns.tranid) || id;
                    const vendor = result.getText(columns.mainName) || result.getValue(columns.mainName) || '';
                    const date = result.getValue(columns.trandate) || '';
                    const label = trim([tranid, vendor, date].filter(Boolean).join(' - '));
                    addOption(options, seen, id, label || id);
                });
            }
        } catch (ex) {
            log.debug({
                title: 'PO options unavailable',
                details: ex.message || ex
            });
        }

        return options;
    }

    function getLocationOptions(selectedLocationId, locationText) {
        const options = [];
        const seen = {};

        if (selectedLocationId) {
            addOption(options, seen, selectedLocationId, lookupLocationName(selectedLocationId) || selectedLocationId);
        }

        try {
            const filters = [
                search.createFilter({
                    name: 'isinactive',
                    operator: search.Operator.IS,
                    values: 'F'
                })
            ];

            if (locationText) {
                filters.push(search.createFilter({
                    name: 'name',
                    operator: search.Operator.CONTAINS,
                    values: locationText
                }));
            }

            const columns = {
                internalId: search.createColumn({
                    name: 'internalid'
                }),
                name: search.createColumn({
                    name: 'name',
                    sort: search.Sort.ASC
                })
            };
            const locationSearch = search.create({
                type: search.Type.LOCATION,
                filters: filters,
                columns: [columns.internalId, columns.name]
            });
            const paged = locationSearch.runPaged({
                pageSize: 1000
            });

            for (let pageIndex = 0; pageIndex < paged.pageRanges.length && options.length < 1000; pageIndex += 1) {
                const page = paged.fetch({
                    index: pageIndex
                });

                page.data.forEach(function (result) {
                    const id = result.getValue(columns.internalId);
                    const label = result.getValue(columns.name) || id;
                    addOption(options, seen, id, label || id);
                });
            }
        } catch (ex) {
            log.debug({
                title: 'Location options unavailable',
                details: ex.message || ex
            });
        }

        return options;
    }

    function addOption(options, seen, id, name) {
        const cleanId = String(id || '');

        if (!cleanId || seen[cleanId]) {
            return;
        }

        options.push({
            id: cleanId,
            name: name || cleanId
        });
        seen[cleanId] = true;
    }

    function lookupEntityName(type, id) {
        try {
            const values = search.lookupFields({
                type: type,
                id: id,
                columns: ['entityid', 'companyname', 'altname']
            });
            return trim((values.entityid || '') + (values.companyname ? ' - ' + values.companyname : '')) ||
                values.altname ||
                id;
        } catch (ex) {
            return '';
        }
    }

    function lookupTransactionName(type, id) {
        try {
            const values = search.lookupFields({
                type: type,
                id: id,
                columns: ['tranid']
            });
            return values.tranid || '';
        } catch (ex) {
            return '';
        }
    }

    function lookupLocationName(id) {
        try {
            const values = search.lookupFields({
                type: search.Type.LOCATION,
                id: id,
                columns: ['name']
            });
            return values.name || '';
        } catch (ex) {
            return '';
        }
    }

    function buildNetSuiteUrl(kind, id) {
        if (!id) {
            return '';
        }

        const cleanId = encodeURIComponent(String(id));
        const paths = {
            po: '/app/accounting/transactions/purchord.nl?id=',
            so: '/app/accounting/transactions/salesord.nl?id=',
            vendor: '/app/common/entity/vendor.nl?id=',
            item: '/app/common/item/item.nl?id='
        };

        return (paths[kind] || '') + cleanId;
    }

    function addResultToPoMap(result, columns, poMap, order) {
        const poId = result.getValue(columns.internalId);
        const lineAmount = toNumber(result.getValue(columns.amount));
        const transactionTotal = toNumber(result.getValue(columns.total));
        const createdFromId = result.getValue(columns.createdFrom);
        const createdFromText = result.getText(columns.createdFrom) || '';
        const isSalesOrder = isCreatedFromSalesOrder(createdFromId, createdFromText);
        const vendorId = result.getValue(columns.vendorInternalId) || '';
        const vendorText = result.getText(columns.mainName) || result.getValue(columns.mainName) || vendorId;
        const currencyId = result.getValue(columns.currency) || '';
        const currencyText = result.getText(columns.currency) || result.getValue(columns.currency) || '';
        const exchangeRate = result.getValue(columns.exchangeRate) || '';
        const subsidiaryId = result.getValue(columns.subsidiaryInternalId) || '';
        const subsidiaryText = result.getText(columns.subsidiary) || result.getValue(columns.subsidiary) || '';
        const locationId = result.getValue(columns.locationInternalId) || '';
        const locationText = result.getText(columns.location) || result.getValue(columns.location) || '';

        if (!poMap[poId]) {
            order.push(poId);
            poMap[poId] = {
                id: poId,
                tranid: result.getValue(columns.tranid) || '',
                url: buildNetSuiteUrl('po', poId),
                date: result.getValue(columns.trandate) || '',
                vendorId: vendorId,
                vendor: vendorText,
                vendorUrl: buildNetSuiteUrl('vendor', vendorId),
                currencyId: currencyId,
                currency: currencyText,
                exchangeRate: exchangeRate,
                status: result.getText(columns.status) || result.getValue(columns.status) || '',
                subsidiaryId: subsidiaryId,
                subsidiary: subsidiaryText,
                locationId: locationId,
                location: locationText,
                department: result.getText(columns.department) || '',
                memo: result.getValue(columns.memoMain) || '',
                total: transactionTotal,
                totalFromTransaction: !!transactionTotal,
                lineCount: 0,
                sourceSalesOrderMap: {},
                lines: []
            };
        }

        const po = poMap[poId];
        if (!po.totalFromTransaction) {
            po.total += lineAmount;
        }
        po.lineCount += 1;

        if (isSalesOrder && createdFromId) {
            po.sourceSalesOrderMap[createdFromId] = {
                id: createdFromId,
                tranid: createdFromText || createdFromId,
                url: buildNetSuiteUrl('so', createdFromId)
            };
        }

        const itemId = result.getValue(columns.item) || '';

        po.lines.push({
            poId: poId,
            poTranId: po.tranid,
            line: result.getValue(columns.line) || '',
            lineUniqueKey: result.getValue(columns.lineUniqueKey) || '',
            itemId: itemId,
            item: result.getText(columns.item) || result.getValue(columns.item) || '',
            itemUrl: buildNetSuiteUrl('item', itemId),
            description: result.getValue(columns.lineMemo) || '',
            quantity: result.getValue(columns.quantity) || '',
            rate: result.getValue(columns.rate) || '',
            amount: roundCurrency(lineAmount),
            locationId: locationId,
            location: locationText,
            expectedReceiptDate: result.getValue(columns.expectedReceiptDate) || '',
            sourceSalesOrderId: isSalesOrder ? createdFromId : '',
            sourceSalesOrderTranId: isSalesOrder ? createdFromText : '',
            sourceSalesOrderUrl: isSalesOrder ? buildNetSuiteUrl('so', createdFromId) : '',
            sourceType: createdFromText || ''
        });
    }

    function createMasterPo(selectedPoIds) {
        if (!selectedPoIds.length) {
            throw error.create({
                name: 'NO_PURCHASE_ORDERS_SELECTED',
                message: 'Select at least one Purchase Order before creating a Master PO.'
            });
        }

        const data = getPurchaseOrdersByIds(selectedPoIds);

        if (!data.purchaseOrders.length) {
            throw error.create({
                name: 'NO_PURCHASE_ORDER_DATA',
                message: 'No Purchase Order lines were found for the selected records.'
            });
        }

        const vendorId = data.purchaseOrders[0].vendorId;
        const subsidiaryId = data.purchaseOrders[0].subsidiaryId;
        const currencyId = data.purchaseOrders[0].currencyId;
        const exchangeRate = data.purchaseOrders[0].exchangeRate;
        const tranDate = new Date();
        const memo = buildMasterMemo(data.purchaseOrders);
        const currentUserId = runtime.getCurrentUser().id;

        if (!vendorId) {
            throw error.create({
                name: 'MISSING_VENDOR',
                message: 'Vendor internal ID was not found on the selected Purchase Orders.'
            });
        }

        if (!subsidiaryId) {
            throw error.create({
                name: 'MISSING_SUBSIDIARY',
                message: 'Subsidiary internal ID was not found on the selected Purchase Orders.'
            });
        }

        const mixedVendor = data.purchaseOrders.some(function (po) {
            return po.vendorId !== vendorId;
        });

        if (mixedVendor) {
            throw error.create({
                name: 'MIXED_VENDOR_SELECTION',
                message: 'All selected Purchase Orders must belong to the same vendor.'
            });
        }

        const mixedSubsidiary = data.purchaseOrders.some(function (po) {
            return po.subsidiaryId !== subsidiaryId;
        });

        if (mixedSubsidiary) {
            throw error.create({
                name: 'MIXED_SUBSIDIARY_SELECTION',
                message: 'All selected Purchase Orders must belong to the same subsidiary.'
            });
        }

        const payloadLog = {
            recordType: CONFIG.masterPoRecordType,
            selectedPurchaseOrderIds: selectedPoIds,
            header: buildSubmitValues(CONFIG.bodyFields.vendor, vendorId),
            sourceLineReferences: []
        };
        payloadLog.header[CONFIG.bodyFields.subsidiary] = subsidiaryId;
        payloadLog.header[CONFIG.bodyFields.transactionDate] = tranDate;
        payloadLog.header[CONFIG.bodyFields.memo] = memo;
        payloadLog.header[CONFIG.bodyFields.currency] = currencyId || '';
        payloadLog.header[CONFIG.bodyFields.exchangeRate] = exchangeRate || '';
        payloadLog.header[CONFIG.bodyFields.createdBy] = currentUserId || '';

        const master = record.create({
            type: CONFIG.masterPoRecordType,
            isDynamic: false
        });

        setRequiredValue(master, CONFIG.bodyFields.vendor, vendorId, 'Vendor');
        setRequiredValue(master, CONFIG.bodyFields.subsidiary, subsidiaryId, 'Subsidiary');
        setRequiredValue(master, CONFIG.bodyFields.transactionDate, tranDate, 'Transaction Date');
        safeSetValue(master, CONFIG.bodyFields.memo, memo);
        safeSetValue(master, CONFIG.bodyFields.currency, currencyId);
        safeSetValue(master, CONFIG.bodyFields.exchangeRate, exchangeRate);
        safeSetValue(master, CONFIG.bodyFields.createdBy, currentUserId);

        let sourceLineCount = 0;

        data.purchaseOrders.forEach(function (po) {
            po.lines.forEach(function (line) {
                if (!line.itemId) {
                    return;
                }

                payloadLog.sourceLineReferences.push({
                    sourcePoId: po.id,
                    sourcePoNumber: po.tranid,
                    sourceLine: line.line,
                    sourceLineUniqueKey: line.lineUniqueKey,
                    item: line.itemId,
                    description: line.description,
                    quantity: toNumber(line.quantity) || 0,
                    rate: toNumber(line.rate) || 0,
                    amount: roundCurrency(line.amount),
                    location: line.locationId || '',
                    sourceSalesOrderId: line.sourceSalesOrderId || '',
                    sourceSalesOrderNumber: line.sourceSalesOrderTranId || ''
                });
                sourceLineCount += 1;
            });
        });

        if (!sourceLineCount) {
            throw error.create({
                name: 'NO_ITEM_LINES_SELECTED',
                message: 'The selected Purchase Orders did not contain item lines to copy to the Master PO.'
            });
        }

        payloadLog.sourceLineCount = sourceLineCount;
        logLargePayload('Consolidated PO custom record payload', payloadLog);

        const masterPoId = master.save({
            enableSourcing: true,
            ignoreMandatoryFields: false
        });

        log.audit({
            title: 'Consolidated PO custom record created',
            details: {
                recordType: CONFIG.masterPoRecordType,
                id: masterPoId,
                sourcePurchaseOrderIds: selectedPoIds
            }
        });

        updateSourcePurchaseOrders(selectedPoIds, masterPoId);

        return {
            id: masterPoId
        };
    }

    function getPurchaseOrdersByIds(poIds) {
        const filters = buildMainSearchFilters({});
        filters.push('AND', ['internalid', 'anyof', poIds]);
        const columns = getPoSearchColumns();
        const poSearch = search.create({
            type: search.Type.PURCHASE_ORDER,
            settings: [{
                name: 'consolidationtype',
                value: 'ACCTTYPE'
            }],
            filters: filters,
            columns: [
                columns.internalId,
                columns.tranid,
                columns.trandate,
                columns.vendorInternalId,
                columns.mainName,
                columns.memoMain,
                columns.status,
                columns.currency,
                columns.exchangeRate,
                columns.createdFrom,
                columns.item,
                columns.lineMemo,
                columns.locationInternalId,
                columns.location,
                columns.subsidiaryInternalId,
                columns.department,
                columns.subsidiary,
                columns.quantity,
                columns.rate,
                columns.amount,
                columns.total,
                columns.expectedReceiptDate,
                columns.line,
                columns.lineUniqueKey
            ]
        });

        const poMap = {};
        const order = [];
        const sourceSalesOrderMap = {};
        const paged = poSearch.runPaged({
            pageSize: 1000
        });

        for (let pageIndex = 0; pageIndex < paged.pageRanges.length; pageIndex += 1) {
            const page = paged.fetch({
                index: pageIndex
            });

            page.data.forEach(function (result) {
                addResultToPoMap(result, columns, poMap, order);
            });
        }

        const purchaseOrders = order.map(function (poId) {
            const po = poMap[poId];
            po.sourceSalesOrders = Object.keys(po.sourceSalesOrderMap).map(function (soId) {
                const so = po.sourceSalesOrderMap[soId];
                sourceSalesOrderMap[soId] = so;
                return so;
            });
            delete po.sourceSalesOrderMap;
            delete po.totalFromTransaction;
            return po;
        });

        return {
            purchaseOrders: purchaseOrders,
            sourceSalesOrderIds: Object.keys(sourceSalesOrderMap)
        };
    }

    function buildMasterMemo(purchaseOrders) {
        const poNumbers = purchaseOrders.map(function (po) {
            return po.tranid || po.id;
        });

        return 'Master PO created from: ' + poNumbers.join(', ');
    }

    function parseSelectedPoIds(value) {
        let parsed;

        try {
            parsed = JSON.parse(value || '[]');
        } catch (ex) {
            parsed = [];
        }

        const clean = {};
        (Array.isArray(parsed) ? parsed : []).forEach(function (id) {
            const normalized = String(id || '').replace(/\D/g, '');
            if (normalized) {
                clean[normalized] = true;
            }
        });

        return Object.keys(clean);
    }

    function updateSourcePurchaseOrders(poIds, masterPoId) {
        const failedPoIds = [];

        poIds.forEach(function (poId) {
            try {
                const values = buildSubmitValues(CONFIG.sourcePoUpdateField, masterPoId);
                logLargePayload('Source PO master link update payload', {
                    recordType: record.Type.PURCHASE_ORDER,
                    id: poId,
                    values: values
                });

                record.submitFields({
                    type: record.Type.PURCHASE_ORDER,
                    id: poId,
                    values: values,
                    options: {
                        enableSourcing: false,
                        ignoreMandatoryFields: true
                    }
                });
            } catch (ex) {
                failedPoIds.push(poId);
                log.error({
                    title: 'Failed to update source PO ' + poId,
                    details: ex
                });
            }
        });

        if (failedPoIds.length) {
            throw error.create({
                name: 'SOURCE_PO_UPDATE_FAILED',
                message: 'Master PO ' + masterPoId + ' was created, but these Purchase Orders were not updated: ' + failedPoIds.join(', ')
            });
        }
    }

    function buildSubmitValues(fieldId, value) {
        const values = {};
        values[fieldId] = value;
        return values;
    }

    function logLargePayload(title, payload) {
        let details;

        try {
            details = JSON.stringify(payload);
        } catch (ex) {
            details = String(payload);
        }

        const chunkSize = 3500;

        for (let start = 0, part = 1; start < details.length; start += chunkSize, part += 1) {
            log.audit({
                title: title + (details.length > chunkSize ? ' part ' + part : ''),
                details: details.slice(start, start + chunkSize)
            });
        }
    }

    function setRequiredValue(rec, fieldId, value, label) {
        if (!fieldId || value === '' || value === null || typeof value === 'undefined') {
            throw error.create({
                name: 'MISSING_MASTER_PO_VALUE',
                message: (label || fieldId) + ' is required to create the Master PO.'
            });
        }

        rec.setValue({
            fieldId: fieldId,
            value: value
        });
    }

    function safeSetValue(rec, fieldId, value) {
        if (!fieldId || value === '' || value === null || typeof value === 'undefined') {
            return;
        }

        try {
            rec.setValue({
                fieldId: fieldId,
                value: value
            });
        } catch (ex) {
            log.debug({
                title: 'Skipped body field ' + fieldId,
                details: ex.message || ex
            });
        }
    }

    function safeSetArrayOrText(rec, fieldId, values) {
        if (!fieldId || !values || !values.length) {
            return;
        }

        try {
            rec.setValue({
                fieldId: fieldId,
                value: values
            });
        } catch (arrayEx) {
            try {
                rec.setValue({
                    fieldId: fieldId,
                    value: values.join(',')
                });
            } catch (textEx) {
                log.debug({
                    title: 'Skipped body field ' + fieldId,
                    details: textEx.message || textEx
                });
            }
        }
    }

    function safeSetCurrentLineValue(rec, sublistId, fieldId, value) {
        if (!fieldId || value === '' || value === null || typeof value === 'undefined') {
            return;
        }

        try {
            rec.setCurrentSublistValue({
                sublistId: sublistId,
                fieldId: fieldId,
                value: value,
                ignoreFieldChange: true
            });
        } catch (ex) {
            log.debug({
                title: 'Skipped line field ' + fieldId,
                details: ex.message || ex
            });
        }
    }

    function isCreatedFromSalesOrder(value, text) {
        const combined = String(value || '') + ' ' + String(text || '');
        return /SalesOrd|Sales Order/i.test(combined);
    }

    function trim(value) {
        return String(value || '').replace(/^\s+|\s+$/g, '');
    }

    function toNetSuiteDate(value) {
        const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);

        if (!match) {
            return '';
        }

        return String(Number(match[2])) + '/' + String(Number(match[3])) + '/' + match[1];
    }

    function toIsoDate(value) {
        const match = String(value || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

        if (!match) {
            return '';
        }

        return match[3] + '-' + pad2(match[1]) + '-' + pad2(match[2]);
    }

    function normalizeIsoDate(value) {
        const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return match ? value : '';
    }

    function pad2(value) {
        const clean = String(Number(value || 0));
        return clean.length === 1 ? '0' + clean : clean;
    }

    function toNumber(value) {
        const parsed = parseFloat(String(value || '').replace(/,/g, ''));
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function roundCurrency(value) {
        return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
    }

    function safeJson(value) {
        return JSON.stringify(value)
            .replace(/</g, '\\u003c')
            .replace(/>/g, '\\u003e')
            .replace(/&/g, '\\u0026');
    }

    function buildHtml(viewModel) {
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
            '.im-btn-danger{background:#fff;border-color:#d9a6a6;color:#9f1f1f}',
            '.im-btn:disabled{opacity:.45;cursor:not-allowed}',
            '.im-alert{margin:12px 16px 0;padding:10px 12px;border-radius:6px;font-size:12px;border:1px solid #efcaca;background:#fff4f4;color:#8d1c1c}',
            '.im-warn{margin:12px 16px 0;padding:10px 12px;border-radius:6px;font-size:12px;border:1px solid #e4cc82;background:#fff8df;color:#745300}',
            '.im-metrics{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:8px;padding:12px 16px;background:#ffffff;border-bottom:1px solid #d7dde7}',
            '.im-metric{border:1px solid #dfe5ee;background:#fbfcfe;border-radius:6px;padding:8px 10px}',
            '.im-metric-label{font-size:10px;text-transform:uppercase;color:#64748b;font-weight:700;letter-spacing:0}',
            '.im-metric-value{font-size:16px;font-weight:800;color:#12263f;margin-top:2px}',
            '.im-filter-panel{display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:10px;padding:12px 16px;background:#fff;border-bottom:1px solid #d7dde7}',
            '.im-filter-cell label{display:block;font-size:11px;font-weight:800;color:#4b5565;margin-bottom:4px}',
            '.im-filter-cell input,.im-filter-cell select{width:100%;height:32px;border:1px solid #bdc7d8;border-radius:6px;background:#fff;padding:0 9px;font-size:12px;color:#1f2933}',
            '.im-filter-buttons{display:flex;align-items:flex-end;gap:8px}',
            '.im-table-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;background:#fff;border-bottom:1px solid #d7dde7}',
            '.im-table-buttons{display:flex;align-items:center;gap:8px;margin-left:auto}',
            '.im-link{color:#165ba7;font-weight:800;text-decoration:none}',
            '.im-link:hover{text-decoration:underline}',
            '.im-table-wrap{max-height:620px;overflow:auto;background:#fff}',
            '.im-table{border-collapse:separate;border-spacing:0;width:100%;font-size:12px}',
            '.im-table th{position:sticky;top:0;z-index:2;background:#e8eef7;color:#24364b;border-bottom:1px solid #cad4e3;border-right:1px solid #d8e0ea;text-align:left;padding:0;white-space:nowrap}',
            '.im-table th button{width:100%;height:34px;border:0;background:transparent;text-align:left;padding:0 9px;font-size:11px;font-weight:800;color:#24364b;cursor:pointer}',
            '.im-table th button:hover{background:#dce6f2}',
            '.im-table td{border-bottom:1px solid #e6ebf2;border-right:1px solid #edf1f6;padding:8px 9px;vertical-align:middle;background:#fff}',
            '.im-table tr:hover td{background:#f8fbff}',
            '.im-table tr.im-selected td{background:#edf7ff}',
            '.im-check{width:16px;height:16px;margin:0}',
            '.im-po-cell{display:flex;align-items:center;gap:8px;font-weight:800;color:#163b63}',
            '.im-expander{width:22px;height:22px;border:1px solid #bcc9da;border-radius:5px;background:#fff;color:#19324f;font-weight:800;cursor:pointer;line-height:20px;text-align:center;padding:0}',
            '.im-badge{display:inline-flex;align-items:center;height:22px;border-radius:999px;padding:0 8px;font-size:11px;font-weight:800;border:1px solid #bfd4ed;background:#eef6ff;color:#154e86}',
            '.im-badge-muted{background:#f5f6f8;border-color:#d5dbe4;color:#667085}',
            '.im-right{text-align:right}',
            '.im-muted{color:#667085}',
            '.im-details-row td{background:#f9fbfd!important;padding:0}',
            '.im-details{padding:12px 14px 16px}',
            '.im-detail-title{font-size:12px;font-weight:800;color:#12263f;margin-bottom:8px}',
            '.im-line-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dfe5ee;border-radius:6px;overflow:hidden}',
            '.im-line-table th{position:static;background:#f0f4fa;padding:7px 8px;border-bottom:1px solid #dfe5ee;font-size:11px}',
            '.im-line-table td{padding:7px 8px;border-bottom:1px solid #edf1f6;font-size:11px}',
            '.im-empty{padding:48px 20px;text-align:center;color:#667085;background:#fff}',
            '.im-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;background:#fff;border-top:1px solid #d7dde7;font-size:12px;color:#5b677a}',
            '.im-progress-overlay{position:fixed;inset:0;z-index:999999;display:none;align-items:center;justify-content:center;background:rgba(15,23,42,.38)}',
            '.im-progress-overlay.im-open{display:flex}',
            '.im-progress-card{width:min(380px,calc(100vw - 32px));border:1px solid #c9d4e4;background:#fff;border-radius:8px;box-shadow:0 24px 70px rgba(15,23,42,.24);padding:22px}',
            '.im-progress-title{font-size:15px;font-weight:800;color:#12263f;text-align:center}',
            '.im-progress-subtitle{font-size:12px;color:#667085;text-align:center;margin-top:6px}',
            '.im-progress-track{height:10px;overflow:hidden;border-radius:999px;background:#e6edf6;margin-top:18px}',
            '.im-progress-bar{height:100%;width:45%;border-radius:999px;background:#1664c0;animation:imProgress 1.05s ease-in-out infinite}',
            '@keyframes imProgress{0%{transform:translateX(-120%)}50%{transform:translateX(80%)}100%{transform:translateX(240%)}}',
            '@media(max-width:1100px){.im-filter-panel{grid-template-columns:repeat(3,minmax(120px,1fr))}}',
            '@media(max-width:900px){.im-metrics{grid-template-columns:repeat(2,minmax(120px,1fr))}.im-topbar{padding:14px 16px;flex-direction:column}.im-actions{position:static;transform:none}.im-footer,.im-table-actions{align-items:flex-start;flex-direction:column}.im-filter-panel{grid-template-columns:repeat(2,minmax(120px,1fr))}.im-table-wrap{max-height:560px}}',
            '</style>',
            '<div class="im-progress-overlay" id="im-create-progress" aria-hidden="true">',
            '<div class="im-progress-card">',
            '<div class="im-progress-title">Creating Master PO</div>',
            '<div class="im-progress-subtitle">Please wait while NetSuite creates the consolidated record.</div>',
            '<div class="im-progress-track"><div class="im-progress-bar"></div></div>',
            '</div>',
            '</div>',
            '<div class="im-master-po">',
            '<div class="im-shell">',
            '<div class="im-topbar">',
            '<div class="im-title">' + escapeHtml(CONFIG.pageTitle) + '</div>',
            '<div class="im-actions">',
            '<button type="button" class="im-btn im-btn-primary" id="im-create-master" disabled>Create Master PO</button>',
            '</div>',
            '</div>',
            viewModel.message ? '<div class="im-alert">' + escapeHtml(viewModel.message) + '</div>' : '',
            viewModel.searchSummary.truncated ? '<div class="im-warn">Search reached the display limit of ' + viewModel.searchSummary.maxSearchLines + ' lines. Narrow the NetSuite filters above to see the full result set.</div>' : '',
            '<div class="im-filter-panel">',
            '<div class="im-filter-cell"><label for="im-header-vendor-text">Vendor</label><input id="im-header-vendor-text" name="im_vendor_text" list="im-vendor-options" value="' + escapeAttribute(getOptionInputValue(viewModel.vendorOptions, viewModel.filters.vendor, viewModel.filters.vendorText)) + '" placeholder="Enter or select vendor"><input type="hidden" id="im-header-vendor" name="im_vendor" value="' + escapeAttribute(viewModel.filters.vendor) + '"><datalist id="im-vendor-options">' + buildDatalistOptionsHtml(viewModel.vendorOptions) + '</datalist></div>',
            '<div class="im-filter-cell"><label for="im-header-po-text">PO Number</label><input id="im-header-po-text" name="im_po_text" list="im-po-options" value="' + escapeAttribute(getOptionInputValue(viewModel.poOptions, viewModel.filters.po, viewModel.filters.poText)) + '" placeholder="Enter or select PO"><input type="hidden" id="im-header-po" name="im_po" value="' + escapeAttribute(viewModel.filters.po) + '"><datalist id="im-po-options">' + buildDatalistOptionsHtml(viewModel.poOptions) + '</datalist></div>',
            '<div class="im-filter-cell"><label for="im-header-location-text">Location</label><input id="im-header-location-text" name="im_location_text" list="im-location-options" value="' + escapeAttribute(getOptionInputValue(viewModel.locationOptions, viewModel.filters.location, viewModel.filters.locationText)) + '" placeholder="Enter or select location"><input type="hidden" id="im-header-location" name="im_location" value="' + escapeAttribute(viewModel.filters.location) + '"><datalist id="im-location-options">' + buildDatalistOptionsHtml(viewModel.locationOptions) + '</datalist></div>',
            '<div class="im-filter-cell"><label for="im-header-date-from">Date From</label><input id="im-header-date-from" name="im_date_from" type="date" value="' + escapeAttribute(viewModel.filters.dateFromIso) + '"></div>',
            '<div class="im-filter-cell"><label for="im-header-date-to">Date To</label><input id="im-header-date-to" name="im_date_to" type="date" value="' + escapeAttribute(viewModel.filters.dateToIso) + '"></div>',
            '<div class="im-filter-cell"><label for="im-header-so-only">Source</label><select id="im-header-so-only" name="im_so_only"><option value="F"' + (!viewModel.filters.soOnly ? ' selected' : '') + '>All POs</option><option value="T"' + (viewModel.filters.soOnly ? ' selected' : '') + '>Created from Sales Order</option></select></div>',
            '<div class="im-filter-buttons"><button type="button" class="im-btn" id="im-reset-filters">Reset Filters</button></div>',
            '</div>',
            '<div class="im-metrics">',
            '<div class="im-metric"><div class="im-metric-label">No. of POs</div><div class="im-metric-value" id="im-visible-count">0</div></div>',
            '<div class="im-metric"><div class="im-metric-label">Selected POs</div><div class="im-metric-value" id="im-selected-count">0</div></div>',
            '<div class="im-metric"><div class="im-metric-label">Selected Amount</div><div class="im-metric-value" id="im-selected-amount">0.00</div></div>',
            '<div class="im-metric"><div class="im-metric-label">Selected Vendor</div><div class="im-metric-value" id="im-selected-vendor">-</div></div>',
            '</div>',
            '<div class="im-table-actions">',
            '<div class="im-muted" id="im-selection-warning"></div>',
            '<div class="im-table-buttons"><button type="button" class="im-btn" id="im-mark-all">Mark All</button><button type="button" class="im-btn" id="im-unmark-all">Unmark All</button></div>',
            '</div>',
            '<div class="im-table-wrap">',
            '<table class="im-table" id="im-po-table">',
            '<thead>',
            '<tr>',
            '<th style="width:42px"><button type="button" data-sort="selected">Sel</button></th>',
            '<th style="width:160px"><button type="button" data-sort="tranid">PO Number</button></th>',
            '<th style="width:220px"><button type="button" data-sort="vendor">Vendor</button></th>',
            '<th style="width:105px"><button type="button" data-sort="date">Date</button></th>',
            '<th style="width:170px"><button type="button" data-sort="status">Status</button></th>',
            '<th style="width:220px"><button type="button" data-sort="sourceSalesOrderText">Source Sales Order</button></th>',
            '<th style="width:95px"><button type="button" data-sort="lineCount">Lines</button></th>',
            '<th style="width:130px"><button type="button" data-sort="total">Amount</button></th>',
            '<th style="width:170px"><button type="button" data-sort="location">Location</button></th>',
            '</tr>',
            '</thead>',
            '<tbody id="im-po-body"></tbody>',
            '</table>',
            '<div class="im-empty" id="im-empty" style="display:none">No Purchase Orders match the current filters.</div>',
            '</div>',
            '<div class="im-footer">',
            '<div>Loaded ' + viewModel.searchSummary.poCount + ' POs across ' + viewModel.searchSummary.lineCount + ' lines.</div>',
            '<div>Click a PO number to show item, quantity, rate, amount, expected receipt date, and source Sales Order.</div>',
            '</div>',
            '</div>',
            '</div>',
            '<script>',
            '(function(){',
            'var suiteletUrl=' + safeJson(viewModel.suiteletUrl || '') + ';',
            'var purchaseOrders=' + safeJson(viewModel.data) + ';',
            'var vendorOptions=' + safeJson(viewModel.vendorOptions) + ';',
            'var poOptions=' + safeJson(viewModel.poOptions) + ';',
            'var locationOptions=' + safeJson(viewModel.locationOptions) + ';',
            'var state={selected:{},expanded:{},sortField:"date",sortDir:"desc",filters:{vendor:{id:"",text:""},po:{id:"",text:""},location:{id:"",text:""},dateFrom:"",dateTo:"",soOnly:"F"}};',
            'var tbody=document.getElementById("im-po-body");',
            'var empty=document.getElementById("im-empty");',
            'var progressOverlay=document.getElementById("im-create-progress");',
            'var createButton=document.getElementById("im-create-master");',
            'function getField(id){return document.getElementById(id)||document.querySelector("[name=\\"" + id + "\\"]");}',
            'var selectedField=getField("custpage_selected_po_ids");',
            'var actionField=getField("custpage_action");',
            'function getSuiteletForm(){return (createButton&&createButton.form)||document.getElementById("main_form")||document.forms[0]||null;}',
            'function esc(value){return String(value==null?"":value).replace(/[&<>"]/g,function(ch){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[ch]||ch;});}',
            'function link(url,text){return url?"<a class=\\"im-link\\" href=\\""+esc(url)+"\\" target=\\"_blank\\">"+esc(text)+"</a>":esc(text);}',
            'function sourceLinks(po){if(!po.sourceSalesOrders||!po.sourceSalesOrders.length)return "<span class=\\"im-badge im-badge-muted\\">No SO</span>";return po.sourceSalesOrders.map(function(so){return "<span class=\\"im-badge\\">"+link(so.url,so.tranid)+"</span>";}).join(" ");}',
            'function number(value){var n=parseFloat(String(value||"0").replace(/,/g,""));return isFinite(n)?n:0;}',
            'function amount(value){return number(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});}',
            'function normalized(value){return String(value==null?"":value).toLowerCase();}',
            'function includesText(value,needle){needle=normalized(needle);return !needle||normalized(value).indexOf(needle)>=0;}',
            'function optionKey(option){return String(option.id||"")+"|"+String(option.name||"");}',
            'function mergeOption(options,seen,id,name){if(!id&&!name)return;var option={id:String(id||""),name:String(name||id||"")};var key=optionKey(option);if(!seen[key]){options.push(option);seen[key]=true;}}',
            'function refreshLoadedOptions(){var vendorSeen={},poSeen={},locationSeen={};vendorOptions=[];poOptions=[];locationOptions=[];purchaseOrders.forEach(function(po){mergeOption(vendorOptions,vendorSeen,po.vendorId,po.vendor);mergeOption(poOptions,poSeen,po.id,[po.tranid,po.vendor,po.date].filter(Boolean).join(" - "));mergeOption(locationOptions,locationSeen,po.locationId,po.location);(po.lines||[]).forEach(function(line){mergeOption(locationOptions,locationSeen,line.locationId,line.location);});});writeDatalist("im-vendor-options",vendorOptions);writeDatalist("im-po-options",poOptions);writeDatalist("im-location-options",locationOptions);}',
            'function writeDatalist(id,options){var list=document.getElementById(id);if(!list)return;list.innerHTML=options.slice(0,1000).map(function(option){return "<option value=\\""+esc(option.name)+"\\"></option>";}).join("");}',
            'function fieldValue(po,field){return field==="selected"?(state.selected[po.id]?1:0):po[field];}',
            'function sortRows(rows){rows.sort(function(a,b){var av=fieldValue(a,state.sortField);var bv=fieldValue(b,state.sortField);if(["total","lineCount","selected"].indexOf(state.sortField)>=0){av=number(av);bv=number(bv);return state.sortDir==="asc"?av-bv:bv-av;}av=normalized(av);bv=normalized(bv);if(av===bv)return 0;return (av>bv?1:-1)*(state.sortDir==="asc"?1:-1);});return rows;}',
            'function parseDate(value){var text=String(value||"");var iso=text.match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);if(iso)return new Date(Number(iso[1]),Number(iso[2])-1,Number(iso[3])).getTime();var us=text.match(/^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})$/);if(us)return new Date(Number(us[3]),Number(us[1])-1,Number(us[2])).getTime();return null;}',
            'function lineMatchesLocation(line,locationFilter){if(locationFilter.id&&String(line.locationId)!==String(locationFilter.id))return false;if(locationFilter.text&&!includesText([line.location,line.locationId].join(" "),locationFilter.text))return false;return true;}',
            'function matches(po){if(!po)return false;var f=state.filters;if(f.vendor.id&&String(po.vendorId)!==String(f.vendor.id))return false;if(f.vendor.text&&!includesText([po.vendor,po.vendorId].join(" "),f.vendor.text))return false;if(f.po.id&&String(po.id)!==String(f.po.id))return false;if(f.po.text&&!includesText([po.tranid,po.id,po.vendor,po.memo].join(" "),f.po.text))return false;if((f.location.id||f.location.text)&&!lineMatchesLocation({locationId:po.locationId,location:po.location},f.location)&&!(po.lines||[]).some(function(line){return lineMatchesLocation(line,f.location);})){return false;}var poDate=parseDate(po.date);var from=parseDate(f.dateFrom);var to=parseDate(f.dateTo);if(from!==null&&poDate!==null&&poDate<from)return false;if(to!==null&&poDate!==null&&poDate>to)return false;if((from!==null||to!==null)&&poDate===null)return false;if(f.soOnly==="T"&&!po.hasSalesOrder)return false;return true;}',
            'function visibleRows(){return sortRows(purchaseOrders.filter(matches));}',
            'function render(){var rows=visibleRows();tbody.innerHTML="";empty.style.display=rows.length?"none":"block";rows.forEach(function(po){tbody.appendChild(renderPoRow(po));if(state.expanded[po.id])tbody.appendChild(renderDetailsRow(po));});updateMetrics(rows);}',
            'function renderPoRow(po){var tr=document.createElement("tr");tr.className=state.selected[po.id]?"im-selected":"";tr.innerHTML=[',
            '"<td><input class=\\"im-check\\" type=\\"checkbox\\" data-select=\\""+esc(po.id)+"\\" "+(state.selected[po.id]?"checked":"")+"></td>",',
            '"<td><div class=\\"im-po-cell\\"><button type=\\"button\\" class=\\"im-expander\\" data-expand=\\""+esc(po.id)+"\\">"+(state.expanded[po.id]?"-":"+")+"</button>"+link(po.url,po.tranid)+"</div></td>",',
            '"<td>"+link(po.vendorUrl,po.vendor)+"</td>",',
            '"<td>"+esc(po.date)+"</td>",',
            '"<td>"+esc(po.status)+"</td>",',
            '"<td>"+sourceLinks(po)+"</td>",',
            '"<td class=\\"im-right\\">"+esc(po.lineCount)+"</td>",',
            '"<td class=\\"im-right\\">"+amount(po.total)+"</td>",',
            '"<td>"+esc(po.location)+"</td>"',
            '].join("");return tr;}',
            'function renderDetailsRow(po){var tr=document.createElement("tr");tr.className="im-details-row";var col=document.createElement("td");col.colSpan=9;var lineRows=po.lines.map(function(line){var lineSo=line.sourceSalesOrderTranId?link(line.sourceSalesOrderUrl,line.sourceSalesOrderTranId):"";return "<tr><td>"+esc(line.line)+"</td><td>"+link(line.itemUrl,line.item)+"</td><td>"+esc(line.description)+"</td><td class=\\"im-right\\">"+esc(line.quantity)+"</td><td class=\\"im-right\\">"+esc(line.rate)+"</td><td class=\\"im-right\\">"+amount(line.amount)+"</td><td>"+esc(line.expectedReceiptDate)+"</td><td>"+lineSo+"</td></tr>";}).join("");col.innerHTML="<div class=\\"im-details\\"><div class=\\"im-detail-title\\">PO line details for "+esc(po.tranid)+"</div><table class=\\"im-line-table\\"><thead><tr><th>Line</th><th>Item</th><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th><th>Expected Receipt</th><th>Source Sales Order</th></tr></thead><tbody>"+lineRows+"</tbody></table></div>";tr.appendChild(col);return tr;}',
            'function updateMetrics(rows){var selectedIds=Object.keys(state.selected);var selectedRows=purchaseOrders.filter(function(po){return !!state.selected[po.id];});var selectedTotal=selectedRows.reduce(function(sum,po){return sum+number(po.total);},0);var vendors={};selectedRows.forEach(function(po){vendors[po.vendorId]=po.vendor;});var vendorNames=Object.keys(vendors).map(function(id){return vendors[id];});document.getElementById("im-visible-count").textContent=rows.length;document.getElementById("im-selected-count").textContent=selectedIds.length;document.getElementById("im-selected-amount").textContent=amount(selectedTotal);document.getElementById("im-selected-vendor").textContent=vendorNames.length===1?vendorNames[0]:"-";document.getElementById("im-selection-warning").textContent=vendorNames.length>1?"Selected POs must be from one vendor.":"";createButton.disabled=selectedIds.length===0||vendorNames.length>1;if(selectedField)selectedField.value=JSON.stringify(selectedIds);}',
            'tbody.addEventListener("click",function(evt){var expand=evt.target.getAttribute("data-expand");if(expand){state.expanded[expand]=!state.expanded[expand];render();}});',
            'tbody.addEventListener("change",function(evt){var id=evt.target.getAttribute("data-select");if(id){if(evt.target.checked){state.selected[id]=true;}else{delete state.selected[id];}render();}});',
            '[].slice.call(document.querySelectorAll("[data-sort]")).forEach(function(btn){btn.addEventListener("click",function(){var field=btn.getAttribute("data-sort");if(state.sortField===field){state.sortDir=state.sortDir==="asc"?"desc":"asc";}else{state.sortField=field;state.sortDir="asc";}render();});});',
            'document.getElementById("im-mark-all").addEventListener("click",function(){visibleRows().forEach(function(po){state.selected[po.id]=true;});render();});',
            'document.getElementById("im-unmark-all").addEventListener("click",function(){state.selected={};render();});',
            'function setHidden(id,value){var el=document.getElementById(id);if(el)el.value=value;}',
            'function toNsDate(value){var m=String(value||"").match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);return m?(String(Number(m[2]))+"/"+String(Number(m[3]))+"/"+m[1]):value;}',
            'function resolveOption(inputId,options){var text=String(document.getElementById(inputId).value||"").replace(/^\\s+|\\s+$/g,"");if(!text)return {id:"",text:""};for(var i=0;i<options.length;i++){if(options[i].name===text||String(options[i].id)===text)return {id:String(options[i].id),text:""};}return {id:"",text:text};}',
            'function exactOption(inputId,options){var text=String(document.getElementById(inputId).value||"").replace(/^\\s+|\\s+$/g,"");if(!text)return {id:"",text:""};for(var i=0;i<options.length;i++){if(options[i].name===text||String(options[i].id)===text)return {id:String(options[i].id),text:""};}return null;}',
            'function readFilters(){var vendor=exactOption("im-header-vendor-text",vendorOptions);var po=exactOption("im-header-po-text",poOptions);var location=exactOption("im-header-location-text",locationOptions);state.filters.vendor=vendor||{id:"",text:""};state.filters.po=po||{id:"",text:""};state.filters.location=location||{id:"",text:""};state.filters.dateFrom=document.getElementById("im-header-date-from").value;state.filters.dateTo=document.getElementById("im-header-date-to").value;state.filters.soOnly=document.getElementById("im-header-so-only").value;setHidden("im-header-vendor",state.filters.vendor.id);setHidden("im-header-po",state.filters.po.id);setHidden("im-header-location",state.filters.location.id);setHidden("custpage_vendor",state.filters.vendor.id);setHidden("custpage_vendor_text",state.filters.vendor.text);setHidden("custpage_po",state.filters.po.id);setHidden("custpage_po_text",state.filters.po.text);setHidden("custpage_location",state.filters.location.id);setHidden("custpage_location_text",state.filters.location.text);setHidden("custpage_date_from",toNsDate(state.filters.dateFrom));setHidden("custpage_date_to",toNsDate(state.filters.dateTo));setHidden("custpage_so_only",state.filters.soOnly);}',
            'function applyFilters(){readFilters();render();}',
            'function bindSelectedOptionFilter(id,options){var el=document.getElementById(id);el.addEventListener("input",function(){if(el.value===""||exactOption(id,options)){applyFilters();}});el.addEventListener("change",function(){if(el.value===""||exactOption(id,options)){applyFilters();}});el.addEventListener("keydown",function(evt){if(evt.key==="Enter"){evt.preventDefault();if(el.value===""||exactOption(id,options)){applyFilters();}}});}',
            'function bindAutoFilter(id){var el=document.getElementById(id);el.addEventListener("input",applyFilters);el.addEventListener("change",applyFilters);el.addEventListener("keydown",function(evt){if(evt.key==="Enter"){evt.preventDefault();applyFilters();}});}',
            'refreshLoadedOptions();',
            'bindSelectedOptionFilter("im-header-vendor-text",vendorOptions);bindSelectedOptionFilter("im-header-po-text",poOptions);bindSelectedOptionFilter("im-header-location-text",locationOptions);',
            '["im-header-date-from","im-header-date-to"].forEach(bindAutoFilter);',
            'document.getElementById("im-header-so-only").addEventListener("change",applyFilters);',
            'document.getElementById("im-reset-filters").addEventListener("click",function(){["im-header-vendor-text","im-header-vendor","im-header-po-text","im-header-po","im-header-location-text","im-header-location","im-header-date-from","im-header-date-to","custpage_vendor","custpage_vendor_text","custpage_po","custpage_po_text","custpage_location","custpage_location_text","custpage_date_from","custpage_date_to"].forEach(function(id){setHidden(id,"");});setHidden("im-header-so-only","F");setHidden("custpage_so_only","F");state.filters={vendor:{id:"",text:""},po:{id:"",text:""},location:{id:"",text:""},dateFrom:"",dateTo:"",soOnly:"F"};render();});',
            'function writeFormValue(form,name,value){var field=getField(name)||(form&&form.elements?form.elements[name]:null);if(!field&&form){field=document.createElement("input");field.type="hidden";field.id=name;field.name=name;form.appendChild(field);}if(field)field.value=value;return field;}',
            'function ensurePostForm(){var form=getSuiteletForm();if(!form){form=document.createElement("form");form.method="post";form.action=suiteletUrl||window.location.href;document.body.appendChild(form);}if(!form.method||String(form.method).toLowerCase()!=="post")form.method="post";return form;}',
            'function showProgress(){if(progressOverlay){progressOverlay.className="im-progress-overlay im-open";progressOverlay.setAttribute("aria-hidden","false");}createButton.disabled=true;createButton.textContent="Creating...";}',
            'function submitSuiteletForm(form){if(window.HTMLFormElement&&HTMLFormElement.prototype.submit){HTMLFormElement.prototype.submit.call(form);return;}form.submit();}',
            'function submitCreateMaster(){var selectedIds=Object.keys(state.selected);if(!selectedIds.length||createButton.disabled)return;showProgress();window.setTimeout(function(){try{readFilters();var form=ensurePostForm();writeFormValue(form,"custpage_action","create_master_po");writeFormValue(form,"custpage_selected_po_ids",JSON.stringify(selectedIds));writeFormValue(form,"custpage_vendor",state.filters.vendor.id);writeFormValue(form,"custpage_vendor_text",state.filters.vendor.text);writeFormValue(form,"custpage_po",state.filters.po.id);writeFormValue(form,"custpage_po_text",state.filters.po.text);writeFormValue(form,"custpage_location",state.filters.location.id);writeFormValue(form,"custpage_location_text",state.filters.location.text);writeFormValue(form,"custpage_date_from",toNsDate(state.filters.dateFrom));writeFormValue(form,"custpage_date_to",toNsDate(state.filters.dateTo));writeFormValue(form,"custpage_so_only",state.filters.soOnly);submitSuiteletForm(form);}catch(ex){if(progressOverlay){progressOverlay.className="im-progress-overlay";progressOverlay.setAttribute("aria-hidden","true");}createButton.disabled=false;createButton.textContent="Create Master PO";alert("Could not submit the Master PO request: "+(ex&&ex.message?ex.message:ex));}},60);}',
            'createButton.addEventListener("click",submitCreateMaster);',
            'readFilters();render();',
            '}());',
            '</script>'
        ].join('');
    }

    function escapeHtml(value) {
        return String(value || '').replace(/[&<>"]/g, function (ch) {
            return {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;'
            }[ch];
        });
    }

    function escapeAttribute(value) {
        return escapeHtml(value).replace(/'/g, '&#39;');
    }

    function getOptionInputValue(options, selectedId, fallbackText) {
        const cleanSelectedId = String(selectedId || '');

        if (cleanSelectedId) {
            const match = (options || []).filter(function (option) {
                return String(option.id) === cleanSelectedId;
            })[0];

            return match ? match.name : cleanSelectedId;
        }

        return fallbackText || '';
    }

    function buildDatalistOptionsHtml(options) {
        return (options || []).map(function (option) {
            return '<option value="' + escapeAttribute(option.name) + '"></option>';
        }).join('');
    }

    return {
        onRequest: onRequest
    };
});
