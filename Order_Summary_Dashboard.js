/**
 * Order Tracking Desk Suitelet
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['N/search', 'N/url', 'N/runtime', 'N/log', 'N/format'], function (search, url, runtime, log, format) {

    const MAX_ROWS = 10000;
    const PAGE_SIZE = 1000;

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
        poOnOrder: ['po on order'],
        salesOrder: ['document number', 'order number', 'sales order', 'so number', 'tranid'],
        item: ['item id', 'itemid', 'item number', 'sku', 'item'],
        customer: ['customer', 'entity'],
        category: ['category', 'item category', 'product category'],
        warehouse: ['warehouse', 'location'],
        orderType: ['custbody_im_order_type', 'order type'],
        dryIce: ['custitem_dry_ice_required', 'dry ice', 'dry ice required'],
        vendor: ['preferred vendor', 'vendor'],
        endingDate: ['ending date', 'customer required by date', 'required by date', 'required by']
    };

    /*
     * links: only these columns become clickable.
     * filters: dropdown filters for each report, rendered in order.
     * A filter is hidden automatically when the saved search
     * does not return a matching result column.
     * The first date-like saved-search result column is used by Date From/To,
     * unless dateFilter names the column (label and keywords) for that report.
     */
    const REPORT_UI = {
        openPO: {
            links: [
                { type: 'transaction', keywords: KEYWORDS.purchaseOrder }
            ],
            filters: [
                { label: 'PO', keywords: KEYWORDS.purchaseOrder },
                { label: 'Category', keywords: KEYWORDS.category },
                { label: 'Item ID', keywords: KEYWORDS.item },
                { label: 'Vendor', keywords: KEYWORDS.vendor }
            ]
        },

        recommendedPurchases: {
            links: [
                { type: 'item', keywords: KEYWORDS.item },
                { type: 'poByItem', keywords: KEYWORDS.poOnOrder }
            ],
            filters: [
                { label: 'Item ID', keywords: KEYWORDS.item },
                { label: 'Warehouse', keywords: KEYWORDS.warehouse },
                { label: 'Category', keywords: KEYWORDS.category },
                { label: 'Vendor', keywords: KEYWORDS.vendor }
            ],
            dateFilter: { label: 'Ending Date', keywords: KEYWORDS.endingDate },
           hideColumns: [KEYWORDS.vendor]
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
                { label: 'Category', keywords: KEYWORDS.category },
                { label: 'Vendor', keywords: KEYWORDS.vendor }
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
                { label: 'Category', keywords: KEYWORDS.category },
                { label: 'Vendor', keywords: KEYWORDS.vendor }
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
                { label: 'Category', keywords: KEYWORDS.category },
                { label: 'Vendor', keywords: KEYWORDS.vendor }
            ]
        },

        shortDated: {
            links: [
                { type: 'item', keywords: KEYWORDS.item }
            ],
            filters: [
                { label: 'Item ID', keywords: KEYWORDS.item },
                { label: 'Warehouse', keywords: KEYWORDS.warehouse },
                { label: 'Category', keywords: KEYWORDS.category },
                { label: 'Vendor', keywords: KEYWORDS.vendor }
            ]
        },

        inventoryOnHand: {
            links: [
                { type: 'item', keywords: KEYWORDS.item }
            ],
            filters: [
                { label: 'Item ID', keywords: KEYWORDS.item },
                { label: 'Warehouse', keywords: KEYWORDS.warehouse },
                { label: 'Category', keywords: KEYWORDS.category },
                { label: 'Vendor', keywords: KEYWORDS.vendor }
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
     *
     * searchType limits a column to "item" or "transaction" searches.
     * hidden columns are read by the script but never shown.
     * If an appended column is not valid for the saved search, the
     * report loads without the appended columns instead of failing.
     */
    const EXTRA_COLUMNS = {
        recommendedPurchases: [
            // item search
            { name: 'vendor', label: 'Preferred Vendor', searchType: 'item' },
            { name: 'internalid', label: 'Item Internal ID', searchType: 'item', hidden: true },

            // transaction search, for example sales order lines
            { name: 'vendor', join: 'item', label: 'Preferred Vendor', searchType: 'transaction' },
            { name: 'internalid', join: 'item', label: 'Item Internal ID', searchType: 'transaction', hidden: true }
        ],
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

    /*
     * Ending Date filter (Recommended Purchases).
     *
     * Ending Date (customer required by date) is a sales order line
     * field. When the Recommended Purchases search does not return it,
     * the Suitelet reads the open sales order lines for the items in
     * the report. An item passes the filter when any of its open lines
     * has an Ending Date in the chosen range; the column shows the
     * earliest one.
     *
     * fieldId: the line field ID, for example 'custcol_ending_date'.
     * Leave it empty to read it from the Ending Date column of the
     * Open Sales Orders or Backorder saved search.
     *
     *   SalesOrd:B  Pending Fulfillment
     *   SalesOrd:D  Partially Fulfilled
     *   SalesOrd:E  Pending Billing/Partially Fulfilled
     *   (add SalesOrd:A to include Pending Approval)
     */
    const ENDING_DATE = {
        fieldId: '',
        label: 'Ending Date',
        salesOrderStatuses: ['SalesOrd:B', 'SalesOrd:D', 'SalesOrd:E'],
        detectFrom: ['openSO', 'backorder'],
        chunkSize: 500
    };

    let detectedEndingDateField = '';

    /*
     * PO On Order popup (Recommended Purchases).
     *
     * Left side, onOrderStatuses: approved purchase orders and
     * transfer orders that still have quantity to receive.
     * Right side, pendingStatuses: purchase orders waiting for
     * approval. A PO whose Approval Status is Pending Approval
     * (value 1) also goes to the right, whatever its status.
     *
     *   PurchOrd:A  Pending Supervisor Approval
     *   PurchOrd:B  Pending Receipt
     *   PurchOrd:D  Partially Received
     *   PurchOrd:E  Pending Billing/Partially Received
     *   TrnfrOrd:B  Pending Fulfillment
     *   TrnfrOrd:D  Partially Fulfilled
     *   TrnfrOrd:E  Pending Receipt/Partially Fulfilled
     *   TrnfrOrd:F  Pending Receipt
     *
     * Optional columns are dropped step by step if a field is not
     * available in the account.
     */
    const ON_ORDER_DETAIL = {
        transactionTypes: ['PurchOrd', 'TrnfrOrd'],
        onOrderStatuses: [
            'PurchOrd:B',
            'PurchOrd:D',
            'PurchOrd:E',
            'TrnfrOrd:B',
            'TrnfrOrd:D',
            'TrnfrOrd:E',
            'TrnfrOrd:F'
        ],
        pendingStatuses: ['PurchOrd:A'],
        pendingApprovalValue: '1',
        coreColumns: ['item', 'tranid', 'status', 'entity', 'location', 'quantity', 'quantityshiprecv'],
        // tried in order: all fields, then without dates, then core only
        optionalColumnSets: [
            ['transferlocation', 'approvalstatus', 'expectedreceiptdate', 'duedate'],
            ['transferlocation', 'approvalstatus'],
            []
        ]
    };

    /*
     * Lookup maps instead of arrays, so the per-row
     * transaction type check is a single property read.
     */
    const CUSTOMER_TRAN_TYPES = toLookup([
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
    ]);

    const VENDOR_TRAN_TYPES = toLookup([
        'purchaseorder',
        'vendorbill',
        'vendorcredit',
        'vendorpayment',
        'itemreceipt',
        'vendorreturnauthorization'
    ]);

    /*
     * url.resolveRecord only depends on the record type, so one
     * URL is resolved per type and the internal ID is swapped in
     * for each row. On a 10,000-row report this replaces
     * thousands of API calls (and failed-call log entries) with
     * a string replace.
     */
    const PENDING_STATUS_VALUES = toLookup(
        ['pendingSupervisorApproval'].concat(ON_ORDER_DETAIL.pendingStatuses)
    );

    const URL_ID_TOKEN = '987654321012';
    const urlTemplates = Object.create(null);

    function toLookup(list) {
        const map = Object.create(null);

        list.forEach(function (value) {
            map[value] = true;
        });

        return map;
    }

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
                sendJson(
                    response,
                    getReportData(
                        request.parameters.report,
                        request.parameters.itemId
                    )
                );
                return;
            }

            if (action === 'onOrderDetail') {
                sendJson(
                    response,
                    getOnOrderDetail(
                        request.parameters.itemId,
                        request.parameters.itemName
                    )
                );
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

    /*
     * Any item search type counts as "item" and any
     * transaction search type counts as "transaction".
     */
    function searchKind(searchType) {
        const type = String(searchType || '').toLowerCase();

        if (
            type === 'transaction' ||
            type === 'transferorder' ||
            CUSTOMER_TRAN_TYPES[type] ||
            VENDOR_TRAN_TYPES[type]
        ) {
            return 'transaction';
        }

        if (type.indexOf('item') !== -1) {
            return 'item';
        }

        return type;
    }

    /*
     * Returns how many columns were appended and the indexes of
     * the hidden ones (read by the script, never shown).
     */
    function addExtraColumns(searchObj, reportKey) {
        const outcome = { added: 0, hidden: {}, hiddenColumns: [] };
        const extras = EXTRA_COLUMNS[reportKey];

        if (!extras || !extras.length) {
            return outcome;
        }

        const columns = searchObj.columns || [];

        if (!columns.length) {
            return outcome;
        }

        /*
         * A summarized search rejects a plain column, so the
         * appended field has to group alongside the existing ones.
         */
        const grouped = columns.some(function (column) {
            return Boolean(column.summary);
        });

        const kind = searchKind(searchObj.searchType);
        const added = [];

        extras.forEach(function (extra) {
            if (extra.searchType && extra.searchType !== kind) {
                return;
            }

            const name = String(extra.name).toLowerCase();
            const join = String(extra.join || '').toLowerCase();

            if (hasColumn(columns, name, join) || hasColumn(added, name, join)) {
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

                const column = search.createColumn(options);

                if (extra.hidden) {
                    outcome.hidden[columns.length + added.length] = true;
                    outcome.hiddenColumns.push(column);
                }

                added.push(column);

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
            outcome.added = added.length;
        }

        return outcome;
    }

    function loadSearch(reportKey) {
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

            return searchObj;

        } catch (e) {
            throw new Error(
                'Unable to load saved search "' + searchId + '" for ' +
                reportKey + ': ' + (e.message || String(e))
            );
        }
    }

    /*
     * Appends an item filter while keeping the saved search's own
     * criteria intact, including OR groups and parentheses.
     */
    function addItemFilter(searchObj, itemId) {
        const itemFilter = ['item', 'anyof', itemId];
        const expression = searchObj.filterExpression || [];

        searchObj.filterExpression = expression.length
            ? [expression, 'AND', itemFilter]
            : [itemFilter];
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

        const text = String(value);
        const cut = text.lastIndexOf(':');

        return cut === -1 ? text.trim() : text.slice(cut + 1).trim();
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

        const typeKey = String(recordType).toLowerCase();
        let template = urlTemplates[typeKey];

        if (template === undefined) {
            template = '';

            try {
                const sample = url.resolveRecord({
                    recordType: recordType,
                    recordId: URL_ID_TOKEN,
                    isEditMode: false
                });

                /*
                 * false = the token did not survive, so this type
                 * falls back to resolving each record directly.
                 */
                template = (sample && sample.indexOf(URL_ID_TOKEN) !== -1)
                    ? sample
                    : false;

            } catch (e) {
                log.debug({
                    title: 'Unable to resolve record URL',
                    details: {
                        recordType: recordType,
                        recordId: recordId,
                        message: e.message
                    }
                });
            }

            urlTemplates[typeKey] = template;
        }

        if (template) {
            return template.split(URL_ID_TOKEN).join(String(recordId));
        }

        if (template === false) {
            try {
                return url.resolveRecord({
                    recordType: recordType,
                    recordId: recordId,
                    isEditMode: false
                });
            } catch (e) {
                return '';
            }
        }

        return '';
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
            itemId: -1,
            itemInternalId: -1
        };

        (columns || []).forEach(function (column, index) {
            if (column.join) {
                // item internal ID through the item join, for example on a sales order line search
                if (
                    roles.itemInternalId === -1 &&
                    String(column.join).toLowerCase() === 'item' &&
                    String(column.name || '').toLowerCase() === 'internalid'
                ) {
                    roles.itemInternalId = index;
                }

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

    function buildRow(result, columns, visible, keys, searchType, roles) {
        const row = {
            internalId: result.id || '',
            recordType: result.recordType || searchType || ''
        };

        const visibleCount = visible.length;

        for (let index = 0; index < visibleCount; index++) {
            row[keys[index]] = getDisplayValue(result, columns[visible[index]]);
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

        if (!row.itemId && roles.itemInternalId !== -1) {
            const joinedItemId = safeGetValue(result, columns[roles.itemInternalId]);

            if (joinedItemId) {
                row.itemId = joinedItemId;
            }
        }

        if (!row.internalId && roles.internalId !== -1) {
            row.internalId = safeGetValue(result, columns[roles.internalId]) || '';
        }

        row.viewUrl = resolveRecordUrl(row.recordType, row.internalId);

        const lowerType = String(row.recordType || '').toLowerCase();

        if (row.entityId) {
            if (CUSTOMER_TRAN_TYPES[lowerType]) {
                row.entityUrl = resolveRecordUrl('customer', row.entityId);

            } else if (VENDOR_TRAN_TYPES[lowerType]) {
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

    function executeSearch(searchObj, hiddenIndexes) {
        const hidden = hiddenIndexes || {};
        const nsColumns = searchObj.columns || [];
        const roles = columnRoles(nsColumns);
        const searchType = searchObj.searchType || '';
        const allColumns = columnMeta(nsColumns);
        const visible = [];
        const rows = [];

        nsColumns.forEach(function (column, index) {
            if (!hidden[index]) {
                visible.push(index);
            }
        });

        const columns = visible.map(function (index) {
            return allColumns[index];
        });

        const keys = columns.map(function (column) {
            return column.key;
        });

        const paged = searchObj.runPaged({ pageSize: PAGE_SIZE });
        const total = paged.count || 0;
        const ranges = paged.pageRanges || [];

        for (
            let pageIndex = 0;
            pageIndex < ranges.length && rows.length < MAX_ROWS;
            pageIndex++
        ) {
            const data = paged.fetch({ index: ranges[pageIndex].index }).data;
            const limit = Math.min(data.length, MAX_ROWS - rows.length);

            for (let rowIndex = 0; rowIndex < limit; rowIndex++) {
                rows.push(buildRow(data[rowIndex], nsColumns, visible, keys, searchType, roles));
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

    function normalizeText(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /*
     * Same matching rule the page uses for filters:
     * exact name or label, otherwise "contains".
     */
    function matchesKeywords(column, keywords) {
        const name = normalizeText(column.name);
        const label = normalizeText(column.label);
        const haystack = name + ' ' + label;

        return keywords.some(function (keyword) {
            const word = normalizeText(keyword);

            return (
                name === word ||
                label === word ||
                (word.length > 2 && haystack.indexOf(word) !== -1)
            );
        });
    }

    /*
     * Uses ENDING_DATE.fieldId when set. Otherwise reads the field ID
     * from the Ending Date column of the Open Sales Orders or
     * Backorder saved search.
     */
    function findEndingDateField() {
        if (ENDING_DATE.fieldId) {
            return ENDING_DATE.fieldId;
        }

        if (detectedEndingDateField) {
            return detectedEndingDateField;
        }

        let found = '';

        ENDING_DATE.detectFrom.some(function (reportKey) {
            if (!getSearchId(reportKey)) {
                return false;
            }

            try {
                const column = (loadSearch(reportKey).columns || []).find(function (candidate) {
                    return (
                        !candidate.join &&
                        !/^formula/i.test(String(candidate.name || '')) &&
                        matchesKeywords(candidate, KEYWORDS.endingDate)
                    );
                });

                if (column) {
                    found = String(column.name);
                }

            } catch (e) {
                log.audit({
                    title: 'Ending Date field detection skipped',
                    details: { reportKey: reportKey, message: e.message }
                });
            }

            return Boolean(found);
        });

        if (found) {
            detectedEndingDateField = found;
        }

        return found;
    }

    function parseDateValue(value) {
        if (!value) {
            return null;
        }

        const types = [format.Type.DATE, format.Type.DATETIME];

        for (let index = 0; index < types.length; index++) {
            try {
                const parsed = format.parse({ value: String(value), type: types[index] });

                if (parsed instanceof Date && !isNaN(parsed.getTime())) {
                    return parsed;
                }

            } catch (e) {
                // not this date type; try the next one
            }
        }

        return null;
    }

    function isoDate(date) {
        const month = date.getMonth() + 1;
        const day = date.getDate();

        return (
            date.getFullYear() + '-' +
            (month < 10 ? '0' : '') + month + '-' +
            (day < 10 ? '0' : '') + day
        );
    }

    /*
     * Adds an Ending Date column to Recommended Purchases from the
     * open sales order lines of the items in the report.
     * row.endingDate is the earliest date (shown in the table) and
     * row.endingDateList holds every date, so the filter keeps an item
     * when any of its open lines falls in the chosen range.
     */
    function attachEndingDates(data, nsColumns) {
        const rows = (data && data.rows) || [];

        if (!rows.length) {
            return;
        }

        // the saved search already returns an Ending Date column, so the filter uses it as it is
        const alreadyReturned = (nsColumns || []).some(function (column) {
            return matchesKeywords(column, KEYWORDS.endingDate);
        });

        if (alreadyReturned) {
            return;
        }

        const itemIds = [];
        const seen = Object.create(null);

        const rowItemIds = rows.map(function (row) {
            const id = String(
                row.itemId ||
                (searchKind(row.recordType) === 'item' ? row.internalId : '') ||
                ''
            );

            if (id && !seen[id]) {
                seen[id] = true;
                itemIds.push(id);
            }

            return id;
        });

        if (!itemIds.length) {
            return;
        }

        try {
            const fieldId = findEndingDateField();

            if (!fieldId) {
                log.audit({
                    title: 'Ending Date filter unavailable',
                    details: 'Set ENDING_DATE.fieldId to the sales order line field ID.'
                });

                return;
            }

            const datesByItem = Object.create(null);

            const itemColumn = search.createColumn({
                name: 'item',
                summary: search.Summary.GROUP
            });

            const dateColumn = search.createColumn({
                name: fieldId,
                summary: search.Summary.GROUP
            });

            for (let start = 0; start < itemIds.length; start += ENDING_DATE.chunkSize) {
                const searchObj = search.create({
                    type: search.Type.TRANSACTION,
                    filters: [
                        ['type', 'anyof', 'SalesOrd'],
                        'AND', ['mainline', 'is', 'F'],
                        'AND', ['closed', 'is', 'F'],
                        'AND', ['status', 'anyof', ENDING_DATE.salesOrderStatuses],
                        'AND', ['item', 'anyof', itemIds.slice(start, start + ENDING_DATE.chunkSize)],
                        'AND', [fieldId, 'isnotempty', ''],
                        // only lines that still have quantity to fulfill
                        'AND', ['formulanumeric: {quantity} - NVL({quantityshiprecv}, 0)', 'greaterthan', '0']
                    ],
                    columns: [itemColumn, dateColumn]
                });

                const paged = searchObj.runPaged({ pageSize: PAGE_SIZE });

                (paged.pageRanges || []).forEach(function (range) {
                    paged.fetch({ index: range.index }).data.forEach(function (result) {
                        const id = String(safeGetValue(result, itemColumn));
                        const text = safeGetValue(result, dateColumn);
                        const parsed = parseDateValue(text);

                        if (!id || !parsed) {
                            return;
                        }

                        (datesByItem[id] || (datesByItem[id] = [])).push({
                            time: parsed.getTime(),
                            text: String(text),
                            iso: isoDate(parsed)
                        });
                    });
                });
            }

            Object.keys(datesByItem).forEach(function (id) {
                datesByItem[id].sort(function (a, b) {
                    return a.time - b.time;
                });
            });

            rows.forEach(function (row, index) {
                const list = datesByItem[rowItemIds[index]];

                if (!list) {
                    return;
                }

                row.endingDate = list[0].text;
                row.endingDateList = list.map(function (entry) {
                    return entry.iso;
                });
            });

            data.columns.push({
                key: 'endingDate',
                label: ENDING_DATE.label,
                name: fieldId,
                join: '',
                summary: ''
            });

        } catch (e) {
            // the report still loads; only the Ending Date column and filter are missing
            log.error({
                title: 'Ending Date lookup failed',
                details: { message: e.message, stack: e.stack }
            });
        }
    }

    function toNumber(value) {
        const numberValue = parseFloat(
            String(value === null || value === undefined ? '' : value).replace(/,/g, '')
        );

        return isNaN(numberValue) ? 0 : numberValue;
    }

    function roundQty(value) {
        return Math.round(value * 10000) / 10000;
    }

    /*
     * The link carries the item's internal ID. The item name is only
     * a fallback for searches that do not return an internal ID.
     */
    function findItemIds(itemId, itemName) {
        if (/^\d+$/.test(String(itemId || ''))) {
            return [String(itemId)];
        }

        const name = String(itemName || '').trim();

        if (!name) {
            return [];
        }

        const target = name.toLowerCase();
        const nameColumn = search.createColumn({ name: 'itemid' });

        /*
         * Only items whose name matches exactly are kept,
         * so "01N14-010" never picks up "01N14-010 V2".
         */
        return search.create({
            type: search.Type.ITEM,
            filters: [['itemid', 'is', name]],
            columns: [nameColumn]
        }).run().getRange({ start: 0, end: 25 }).filter(function (result) {
            const resultName = stripHierarchy(safeGetValue(result, nameColumn)) || '';
            return String(resultName).trim().toLowerCase() === target;
        }).map(function (result) {
            return String(result.id);
        });
    }

    /*
     * One line-level search returns both sides of the popup,
     * which is cheaper than running a search per side.
     */
    function runOnOrderSearch(itemIds, columnNames) {
        const columnMap = {};

        const columns = columnNames.map(function (name) {
            const column = search.createColumn({ name: name });
            columnMap[name] = column;
            return column;
        });

        const searchObj = search.create({
            type: search.Type.TRANSACTION,
            filters: [
                ['type', 'anyof', ON_ORDER_DETAIL.transactionTypes],
                'AND', ['mainline', 'is', 'F'],
                'AND', ['closed', 'is', 'F'],
                'AND', ['item', 'anyof', itemIds],
                'AND', ['quantity', 'greaterthan', '0'],
                'AND', ['status', 'anyof', ON_ORDER_DETAIL.onOrderStatuses.concat(ON_ORDER_DETAIL.pendingStatuses)]
            ],
            columns: columns
        });

        const results = [];
        const paged = searchObj.runPaged({ pageSize: PAGE_SIZE });

        (paged.pageRanges || []).forEach(function (range) {
            const data = paged.fetch({ index: range.index }).data;

            for (let index = 0; index < data.length; index++) {
                results.push(data[index]);
            }
        });

        return { results: results, columns: columnMap };
    }

    function getOnOrderDetail(itemId, itemName) {
        const itemIds = findItemIds(itemId, itemName);

        if (!itemIds.length) {
            return {
                onOrder: [],
                pending: [],
                error: 'Could not find the item for this row.'
            };
        }

        const sets = ON_ORDER_DETAIL.optionalColumnSets;
        let run = null;

        for (let index = 0; index < sets.length && !run; index++) {
            try {
                run = runOnOrderSearch(itemIds, ON_ORDER_DETAIL.coreColumns.concat(sets[index]));

            } catch (e) {
                // a field is not available in this account; the last set is core only, so let that error surface
                if (index === sets.length - 1) {
                    throw e;
                }

                log.audit({
                    title: 'On order detail: optional columns skipped',
                    details: { skipped: sets[index].join(', '), message: e.message }
                });
            }
        }

        const col = run.columns;
        const wantedItems = toLookup(itemIds);
        const groups = Object.create(null);
        const onOrder = [];
        const pending = [];

        run.results.forEach(function (result) {
            const lineItemId = String(safeGetValue(result, col.item));

            /*
             * The item filter can also return lines for related items
             * (for example sub-items), so only lines for the exact
             * item that was clicked are kept.
             */
            if (!wantedItems[lineItemId]) {
                return;
            }

            const isTransfer = String(result.recordType || '').toLowerCase() === 'transferorder';
            const statusValue = String(safeGetValue(result, col.status));
            const statusText = safeGetText(result, col.status) || statusValue;

            const approvalValue = col.approvalstatus
                ? String(safeGetValue(result, col.approvalstatus))
                : '';

            const isPending = !isTransfer && (
                approvalValue === ON_ORDER_DETAIL.pendingApprovalValue ||
                PENDING_STATUS_VALUES[statusValue] === true ||
                /approval/i.test(statusText)
            );

            const fromLocation = stripHierarchy(safeGetText(result, col.location)) || '';

            const toLocation = col.transferlocation
                ? (stripHierarchy(safeGetText(result, col.transferlocation)) || '')
                : '';

            // a transfer order is on order at the location receiving it
            const location = isTransfer ? (toLocation || fromLocation) : fromLocation;

            const source = isTransfer
                ? ((toLocation && fromLocation && fromLocation !== toLocation) ? 'From ' + fromLocation : '')
                : (stripHierarchy(safeGetText(result, col.entity)) || '');

            // lines of the same order, item and location are combined into one row
            const groupKey = result.id + '|' + lineItemId + '|' + location;
            let entry = groups[groupKey];

            if (!entry) {
                entry = groups[groupKey] = {
                    id: String(result.id),
                    type: isTransfer ? 'TO' : 'PO',
                    item: stripHierarchy(safeGetText(result, col.item)) || '',
                    number: String(safeGetValue(result, col.tranid) || result.id),
                    url: resolveRecordUrl(isTransfer ? 'transferorder' : 'purchaseorder', result.id),
                    status: statusText,
                    location: location,
                    source: source,
                    expected: '',
                    ordered: 0,
                    received: 0,
                    remaining: 0
                };

                (isPending ? pending : onOrder).push(entry);
            }

            const ordered = toNumber(safeGetValue(result, col.quantity));
            const received = toNumber(safeGetValue(result, col.quantityshiprecv));

            /*
             * Transfer orders also return the shipping side of each line
             * with a minus quantity. Only the receiving (plus) side is
             * counted, so Ordered, Received and Remaining are plus amounts.
             */
            if (ordered > 0) {
                entry.ordered += ordered;
                entry.received += received;
                entry.remaining += Math.max(ordered - received, 0);
            }

            if (!entry.expected) {
                entry.expected =
                    (col.expectedreceiptdate && safeGetValue(result, col.expectedreceiptdate)) ||
                    (col.duedate && safeGetValue(result, col.duedate)) ||
                    '';
            }
        });

        function rounded(entry) {
            entry.ordered = roundQty(entry.ordered);
            entry.received = roundQty(entry.received);
            entry.remaining = roundQty(entry.remaining);
            return entry;
        }

        return {
            itemIds: itemIds,
            multipleItems: itemIds.length > 1,
            // a line already fully received is no longer on order
            onOrder: onOrder.filter(function (entry) {
                return entry.remaining > 0;
            }).map(rounded),
            pending: pending.map(rounded)
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

    function getReportData(reportKey, itemId) {
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
            const searchObj = loadSearch(report.key);

            if (report.key === 'openPO' && /^\d+$/.test(String(itemId || ''))) {
                addItemFilter(searchObj, String(itemId));
            }

            const baseColumns = searchObj.columns;
            const extras = addExtraColumns(searchObj, report.key);
            let result;

            try {
                result = executeSearch(searchObj, extras.hidden);

            } catch (e) {
                // an appended column is not valid for this saved search
                if (!extras.added) {
                    throw e;
                }

                log.audit({
                    title: 'Appended columns skipped',
                    details: { reportKey: report.key, message: e.message }
                });

                result = null;

                // keep the hidden item ID (item links) if only a visible column was the problem
                const hiddenCount = extras.hiddenColumns.length;

                if (hiddenCount && hiddenCount < extras.added) {
                    try {
                        const hidden = {};

                        for (let index = 0; index < hiddenCount; index++) {
                            hidden[baseColumns.length + index] = true;
                        }

                        searchObj.columns = baseColumns.concat(extras.hiddenColumns);
                        result = executeSearch(searchObj, hidden);

                    } catch (retryError) {
                        result = null;
                    }
                }

                if (!result) {
                    searchObj.columns = baseColumns;
                    result = executeSearch(searchObj);
                }
            }

            if (report.key === 'recommendedPurchases') {
                attachEndingDates(result, searchObj.columns);
            }

            return result;
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
                total: loadSearch(report.key).runPaged({ pageSize: PAGE_SIZE }).count || 0
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
            const dateFilter = REPORT_UI[report.key].dateFilter;
            const dateLabel = dateFilter && dateFilter.label ? dateFilter.label + ' ' : 'Date ';

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
                            '<label>' + dateLabel + 'From</label>' +
                            '<input class="input-from" type="date">' +
                        '</div>' +

                        '<div class="filter-field date-field">' +
                            '<label>' + dateLabel + 'To</label>' +
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
        const reportsJson = inlineJson(REPORTS);
        const reportUiJson = inlineJson(REPORT_UI);

        /*
         * Function replacers, so a "$" inside a label can never be
         * treated as a special replacement pattern.
         */
        return buildHtml()
            .replace('__REPORTS__', function () { return reportsJson; })
            .replace('__REPORT_UI__', function () { return reportUiJson; });
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
    box-shadow: 0 8px 20px rgba(20, 23, 28, .05);
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
    grid-template-columns: repeat(7, 1fr);
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
    border-bottom: 1px solid var(--line);
    margin-bottom: 15px;
}

.tab-button {
    border: 0;
    background: none;
    padding: 10px 1px;
    cursor: pointer;
    color: var(--muted);
    font-weight: 700;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
}

.tab-button.active {
    color: var(--signal2);
    border-bottom-color: var(--signal);
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
    box-shadow: 0 0 0 3px var(--signalSoft);
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
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
}

td {
    padding: 10px 11px;
    border-bottom: 1px solid var(--line2);
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

/*
 * PO On Order popup
 */
body.modal-open {
    overflow: hidden;
}

.modal {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
}

.modal[hidden],
.scope-toggle[hidden] {
    display: none;
}

.modal-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(20, 23, 28, .45);
}

.modal-dialog {
    position: relative;
    width: 100%;
    max-width: 1320px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    box-shadow: 0 24px 60px rgba(20, 23, 28, .25);
}

.modal-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    padding: 18px 20px 14px;
    border-bottom: 1px solid var(--line);
}

.modal-title {
    font-size: 20px;
    margin: 0;
}

.modal-meta {
    margin-top: 5px;
    color: var(--muted);
    font-size: 13px;
}

.modal-meta strong {
    color: var(--signal2);
}

.modal-tools {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    justify-content: flex-end;
}

.scope-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 700;
    color: var(--muted);
    cursor: pointer;
    white-space: nowrap;
}

.modal-body {
    padding: 16px 20px 20px;
    overflow: auto;
}

.modal-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
    align-items: start;
}

.modal-side {
    min-width: 0;
}

.side-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 10px;
    margin-bottom: 9px;
    padding-left: 10px;
    border-left: 3px solid var(--signal);
}

.modal-side.pending .side-head {
    border-left-color: var(--warn);
}

.side-title {
    font-size: 15px;
    margin: 0;
}

.side-sub {
    font-size: 11.5px;
    color: var(--faint);
    margin-top: 2px;
}

.side-total {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    font-size: 11.5px;
    color: var(--muted);
    white-space: nowrap;
}

.side-sum strong {
    font-size: 18px;
    color: var(--signal2);
    margin-left: 3px;
}

.modal-side.pending .side-sum strong {
    color: var(--warn);
}

.modal-table table {
    min-width: 520px;
}

.modal-table th,
.modal-table td {
    padding: 8px 9px;
}

.modal-table td {
    font-size: 12.5px;
}

.type-badge {
    display: inline-block;
    font-size: 9.5px;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 4px;
    margin-right: 6px;
    vertical-align: 1px;
    background: var(--signalSoft);
    color: var(--signal2);
}

.type-badge.type-to {
    background: #e3f0e8;
    color: #2f6b4f;
}

.line-sub {
    font-size: 11px;
    color: var(--faint);
    margin-top: 3px;
}

@media (max-width: 900px) {
    .modal {
        padding: 10px;
    }

    .modal-head {
        flex-direction: column;
    }

    .modal-grid {
        grid-template-columns: 1fr;
    }
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
        grid-template-columns: repeat(4, 1fr);
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
        grid-template-columns: repeat(2, 1fr);
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

<div id="onOrderModal" class="modal" hidden>
    <div class="modal-backdrop" data-close-modal="1"></div>

    <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="onOrderTitle">

        <div class="modal-head">
            <div>
                <div class="eyebrow">PO On Order</div>
                <h2 id="onOrderTitle" class="modal-title"></h2>
                <div class="modal-meta">
                    Recommended Purchases shows <strong id="onOrderQty"></strong> on order
                </div>
            </div>

            <div class="modal-tools">
                <label id="onOrderScopeWrap" class="scope-toggle" hidden>
                    <input id="onOrderScope" type="checkbox">
                    <span id="onOrderScopeLabel"></span>
                </label>

                <button type="button" id="onOrderClose" class="button" data-close-modal="1">
                    Close
                </button>
            </div>
        </div>

        <div class="modal-body">
            <div id="onOrderError"></div>

            <div class="modal-grid">

                <section class="modal-side">
                    <div class="side-head">
                        <div>
                            <h3 class="side-title">On order</h3>
                            <div class="side-sub">Approved purchase orders and transfer orders not yet received</div>
                        </div>
                        <div id="onOrderTotal" class="side-total"></div>
                    </div>

                    <div class="table-wrap modal-table">
                        <table>
                            <thead>
                                <tr>
                                    <th>Order</th>
                                    <th>Status</th>
                                    <th>Location</th>
                                    <th>Expected</th>
                                    <th class="num">Ordered</th>
                                    <th class="num">Received</th>
                                    <th class="num">Remaining</th>
                                </tr>
                            </thead>
                            <tbody id="onOrderBody"></tbody>
                        </table>
                    </div>
                </section>

                <section class="modal-side pending">
                    <div class="side-head">
                        <div>
                            <h3 class="side-title">Waiting for approval</h3>
                            <div class="side-sub">Purchase orders pending approval or pending supervisor approval</div>
                        </div>
                        <div id="pendingTotal" class="side-total"></div>
                    </div>

                    <div class="table-wrap modal-table">
                        <table>
                            <thead>
                                <tr>
                                    <th>Order</th>
                                    <th>Status</th>
                                    <th>Location</th>
                                    <th>Expected</th>
                                    <th class="num">Quantity</th>
                                </tr>
                            </thead>
                            <tbody id="pendingBody"></tbody>
                        </table>
                    </div>
                </section>

            </div>
        </div>

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
    var SUITELET_URL = window.location.href.split('#')[0];

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

    /*
     * Each layout gets a version number. Rows remember the version
     * their cached HTML, search text and date were built for, so
     * filtering and re-rendering never recompute them.
     */
    var layoutVersion = 0;

    /*
     * Latest request number per report. Older responses that
     * arrive late are ignored instead of overwriting newer data.
     */
    var requestSeq = {};

    /*
     * PO On Order popup results per item, so opening the same
     * item again is instant. Cleared by any Refresh.
     */
    var detailCache = Object.create(null);
    var detailSeq = 0;
    var detail = null;

    var reportMap = Object.create(null);
    var barCache = Object.create(null);

    REPORTS.forEach(function (report) {
        reportMap[report.key] = report;
    });

    var activeKey = REPORTS.length ? REPORTS[0].key : '';

    var SEARCH_SEPARATOR = '\\u0001';

    var WHOLE_NUMBER = new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });

    var DECIMAL_NUMBER = new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    var ESC_TEST = /[&<>"']/;
    var ESC_ALL = /[&<>"']/g;

    var ESC_MAP = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };

    function escChar(character) {
        return ESC_MAP[character];
    }

    function byId(id) {
        return document.getElementById(id);
    }

    function esc(value) {
        if (value === null || value === undefined || value === '') {
            return '';
        }

        var text = String(value);

        return ESC_TEST.test(text) ? text.replace(ESC_ALL, escChar) : text;
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

    /*
     * Checkbox columns come back as T and F.
     * Returns '' when the value is not a checkbox value.
     */
    function yesNo(value) {
        if (value === true || value === 'T') {
            return 'Yes';
        }

        if (value === false || value === 'F') {
            return 'No';
        }

        return '';
    }

    function displayValue(value, numeric) {
        if (value === null || value === undefined || value === '') {
            return '';
        }

        var flag = yesNo(value);

        if (flag) {
            return flag;
        }

        if (!numeric) {
            return esc(value);
        }

        var numberValue = Number(String(value).replace(/,/g, ''));

        if (isNaN(numberValue)) {
            return esc(value);
        }

        return (numberValue % 1 === 0 ? WHOLE_NUMBER : DECIMAL_NUMBER).format(numberValue);
    }

    /*
     * The stored option value stays raw so the
     * row comparison in filterRows still matches.
     */
    function optionLabel(value) {
        return yesNo(value) || String(value);
    }

    function rawCsv(value) {
        if (value === null || value === undefined) {
            return '';
        }

        return yesNo(value) || String(value);
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
        return reportMap[key] || null;
    }

    function filterBar(key) {
        if (!barCache[key]) {
            barCache[key] = document.querySelector(
                '.filter-bar[data-report="' + key + '"]'
            );
        }

        return barCache[key];
    }

    function filterDefs(key) {
        return (REPORT_UI[key] && REPORT_UI[key].filters) || [];
    }

    function cleanUrl(input) {
        return input
            .replace(/([?&])action=[^&]*/g, '$1')
            .replace(/([?&])report=[^&]*/g, '$1')
            .replace(/([?&])itemId=[^&]*/g, '$1')
            .replace(/([?&])itemName=[^&]*/g, '$1')
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

            for (keywordIndex = 0; keywordIndex < keywords.length; keywordIndex++) {
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

            for (keywordIndex = 0; keywordIndex < keywords.length; keywordIndex++) {
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

        ((REPORT_UI[key] && REPORT_UI[key].links) || []).forEach(function (link) {
            var found = columnKey(columns, link.keywords);

            if (found && !linkTypes[found]) {
                linkTypes[found] = link.type;
            }
        });

        var dateFilter = REPORT_UI[key] && REPORT_UI[key].dateFilter;

        layoutVersion++;

        var slotKeys = filterDefs(key).map(function (filter) {
            return columnKey(columns, filter.keywords);
        });

        var itemKey = '';
        var warehouseKey = '';

        Object.keys(linkTypes).forEach(function (columnKeyName) {
            if (!itemKey && linkTypes[columnKeyName] === 'item') {
                itemKey = columnKeyName;
            }
        });

        filterDefs(key).forEach(function (filter, slot) {
            if (!warehouseKey && normalize(filter.label) === 'warehouse') {
                warehouseKey = slotKeys[slot] || '';
            }
        });

             var hiddenKeys = {};

((REPORT_UI[key] && REPORT_UI[key].hideColumns) || []).forEach(function (keywords) {
    var found = columnKey(columns, keywords);

    if (found) {
        hiddenKeys[found] = true;
    }
});

var reportLayout = {
    version: layoutVersion,
    dateKey: columnKey(columns, dateFilter ? dateFilter.keywords : ['date']),
    itemKey: itemKey,
    warehouseKey: warehouseKey,
    slotKeys: slotKeys,
    hiddenKeys: Object.keys(hiddenKeys),
    columns: columns.filter(function (column) {
        return !hiddenKeys[column.key];
    }).map(function (column) {
        return {
            key: column.key,
            label: column.label,
            numeric: numericLabel(column.label),
            linkType: linkTypes[column.key] || ''
        };
    })
};

        layouts[key] = reportLayout;

        return reportLayout;
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

    /*
     * PO On Order cell for Recommended Purchases. The quantity opens
     * the popup; the orders themselves load only when clicked.
     */
    function onOrderCell(row, column, value, reportLayout) {
        var lowerType = String(row.recordType || '').toLowerCase();

        var itemId =
            row.itemId ||
            (lowerType.indexOf('item') !== -1 ? row.internalId : '') ||
            '';

        var itemName = reportLayout.itemKey ? (row[reportLayout.itemKey] || '') : '';

        if (!itemId && !itemName) {
            return value;
        }

        var warehouse = reportLayout.warehouseKey
            ? (row[reportLayout.warehouseKey] || '')
            : '';

        return (
            '<a class="record-link on-order-link" href="#" role="button" ' +
            'data-item-id="' + esc(itemId) + '" ' +
            'data-item-name="' + esc(itemName) + '" ' +
            'data-warehouse="' + esc(warehouse) + '" ' +
            'data-qty="' + esc(row[column.key]) + '" ' +
            'title="Show purchase orders and transfer orders">' +
            value +
            '</a>'
        );
    }

    function cellHtml(row, column, reportLayout) {
        var value = displayValue(row[column.key], column.numeric);

        if (!column.linkType || !value) {
            return value;
        }

        if (column.linkType === 'poByItem') {
            return onOrderCell(row, column, value, reportLayout);
        }

        var href = linkUrl(row, column.linkType);

        if (!href) {
            return value;
        }

        return (
            '<a class="record-link" target="_blank" ' +
            'rel="noopener" href="' + esc(href) + '">' +
            value +
            '</a>'
        );
    }

    var ON_ORDER_COLS = 7;
    var PENDING_COLS = 5;

    function qtyHtml(value) {
        return displayValue(value, true) || '0';
    }

    function sortLines(lines) {
        lines.forEach(function (line) {
            var date = parseDate(line.expected);
            line._t = date ? date.getTime() : Infinity;
        });

        return lines.sort(function (a, b) {
            return (a._t - b._t) ||
                String(a.number).localeCompare(String(b.number), undefined, { numeric: true });
        });
    }

    function openOnOrder(link) {
        var itemId = link.getAttribute('data-item-id') || '';
        var itemName = link.getAttribute('data-item-name') || '';
        var warehouse = link.getAttribute('data-warehouse') || '';
        var cacheKey = itemId ? 'id:' + itemId : 'name:' + itemName.toLowerCase();
        var seq = ++detailSeq;

        detail = { data: null, warehouse: warehouse, trigger: link };

        byId('onOrderTitle').textContent = itemName || ('Item ' + itemId);
        byId('onOrderQty').innerHTML = qtyHtml(link.getAttribute('data-qty'));
        byId('onOrderScopeWrap').hidden = !warehouse;
        byId('onOrderScope').checked = Boolean(warehouse);
        byId('onOrderScopeLabel').textContent = warehouse ? 'Only ' + warehouse : '';
        byId('onOrderError').innerHTML = '';
        byId('onOrderTotal').innerHTML = '';
        byId('pendingTotal').innerHTML = '';
        byId('onOrderBody').innerHTML = emptyRow(ON_ORDER_COLS, 'Loading orders...');
        byId('pendingBody').innerHTML = emptyRow(PENDING_COLS, 'Loading orders...');

        byId('onOrderModal').hidden = false;
        document.body.classList.add('modal-open');
        byId('onOrderClose').focus();

        if (detailCache[cacheKey]) {
            detail.data = detailCache[cacheKey];
            renderOnOrder();
            return;
        }

        api('onOrderDetail', {
            itemId: itemId,
            itemName: itemId ? '' : itemName
        })
            .then(function (data) {
                detailCache[cacheKey] = {
                    multipleItems: Boolean(data.multipleItems),
                    onOrder: sortLines(data.onOrder || []),
                    pending: sortLines(data.pending || [])
                };

                if (seq !== detailSeq) {
                    return;
                }

                detail.data = detailCache[cacheKey];
                renderOnOrder();
            })
            .catch(function (e) {
                if (seq !== detailSeq) {
                    return;
                }

                byId('onOrderError').innerHTML =
                    '<div class="section-error">' + esc(e.message) + '</div>';

                byId('onOrderBody').innerHTML = emptyRow(ON_ORDER_COLS, 'Unable to load orders.');
                byId('pendingBody').innerHTML = emptyRow(PENDING_COLS, 'Unable to load orders.');
            });
    }

    function closeOnOrder() {
        var trigger = detail && detail.trigger;

        detailSeq++;
        detail = null;

        byId('onOrderModal').hidden = true;
        document.body.classList.remove('modal-open');

        if (trigger && document.body.contains(trigger)) {
            trigger.focus();
        }
    }

    function inScope(lines) {
        if (!detail.warehouse || !byId('onOrderScope').checked) {
            return lines;
        }

        var target = detail.warehouse.toLowerCase();

        return lines.filter(function (line) {
            return String(line.location || '').toLowerCase() === target;
        });
    }

    function orderCell(line) {
        var number = line.url
            ? '<a class="record-link" target="_blank" rel="noopener" href="' +
              esc(line.url) + '">' + esc(line.number) + '</a>'
            : esc(line.number);

        return (
            '<span class="type-badge type-' + esc(String(line.type).toLowerCase()) + '">' +
            esc(line.type) +
            '</span>' +
            number +
            (line.source ? '<div class="line-sub">' + esc(line.source) + '</div>' : '') +
            (detail.data.multipleItems && line.item
                ? '<div class="line-sub">Item ' + esc(line.item) + '</div>'
                : '')
        );
    }

    function sideTotal(label, lines, field) {
        var total = 0;

        lines.forEach(function (line) {
            total += Number(line[field]) || 0;
        });

        return (
            '<span class="side-count">' +
            esc(lines.length + (lines.length === 1 ? ' order' : ' orders')) +
            '</span>' +
            '<span class="side-sum">' + esc(label) +
            ' <strong>' + qtyHtml(Math.round(total * 10000) / 10000) + '</strong></span>'
        );
    }

    function emptyMessage(text, hiddenCount) {
        if (hiddenCount > 0) {
            return (
                text + ' at ' + detail.warehouse + '. ' +
                hiddenCount + ' more at other locations; clear "Only ' +
                detail.warehouse + '" to see them.'
            );
        }

        return text + '.';
    }

    function renderOnOrder() {
        if (!detail || !detail.data) {
            return;
        }

        var onOrder = inScope(detail.data.onOrder);
        var pending = inScope(detail.data.pending);

        byId('onOrderBody').innerHTML = onOrder.length
            ? onOrder.map(function (line) {
                return (
                    '<tr>' +
                    '<td>' + orderCell(line) + '</td>' +
                    '<td>' + esc(line.status) + '</td>' +
                    '<td>' + esc(line.location) + '</td>' +
                    '<td>' + esc(line.expected) + '</td>' +
                    '<td class="num">' + qtyHtml(line.ordered) + '</td>' +
                    '<td class="num">' + qtyHtml(line.received) + '</td>' +
                    '<td class="num">' + qtyHtml(line.remaining) + '</td>' +
                    '</tr>'
                );
            }).join('')
            : emptyRow(ON_ORDER_COLS, emptyMessage(
                'No approved purchase orders or transfer orders on order',
                detail.data.onOrder.length - onOrder.length
            ));

        byId('pendingBody').innerHTML = pending.length
            ? pending.map(function (line) {
                return (
                    '<tr>' +
                    '<td>' + orderCell(line) + '</td>' +
                    '<td>' + esc(line.status) + '</td>' +
                    '<td>' + esc(line.location) + '</td>' +
                    '<td>' + esc(line.expected) + '</td>' +
                    '<td class="num">' + qtyHtml(line.remaining) + '</td>' +
                    '</tr>'
                );
            }).join('')
            : emptyRow(PENDING_COLS, emptyMessage(
                'No purchase orders waiting for approval',
                detail.data.pending.length - pending.length
            ));

        byId('onOrderTotal').innerHTML = sideTotal('Remaining', onOrder, 'remaining');
        byId('pendingTotal').innerHTML = sideTotal('Quantity', pending, 'remaining');
    }

    /*
     * Builds the row's HTML, lowercase search text and date once
     * per layout. Later keystrokes and dropdown changes only
     * compare cached values and join cached HTML strings.
     */
    function prepareRow(row, reportLayout) {
        if (row._v === reportLayout.version) {
            return;
        }

        var columns = reportLayout.columns;
        var cells = [];
        var searchParts = [];
        var index;

        for (index = 0; index < columns.length; index++) {
            var column = columns[index];
            var raw = row[column.key];

            if (raw !== null && raw !== undefined) {
                searchParts.push(String(raw).toLowerCase());
            }

            cells.push(
                column.numeric ? '<td class="num">' : '<td>',
                cellHtml(row, column, reportLayout),
                '</td>'
            );
        }

        /*
         * A row can carry several dates in "<date column key>List",
         * for example every open sales order line's Ending Date for
         * the item. The date filter matches when any of them is in range.
         */
        var dateList = reportLayout.dateKey ? row[reportLayout.dateKey + 'List'] : null;
        var dateTimes = null;
        var dateValue = null;

        if (dateList && dateList.length) {
            dateTimes = [];

            for (index = 0; index < dateList.length; index++) {
                var listDate = parseDate(dateList[index]);

                if (listDate) {
                    dateTimes.push(listDate.getTime());
                }
            }

        } else if (reportLayout.dateKey) {
            dateValue = parseDate(row[reportLayout.dateKey]);
        }

        row._h = '<tr>' + cells.join('') + '</tr>';
        row._s = searchParts.join(SEARCH_SEPARATOR);
        row._ds = dateTimes;
        row._d = dateTimes
            ? (dateTimes.length ? dateTimes[0] : null)
            : (dateValue ? dateValue.getTime() : null);
        row._v = reportLayout.version;
    }

    /*
     * The text a dropdown option stores and each row is compared with.
     * Checkboxes come back as true/false or T/F, so both become T/F;
     * a false checkbox (or a numeric 0) must never turn blank.
     */
    function filterValue(value) {
        if (value === null || value === undefined) {
            return '';
        }

        var flag = yesNo(value);

        if (flag) {
            return flag === 'Yes' ? 'T' : 'F';
        }

        return String(value);
    }


    function anyDateInRange(times, fromTime, toTime) {
        for (var index = 0; index < times.length; index++) {
            if (
                (fromTime === null || times[index] >= fromTime) &&
                (toTime === null || times[index] <= toTime)
            ) {
                return true;
            }
        }

        return false;
    }

    function filterRows(section, key) {
        var filterState = state(key);
        var reportLayout = layout(key);
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

        var fromTime = filterState.dateFrom
            ? new Date(filterState.dateFrom).getTime()
            : null;

        var toTime = null;

        if (filterState.dateTo) {
            var toDate = new Date(filterState.dateTo);
            toDate.setHours(23, 59, 59, 999);
            toTime = toDate.getTime();
        }

        var useDates =
            Boolean(reportLayout.dateKey) &&
            (fromTime !== null || toTime !== null);

        var query = filterState.q
            ? filterState.q.toLowerCase()
            : '';

        if (!activeSlots.length && !useDates && !query) {
            return rows;
        }

        var slotCount = activeSlots.length;

        return rows.filter(function (row) {
            for (var index = 0; index < slotCount; index++) {
                               if (filterValue(row[activeSlots[index].key]) !== activeSlots[index].value) {

                    return false;
                }
            }

            if (useDates || query) {
                prepareRow(row, reportLayout);
            }

            if (useDates) {
                if (row._ds) {
                    if (!anyDateInRange(row._ds, fromTime, toTime)) {
                        return false;
                    }

                } else {
                    if (row._d === null) {
                        return false;
                    }

                    if (fromTime !== null && row._d < fromTime) {
                        return false;
                    }

                    if (toTime !== null && row._d > toTime) {
                        return false;
                    }
                }
            }

            if (query && row._s.indexOf(query) === -1) {
                return false;
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

                if (value === null || value === undefined || value === '') {
                    return;
                }

                               var uniqueKey = filterValue(value);


                if (!seen[uniqueKey]) {
                    seen[uniqueKey] = true;
                                       values.push(uniqueKey);

                }
            });

            values.sort(function (a, b) {
                return String(a).localeCompare(String(b), undefined, {
                    numeric: true,
                    sensitivity: 'base'
                });
            });

            var options = ['<option value="">All</option>'];

            values.forEach(function (value) {
                options.push(
                    '<option value="' + esc(value) + '">' +
                    esc(optionLabel(value)) +
                    '</option>'
                );
            });

            select.innerHTML = options.join('');

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

    function renderBody(key, reportLayout, rows, emptyText) {
        var body = byId('body_' + key);
        var columns = reportLayout.columns;

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

        var html = new Array(rows.length);

        for (var rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            prepareRow(rows[rowIndex], reportLayout);
            html[rowIndex] = rows[rowIndex]._h;
        }

        body.innerHTML = html.join('');
    }

    function updateCount(key, shown, total) {
        var bar = filterBar(key);
        var element = bar ? bar.querySelector('.row-count') : null;

        if (!element) {
            return;
        }

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
            reportLayout,
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

        ['.input-search', '.input-from', '.input-to'].forEach(function (selector) {
            var input = bar.querySelector(selector);

            if (input) {
                input.value = '';
            }
        });

        filterDefs(key).forEach(function (filterDefinition, slot) {
            var select = bar.querySelector('.input-' + slot);

            if (select) {
                select.value = '';
            }
        });
    }

    /*
     * params is optional. When passed (for example an item filter
     * from a PO On Order link) the overview total is left alone,
     * because the result is only part of the report.
     */
    function loadReport(key, force, params) {
        var report = definition(key);

        if (!report) {
            return;
        }

        if (cache[key] && !force && !params) {
            render(key);
            return;
        }

        var seq = (requestSeq[key] || 0) + 1;

        requestSeq[key] = seq;

        sectionError(key, '');

        byId('head_' + key).innerHTML = '<th>Loading</th>';

        byId('body_' + key).innerHTML = emptyRow(
            1,
            'Loading ' + report.label.toLowerCase() + '...'
        );

        var requestParams = { report: key };

        Object.keys(params || {}).forEach(function (name) {
            requestParams[name] = params[name];
        });

        api('reportData', requestParams)
            .then(function (data) {
                if (requestSeq[key] !== seq) {
                    return;
                }

                cache[key] = data;

                resetFilters(key);

                populateFilters(key, data.columns || [], data.rows || []);

                render(key);

                if (!params) {
                    var count = byId('count_' + key);

                    count.innerHTML = esc(
                        data.total !== undefined
                            ? data.total
                            : (data.rows || []).length
                    );

                    count.title = '';
                }
            })
            .catch(function (e) {
                if (requestSeq[key] !== seq) {
                    return;
                }

                sectionError(key, e.message);

                byId('head_' + key).innerHTML = '<th>Error</th>';

                byId('body_' + key).innerHTML = emptyRow(
                    1,
                    'Unable to load this report: ' + e.message
                );

                if (!params) {
                    var count = byId('count_' + key);

                    count.innerHTML = '–';
                    count.title = e.message;
                }
            });
    }

    function activate(key, skipLoad) {
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

        if (!skipLoad) {
            loadReport(key, false);
        }
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
                var bar = filterBar(key);



        filterDefs(key).forEach(function (filterDefinition, slot) {
            if (
                filterState.slots[slot] &&
                reportLayout.slotKeys[slot]
            ) {
                  // the option's own text, so a checkbox reads Yes/No rather than true/false
                var select = bar ? bar.querySelector('.input-' + slot) : null;

                var text = select && select.selectedIndex > 0
                    ? select.options[select.selectedIndex].text
                    : optionLabel(filterState.slots[slot]);

                parts.push(filterDefinition.label + ': ' + text);
            }
        });
        var dateFilter = REPORT_UI[key] && REPORT_UI[key].dateFilter;
        var dateLabel = dateFilter && dateFilter.label ? dateFilter.label + ' ' : '';

        if (filterState.dateFrom) {
            parts.push(dateLabel + 'From ' + filterState.dateFrom);
        }

        if (filterState.dateTo) {
            parts.push(dateLabel + 'To ' + filterState.dateTo);
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
            var target = event.target;

            if (!target || !target.closest) {
                return;
            }

            /*
             * Recommended Purchases: PO On Order quantity opens the popup.
             */
            var onOrderLink = target.closest('.on-order-link');

            if (onOrderLink) {
                event.preventDefault();
                openOnOrder(onOrderLink);
                return;
            }

            if (target.closest('[data-close-modal]')) {
                closeOnOrder();
                return;
            }

            // order links inside the popup open normally
            if (target.closest('#onOrderModal')) {
                return;
            }

            var tab = target.closest('.tab-button');

            if (tab) {
                activate(tab.getAttribute('data-tab'));
                return;
            }

            var card = target.closest('.overview-card');

            if (card) {
                activate(card.getAttribute('data-report'));
                return;
            }

            var bar = target.closest('.filter-bar');

            if (!bar) {
                if (target.closest('#refreshAll')) {
                    error('');

                    cache = {};
                    exportData = {};
                    layouts = {};
                    detailCache = Object.create(null);

                    loadCounts();
                    loadReport(activeKey, true);
                }

                return;
            }

            var key = bar.getAttribute('data-report');

            if (target.closest('.clear-button')) {
                resetFilters(key);
                render(key);
                return;
            }

            if (target.closest('.refresh-button')) {
                detailCache = Object.create(null);
                loadReport(key, true);
                return;
            }

            if (target.closest('.print-button')) {
                printReport(key);
                return;
            }

            if (target.closest('.export-button')) {
                exportCsv(key);
            }
        });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && !byId('onOrderModal').hidden) {
                closeOnOrder();
            }
        });

        byId('onOrderScope').addEventListener('change', renderOnOrder);

        REPORTS.forEach(function (report) {
            var bar = filterBar(report.key);

            if (!bar) {
                return;
            }

            var timer;

            bar.querySelector('.input-search').addEventListener('input', function (event) {
                var value = event.target.value.trim();

                clearTimeout(timer);

                timer = setTimeout(function () {
                    state(report.key).q = value;
                    render(report.key);
                }, 250);
            });

            filterDefs(report.key).forEach(function (filterDefinition, slot) {
                var select = bar.querySelector('.input-' + slot);

                if (!select) {
                    return;
                }

                select.addEventListener('change', function (event) {
                    state(report.key).slots[slot] = event.target.value;
                    render(report.key);
                });
            });

            bar.querySelector('.input-from').addEventListener('change', function (event) {
                state(report.key).dateFrom = event.target.value;
                render(report.key);
            });

            bar.querySelector('.input-to').addEventListener('change', function (event) {
                state(report.key).dateTo = event.target.value;
                render(report.key);
            });
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