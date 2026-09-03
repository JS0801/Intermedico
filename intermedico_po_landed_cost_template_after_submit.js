/**
 * Backfill Landed Cost Template on Purchase Orders created from Sales Orders.
 *
 * @NApiVersion 2.0
 * @NScriptType UserEventScript
 *
 * Deploy on Purchase Order, afterSubmit.
 */
define(['N/log', 'N/record', 'N/search'], function (log, record, search) {
    var CONFIG = {
        runOnlyOnCreate: true,
        runOnlyWhenCreatedFromSalesOrder: true,

        records: {
            landedCostMapping: 'customrecord_scm_lc_mapping',
            landedCostProfile: 'customrecord_scm_lc_profile'
        },

        bodyFields: {
            createdFrom: 'createdfrom',
            currency: 'currency',
            landedCostPerLine: 'landedcostperline'
        },

        lineFields: {
            sublist: 'item',
            item: 'item',
            landedCostTemplate: 'custcol_scm_costcat_profile',
            trackLandedCost: 'custcol_scm_track_landed_cost',
            autoCalculate: 'custcol_scm_lc_autocalc',
            parentItem: 'custcol_scm_item_parent'
        },

        mappingFieldCandidates: {
            item: [
                'custrecord_scm_lc_mapping_item'
            ],
            profile: [
                'custrecord_scm_lc_mapping_profile',
                'custrecord_scm_lc_profile',
                'custrecord_scm_lc_mapping_template',
                'custrecord_scm_lc_mapping_costcat_profile'
            ],
            preferred: [
                'custrecord_scm_lc_mapping_preferred',
                'custrecord_scm_lc_mapping_ispreferred',
                'custrecord_scm_lc_mapping_ispref'
            ],
            currency: [
                'custrecord_scm_lc_mapping_currency'
            ]
        },

        consignedLineFieldCandidates: [
            'custcol_scm_lc_consigned',
            'custcol_scm_consigned',
            'custcol_scm_is_consigned'
        ]
    };

    function afterSubmit(context) {
             log.debug('type', context.type)
        try {
            if (context.type !== 'specialorder') {
                return;
            }

            var poId = context.newRecord.id;
            var createdFrom = context.newRecord.getValue({ fieldId: CONFIG.bodyFields.createdFrom });

            if (CONFIG.runOnlyWhenCreatedFromSalesOrder && !isCreatedFromSalesOrder(createdFrom)) {
                return;
            }

            var poRecord = record.load({
                type: record.Type.PURCHASE_ORDER,
                id: poId,
                isDynamic: false
            });

            var landedCostPerLine = safeGetValue(poRecord, CONFIG.bodyFields.landedCostPerLine);
            if (landedCostPerLine === false || landedCostPerLine === 'F') {
                log.debug({
                    title: 'PO LC Template Backfill skipped',
                    details: 'PO ' + poId + ' has Landed Cost Per Line unchecked.'
                });
                return;
            }

            var mappingFields = resolveMappingFields();
            var result = backfillEmptyTemplates(poRecord, mappingFields);

            if (result.changedCount > 0) {
                var savedId = poRecord.save({
                    enableSourcing: false,
                    ignoreMandatoryFields: true
                });

                log.audit({
                    title: 'PO LC Template Backfill complete',
                    details: 'Updated ' + result.changedCount + ' line(s) on PO ' + savedId + '.'
                });
            } else {
                log.debug({
                    title: 'PO LC Template Backfill no changes',
                    details: 'No eligible blank landed cost template lines found on PO ' + poId + '.'
                });
            }
        } catch (e) {
            log.error({
                title: 'PO LC Template Backfill error',
                details: e
            });
        }
    }

    function backfillEmptyTemplates(poRecord, mappingFields) {
        var candidates = collectBlankTemplateLines(poRecord);
        if (candidates.length < 1) {
            return { changedCount: 0 };
        }

        var itemIds = uniqueValues(pluck(candidates, 'itemId'));
        var itemDetails = searchItemDetails(itemIds);
        var parentIds = [];
        var i;

        for (i = 0; i < candidates.length; i++) {
            if (!candidates[i].parentItemId && itemDetails[candidates[i].itemId]) {
                candidates[i].parentItemId = itemDetails[candidates[i].itemId].parentId || '';
            }

            if (candidates[i].parentItemId) {
                parentIds.push(candidates[i].parentItemId);
            }
        }

        mergeObjects(itemDetails, searchItemDetails(uniqueValues(parentIds)));

        var eligibleLines = [];
        var preferredLookupItems = {};

        for (i = 0; i < candidates.length; i++) {
            var line = candidates[i];
            var trackLandedCost = line.lineTrackLandedCost;

            if (trackLandedCost === null && itemDetails[line.itemId]) {
                trackLandedCost = itemDetails[line.itemId].trackLandedCost;
            }

            if (trackLandedCost !== true) {
                continue;
            }

            eligibleLines.push(line);
            preferredLookupItems[line.itemId] = true;
            if (line.parentItemId) {
                preferredLookupItems[line.parentItemId] = true;
            }
        }

        if (eligibleLines.length < 1) {
            return { changedCount: 0 };
        }

        var currency = safeGetValue(poRecord, CONFIG.bodyFields.currency);
        var preferredProfiles = searchPreferredProfiles({
            itemIds: objectKeys(preferredLookupItems),
            currency: currency,
            itemDetails: itemDetails,
            mappingFields: mappingFields
        });

        var changedCount = 0;
        var lineFields = CONFIG.lineFields;

        for (i = 0; i < eligibleLines.length; i++) {
            var eligibleLine = eligibleLines[i];
            var preferredProfile = getPreferredProfileForLine(eligibleLine, preferredProfiles, itemDetails);

            if (!preferredProfile) {
                continue;
            }

            poRecord.setSublistValue({
                sublistId: lineFields.sublist,
                fieldId: lineFields.landedCostTemplate,
                line: eligibleLine.lineIndex,
                value: preferredProfile
            });

            changedCount++;
        }

        return { changedCount: changedCount };
    }

    function collectBlankTemplateLines(poRecord) {
        var lineFields = CONFIG.lineFields;
        var lineCount = poRecord.getLineCount({ sublistId: lineFields.sublist }) || 0;
        var lines = [];
        var i;

        for (i = 0; i < lineCount; i++) {
            var existingTemplate = safeGetSublistValue(poRecord, lineFields.sublist, lineFields.landedCostTemplate, i);
            if (!isEmpty(existingTemplate)) {
                continue;
            }

            var itemId = safeGetSublistValue(poRecord, lineFields.sublist, lineFields.item, i);
            if (isEmpty(itemId)) {
                continue;
            }

            if (isLineConsigned(poRecord, i)) {
                continue;
            }

            lines.push({
                lineIndex: i,
                itemId: String(itemId),
                parentItemId: valueToString(safeGetSublistValue(poRecord, lineFields.sublist, lineFields.parentItem, i)),
                lineTrackLandedCost: normalizeBooleanOrNull(
                    safeGetSublistValue(poRecord, lineFields.sublist, lineFields.trackLandedCost, i)
                )
            });
        }

        return lines;
    }

    function searchPreferredProfiles(options) {
        var filters = [
            [options.mappingFields.item, search.Operator.ANYOF, options.itemIds],
            'AND',
            [options.mappingFields.preferred, search.Operator.IS, 'T'],
            'AND',
            ['isinactive', search.Operator.IS, 'F']
        ];

        if (!isEmpty(options.currency) && options.mappingFields.currency) {
            filters.push('AND');
            filters.push([options.mappingFields.currency, search.Operator.IS, options.currency]);
        }

        var resultByItem = {};
        var profileActiveCache = {};

        runPagedSearch(search.create({
            type: CONFIG.records.landedCostMapping,
            filters: filters,
            columns: [
                search.createColumn({ name: options.mappingFields.item }),
                search.createColumn({ name: options.mappingFields.profile })
            ]
        }), function (result) {
            var itemId = result.getValue({ name: options.mappingFields.item });
            var profileId = result.getValue({ name: options.mappingFields.profile });

            if (isEmpty(itemId) || isEmpty(profileId)) {
                return true;
            }

            if (!isProfileActive(profileId, profileActiveCache)) {
                return true;
            }

            resultByItem[String(itemId)] = {
                preferredProfile: String(profileId),
                trackLandedCost: options.itemDetails[String(itemId)] ?
                    options.itemDetails[String(itemId)].trackLandedCost :
                    false
            };

            return true;
        });

        return resultByItem;
    }

    function searchItemDetails(itemIds) {
        var details = {};
        var ids = uniqueValues(itemIds);

        if (ids.length < 1) {
            return details;
        }

        runPagedSearch(search.create({
            type: search.Type.ITEM,
            filters: [
                ['internalid', search.Operator.ANYOF, ids]
            ],
            columns: [
                search.createColumn({ name: 'internalid' }),
                search.createColumn({ name: 'tracklandedcost' }),
                search.createColumn({ name: 'parent' })
            ]
        }), function (result) {
            var itemId = result.getValue({ name: 'internalid' });

            details[String(itemId)] = {
                trackLandedCost: normalizeBooleanOrNull(result.getValue({ name: 'tracklandedcost' })) === true,
                parentId: valueToString(result.getValue({ name: 'parent' }))
            };

            return true;
        });

        return details;
    }

    function getPreferredProfileForLine(line, preferredProfiles, itemDetails) {
        if (preferredProfiles[line.itemId] && preferredProfiles[line.itemId].preferredProfile) {
            return preferredProfiles[line.itemId].preferredProfile;
        }

        if (!line.parentItemId || !preferredProfiles[line.parentItemId]) {
            return '';
        }

        var parentDetails = itemDetails[line.parentItemId] || {};
        if (parentDetails.trackLandedCost !== true) {
            return '';
        }

        return preferredProfiles[line.parentItemId].preferredProfile || '';
    }

    function isCreatedFromSalesOrder(createdFromId) {
        if (isEmpty(createdFromId)) {
            return false;
        }

        try {
            var source = search.lookupFields({
                type: search.Type.TRANSACTION,
                id: createdFromId,
                columns: ['recordtype', 'type']
            });

            var recordType = valueToString(source.recordtype).toLowerCase();
            var typeText = valueToText(source.type).toLowerCase();

            return recordType === 'salesorder' ||
                recordType === 'salesord' ||
                typeText === 'sales order' ||
                typeText === 'salesord';
        } catch (e) {
            log.error({
                title: 'Created From lookup failed',
                details: 'createdfrom=' + createdFromId + ' | ' + e.name + ': ' + e.message
            });
            return false;
        }
    }

    function isLineConsigned(poRecord, lineIndex) {
        var i;

        for (i = 0; i < CONFIG.consignedLineFieldCandidates.length; i++) {
            var read = tryGetSublistValue(
                poRecord,
                CONFIG.lineFields.sublist,
                CONFIG.consignedLineFieldCandidates[i],
                lineIndex
            );

            if (read.found && normalizeBooleanOrNull(read.value) === true) {
                return true;
            }
        }

        return false;
    }

    function isProfileActive(profileId, cache) {
        var key = String(profileId);

        if (cache.hasOwnProperty(key)) {
            return cache[key];
        }

        try {
            var profile = search.lookupFields({
                type: CONFIG.records.landedCostProfile,
                id: profileId,
                columns: ['isinactive']
            });

            cache[key] = normalizeBooleanOrNull(profile.isinactive) !== true;
        } catch (e) {
            log.error({
                title: 'Landed cost profile lookup failed',
                details: 'profile=' + profileId + ' | ' + e.name + ': ' + e.message
            });
            cache[key] = false;
        }

        return cache[key];
    }

    function resolveMappingFields() {
        return {
            item: firstValidSearchColumn(CONFIG.records.landedCostMapping, CONFIG.mappingFieldCandidates.item, true),
            profile: firstValidSearchColumn(CONFIG.records.landedCostMapping, CONFIG.mappingFieldCandidates.profile, true),
            preferred: firstValidSearchColumn(CONFIG.records.landedCostMapping, CONFIG.mappingFieldCandidates.preferred, true),
            currency: firstValidSearchColumn(CONFIG.records.landedCostMapping, CONFIG.mappingFieldCandidates.currency, false)
        };
    }

    function firstValidSearchColumn(recordType, candidates, required) {
        var i;

        for (i = 0; i < candidates.length; i++) {
            try {
                search.create({
                    type: recordType,
                    filters: [],
                    columns: [search.createColumn({ name: candidates[i] })]
                }).run().getRange({ start: 0, end: 1 });

                return candidates[i];
            } catch (e) {
                log.debug({
                    title: 'Mapping field candidate rejected',
                    details: candidates[i] + ' | ' + e.name + ': ' + e.message
                });
            }
        }

        if (required) {
            throw new Error('Unable to resolve required field on ' + recordType + ': ' + candidates.join(', '));
        }

        return '';
    }

    function runPagedSearch(searchObj, callback) {
        var pagedData = searchObj.runPaged({ pageSize: 1000 });
        var i;

        for (i = 0; i < pagedData.pageRanges.length; i++) {
            var page = pagedData.fetch({ index: pagedData.pageRanges[i].index });
            var j;

            for (j = 0; j < page.data.length; j++) {
                if (callback(page.data[j]) === false) {
                    return;
                }
            }
        }
    }

    function safeGetValue(rec, fieldId) {
        try {
            return rec.getValue({ fieldId: fieldId });
        } catch (e) {
            return '';
        }
    }

    function safeGetSublistValue(rec, sublistId, fieldId, line) {
        return tryGetSublistValue(rec, sublistId, fieldId, line).value;
    }

    function tryGetSublistValue(rec, sublistId, fieldId, line) {
        try {
            return {
                found: true,
                value: rec.getSublistValue({
                    sublistId: sublistId,
                    fieldId: fieldId,
                    line: line
                })
            };
        } catch (e) {
            return {
                found: false,
                value: ''
            };
        }
    }

    function normalizeBooleanOrNull(value) {
        if (value === true || value === 'T' || value === 'true') {
            return true;
        }

        if (value === false || value === 'F' || value === 'false') {
            return false;
        }

        return null;
    }

    function valueToString(value) {
        if (isEmpty(value)) {
            return '';
        }

        if (Object.prototype.toString.call(value) === '[object Array]') {
            if (value.length < 1) {
                return '';
            }

            return valueToString(value[0]);
        }

        if (typeof value === 'object' && value.value !== undefined) {
            return String(value.value);
        }

        return String(value);
    }

    function valueToText(value) {
        if (isEmpty(value)) {
            return '';
        }

        if (Object.prototype.toString.call(value) === '[object Array]') {
            if (value.length < 1) {
                return '';
            }

            return valueToText(value[0]);
        }

        if (typeof value === 'object') {
            if (value.text !== undefined) {
                return String(value.text);
            }

            if (value.value !== undefined) {
                return String(value.value);
            }
        }

        return String(value);
    }

    function pluck(items, propertyName) {
        var values = [];
        var i;

        for (i = 0; i < items.length; i++) {
            values.push(items[i][propertyName]);
        }

        return values;
    }

    function uniqueValues(values) {
        var map = {};
        var unique = [];
        var i;

        for (i = 0; values && i < values.length; i++) {
            if (isEmpty(values[i])) {
                continue;
            }

            var key = String(values[i]);
            if (!map[key]) {
                map[key] = true;
                unique.push(key);
            }
        }

        return unique;
    }

    function objectKeys(obj) {
        var keys = [];
        var key;

        for (key in obj) {
            if (obj.hasOwnProperty(key)) {
                keys.push(key);
            }
        }

        return keys;
    }

    function mergeObjects(target, source) {
        var key;

        for (key in source) {
            if (source.hasOwnProperty(key)) {
                target[key] = source[key];
            }
        }
    }

    function isEmpty(value) {
        return value === null ||
            value === undefined ||
            value === '' ||
            (Object.prototype.toString.call(value) === '[object Array]' && value.length < 1);
    }

    return {
        afterSubmit: afterSubmit
    };
});
