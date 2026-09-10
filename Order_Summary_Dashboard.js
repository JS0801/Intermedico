/**
 * Order Tracking Desk Suitelet
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['N/search', 'N/url', 'N/runtime', 'N/log'], function (search, url, runtime, log) {

    const MAX_ROWS = 10000;

    const PARAMS = {
        openPO: 'custscript_img_open_po',
        recommendedPurchases: 'custscript_img_recommended_purchases',
        backorder: 'custscript_img_backorder_report',
        soHistory: 'custscript_img_sales_order_history',
        openSO: 'custscript_img_open_so',
        shortDated: 'custscript_img_short_dated_product',
        inventoryOnHand: 'custscript_img_inventory_on_hand'
    };

    const REPORTS = [
        { key: 'openPO', label: 'Open Purchase Orders' },
        { key: 'recommendedPurchases', label: 'Recommended Purchases' },
        { key: 'backorder', label: 'Backorder Report' },
        { key: 'soHistory', label: 'Sales Order History' },
        { key: 'openSO', label: 'Open Sales Orders' },
        { key: 'shortDated', label: 'Short Dated Product' },
        { key: 'inventoryOnHand', label: 'Inventory On Hand' }
    ];

    /*
     * Reusable keyword sets. Every filter and link definition
     * points at one of these so a change lands everywhere.
     */
    const KEYWORDS = {
        purchaseOrder: ['po', 'po number', 'purchase order', 'document number', 'tranid'],
        salesOrder: ['document number', 'order number', 'sales order', 'so number', 'tranid'],
        item: ['item id', 'itemid', 'item number', 'sku', 'item'],
        customer: ['customer', 'entity'],
        category: ['category', 'item category', 'product category'],
        warehouse: ['warehouse', 'location'],
        orderType: ['custbody_im_order_type', 'order type'],
        dryIce: ['custitem_dry_ice_required', 'dry ice', 'dry ice required']
    };

    /*
     * links: only these columns become clickable.
     * filters: dropdown filters for each report, rendered in order.
     * A filter is hidden automatically when the saved search
     * does not return a matching result column.
     * The first date-like saved-search result column is used by Date From/To.
     */
    const REPORT_UI = {
        openPO: {
            links: [
                { type: 'transaction', keywords: KEYWORDS.purchaseOrder }
            ],
            filters: [
                { label: 'PO', keywords: KEYWORDS.purchaseOrder },
                { label: 'Category', keywords: KEYWORDS.category },
                { label: 'Item ID', keywords: KEYWORDS.item }
            ]
        },

        recommendedPurchases: {
            links: [
                { type: 'item', keywords: KEYWORDS.item }
            ],
            filters: [
                { label: 'Item ID', keywords: KEYWORDS.item },
                { label: 'Warehouse', keywords: KEYWORDS.warehouse },
                { label: 'Category', keywords: KEYWORDS.category }
            ]
        },

        backorder: {
            links: [
                { type: 'transaction', keywords: KEYWORDS.salesOrder },
                { type: 'item', keywords: KEYWORDS.item },
                { type: 'customer', keywords: KEYWORDS.customer }
            ],
            filters: [
                { label: 'Sales Order', keywords: KEYWORDS.salesOrder },
                { label: 'Item ID', keywords: KEYWORDS.item },
                { label: 'Customer', keywords: KEYWORDS.customer },
                { label: 'Order Type', keywords: KEYWORDS.orderType },
                { label: 'Category', keywords: KEYWORDS.category }
            ]
        },

        soHistory: {
            links: [
                { type: 'transaction', keywords: KEYWORDS.salesOrder },
                { type: 'item', keywords: KEYWORDS.item }
            ],
            filters: [
                { label: 'Sales Order', keywords: KEYWORDS.salesOrder },
                { label: 'Customer', keywords: KEYWORDS.customer },
                { label: 'Item ID', keywords: KEYWORDS.item },
                { label: 'Order Type', keywords: KEYWORDS.orderType },
                { label: 'Category', keywords: KEYWORDS.category }
            ]
        },

        openSO: {
            links: [
                { type: 'transaction', keywords: KEYWORDS.salesOrder },
                { type: 'item', keywords: KEYWORDS.item }
            ],
            filters: [
                { label: 'Sales Order', keywords: KEYWORDS.salesOrder },
                { label: 'Item ID', keywords: KEYWORDS.item },
                { label: 'Customer', keywords: KEYWORDS.customer },
                { label: 'Order Type', keywords: KEYWORDS.orderType },
                { label: 'Dry Ice', keywords: KEYWORDS.dryIce },
                { label: 'Category', keywords: KEYWORDS.category }
            ]
        },

        shortDated: {
            links: [
                { type: 'item', keywords: KEYWORDS.item }
            ],
            filters: [
                { label: 'Item ID', keywords: KEYWORDS.item },
                { label: 'Warehouse', keywords: KEYWORDS.warehouse },
                { label: 'Category', keywords: KEYWORDS.category }
            ]
        },

        inventoryOnHand: {
            links: [
                { type: 'item', keywords: KEYWORDS.item }
            ],
            filters: [
                { label: 'Item ID', keywords: KEYWORDS.item },
                { label: 'Warehouse', keywords: KEYWORDS.warehouse },
                { label: 'Category', keywords: KEYWORDS.category }
            ]
        }
    };

    /*
     * Result columns the Suitelet appends after loading, so a
     * filter can work without editing the saved search itself.
     * Skipped when the search already returns the field.
     *
     * Set "join" when the field lives on the item rather than
     * the transaction body, for example:
     *   { name: 'custitem_im_dry_ice', join: 'item', label: 'Dry Ice' }
     */
    const EXTRA_COLUMNS = {
        backorder: [
            { name: 'custbody_im_order_type', label: 'Order Type' }
        ],
        soHistory: [
            { name: 'custbody_im_order_type', label: 'Order Type' }
        ],
        openSO: [
            { name: 'custbody_im_order_type', label: 'Order Type' },
            { name: 'custitem_dry_ice_required', join: 'item', label: 'Dry Ice' }
        ]
    };

    const CUSTOMER_TRAN_TYPES = [
        'salesorder',
        'invoice',
        'cashsale',
        'creditmemo',
        'customerpayment',
        'customerdeposit',
        'estimate',
        'cashrefund',
        'returnauthorization',
        'itemfulfillment',
        'opportunity'
    ];

    const VENDOR_TRAN_TYPES = [
        'purchaseorder',
        'vendorbill',
        'vendorcredit',
        'vendorpayment',
        'itemreceipt',
        'vendorreturnauthorization'
    ];

    function onRequest(context) {
        const request = context.request;
        const response = context.response;
        const action = request.parameters.action;

        if (request.method === 'GET' && !action) {
            response.write(renderPage());
            return;
        }

        try {
            if (action === 'reportData') {
                sendJson(response, getReportData(request.parameters.report));
                return;
            }

            if (action === 'count') {
                sendJson(response, getReportCount(request.parameters.report));
                return;
            }

            if (action === 'counts') {
                sendJson(response, getAllCounts());
                return;
            }

            if (action === 'paramCheck') {
                sendJson(response, getParamCheck());
                return;
            }

            sendJson(response, {
                error: 'Unknown action: ' + (action || '')
            });

        } catch (e) {
            log.error({
                title: 'Order Tracking Desk Error',
                details: {
                    action: action,
                    message: e.message,
                    stack: e.stack
                }
            });

            sendJson(response, {
                error: e.message || String(e)
            });
        }
    }

    function sendJson(response, data) {
        response.setHeader({
            name: 'Content-Type',
            value: 'application/json; charset=UTF-8'
        });

        response.write(JSON.stringify(data || {}));
    }

    function getReportDef(key) {
        return REPORTS.find(function (report) {
            return report.key === key;
        }) || null;
    }

    function getSearchId(reportKey) {
        const paramId = PARAMS[reportKey];

        if (!paramId) {
            return '';
        }

        const value = runtime.getCurrentScript().getParameter({ name: paramId });

        return value ? String(value).trim() : '';
    }

    function getParamCheck() {
        const output = {};

        REPORTS.forEach(function (report) {
            const value = getSearchId(report.key);

            output[report.key] = {
                paramId: PARAMS[report.key],
                configured: Boolean(value),
                value: value || null
            };
        });

        return output;
    }

    function hasColumn(columns, name, join) {
        return (columns || []).some(function (column) {
            return (
                String(column.name || '').toLowerCase() === name &&
                String(column.join || '').toLowerCase() === join
            );
        });
    }

    function addExtraColumns(searchObj, reportKey) {
        const extras = EXTRA_COLUMNS[reportKey];

        if (!extras || !extras.length) {
            return;
        }

        const columns = searchObj.columns || [];

        if (!columns.length) {
            return;
        }

        /*
         * A summarized search rejects a plain column, so the
         * appended field has to group alongside the existing ones.
         */
        const grouped = columns.some(function (column) {
            return Boolean(column.summary);
        });

        const added = [];

        extras.forEach(function (extra) {
            const name = String(extra.name).toLowerCase();
            const join = String(extra.join || '').toLowerCase();

            if (hasColumn(columns, name, join)) {
                return;
            }

            try {
                const options = {
                    name: extra.name,
                    label: extra.label || extra.name
                };

                if (extra.join) {
                    options.join = extra.join;
                }

                if (grouped) {
                    options.summary = search.Summary.GROUP;
                }

                added.push(search.createColumn(options));

            } catch (e) {
                log.audit({
                    title: 'Unable to append result column',
                    details: {
                        reportKey: reportKey,
                        field: extra.name,
                        join: extra.join || '',
                        message: e.message
                    }
                });
            }
        });

        if (added.length) {
            searchObj.columns = columns.concat(added);
        }
    }

    function loadSearch(reportKey, includeExtras) {
        const searchId = getSearchId(reportKey);

        if (!searchId) {
            throw new Error(
                'Missing saved search parameter: ' + PARAMS[reportKey] +
                '. Set its saved-search ID on the Suitelet deployment.'
            );
        }

        try {
            const loadOptions = { id: searchId };

            /*
             * Inventory Balance is a standalone search type,
             * so NetSuite requires the type when loading it.
             */
            if (reportKey === 'shortDated' || reportKey === 'inventoryOnHand') {
                loadOptions.type = search.Type.INVENTORY_BALANCE;
            }

            const searchObj = search.load(loadOptions);

            log.debug({
                title: 'Saved Search Loaded',
                details: {
                    reportKey: reportKey,
                    searchId: searchId,
                    searchType: searchObj.searchType
                }
            });

            if (includeExtras) {
                addExtraColumns(searchObj, reportKey);
            }

            return searchObj;

        } catch (e) {
            throw new Error(
                'Unable to load saved search "' + searchId + '" for ' +
                reportKey + ': ' + (e.message || String(e))
            );
        }
    }

    function safeGetValue(result, column) {
        try {
            const value = result.getValue(column);
            return (value === null || value === undefined) ? '' : value;
        } catch (e) {
            return '';
        }
    }

    function safeGetText(result, column) {
        try {
            const text = result.getText(column);
            return (text === null || text === undefined) ? '' : text;
        } catch (e) {
            return '';
        }
    }

    function stripHierarchy(value) {
        if (!value) {
            return value;
        }

        const parts = String(value).split(':');

        return parts[parts.length - 1].trim();
    }

    function getDisplayValue(result, column) {
        const text = safeGetText(result, column);

        if (text !== '') {
            return stripHierarchy(text);
        }

        return safeGetValue(result, column);
    }

    function resolveRecordUrl(recordType, recordId) {
        if (!recordType || !recordId) {
            return '';
        }

        try {
            return url.resolveRecord({
                recordType: recordType,
                recordId: recordId,
                isEditMode: false
            });
        } catch (e) {
            log.debug({
                title: 'Unable to resolve record URL',
                details: {
                    recordType: recordType,
                    recordId: recordId,
                    message: e.message
                }
            });

            return '';
        }
    }

    function resolveItemUrl(itemId) {
        return itemId
            ? '/app/common/item/item.nl?id=' + encodeURIComponent(itemId)
            : '';
    }

    function columnMeta(columns) {
        return (columns || []).map(function (column, index) {
            return {
                key: 'c' + index,
                label: column.label || column.name || ('Column ' + (index + 1)),
                name: column.name || '',
                join: column.join || '',
                summary: column.summary || ''
            };
        });
    }

    /*
     * Column roles are resolved once per search instead of
     * per row, since every row shares the same column list.
     */
    function columnRoles(columns) {
        const roles = {
            internalId: -1,
            entity: -1,
            item: -1,
            itemId: -1
        };

        (columns || []).forEach(function (column, index) {
            if (column.join) {
                return;
            }

            const name = String(column.name || '').toLowerCase();

            if (name === 'internalid' || name === 'internalidnumber') {
                if (roles.internalId === -1) {
                    roles.internalId = index;
                }
            } else if (name === 'entity') {
                if (roles.entity === -1) {
                    roles.entity = index;
                }
            } else if (name === 'item') {
                if (roles.item === -1) {
                    roles.item = index;
                }
            } else if (name === 'itemid') {
                if (roles.itemId === -1) {
                    roles.itemId = index;
                }
            }
        });

        return roles;
    }

    function buildRow(result, columns, searchType, roles) {
        const row = {
            internalId: result.id || '',
            recordType: result.recordType || searchType || ''
        };

        for (let index = 0; index < columns.length; index++) {
            row['c' + index] = getDisplayValue(result, columns[index]);
        }

        if (roles.entity !== -1) {
            const entityValue = safeGetValue(result, columns[roles.entity]);

            if (entityValue) {
                row.entityId = entityValue;
            }
        }

        if (roles.item !== -1) {
            const itemValue = safeGetValue(result, columns[roles.item]);

            if (itemValue) {
                row.itemId = itemValue;
            }
        }

        if (!row.internalId && roles.internalId !== -1) {
            row.internalId = safeGetValue(result, columns[roles.internalId]) || '';
        }

        row.viewUrl = resolveRecordUrl(row.recordType, row.internalId);

        const lowerType = String(row.recordType || '').toLowerCase();

        if (row.entityId) {
            if (CUSTOMER_TRAN_TYPES.indexOf(lowerType) !== -1) {
                row.entityUrl = resolveRecordUrl('customer', row.entityId);

            } else if (VENDOR_TRAN_TYPES.indexOf(lowerType) !== -1) {
                row.entityUrl = resolveRecordUrl('vendor', row.entityId);
            }
        }

        if (row.itemId) {
            row.itemUrl = resolveItemUrl(row.itemId);

        } else if (lowerType.indexOf('item') !== -1) {
            row.itemUrl = row.viewUrl || resolveItemUrl(row.internalId);

        } else if (roles.itemId !== -1 && row.internalId) {
            row.itemUrl = resolveItemUrl(row.internalId);
        }

        return row;
    }

    function executeSearch(searchObj) {
        const nsColumns = searchObj.columns || [];
        const columns = columnMeta(nsColumns);
        const roles = columnRoles(nsColumns);
        const searchType = searchObj.searchType || '';
        const rows = [];

        const paged = searchObj.runPaged({ pageSize: 1000 });
        const total = paged.count || 0;

        for (
            let pageIndex = 0;
            pageIndex < paged.pageRanges.length && rows.length < MAX_ROWS;
            pageIndex++
        ) {
            const page = paged.fetch({
                index: paged.pageRanges[pageIndex].index
            });

            for (
                let rowIndex = 0;
                rowIndex < page.data.length && rows.length < MAX_ROWS;
                rowIndex++
            ) {
                rows.push(
                    buildRow(page.data[rowIndex], nsColumns, searchType, roles)
                );
            }
        }

        return {
            total: total,
            displayed: rows.length,
            limited: total > MAX_ROWS,
            columns: columns,
            rows: rows
        };
    }

    function safeSection(title, callback) {
        try {
            return callback();
        } catch (e) {
            log.error({
                title: title + ' failed',
                details: {
                    message: e.message,
                    stack: e.stack
                }
            });

            return {
                total: 0,
                displayed: 0,
                limited: false,
                columns: [],
                rows: [],
                error: e.message || String(e)
            };
        }
    }

    function getReportData(reportKey) {
        const report = getReportDef(reportKey);

        if (!report) {
            return {
                reportKey: reportKey || '',
                label: '',
                total: 0,
                displayed: 0,
                limited: false,
                columns: [],
                rows: [],
                error: 'Unknown report: ' + (reportKey || '')
            };
        }

        const data = safeSection(report.label, function () {
            return executeSearch(loadSearch(report.key, true));
        });

        data.reportKey = report.key;
        data.label = report.label;

        return data;
    }

    function getReportCount(reportKey) {
        const report = getReportDef(reportKey);

        if (!report) {
            return {
                reportKey: reportKey || '',
                total: 0,
                error: 'Unknown report: ' + (reportKey || '')
            };
        }

        const data = safeSection(report.label + ' count', function () {
            return {
                total: loadSearch(report.key).runPaged({ pageSize: 1000 }).count || 0
            };
        });

        data.reportKey = report.key;
        data.label = report.label;

        return data;
    }

    function getAllCounts() {
        const output = {};

        REPORTS.forEach(function (report) {
            output[report.key] = getReportCount(report.key);
        });

        return output;
    }

    function inlineJson(value) {
        return JSON.stringify(value)
            .replace(/</g, '\\u003c')
            .replace(/>/g, '\\u003e')
            .replace(/&/g, '\\u0026');
    }

    function overviewCards() {
        return REPORTS.map(function (report) {
            return (
                '<div class="overview-card" data-report="' + report.key + '">' +
                    '<div class="overview-label">' + report.label + '</div>' +
                    '<div class="overview-count" id="count_' + report.key + '">–</div>' +
                    '<div class="overview-link">View report →</div>' +
                '</div>'
            );
        }).join('');
    }

    function tabButtons() {
        return REPORTS.map(function (report, index) {
            return (
                '<button type="button" class="tab-button' +
                (index === 0 ? ' active' : '') +
                '" data-tab="' + report.key + '">' +
                report.label +
                '</button>'
            );
        }).join('');
    }

    /*
     * One select is rendered per configured filter, so a report
     * can carry any number of dropdowns without a code change.
     */
    function filterSelects(reportKey) {
        return REPORT_UI[reportKey].filters.map(function (filter, slot) {
            return (
                '<div class="filter-field filter-' + slot + '">' +
                    '<label class="label-' + slot + '">' + filter.label + '</label>' +
                    '<select class="input-' + slot + '">' +
                        '<option value="">All</option>' +
                    '</select>' +
                '</div>'
            );
        }).join('');
    }

    function tabPanels() {
        return REPORTS.map(function (report, index) {
            return (
                '<section id="panel_' + report.key + '" class="tab-panel' +
                (index === 0 ? ' active' : '') + '">' +

                    '<div class="filter-bar" data-report="' + report.key + '">' +

                        '<div class="filter-field search-field">' +
                            '<label>Search</label>' +
                            '<input class="input-search" type="text" ' +
                            'placeholder="Search this report...">' +
                        '</div>' +

                        filterSelects(report.key) +

                        '<div class="filter-field date-field">' +
                            '<label>Date From</label>' +
                            '<input class="input-from" type="date">' +
                        '</div>' +

                        '<div class="filter-field date-field">' +
                            '<label>Date To</label>' +
                            '<input class="input-to" type="date">' +
                        '</div>' +

                        '<div class="filter-actions">' +
                            '<span class="row-count"></span>' +

                            '<button type="button" class="button clear-button">' +
                                'Clear' +
                            '</button>' +

                            '<button type="button" class="button refresh-button">' +
                                'Refresh' +
                            '</button>' +

                            '<button type="button" class="button print-button">' +
                                'Print / PDF' +
                            '</button>' +

                            '<button type="button" class="button primary export-button">' +
                                'Export CSV' +
                            '</button>' +
                        '</div>' +

                    '</div>' +

                    '<div id="error_' + report.key + '"></div>' +

                    '<div class="table-wrap">' +
                        '<table>' +
                            '<thead>' +
                                '<tr id="head_' + report.key + '"></tr>' +
                            '</thead>' +

                            '<tbody id="body_' + report.key + '">' +
                                '<tr>' +
                                    '<td class="loading">' +
                                        'Select the tab to load data...' +
                                    '</td>' +
                                '</tr>' +
                            '</tbody>' +
                        '</table>' +
                    '</div>' +

                '</section>'
            );
        }).join('');
    }

    function renderPage() {
        return buildHtml()
            .replace('__REPORTS__', inlineJson(REPORTS))
            .replace('__REPORT_UI__', inlineJson(REPORT_UI));
    }

    function buildHtml() {
        return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Order Tracking Desk</title>

<style>
:root {
    --paper: #eff1ec;
    --panel: #ffffff;
    --ink: #14171c;
    --muted: #667085;
    --faint: #8b93a1;
    --line: #dde1dc;
    --line2: #eaede9;
    --signal: #3d4a8a;
    --signal2: #2b3568;
    --signalSoft: #e8eaf5;
    --warn: #96591a;
    --warnSoft: #fbf0de;
    --radius: 10px;
}

* {
    box-sizing: border-box;
}

body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: Arial, Helvetica, sans-serif;
    font-size: 14px;
}

.page {
    max-width: 1500px;
    margin: auto;
    padding: 30px 26px 55px;
}

.topbar {
    display: flex;
    justify-content: space-between;
    gap: 20px;
    align-items: flex-start;
    margin-bottom: 20px;
}

.eyebrow {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: .08em;
    color: var(--signal);
    font-weight: 700;
    margin-bottom: 7px;
}

.title {
    font-size: 28px;
    margin: 0;
}

.subtitle {
    margin-top: 7px;
    color: var(--muted);
    font-size: 13px;
    line-height: 1.5;
}

.card {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 19px;
    margin-bottom: 18px;
    box-shadow:
        0 8px 20px
        rgba(20, 23, 28, .05);
}

.button {
    height: 35px;
    border: 1px solid var(--line);
    background: #ffffff;
    border-radius: 8px;
    padding: 0 12px;
    cursor: pointer;
    font-weight: 700;
    font-size: 12px;
}

.button:hover {
    border-color: var(--signal);
    color: var(--signal2);
}

.button.primary {
    background: var(--signal);
    border-color: var(--signal);
    color: #ffffff;
}

.button.primary:hover {
    background: var(--signal2);
    color: #ffffff;
}

.top-refresh {
    height: 39px;
    font-size: 13px;
}

.overview-grid {
    display: grid;
    grid-template-columns:
        repeat(7, 1fr);
    gap: 11px;
}

.overview-card {
    background: #f8f9f6;
    border: 1px solid var(--line);
    border-radius: 9px;
    padding: 14px;
    cursor: pointer;
}

.overview-card:hover {
    border-color: var(--signal);
}

.overview-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: .05em;
    color: var(--faint);
    font-weight: 700;
    min-height: 27px;
}

.overview-count {
    font-size: 24px;
    font-weight: 700;
    color: var(--signal2);
    margin-top: 7px;
}

.overview-link {
    font-size: 11px;
    color: var(--muted);
    margin-top: 5px;
}

.tabs {
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
    border-bottom:
        1px solid var(--line);
    margin-bottom: 15px;
}

.tab-button {
    border: 0;
    background: none;
    padding: 10px 1px;
    cursor: pointer;
    color: var(--muted);
    font-weight: 700;
    border-bottom:
        2px solid transparent;
    margin-bottom: -1px;
}

.tab-button.active {
    color: var(--signal2);
    border-bottom-color:
        var(--signal);
}

.tab-panel {
    display: none;
}

.tab-panel.active {
    display: block;
}

.filter-bar {
    display: flex;
    align-items: end;
    gap: 9px;
    flex-wrap: wrap;
    background: #f8f9f6;
    border: 1px solid var(--line);
    border-radius: 9px;
    padding: 12px;
    margin-bottom: 13px;
}

/*
 * Reports carry a different number of dropdowns, so the
 * fields share the row evenly and wrap instead of overflowing.
 */
.filter-field {
    flex: 1 1 140px;
    min-width: 130px;
}

.search-field {
    flex: 2 1 220px;
    min-width: 200px;
}

.date-field {
    flex: 0 1 150px;
}

.filter-field label {
    display: block;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: .06em;
    color: var(--faint);
    font-weight: 700;
    margin-bottom: 5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.filter-field input,
.filter-field select {
    width: 100%;
    height: 34px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: #ffffff;
    padding: 7px 10px;
    font-size: 12.5px;
    outline: none;
}

.filter-field input:focus,
.filter-field select:focus {
    border-color: var(--signal);
    box-shadow:
        0 0 0 3px
        var(--signalSoft);
}

.filter-actions {
    flex: 0 0 auto;
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 7px;
}

.row-count {
    font-size: 11px;
    color: var(--faint);
    white-space: nowrap;
}

.table-wrap {
    overflow: auto;
    border: 1px solid var(--line);
    border-radius: 9px;
}

table {
    width: 100%;
    border-collapse: collapse;
    min-width: 900px;
}

th {
    background: #f7f8f5;
    color: var(--muted);
    text-align: left;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: .05em;
    padding: 11px;
    border-bottom:
        1px solid var(--line);
    white-space: nowrap;
}

td {
    padding: 10px 11px;
    border-bottom:
        1px solid var(--line2);
    font-size: 13px;
    vertical-align: top;
}

tbody tr:nth-child(even) td {
    background: #fbfbfa;
}

.num {
    text-align: right;
    font-family: monospace;
}

/*
 * Underline is intentionally shown on every
 * clickable transaction, customer and item value.
 */
.record-link {
    color: var(--signal2);
    font-weight: 700;
    text-decoration-line: underline;
    text-decoration-color: var(--signal);
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
    cursor: pointer;
}

.record-link:hover {
    color: var(--signal);
    text-decoration-thickness: 2px;
}

.loading,
.empty {
    text-align: center;
    color: var(--faint);
    padding: 32px;
}

.section-error,
.global-error {
    background: var(--warnSoft);
    color: var(--warn);
    border: 1px solid #ebc994;
    border-radius: 8px;
    padding: 11px 13px;
    margin-bottom: 12px;
}

.global-error {
    display: none;
}

@media (max-width: 1250px) {
    .overview-grid {
        grid-template-columns:
            repeat(4, 1fr);
    }
}

@media (max-width: 700px) {
    .page {
        padding: 18px 11px 35px;
    }

    .topbar {
        flex-direction: column;
    }

    .overview-grid {
        grid-template-columns:
            repeat(2, 1fr);
    }

    .filter-field,
    .search-field,
    .date-field {
        flex: 1 1 100%;
    }

    .filter-actions {
        margin-left: 0;
        width: 100%;
        flex-wrap: wrap;
    }
}
</style>
</head>

<body>
<div class="page">

    <div class="topbar">
        <div>
            <div class="eyebrow">
                Purchasing &amp; Sales Order Tracking
            </div>

            <h1 class="title">
                Order Tracking Desk
            </h1>

            <div class="subtitle">
                Open purchase orders, recommended purchases,
                backorders, sales order history, open sales
                orders, short-dated products and inventory
                on hand.
            </div>
        </div>

        <button
            type="button"
            id="refreshAll"
            class="button primary top-refresh">
            Refresh All
        </button>
    </div>

    <div
        id="globalError"
        class="global-error">
    </div>

    <div class="card">
        <div class="overview-grid">
            ${overviewCards()}
        </div>
    </div>

    <div class="card">
        <div class="tabs">
            ${tabButtons()}
        </div>

        ${tabPanels()}
    </div>

</div>

<script>
(function () {
    'use strict';

    /*
     * Use the URL that opened the Suitelet.
     * This preserves an external Suitelet ns-at token
     * or custom account domain when loading AJAX data.
     */
    var SUITELET_URL =
        window.location.href.split('#')[0];

    var REPORTS = __REPORTS__;

    var REPORT_UI = __REPORT_UI__;

    var cache = {};
    var states = {};
    var exportData = {};

    /*
     * Resolved column keys per report, rebuilt only when
     * a report is loaded rather than on every keystroke.
     */
    var layouts = {};

    var activeKey =
        REPORTS.length ? REPORTS[0].key : '';

    function byId(id) {
        return document.getElementById(id);
    }

    function esc(value) {
        if (value === null || value === undefined || value === '') {
            return '';
        }

        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function normalize(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[_-]+/g, ' ')
            .replace(/\\s+/g, ' ')
            .trim();
    }

    var NUMERIC_KEYWORDS = [
        'quantity',
        'qty',
        'available',
        'on hand',
        'committed',
        'back ordered',
        'in transit',
        'on order',
        'cost',
        'price',
        'amount',
        'value',
        'rate'
    ];

    function numericLabel(label) {
        var text = normalize(label);

        return NUMERIC_KEYWORDS.some(function (keyword) {
            return text.indexOf(keyword) !== -1;
        });
    }

    function displayValue(value, numeric) {
        if (value === null || value === undefined || value === '') {
            return '';
        }

        if (value === true || String(value) === 'T') {
            return 'Yes';
        }

        if (value === false || String(value) === 'F') {
            return 'No';
        }

        if (!numeric) {
            return esc(value);
        }

        var numberValue = Number(String(value).replace(/,/g, ''));

        if (isNaN(numberValue)) {
            return esc(value);
        }

        return numberValue.toLocaleString('en-US', {
            minimumFractionDigits: numberValue % 1 === 0 ? 0 : 2,
            maximumFractionDigits: 2
        });
    }

    /*
     * Checkbox columns come back as T and F, which reads badly
     * in a dropdown. The stored option value stays raw so the
     * row comparison in filterRows still matches.
     */
    function optionLabel(value) {
        if (value === true || String(value) === 'T') {
            return 'Yes';
        }

        if (value === false || String(value) === 'F') {
            return 'No';
        }

        return String(value);
    }

    function rawCsv(value) {
        if (value === null || value === undefined) {
            return '';
        }

        if (value === true || String(value) === 'T') {
            return 'Yes';
        }

        if (value === false || String(value) === 'F') {
            return 'No';
        }

        return String(value);
    }

    function csvEscape(value) {
        var stringValue = rawCsv(value);

        /*
         * The slashes are doubled because this browser
         * JavaScript is inside the server template string.
         */
        return /[",\\n\\r]/.test(stringValue)
            ? '"' + stringValue.replace(/"/g, '""') + '"'
            : stringValue;
    }

    function error(message) {
        var element = byId('globalError');

        if (!message) {
            element.style.display = 'none';
            element.innerHTML = '';
            return;
        }

        element.innerHTML = esc(message);
        element.style.display = 'block';
    }

    function sectionError(key, message) {
        byId('error_' + key).innerHTML = message
            ? '<div class="section-error">' + esc(message) + '</div>'
            : '';
    }

    function definition(key) {
        return REPORTS.find(function (report) {
            return report.key === key;
        }) || null;
    }

    function filterBar(key) {
        return document.querySelector(
            '.filter-bar[data-report="' + key + '"]'
        );
    }

    function filterDefs(key) {
        return (REPORT_UI[key] && REPORT_UI[key].filters) || [];
    }

    function cleanUrl(input) {
        return input
            .replace(/([?&])action=[^&]*/g, '$1')
            .replace(/([?&])report=[^&]*/g, '$1')
            .replace(/([?&])_ts=[^&]*/g, '$1')
            .replace(/[?&]+$/, '')
            .replace('?&', '?')
            .replace(/&&+/g, '&');
    }

    function api(action, params) {
        params = params || {};

        var base = cleanUrl(SUITELET_URL);

        var list = [
            'action=' + encodeURIComponent(action),
            '_ts=' + Date.now()
        ];

        Object.keys(params).forEach(function (key) {
            if (
                params[key] !== null &&
                params[key] !== undefined &&
                params[key] !== ''
            ) {
                list.push(
                    encodeURIComponent(key) + '=' +
                    encodeURIComponent(params[key])
                );
            }
        });

        var finalUrl =
            base +
            (base.indexOf('?') === -1 ? '?' : '&') +
            list.join('&');

        return fetch(finalUrl, {
            method: 'GET',
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
            cache: 'no-store'
        }).then(function (response) {
            return response.text().then(function (text) {
                var data;

                try {
                    data = JSON.parse(text);

                } catch (e) {
                    throw new Error(
                        'Expected JSON but received HTTP ' + response.status +
                        '. The request may have returned a login or ' +
                        'NetSuite error page.'
                    );
                }

                if (!response.ok) {
                    throw new Error(data.error || ('HTTP ' + response.status));
                }

                if (data && data.error) {
                    throw new Error(data.error);
                }

                return data;
            });
        });
    }

    function columnKey(columns, keywords) {
        columns = columns || [];

        keywords = (keywords || []).map(normalize);

        var index;
        var keywordIndex;
        var name;
        var label;
        var haystack;

        /*
         * Exact matching first.
         * This prevents "Item" from incorrectly
         * matching "Item Category".
         */
        for (index = 0; index < columns.length; index++) {
            name = normalize(columns[index].name);
            label = normalize(columns[index].label);

            for (
                keywordIndex = 0;
                keywordIndex < keywords.length;
                keywordIndex++
            ) {
                if (
                    name === keywords[keywordIndex] ||
                    label === keywords[keywordIndex]
                ) {
                    return columns[index].key;
                }
            }
        }

        /*
         * Contains matching second.
         * Example: "Warehouse Location" can match
         * the configured "warehouse" keyword.
         */
        for (index = 0; index < columns.length; index++) {
            haystack = normalize(
                (columns[index].name || '') + ' ' + (columns[index].label || '')
            );

            for (
                keywordIndex = 0;
                keywordIndex < keywords.length;
                keywordIndex++
            ) {
                if (
                    keywords[keywordIndex].length > 2 &&
                    haystack.indexOf(keywords[keywordIndex]) !== -1
                ) {
                    return columns[index].key;
                }
            }
        }

        return null;
    }

    function linkUrl(row, type) {
        if (type === 'transaction') {
            return row.viewUrl || '';
        }

        if (type === 'customer') {
            return row.entityUrl || '';
        }

        if (type === 'item') {
            return row.itemUrl || '';
        }

        return '';
    }

    /*
     * Everything the table renderer needs about a column is
     * resolved once here: display label, numeric alignment
     * and which record type it links to.
     */
    function buildLayout(key, columns) {
        columns = columns || [];

        var linkTypes = {};

        (REPORT_UI[key].links || []).forEach(function (link) {
            var found = columnKey(columns, link.keywords);

            if (found && !linkTypes[found]) {
                linkTypes[found] = link.type;
            }
        });

        var layout = {
            dateKey: columnKey(columns, ['date']),
            slotKeys: filterDefs(key).map(function (filter) {
                return columnKey(columns, filter.keywords);
            }),
            columns: columns.map(function (column) {
                return {
                    key: column.key,
                    label: column.label,
                    numeric: numericLabel(column.label),
                    linkType: linkTypes[column.key] || ''
                };
            })
        };

        layouts[key] = layout;

        return layout;
    }

    function layout(key) {
        return layouts[key] || buildLayout(key, (cache[key] || {}).columns || []);
    }

    function blankState(key) {
        var fresh = {
            q: '',
            slots: [],
            dateFrom: '',
            dateTo: ''
        };

        filterDefs(key).forEach(function () {
            fresh.slots.push('');
        });

        return fresh;
    }

    function state(key) {
        if (!states[key]) {
            states[key] = blankState(key);
        }

        return states[key];
    }

    function parseDate(value) {
        if (!value) {
            return null;
        }

        var dateValue = new Date(value);

        if (isNaN(dateValue.getTime())) {
            var parts = String(value).split('/');

            if (parts.length === 3) {
                dateValue = new Date(
                    Number(parts[2]),
                    Number(parts[0]) - 1,
                    Number(parts[1])
                );
            }
        }

        return isNaN(dateValue.getTime()) ? null : dateValue;
    }

    function filterRows(section, key) {
        var filterState = state(key);
        var reportLayout = layout(key);
        var columns = reportLayout.columns;
        var rows = section.rows || [];

        /*
         * Only the slots actually in use are tested per row.
         */
        var activeSlots = [];

        filterState.slots.forEach(function (value, slot) {
            var slotKey = reportLayout.slotKeys[slot];

            if (value && slotKey) {
                activeSlots.push({ key: slotKey, value: value });
            }
        });

        var fromDate = filterState.dateFrom
            ? new Date(filterState.dateFrom)
            : null;

        var toDate = null;

        if (filterState.dateTo) {
            toDate = new Date(filterState.dateTo);
            toDate.setHours(23, 59, 59, 999);
        }

        var useDates =
            Boolean(reportLayout.dateKey) && Boolean(fromDate || toDate);

        var query = filterState.q
            ? filterState.q.toLowerCase()
            : '';

        if (!activeSlots.length && !useDates && !query) {
            return rows;
        }

        return rows.filter(function (row) {
            var index;

            for (index = 0; index < activeSlots.length; index++) {
                if (
                    String(row[activeSlots[index].key] || '') !==
                    activeSlots[index].value
                ) {
                    return false;
                }
            }

            if (useDates) {
                var rowDate = parseDate(row[reportLayout.dateKey]);

                if (!rowDate) {
                    return false;
                }

                if (fromDate && rowDate < fromDate) {
                    return false;
                }

                if (toDate && rowDate > toDate) {
                    return false;
                }
            }

            if (query) {
                var matched = false;

                for (index = 0; index < columns.length; index++) {
                    var value = row[columns[index].key];

                    if (
                        value !== null &&
                        value !== undefined &&
                        String(value).toLowerCase().indexOf(query) !== -1
                    ) {
                        matched = true;
                        break;
                    }
                }

                if (!matched) {
                    return false;
                }
            }

            return true;
        });
    }

    function populateFilters(key, columns, rows) {
        var bar = filterBar(key);

        if (!bar) {
            return;
        }

        var filterState = state(key);
        var reportLayout = buildLayout(key, columns);

        filterDefs(key).forEach(function (filterDefinition, slot) {
            var wrapper = bar.querySelector('.filter-' + slot);
            var select = bar.querySelector('.input-' + slot);
            var label = bar.querySelector('.label-' + slot);

            if (!wrapper || !select || !label) {
                return;
            }

            var keyFound = reportLayout.slotKeys[slot];

            /*
             * Hide a filter when the required
             * saved-search result column is missing.
             */
            if (!keyFound) {
                wrapper.style.display = 'none';
                filterState.slots[slot] = '';
                return;
            }

            wrapper.style.display = '';
            label.innerHTML = esc(filterDefinition.label);

            var seen = Object.create(null);
            var values = [];

            (rows || []).forEach(function (row) {
                var value = row[keyFound];
                var uniqueKey = String(value);

                if (
                    value !== null &&
                    value !== undefined &&
                    value !== '' &&
                    !seen[uniqueKey]
                ) {
                    seen[uniqueKey] = true;
                    values.push(value);
                }
            });

            values.sort(function (a, b) {
                return String(a).localeCompare(String(b), undefined, {
                    numeric: true,
                    sensitivity: 'base'
                });
            });

            select.innerHTML =
                '<option value="">All</option>' +
                values.map(function (value) {
                    return (
                        '<option value="' + esc(value) + '">' +
                        esc(optionLabel(value)) +
                        '</option>'
                    );
                }).join('');

            select.value = filterState.slots[slot] || '';
        });

        /*
         * Keep the date filter behavior.
         * It appears whenever a saved-search
         * result column contains "date".
         */
        var hasDate = Boolean(reportLayout.dateKey);

        bar.querySelectorAll('.date-field').forEach(function (element) {
            element.style.display = hasDate ? '' : 'none';
        });
    }

    function renderHead(key, columns) {
        byId('head_' + key).innerHTML = columns.map(function (column) {
            return (
                '<th' + (column.numeric ? ' class="num"' : '') + '>' +
                esc(column.label) +
                '</th>'
            );
        }).join('');
    }

    function emptyRow(colspan, text) {
        return (
            '<tr>' +
                '<td colspan="' + colspan + '" class="empty">' +
                    esc(text) +
                '</td>' +
            '</tr>'
        );
    }

    function renderBody(key, columns, rows, emptyText) {
        var body = byId('body_' + key);

        if (!columns.length) {
            body.innerHTML = emptyRow(
                1,
                'No saved-search result columns were found.'
            );

            return;
        }

        if (!rows.length) {
            body.innerHTML = emptyRow(columns.length, emptyText);
            return;
        }

        var html = [];
        var rowIndex;
        var columnIndex;

        for (rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            var row = rows[rowIndex];

            html.push('<tr>');

            for (
                columnIndex = 0;
                columnIndex < columns.length;
                columnIndex++
            ) {
                var column = columns[columnIndex];
                var value = displayValue(row[column.key], column.numeric);

                if (column.linkType && value) {
                    var href = linkUrl(row, column.linkType);

                    if (href) {
                        value =
                            '<a class="record-link" target="_blank" ' +
                            'rel="noopener" href="' + esc(href) + '">' +
                            value +
                            '</a>';
                    }
                }

                html.push(
                    column.numeric ? '<td class="num">' : '<td>',
                    value,
                    '</td>'
                );
            }

            html.push('</tr>');
        }

        body.innerHTML = html.join('');
    }

    function updateCount(key, shown, total) {
        var element = document.querySelector(
            '.filter-bar[data-report="' + key + '"] .row-count'
        );

        var section = cache[key] || {};

        var suffix = section.limited
            ? ' (first ' + esc(section.displayed || total) + ' loaded)'
            : '';

        element.innerHTML =
            (
                shown === total
                    ? esc(total) + ' rows'
                    : esc(shown) + ' of ' + esc(total) + ' rows'
            ) +
            suffix;
    }

    function render(key) {
        var report = definition(key);

        var section = cache[key] || { columns: [], rows: [] };

        var reportLayout = layout(key);

        var rows = filterRows(section, key);

        exportData[key] = {
            columns: section.columns || [],
            rows: rows
        };

        sectionError(key, section.error || '');

        renderHead(key, reportLayout.columns);

        renderBody(
            key,
            reportLayout.columns,
            rows,
            'No ' + report.label.toLowerCase() + ' found.'
        );

        updateCount(key, rows.length, (section.rows || []).length);
    }

    function resetFilters(key) {
        states[key] = blankState(key);

        var bar = filterBar(key);

        if (!bar) {
            return;
        }

        ['.input-search', '.input-from', '.input-to'].forEach(
            function (selector) {
                var input = bar.querySelector(selector);

                if (input) {
                    input.value = '';
                }
            }
        );

        filterDefs(key).forEach(function (filterDefinition, slot) {
            var select = bar.querySelector('.input-' + slot);

            if (select) {
                select.value = '';
            }
        });
    }

    function loadReport(key, force) {
        var report = definition(key);

        if (!report) {
            return;
        }

        if (cache[key] && !force) {
            render(key);
            return;
        }

        sectionError(key, '');

        byId('head_' + key).innerHTML = '<th>Loading</th>';

        byId('body_' + key).innerHTML = emptyRow(
            1,
            'Loading ' + report.label.toLowerCase() + '...'
        );

        api('reportData', { report: key })
            .then(function (data) {
                cache[key] = data;

                resetFilters(key);

                populateFilters(key, data.columns || [], data.rows || []);

                render(key);

                var count = byId('count_' + key);

                count.innerHTML = esc(
                    data.total !== undefined
                        ? data.total
                        : (data.rows || []).length
                );

                count.title = '';
            })
            .catch(function (e) {
                sectionError(key, e.message);

                byId('head_' + key).innerHTML = '<th>Error</th>';

                byId('body_' + key).innerHTML = emptyRow(
                    1,
                    'Unable to load this report: ' + e.message
                );

                var count = byId('count_' + key);

                count.innerHTML = '–';
                count.title = e.message;
            });
    }

    function activate(key) {
        if (!definition(key)) {
            return;
        }

        activeKey = key;

        document.querySelectorAll('.tab-button').forEach(function (button) {
            button.classList.toggle(
                'active',
                button.getAttribute('data-tab') === key
            );
        });

        document.querySelectorAll('.tab-panel').forEach(function (panel) {
            panel.classList.toggle('active', panel.id === 'panel_' + key);
        });

        loadReport(key, false);
    }

    function loadCounts() {
        var queue = REPORTS.filter(function (report) {
            return report.key !== activeKey;
        });

        var index = 0;

        REPORTS.forEach(function (report) {
            var element = byId('count_' + report.key);

            element.innerHTML = '…';
            element.title = '';
        });

        /*
         * Load two counts at a time instead of firing
         * all seven requests simultaneously.
         */
        function worker() {
            if (index >= queue.length) {
                return Promise.resolve();
            }

            var report = queue[index++];

            var element = byId('count_' + report.key);

            return api('count', { report: report.key })
                .then(function (data) {
                    element.innerHTML = esc(data.total || 0);
                })
                .catch(function (e) {
                    element.innerHTML = '–';
                    element.title = e.message;
                })
                .then(worker);
        }

        Promise.all([worker(), worker()]).catch(function (e) {
            error('Could not load overview counts: ' + e.message);
        });
    }

    function appliedFilters(key) {
        var filterState = state(key);
        var reportLayout = layout(key);
        var parts = [];

        if (filterState.q) {
            parts.push('Search: ' + filterState.q);
        }

        filterDefs(key).forEach(function (filterDefinition, slot) {
            if (
                filterState.slots[slot] &&
                reportLayout.slotKeys[slot]
            ) {
                parts.push(
                    filterDefinition.label + ': ' +
                    optionLabel(filterState.slots[slot])
                );
            }
        });

        if (filterState.dateFrom) {
            parts.push('From ' + filterState.dateFrom);
        }

        if (filterState.dateTo) {
            parts.push('To ' + filterState.dateTo);
        }

        return parts;
    }

    /*
     * A hidden iframe avoids the popup blocker that a new
     * window would hit inside the NetSuite shell.
     */
    function printFrame() {
        var frame = byId('printFrame');

        if (!frame) {
            frame = document.createElement('iframe');

            frame.id = 'printFrame';
            frame.setAttribute('aria-hidden', 'true');
            frame.style.position = 'fixed';
            frame.style.right = '0';
            frame.style.bottom = '0';
            frame.style.width = '0';
            frame.style.height = '0';
            frame.style.border = '0';

            document.body.appendChild(frame);
        }

        return frame;
    }

    function printReport(key) {
        var report = definition(key);
        var reportLayout = layout(key);
        var columns = reportLayout.columns;
        var rows = (exportData[key] || {}).rows || [];

        if (!columns.length || !rows.length) {
            error(
                'Nothing to print for ' +
                (report ? report.label : key) + '.'
            );

            return;
        }

        error('');

        var applied = appliedFilters(key);

        var html = [];

        html.push('<!doctype html><html><head><meta charset="utf-8">');
        html.push('<title>' + esc(report.label) + '</title><style>');
        html.push('@page { size: landscape; margin: 12mm; }');
        html.push(
            'body { font-family: Arial, Helvetica, sans-serif; ' +
            'color: #14171c; margin: 0; }'
        );
        html.push('h1 { font-size: 16px; margin: 0 0 3px; }');
        html.push(
            '.meta { font-size: 10px; color: #667085; ' +
            'margin-bottom: 9px; line-height: 1.5; }'
        );
        html.push('table { width: 100%; border-collapse: collapse; }');
        html.push(
            'th { text-align: left; font-size: 9px; ' +
            'text-transform: uppercase; letter-spacing: .04em; ' +
            'color: #45505f; border-bottom: 1px solid #98a0ad; ' +
            'padding: 5px 6px; }'
        );
        html.push(
            'td { font-size: 10px; padding: 4px 6px; ' +
            'border-bottom: 1px solid #e4e7e2; vertical-align: top; }'
        );
        html.push('th.num, td.num { text-align: right; }');
        html.push('thead { display: table-header-group; }');
        html.push('tr { page-break-inside: avoid; }');
        html.push('</style></head><body>');

        html.push('<h1>' + esc(report.label) + '</h1>');

        html.push(
            '<div class="meta">' +
            esc(rows.length + ' rows | ' + new Date().toLocaleString()) +
            (
                applied.length
                    ? '<br>' + esc('Filters: ' + applied.join(' | '))
                    : ''
            ) +
            '</div>'
        );

        html.push('<table><thead><tr>');

        columns.forEach(function (column) {
            html.push(
                '<th' + (column.numeric ? ' class="num"' : '') + '>' +
                esc(column.label) +
                '</th>'
            );
        });

        html.push('</tr></thead><tbody>');

        rows.forEach(function (row) {
            html.push('<tr>');

            columns.forEach(function (column) {
                html.push(
                    column.numeric ? '<td class="num">' : '<td>',
                    displayValue(row[column.key], column.numeric),
                    '</td>'
                );
            });

            html.push('</tr>');
        });

        html.push('</tbody></table></body></html>');

        try {
            var frame = printFrame();
            var frameDocument = frame.contentWindow.document;

            frameDocument.open();
            frameDocument.write(html.join(''));
            frameDocument.close();

            frame.contentWindow.focus();

            setTimeout(function () {
                frame.contentWindow.print();
            }, 250);

        } catch (e) {
            error('Unable to open the print view: ' + e.message);
        }
    }

    function exportCsv(key) {
        var report = definition(key);

        var data = exportData[key] || { columns: [], rows: [] };

        if (!data.columns.length || !data.rows.length) {
            error(
                'Nothing to export for ' +
                (report ? report.label : key) + '.'
            );

            return;
        }

        var lines = [
            data.columns.map(function (column) {
                return csvEscape(column.label);
            }).join(',')
        ];

        data.rows.forEach(function (row) {
            lines.push(
                data.columns.map(function (column) {
                    return csvEscape(row[column.key]);
                }).join(',')
            );
        });

        var blob = new Blob([lines.join('\\r\\n')], {
            type: 'text/csv;charset=utf-8;'
        });

        var link = document.createElement('a');

        var objectUrl = URL.createObjectURL(blob);

        link.href = objectUrl;

        link.download =
            key + '_' + new Date().toISOString().slice(0, 10) + '.csv';

        document.body.appendChild(link);

        link.click();

        document.body.removeChild(link);

        URL.revokeObjectURL(objectUrl);
    }

    function bind() {
        document.addEventListener('click', function (event) {
            var tab = event.target.closest('.tab-button');

            if (tab) {
                activate(tab.getAttribute('data-tab'));
                return;
            }

            var card = event.target.closest('.overview-card');

            if (card) {
                activate(card.getAttribute('data-report'));
                return;
            }

            var bar = event.target.closest('.filter-bar');

            if (!bar) {
                if (event.target.closest('#refreshAll')) {
                    error('');

                    cache = {};
                    exportData = {};
                    layouts = {};

                    loadCounts();
                    loadReport(activeKey, true);
                }

                return;
            }

            var key = bar.getAttribute('data-report');

            if (event.target.closest('.clear-button')) {
                resetFilters(key);
                render(key);
                return;
            }

            if (event.target.closest('.refresh-button')) {
                loadReport(key, true);
                return;
            }

            if (event.target.closest('.print-button')) {
                printReport(key);
                return;
            }

            if (event.target.closest('.export-button')) {
                exportCsv(key);
            }
        });

        REPORTS.forEach(function (report) {
            var bar = filterBar(report.key);

            if (!bar) {
                return;
            }

            var timer;

            bar.querySelector('.input-search').addEventListener(
                'input',
                function (event) {
                    var value = event.target.value.trim();

                    clearTimeout(timer);

                    timer = setTimeout(function () {
                        state(report.key).q = value;
                        render(report.key);
                    }, 250);
                }
            );

            filterDefs(report.key).forEach(function (
                filterDefinition,
                slot
            ) {
                var select = bar.querySelector('.input-' + slot);

                if (!select) {
                    return;
                }

                select.addEventListener('change', function (event) {
                    state(report.key).slots[slot] = event.target.value;
                    render(report.key);
                });
            });

            bar.querySelector('.input-from').addEventListener(
                'change',
                function (event) {
                    state(report.key).dateFrom = event.target.value;
                    render(report.key);
                }
            );

            bar.querySelector('.input-to').addEventListener(
                'change',
                function (event) {
                    state(report.key).dateTo = event.target.value;
                    render(report.key);
                }
            );
        });
    }

    function init() {
        try {
            bind();
            loadCounts();
            activate(activeKey);

        } catch (e) {
            error('Failed to initialize the page: ' + e.message);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
</script>
</body>
</html>`;
    }

    return {
        onRequest: onRequest
    };
});