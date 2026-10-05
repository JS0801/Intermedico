/**
 * Copyright (c) 2026, Oracle and/or its affiliates. All rights reserved.
 *
 * This software is the confidential and proprietary information of
 * NetSuite, Inc. ('Confidential Information'). You shall not
 * disclose such Confidential Information and shall use it only in
 * accordance with the terms of the license agreement you entered into
 * with NetSuite.
 *
 * - Validates the Price Rule Management page.
 *
 * Version          Date                      Author                                Remarks
 * 1.0            Jan 14 2026            zephaniah.donato                          Initial design.
 * 1.1            Jun 10 2026            Manuel Teodoro                            Prevent user changes to line items when status is Approved/Voided.
 * 1.2            Jun 10 2026            Manuel Teodoro                            Removing Customer in the Customer List - Block native Customer List remove link.
 * 1.3            Aug 06 2026            Manuel Teodoro                            Source Address from Account # when the Account # field changes.
 * 1.4            Aug 06 2026            Manuel Teodoro                            Scroll to duplicate price warnings when they are present.
 * 1.5            Aug 06 2026            Manuel Teodoro                            Support checkbox boolean values when detecting duplicate price warnings.
 * 1.6            Aug 06 2026            Manuel Teodoro                            Display duplicate price warnings in a popup error dialog.
 * 1.7            Aug 14 2026            Manuel Teodoro                            Source Minimum Order Value from the header for newly added item lines.
 * 1.8            Aug 15 2026            Manuel Teodoro                            Source anticipated volume for the selected item and associated Price Rule customers.
 * 1.9            Aug 19 2026            Manuel Teodoro                            Format duplicate Price Rule list-price warnings as separate lines in the popup.
 * 2.0            Aug 25 2026            Manuel Teodoro                            Reduce edit-mode initialization for large Price Rule Management records.
 * 2.1            Aug 25 2026            Manuel Teodoro                            Use direct item-line reads during save-time margin recalculation.
 *
 */

/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope Public
 */
define(['N/currentRecord', 'N/ui/dialog', 'N/search', 'N/record', '../library/NSTS_MD_CommonLibrary'],

    function (currentRecord, dialog, search, record, commonLibrary) {
        let strLogTitle;

        let arrAllLineItems = [];
        let objOriginalLineValuesByIndex = {};
        let objOriginalLineValuesByKey = {};
        let intOriginalLineCount = 0;

        const idSublist = 'recmachcustrecord_nts_pr_item_create_parent';
        const idCustomerSublist = 'recmachcustrecord_nts_pr_customer_create_prm';

        let objScriptParameters = {
            customPriceType: 'custscript_ns_cs_prmv_custom_price_type',
            anticipatedVolumeSearch: 'custscript_ns_cs_prmv_pr_ant_vol_search'
        };

        // Prevent user changes to line items when status is Approved/Voided - existing company preference status parameters.
        let objLockedLineStatusParameters = {
            approvedStatus: 'custscript_prdb_sl_status_approved',
            voidedStatus: 'custscript_prdb_sl_status_voided'
        };

        const objBodyFieldIds = {
            accountNumber: 'custrecord_nts_pr_acctnumber',
            address: 'custrecord_nts_pr_address',
            freightChargeAmount: 'custrecord_nts_pr_create_freight_amount',
            handlingChargeAmount: 'custrecord_nts_pr_create_handling_amount',
            dangerousGoodsChargeAmount: 'custrecord_nts_pr_create_dnggoods_amt',
            dryIceChargeAmount: 'custrecord_nts_pr_create_dry_ice_amt',
            minimumOrderChargeAmount: 'custrecord_nts_pr_create_minord_amt',
            minimumOrderValue: 'custrecord_nts_pr_minimum_order_value',
        };

        const objBodyFieldBooleans = {
            freight: 'custrecord_nts_pr_create_freight',
            handling: 'custrecord_nts_pr_create_handling',
            dangerousGoods: 'custrecord_nts_pr_create_dangerous_goods',
            dryIce: 'custrecord_nts_pr_create_dry_ice',
            minimumOrderCharge: 'custrecord_nts_pr_create_minord_charge',
        };

        const objLineFieldIds = {
            // Booleans
            freight: 'custrecord_nts_pr_item_iscustom_freight',
            handling: 'custrecord_nts_pr_item_iscustom_handling',
            dangerousGoods: 'custrecord_nts_pr_item_iscustom_dangoods',
            dryIce: 'custrecord_nts_pr_item_iscustom_dryice',
            minimumOrderCharge: 'custrecord_nts_pr_item_iscustom_minorder',

            // Amounts
            freightChargeAmount: 'custrecord_nts_pr_item_freight',
            handlingChargeAmount: 'custrecord_nts_pr_item_handling',
            dangerousGoodsChargeAmount: 'custrecord_nts_pr_item_dangerousgoods',
            dryIceChargeAmount: 'custrecord_nts_pr_item_dryice',
            minimumOrderChargeAmount: 'custrecord_nts_pr_item_minordercharge',
            minimumOrderValue: 'custrecord_nts_pr_item_minordervalue',

            // Volume QTY
            volume: 'custrecord_nts_pr_item_anticipatedvolume',
            volumePrev: 'custrecord_nts_pr_item_volume_2yrs'
        };

        // Prevent user changes to line items when status is Approved/Voided - tracked fields for edit-mode comparison.
        const objLockedLineFieldIds = {
            print: 'custrecord_nts_pr_item_print',
            item: 'custrecord_nts_pr_item_id',
            itemName: 'custrecord_nts_pr_item_name',
            startDate: 'custrecord_nts_pr_ic_start_date',
            endDate: 'custrecord_nts_pr_ic_end_date',
            listPrice: 'custrecord_nts_pr_item_listprice',
            previousDiscountedPrice: 'custrecord_nts_pr_item_prev_dscntedprice',
            discountedPrice: 'custrecord_nts_pr_item_discountedprice',
            priceChange: 'custrecord_nts_pr_item_pricechange',
            averageCost: 'custrecord_nts_pr_item_avg_cost',
            previousVolume: 'custrecord_nts_pr_item_volume_2yrs',
            anticipatedVolume: 'custrecord_nts_pr_item_anticipatedvolume',
            annualValue: 'custrecord_nts_pr_item_annualvalue',
            projectedAnnualValue: 'custrecord_nts_pr_item_projected_value',
            marginAmount: 'custrecord_nts_pr_item_amount',
            marginPercent: 'custrecord_nts_pr_item_margin_pct',
            status: 'custrecord_nts_pr_item_status',
            department: 'custrecord_nts_pr_item_department',
            class: 'custrecord_nts_pr_item_class',
            mdRequired: 'custrecord_nts_pr_item_md_required',
            mdLicenseNumber: 'custrecord_nts_pr_item_md_license_number',
            cnsc: 'custrecord_nts_pr_item_iscnsc',
            isCustomFreight: 'custrecord_nts_pr_item_iscustom_freight',
            freight: 'custrecord_nts_pr_item_freight',
            isCustomHandling: 'custrecord_nts_pr_item_iscustom_handling',
            handling: 'custrecord_nts_pr_item_handling',
            isCustomDangerousGoods: 'custrecord_nts_pr_item_iscustom_dangoods',
            dangerousGoods: 'custrecord_nts_pr_item_dangerousgoods',
            isCustomDryIce: 'custrecord_nts_pr_item_iscustom_dryice',
            dryIce: 'custrecord_nts_pr_item_dryice',
            minimumOrderValue: 'custrecord_nts_pr_item_minordervalue',
            isCustomMinimumOrder: 'custrecord_nts_pr_item_iscustom_minorder',
            minimumOrderCharge: 'custrecord_nts_pr_item_minordercharge',
            scriptError: 'custrecord_nts_pr_error',
            adjustmentAmount: 'custrecord_nts_pr_ic_adjust_amt',
            parent: 'custrecord_nts_pr_item_create_parent'
        };

        const strLockedLineMessage = 'This line is Approved/Voided and cannot be modified.';
        const strCustomerRemoveLinkMessage = 'You are not allowed to remove customers using the line Remove link. Please use the Remove Customer button.';

        const objFieldLabels = {
            freightChargeAmount: 'Freight Charge Amount',
            handlingChargeAmount: 'Handling Charge Amount',
            dangerousGoodsChargeAmount: 'Dangerous Goods Charge Amount',
            dryIceChargeAmount: 'Dry Ice Charge Amount',
            minimumOrderChargeAmount: 'Minimum Order Charge Amount',
            flLineCost: "Avg Item Cost",
            minimumOrderValue: "Minimum Order Value",
        };

        /**
         * Function to be executed after page is initialized.
         *
         * @param {Object} scriptContext
         * @param {Record} scriptContext.currentRecord - Current form record
         * @param {string} scriptContext.mode - The mode in which the record is being accessed (create, copy, or edit)
         *
         * @since 2015.2
         */
        function pageInit(scriptContext) {
            try {
                strLogTitle = 'pageInit';
                let recCurrentRecord = currentRecord.get();
                objScriptParameters = commonLibrary.getParameters(objScriptParameters);
                objLockedLineStatusParameters = commonLibrary.getParameters(objLockedLineStatusParameters, true);
                // CHANGE 2.0: Initialize the edit-mode cache without reading every line.
                // Individual line snapshots are captured only when a user opens that line.
                cacheOriginalLineValues(scriptContext, recCurrentRecord);
                disableBodyAmountFieldsOnStartup();
                getAllLineItems(recCurrentRecord);
                displayDuplicatePriceWarning(recCurrentRecord);
            } catch (e) {
                log.error(
                    `Error at [${strLogTitle}] function for ${strLogTitle}`,
                    `Message:<\/br>${e.message}<\/br><\/br>Stack:<\/br>${e.stack}`
                );
            }
        }

        /**
         * CHANGE 2.0: Capture the original values only for the line currently opened by
         * the user. This preserves Approved/Voided line protection without blocking the
         * browser while preloading every field on a large Price Rule.
         */
        function lineInit(scriptContext) {
            try {
                if (scriptContext.sublistId !== idSublist || scriptContext.mode !== 'edit') return;

                cacheOriginalCurrentLineValues(currentRecord.get());
            } catch (e) {
                log.error(
                    'Error at [lineInit] function',
                    `Message:<\/br>${e.message}<\/br><\/br>Stack:<\/br>${e.stack}`
                );
            }
        }

        function displayDuplicatePriceWarning(recCurrentRecord) {
            const idWarningMessage = 'custpage_duplicate_list_price_warning_message';
            let stWarningMessage;

            try {
                stWarningMessage = recCurrentRecord.getValue({ fieldId: idWarningMessage });
            } catch (e) {
                return;
            }
            if (!stWarningMessage) return;

            // The User Event supplies one newline-delimited entry per affected line.
            // Escape the sourced item text before adding presentation-only line breaks to the dialog.
            const stFormattedWarningMessage = String(stWarningMessage)
                .split(/\r?\n/)
                .filter(function (stLine) { return stLine; })
                .map(function (stLine) {
                    return '&bull; ' + stLine
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;')
                        .replace(/'/g, '&#39;');
                })
                .join('<br/>');

            dialog.alert({
                title: 'Calculated Discounted Price Exceeds List Price',
                message: stFormattedWarningMessage
            });
        }

        /**
         * Function to be executed when field is changed.
         *
         * @param {Object} scriptContext
         * @param {Record} scriptContext.currentRecord - Current form record
         * @param {string} scriptContext.sublistId - Sublist name
         * @param {string} scriptContext.fieldId - Field name
         * @param {number} scriptContext.lineNum - Line number. Will be undefined if not a sublist or matrix field
         * @param {number} scriptContext.columnNum - Line number. Will be undefined if not a matrix field
         *
         * @since 2015.2
         */
        function fieldChanged(scriptContext) {
            try {
                strLogTitle = 'fieldChanged';
                log.debug("fieldChanged",{
                    sublistId: scriptContext.sublistId,
                    fieldId: scriptContext.fieldId,
                    lineNum: scriptContext.lineNum,
                });
                if (scriptContext.fieldId === objBodyFieldIds.accountNumber) {
                    sourceAddressFromAccount(currentRecord.get());
                }
                startValidationFieldChanged(scriptContext);
                calculateRates(scriptContext);
            } catch (e) {
                log.error(
                    `Error at [${strLogTitle}] function for ${strLogTitle}`,
                    `Message:<\/br>${e.message}<\/br><\/br>Stack:<\/br>${e.stack}`
                );
            }
        }

        function sourceAddressFromAccount(recCurrentRecord) {

            const idAccount = recCurrentRecord.getValue({
                fieldId: objBodyFieldIds.accountNumber
            });
            let stAddress = '';

            if (idAccount) {
                const recAccount = record.load({
                        type: record.Type.CUSTOMER,
                        id: idAccount,
                });
                stAddress = recAccount.getValue({
                    fieldId: 'defaultaddress'
                }) || '';
            }

            // Address is now maintained explicitly so changing Account # replaces it with that account's default address.
            recCurrentRecord.setValue({
                fieldId: objBodyFieldIds.address,
                value: stAddress,
                ignoreFieldChange: true
            });
        }

        /**
         * Function to be executed when field is slaved.
         *
         * @param {Object} scriptContext
         * @param {Record} scriptContext.currentRecord - Current form record
         * @param {string} scriptContext.sublistId - Sublist name
         * @param {string} scriptContext.fieldId - Field name
         *
         * @since 2015.2
         */
        function postSourcing(scriptContext) {
            try {
                strLogTitle = 'postSourcing';
                log.debug("postsourcing",{
                    sublistId: scriptContext.sublistId,
                    fieldId: scriptContext.fieldId,
                    lineNum: scriptContext.lineNum,
                });
                startValidationPostSourcing(scriptContext);
                calculateRates(scriptContext);
            } catch (e) {
                log.error(
                    `Error at [${strLogTitle}] function for ${strLogTitle}`,
                    `Message:<\/br>${e.message}<\/br><\/br>Stack:<\/br>${e.stack}`
                );
            }
        }

        /**
         * Validation function to be executed when sublist line is committed.
         *
         * @param {Object} scriptContext
         * @param {Record} scriptContext.currentRecord - Current form record
         * @param {string} scriptContext.sublistId - Sublist name
         *
         * @returns {boolean} Return true if sublist line is valid
         *
         * @since 2015.2
         */
        function validateLine(scriptContext) {
            try {
                strLogTitle = 'validateLine';
                log.debug("validateLine",{
                    sublistId: scriptContext.sublistId,
                });
                let recCurrentRecord = currentRecord.get();
                // checkIfItemIsDuplicated(recCurrentRecord);
                // Prevent user changes to line items when status is Approved/Voided - block changed locked lines on commit.
                if (scriptContext.sublistId === idSublist && lockedLineHasChanged(recCurrentRecord)) {
                    dialog.alert({
                        title: 'Alert',
                        message: strLockedLineMessage
                    });
                    return false;
                }
                return validateMDLicense(recCurrentRecord);
            } catch (e) {
                log.error(
                    `Error at [${strLogTitle}] function for ${strLogTitle}`,
                    `Message:<\/br>${e.message}<\/br><\/br>Stack:<\/br>${e.stack}`
                );
            }
        }

        /**
         * Validation function to be executed when sublist line is deleted.
         *
         * @param {Object} scriptContext
         * @param {Record} scriptContext.currentRecord - Current form record
         * @param {string} scriptContext.sublistId - Sublist name
         *
         * @returns {boolean} Return true if sublist line can be deleted
         *
         * @since 2015.2
         */
        function validateDelete(scriptContext) {
            try {
                strLogTitle = 'validateDelete';
                // Removing Customer in the Customer List - block users from using the native Customer List Remove link.
                if (scriptContext.sublistId === idCustomerSublist) {
                    dialog.alert({
                        title: 'Alert',
                        message: strCustomerRemoveLinkMessage
                    });
                    return false;
                }

                if (scriptContext.sublistId !== idSublist) return true;

                let recCurrentRecord = currentRecord.get();
                // Prevent user changes to line items when status is Approved/Voided - block deleted locked lines.
                if (currentLineIsLocked(recCurrentRecord)) {
                    dialog.alert({
                        title: 'Alert',
                        message: strLockedLineMessage
                    });
                    return false;
                }
                return true;
            } catch (e) {
                log.error(
                    `Error at [${strLogTitle}] function for ${strLogTitle}`,
                    `Message:<\/br>${e.message}<\/br><\/br>Stack:<\/br>${e.stack}`
                );
            }
        }

        /**
         * Validation function to be executed when record is saved.
         *
         * @param {Object} scriptContext
         * @param {Record} scriptContext.currentRecord - Current form record
         * @returns {boolean} Return true if record is valid
         *
         * @since 2015.2
         */
        function saveRecord(scriptContext) {
            try {
                strLogTitle = 'saveRecord';
                let recCurrentRecord = currentRecord.get();
                // CHANGE 2.1: The library supports direct reads; avoid selecting and rendering every item line on save.
                commonLibrary.updateBodyFieldMargins(recCurrentRecord, false, idSublist);
                const bCustomerLineIsValid = commonLibrary.validateCustomerSublist(recCurrentRecord);
                const arrInvalidCNSCCustomers = commonLibrary.validateCNSC(recCurrentRecord);
                if (!bCustomerLineIsValid) {
                    dialog.alert({
                        title: 'Alert',
                        message: commonLibrary.strCustomerLineInvalidMessage
                    });
                    return false;
                }
                if (arrInvalidCNSCCustomers.length > 0) {
                    // dialog.confirm({
                    //     title: 'CNSC Missing',
                    //     message: commonLibrary.strCNSCInvalidMessage + arrInvalidCNSCCustomers.join('<br>')
                    // }).then(
                    //     () => {return true}
                    // ).catch(
                    //     () => {return false});
                    // TODO: Jan-28: Update after demo. Make the CNSC alert only, not hard stop.
                    return window.confirm(
                        `${commonLibrary.strCNSCInvalidMessage}\n\n${arrInvalidCNSCCustomers.join('\n')}`
                    );
                }
                else {
                    return true;
                }
            } catch (e) {
                log.error(
                    `Error at [${strLogTitle}] function for ${strLogTitle}`,
                    `Message:<\/br>${e.message}<\/br><\/br>Stack:<\/br>${e.stack}`
                );
            }
        }

        function getAllLineItems(recCurrentRecord) {
            strLogTitle = 'getAllLineItems';
            const intLineCount = recCurrentRecord.getLineCount({
                sublistId: idSublist,
            });
            // CHANGE 2.0: Retain duplicate-item validation without selecting and
            // rendering every line during page initialization.
            arrAllLineItems = [];
            for (let i = 0; i < intLineCount; i++) {
                const idItem = recCurrentRecord.getSublistValue({
                    sublistId: idSublist,
                    fieldId: 'custrecord_nts_pr_item_id',
                    line: i
                });
                arrAllLineItems.push(idItem);
            }
            log.debug('getAllLineItems',arrAllLineItems);
        }

        function checkIfItemIsDuplicated(recCurrentRecord) {
            strLogTitle = 'checkIfItemIsDuplicated';
            const idItem = recCurrentRecord.getCurrentSublistValue({
                sublistId: idSublist,
                fieldId: 'custrecord_nts_pr_item_id',
            });
            log.debug("checkIfItemIsDuplicated.getAllLineItems", {
                idItem,
                arrAllLineItems,
                bIsExisting: arrAllLineItems.indexOf(idItem) === -1,
            });
            if (arrAllLineItems.indexOf(idItem) === -1) {
                arrAllLineItems.push(idItem);
            }
            else {
                const strItem = recCurrentRecord.getCurrentSublistText({
                    sublistId: idSublist,
                    fieldId: 'custrecord_nts_pr_item_id',
                });
                dialog.alert({
                    title: 'Alert',
                    message: `The item [${strItem}] already exists in the list.`,
                });
            }
        }

        function validateMDLicense(recCurrentRecord) {
            let bReturnVal = true;
            let objLineFieldIdsForMDLicense = {
                bMDLicenseRequired: 'custrecord_nts_pr_item_md_required',
                strMDLicenseNo: 'custrecord_nts_pr_item_md_license_number'
            }
            const objLineFieldValues = commonLibrary.getLineFieldValues(recCurrentRecord, true, false, objLineFieldIdsForMDLicense, idSublist);
            log.debug("validateMDLicense.objLineFieldValues",objLineFieldValues);
            if (objLineFieldValues.bMDLicenseRequired && !objLineFieldValues.strMDLicenseNo) {
                dialog.alert({
                    title: 'Alert',
                    message: "MD License # is required for this Item."
                });
                bReturnVal = false;
            }
            return bReturnVal;
        }

        function cacheOriginalLineValues(scriptContext, recCurrentRecord) {
            objOriginalLineValuesByIndex = {};
            objOriginalLineValuesByKey = {};
            intOriginalLineCount = 0;

            if (!scriptContext || scriptContext.mode !== 'edit') return;

            const intLineCount = recCurrentRecord.getLineCount({
                sublistId: idSublist,
            });
            intOriginalLineCount = intLineCount;
            cacheOriginalCurrentLineValues(recCurrentRecord);
        }

        function cacheOriginalCurrentLineValues(recCurrentRecord) {
            const intCurrentLine = getCurrentLineIndex(recCurrentRecord);
            if (intCurrentLine === null || intCurrentLine >= intOriginalLineCount) return;

            const stLineKey = getCurrentLineIdentifier(recCurrentRecord);
            if ((stLineKey && objOriginalLineValuesByKey[stLineKey])
                || Object.prototype.hasOwnProperty.call(objOriginalLineValuesByIndex, intCurrentLine)) {
                return;
            }

            const objLineCache = {
                values: getCurrentSublistLineValues(recCurrentRecord),
                statusText: safeGetCurrentSublistText(recCurrentRecord, objLockedLineFieldIds.status)
            };
            objOriginalLineValuesByIndex[intCurrentLine] = objLineCache;
            if (stLineKey) objOriginalLineValuesByKey[stLineKey] = objLineCache;
        }

        function lockedLineHasChanged(recCurrentRecord) {
            const objOriginalLine = getOriginalCurrentLine(recCurrentRecord);
            const objCurrentLineValues = getCurrentSublistLineValues(recCurrentRecord);
            const stCurrentStatusText = safeGetCurrentSublistText(recCurrentRecord, objLockedLineFieldIds.status);
            const bLineIsLocked = isLockedLineStatus(objCurrentLineValues.status, stCurrentStatusText)
                || (objOriginalLine && isLockedLineStatus(objOriginalLine.values.status, objOriginalLine.statusText));

            if (!bLineIsLocked) return false;
            if (!objOriginalLine) return true;

            return lineValuesHaveChanged(objOriginalLine.values, objCurrentLineValues);
        }

        function currentLineIsLocked(recCurrentRecord) {
            const objOriginalLine = getOriginalCurrentLine(recCurrentRecord);
            const stCurrentStatus = safeGetCurrentSublistValue(recCurrentRecord, objLockedLineFieldIds.status);
            const stCurrentStatusText = safeGetCurrentSublistText(recCurrentRecord, objLockedLineFieldIds.status);

            return isLockedLineStatus(stCurrentStatus, stCurrentStatusText)
                || (objOriginalLine && isLockedLineStatus(objOriginalLine.values.status, objOriginalLine.statusText));
        }

        function getOriginalCurrentLine(recCurrentRecord) {
            const stLineKey = getCurrentLineIdentifier(recCurrentRecord);
            if (stLineKey && objOriginalLineValuesByKey[stLineKey]) return objOriginalLineValuesByKey[stLineKey];

            // Prevent user changes to line items when status is Approved/Voided - allow inserted lines whose indexes shifted.
            if (!stLineKey && lineCountHasIncreased(recCurrentRecord)) return null;

            const intCurrentLine = getCurrentLineIndex(recCurrentRecord);
            if (intCurrentLine !== null
                && Object.prototype.hasOwnProperty.call(objOriginalLineValuesByIndex, intCurrentLine)) {
                return objOriginalLineValuesByIndex[intCurrentLine];
            }

            return null;
        }

        function lineValuesHaveChanged(objOriginalValues, objCurrentValues) {
            for (let stFieldKey in objLockedLineFieldIds) {
                if (normalizeLineValue(objOriginalValues[stFieldKey]) !== normalizeLineValue(objCurrentValues[stFieldKey])) {
                    return true;
                }
            }
            return false;
        }

        function getCurrentSublistLineValues(recCurrentRecord) {
            let objValues = {};
            for (let stFieldKey in objLockedLineFieldIds) {
                objValues[stFieldKey] = safeGetCurrentSublistValue(recCurrentRecord, objLockedLineFieldIds[stFieldKey]);
            }
            return objValues;
        }

        function isLockedLineStatus(stStatusValue, stStatusText) {
            const stNormalizedStatusValue = normalizeLineValue(stStatusValue);
            const arrLockedStatusValues = [
                objLockedLineStatusParameters.approvedStatus,
                objLockedLineStatusParameters.voidedStatus
            ];

            for (let i = 0; i < arrLockedStatusValues.length; i++) {
                if (arrLockedStatusValues[i] && stNormalizedStatusValue === normalizeLineValue(arrLockedStatusValues[i])) {
                    return true;
                }
            }

            const stNormalizedStatusText = (stStatusText || '').toString().trim().toLowerCase();
            return stNormalizedStatusText === 'approved' || stNormalizedStatusText === 'voided';
        }

        function getCurrentLineIdentifier(recCurrentRecord) {
            const arrLineKeyFields = ['id', 'internalid', 'lineuniquekey'];
            for (let i = 0; i < arrLineKeyFields.length; i++) {
                const stLineKey = safeGetCurrentSublistValue(recCurrentRecord, arrLineKeyFields[i]);
                if (stLineKey) return normalizeLineValue(stLineKey);
            }
            return '';
        }

        function lineCountHasIncreased(recCurrentRecord) {
            try {
                return recCurrentRecord.getLineCount({
                    sublistId: idSublist
                }) > intOriginalLineCount;
            } catch (e) {
                return false;
            }
        }

        function getCurrentLineIndex(recCurrentRecord) {
            try {
                if (typeof recCurrentRecord.getCurrentSublistIndex !== 'function') return null;
                const intLine = recCurrentRecord.getCurrentSublistIndex({
                    sublistId: idSublist
                });
                return intLine >= 0 ? intLine : null;
            } catch (e) {
                return null;
            }
        }

        function safeGetCurrentSublistValue(recCurrentRecord, stFieldId) {
            try {
                return recCurrentRecord.getCurrentSublistValue({
                    sublistId: idSublist,
                    fieldId: stFieldId
                });
            } catch (e) {
                return '';
            }
        }

        function safeGetCurrentSublistText(recCurrentRecord, stFieldId) {
            try {
                return recCurrentRecord.getCurrentSublistText({
                    sublistId: idSublist,
                    fieldId: stFieldId
                });
            } catch (e) {
                return '';
            }
        }

        function normalizeLineValue(value) {
            if (value === null || value === undefined) return '';
            if (value instanceof Date) return value.getTime().toString();
            if (Array.isArray(value)) return value.map(normalizeLineValue).join('|');
            return value.toString();
        }

        function checkFieldsIfMandatory(recCurrentRecord, objIsMandatoryField) {
            strLogTitle = 'checkFieldsIfMandatory';
            let objFields = {};
            // let objIsMandatoryField = getBodyFieldValues(recCurrentRecord, true, objBodyFieldBooleans);
            log.debug("checkFieldsIfMandatory",objIsMandatoryField)
            // for (let strKey in objIsMandatoryField) {
            //     objIsMandatoryField[strKey] = objIsMandatoryField[strKey] === objScriptParameters.customPriceType;
            // }
            if (objIsMandatoryField.freight === objScriptParameters.customPriceType) {
                objFields["freightChargeAmount"] = objBodyFieldIds.freightChargeAmount;
            }
            if (objIsMandatoryField.handling === objScriptParameters.customPriceType) {
                objFields["handlingChargeAmount"] = objBodyFieldIds.handlingChargeAmount;
            }
            if (objIsMandatoryField.dangerousGoods === objScriptParameters.customPriceType) {
                objFields["dangerousGoodsChargeAmount"] = objBodyFieldIds.dangerousGoodsChargeAmount;
            }
            if (objIsMandatoryField.dryIce === objScriptParameters.customPriceType) {
                objFields["dryIceChargeAmount"] = objBodyFieldIds.dryIceChargeAmount;
            }
            if (objIsMandatoryField.minimumOrderCharge === objScriptParameters.customPriceType) {
                objFields["minimumOrderChargeAmount"] = objBodyFieldIds.minimumOrderChargeAmount;
                objFields["minimumOrderValue"] = objBodyFieldIds.minimumOrderValue;
            }
            return objFields;
        }

        function calculateRates(scriptContext) {
            let recCurrentRecord = currentRecord.get();

            if (![
                'custrecord_nts_pr_item_discountedprice',
                'custrecord_nts_pr_item_avg_cost',
                'custrecord_nts_pr_item_id',
                'custrecord_nts_pr_item_anticipatedvolume',
                'custrecord_nts_pr_item_volume_2yrs'
            ].includes(scriptContext.fieldId)) return;

            const objLineFields = {
                flDiscountedPrice: 'custrecord_nts_pr_item_discountedprice',
                flLineCost: 'custrecord_nts_pr_item_avg_cost',
                intItemId: 'custrecord_nts_pr_item_id',
                flPrevDiscountPrice: 'custrecord_nts_pr_item_prev_dscntedprice',
                volume: 'custrecord_nts_pr_item_anticipatedvolume',
            }
            let objLinesValues = commonLibrary.getLineFieldValues(recCurrentRecord, true, scriptContext.lineNum , objLineFields, idSublist);

            log.debug("calculateRates.objLinesValues",objLinesValues);

            for (let strKey in objLinesValues) {
                if (objLinesValues[strKey]) continue;
                objLinesValues[strKey] = 0;
            }

            const flDiscountedPrice = Number(objLinesValues.flDiscountedPrice);
            const flLineCost = Number(objLinesValues.flLineCost);
            const flPrevDiscountPrice = Number(objLinesValues.flPrevDiscountPrice);
            const flVolume = Number(objLinesValues.volume);

            const flSafeDiscountedPrice = Number.isFinite(flDiscountedPrice) ? flDiscountedPrice : 0;
            const flSafeLineCost = Number.isFinite(flLineCost) ? flLineCost : 0;
            const flSafePrevDiscountPrice = Number.isFinite(flPrevDiscountPrice) ? flPrevDiscountPrice : 0;
            const flSafeVolume = Number.isFinite(flVolume) ? flVolume : 0;

            // const flMarginAmount = objLinesValues.flDiscountedPrice - objLinesValues.flLineCost;
            // const flMarginPercentage = ((objLinesValues.flDiscountedPrice - objLinesValues.flLineCost) / objLinesValues.flDiscountedPrice) * 100;

            // New Formula Feb 12
            const flAnnualValue = flSafeVolume * flSafePrevDiscountPrice;
            const flProjectedAnnualValue = flSafeVolume * flSafeDiscountedPrice;
            const flMarginAmount = (flSafeDiscountedPrice - flSafeLineCost) * flSafeVolume;
            // const flMarginPercentage = flMarginAmount / flProjectedAnnualValue;
            const flMarginPercentage = flSafeDiscountedPrice !== 0
                ? ((flSafeDiscountedPrice - flSafeLineCost) / flSafeDiscountedPrice) * 100
                : 0;

            log.debug("calculateRates", {
                objLinesValues,
                flAnnualValue,
                flProjectedAnnualValue,
                flMarginAmount,
                flMarginPercentage,
            });

            let objLineFieldUpdates = {
                custrecord_nts_pr_item_annualvalue: flAnnualValue.toFixed(2),
                custrecord_nts_pr_item_projected_value: flProjectedAnnualValue.toFixed(2),
                custrecord_nts_pr_item_amount: flMarginAmount.toFixed(2),
                custrecord_nts_pr_item_margin_pct: flMarginPercentage.toFixed(2),
            };

            if (flSafePrevDiscountPrice > 0 && flSafeDiscountedPrice !== 0) {
                const flPriceChange = (
                    (flSafeDiscountedPrice - flSafePrevDiscountPrice)
                    / flSafePrevDiscountPrice
                ) * 100;
                objLineFieldUpdates.custrecord_nts_pr_item_pricechange = flPriceChange.toFixed(2);
            }

            log.debug("calculateRates.Update",objLineFieldUpdates);

            for (let strFieldId in objLineFieldUpdates) {
                recCurrentRecord.setCurrentSublistValue({
                    sublistId: idSublist,
                    fieldId: strFieldId,
                    value: objLineFieldUpdates[strFieldId],
                });
            }
        }

        function startValidationPostSourcing(scriptContext) {
            let recCurrentRecord = currentRecord.get();

            if (scriptContext.fieldId === 'custrecord_nts_pr_item_id') {

                let objLineFieldUpdates = {};
                const objBodyFieldBooleanValues = getBodyFieldValues(recCurrentRecord, true, objBodyFieldBooleans);
                const objMandatoryFields = checkFieldsIfMandatory(recCurrentRecord, objBodyFieldBooleanValues);
                const objBodyFieldValues = getBodyFieldValues(recCurrentRecord, true, objMandatoryFields);

                const idItem =  recCurrentRecord.getCurrentSublistValue({
                    sublistId: idSublist,
                    fieldId: 'custrecord_nts_pr_item_id',
                });
                const arrCustomerIds = getAssociatedCustomerIds(recCurrentRecord);
                // Run a fresh, targeted search for this item line; do not reuse a potentially stale page-level result set.
                const objItemsAnticipatedVolume = arrCustomerIds.length > 0 && idItem
                    ? commonLibrary.getItemAnticipatedVolume(
                        objScriptParameters.anticipatedVolumeSearch,
                        arrCustomerIds,
                        [idItem]
                    )
                    : {};

                log.debug("startValidationPostSourcing",{
                    objBodyFieldBooleanValues,
                    objMandatoryFields,
                    objBodyFieldValues,
                    idItem,
                    customerCount: arrCustomerIds.length,
                    "has anticipated volume": objItemsAnticipatedVolume.hasOwnProperty(idItem)
                });

                log.debug("objItemsAnticipatedVolume,", objItemsAnticipatedVolume)

                const arrNullFields = emptyValueChecker(objBodyFieldValues);

                if (arrNullFields.length !== 0) {
                    const strFieldLabels = getFieldLabels(arrNullFields);
                    log.debug("strFieldLabels",strFieldLabels);

                    recCurrentRecord.cancelLine({
                        sublistId: idSublist
                    });

                    dialog.alert({
                        title: 'Alert',
                        message: `${strFieldLabels} value is required.`
                    });

                    return;
                }

                if (objItemsAnticipatedVolume.hasOwnProperty(idItem)) {
                    objLineFieldUpdates[objLineFieldIds.volume] = Math.round(objItemsAnticipatedVolume[idItem]['volume12Months']);
                    // objLineFieldUpdates[objLineFieldIds.volumePrev] = Math.round(objItemsAnticipatedVolume[idItem]['volume24Months']);
                }

                if (objBodyFieldBooleanValues.freight === objScriptParameters.customPriceType) {
                    objLineFieldUpdates[objLineFieldIds.freight] = true;
                    objLineFieldUpdates[objLineFieldIds.freightChargeAmount] = objBodyFieldValues.freightChargeAmount;
                }
                if (objBodyFieldBooleanValues.handling === objScriptParameters.customPriceType) {
                    objLineFieldUpdates[objLineFieldIds.handling] = true;
                    objLineFieldUpdates[objLineFieldIds.handlingChargeAmount] = objBodyFieldValues.handlingChargeAmount;
                }
                if (objBodyFieldBooleanValues.dangerousGoods === objScriptParameters.customPriceType) {
                    objLineFieldUpdates[objLineFieldIds.dangerousGoods] = true;
                    objLineFieldUpdates[objLineFieldIds.dangerousGoodsChargeAmount] = objBodyFieldValues.dangerousGoodsChargeAmount;
                }
                if (objBodyFieldBooleanValues.dryIce === objScriptParameters.customPriceType) {
                    objLineFieldUpdates[objLineFieldIds.dryIce] = true;
                    objLineFieldUpdates[objLineFieldIds.dryIceChargeAmount] = objBodyFieldValues.dryIceChargeAmount;
                }
                if (objBodyFieldBooleanValues.minimumOrderCharge === objScriptParameters.customPriceType) {
                    objLineFieldUpdates[objLineFieldIds.minimumOrderCharge] = true;
                    objLineFieldUpdates[objLineFieldIds.minimumOrderChargeAmount] = objBodyFieldValues.minimumOrderChargeAmount;
                }

                // Source the header Minimum Order Value for every newly added item line.
                objLineFieldUpdates[objLineFieldIds.minimumOrderValue] = recCurrentRecord.getValue({
                    fieldId: objBodyFieldIds.minimumOrderValue
                });

                log.debug("objLineFieldUpdates:325",objLineFieldUpdates);

                for (let strFieldId in objLineFieldUpdates) {
                    recCurrentRecord.setCurrentSublistValue({
                        sublistId: idSublist,
                        fieldId: strFieldId,
                        value: objLineFieldUpdates[strFieldId],
                    });
                }

            }

        }

        function getAssociatedCustomerIds(recCurrentRecord) {
            const arrCustomerIds = [];
            const intCustomerLineCount = recCurrentRecord.getLineCount({
                sublistId: idCustomerSublist
            });

            for (let intLine = 0; intLine < intCustomerLineCount; intLine++) {
                const idCustomer = recCurrentRecord.getSublistValue({
                    sublistId: idCustomerSublist,
                    fieldId: 'custrecord_nts_pr_customer_create_cust',
                    line: intLine
                });

                if (idCustomer && !arrCustomerIds.includes(String(idCustomer))) {
                    arrCustomerIds.push(String(idCustomer));
                }
            }

            return arrCustomerIds;
        }

        function startValidationFieldChanged(scriptContext) {
            let recCurrentRecord = currentRecord.get();

            if (scriptContext.fieldId === 'custrecord_nts_pr_item_id') {
                checkIfItemIsDuplicated(recCurrentRecord);
            }

            if ([
                'custrecord_nts_pr_item_discountedprice',
                'custrecord_nts_pr_item_avg_cost',
                'custrecord_nts_pr_item_id',
            ].includes(scriptContext.fieldId)) {
                const objLineFields = {
                    flDiscountedPrice: 'custrecord_nts_pr_item_discountedprice',
                    flLineCost: 'custrecord_nts_pr_item_avg_cost',
                    intItemId: 'custrecord_nts_pr_item_id',
                    flPrevDiscountPrice: 'custrecord_nts_pr_item_prev_dscntedprice',
                    volume: 'custrecord_nts_pr_item_anticipatedvolume',
                    flListPrice: 'custrecord_nts_pr_item_listprice',
                }
                const objLinesValues = commonLibrary.getLineFieldValues(recCurrentRecord, true, scriptContext.lineNum , objLineFields, idSublist);
                const arrNullFields = emptyValueChecker(objLinesValues);

                log.debug("PS: line discounted price field nulls", {
                    arrNullFields: arrNullFields,
                    type: typeof arrNullFields,
                    length: arrNullFields.length,
                });
                log.debug(strLogTitle, 'objLinesValues:'+JSON.stringify(objLinesValues));

                //Get Average Cost Value from EST Landed Cost if Avg Cost is NULL
                if (objLinesValues.intItemId && objLinesValues.flLineCost === '')
                {
                    let arrItemLookUp = search.lookupFields({
                        type: 'item',
                        id: objLinesValues.intItemId,
                        columns: ['custitem_ns_estlandedcost']
                    });

                    if (arrItemLookUp['custitem_ns_estlandedcost'] != '')
                    {
                        recCurrentRecord.setCurrentSublistValue({
                            sublistId: idSublist,
                            fieldId: 'custrecord_nts_pr_item_avg_cost',
                            value: arrItemLookUp['custitem_ns_estlandedcost']
                        });
                    }
                }

                const flDiscountedPrice = Number(objLinesValues.flDiscountedPrice);
                const flListPrice = Number(objLinesValues.flListPrice);
                if (Number.isFinite(flDiscountedPrice)
                    && Number.isFinite(flListPrice)
                    && flDiscountedPrice > flListPrice) {
                    dialog.alert({
                        title: 'Alert',
                        message: 'Disc Price is greater than List Price'
                    });
                }

                if (arrNullFields.length !== 0) return;

            }

            if (Object.values(objBodyFieldBooleans).includes(scriptContext.fieldId)) {
                checkFieldsToDisable(scriptContext.fieldId);
            }

        }

        function disableBodyAmountFieldsOnStartup() {
            strLogTitle = 'disableBodyAmountFieldsOnStartup';
            let arrFieldIds = Object.values(objBodyFieldBooleans);
            for (let i = 0; i < arrFieldIds.length; i++) {
                checkFieldsToDisable(arrFieldIds[i]);
            }
        }

        function checkFieldsToDisable(strCurrentField) {

            let strAmountField;
            let recCurrentRecord = currentRecord.get();
            const strCurrentFieldValue = parseInt(
                recCurrentRecord.getValue({
                    fieldId: strCurrentField,
                })
            );
            const bDisableField = strCurrentFieldValue !== objScriptParameters.customPriceType;

            // log.debug("checkFieldsToDisable",{
            //     strCurrentField,
            //     strCurrentFieldValue,
            //     bDisableField,
            //     objScriptParameters,
            // });

            if (strCurrentField === objBodyFieldBooleans.freight) {
                strAmountField = objBodyFieldIds.freightChargeAmount;
            }
            if (strCurrentField === objBodyFieldBooleans.handling) {
                strAmountField = objBodyFieldIds.handlingChargeAmount;
            }
            if (strCurrentField === objBodyFieldBooleans.dangerousGoods) {
                strAmountField = objBodyFieldIds.dangerousGoodsChargeAmount;
            }
            if (strCurrentField === objBodyFieldBooleans.dryIce) {
                strAmountField = objBodyFieldIds.dryIceChargeAmount;
            }
            if (strCurrentField === objBodyFieldBooleans.minimumOrderCharge) {
                strAmountField = objBodyFieldIds.minimumOrderChargeAmount;
            }
            // log.debug("finalupdates",{
            //     strAmountField,
            //     bDisableField,
            // });
            if (bDisableField) {
                recCurrentRecord.setValue({
                    fieldId: strAmountField,
                    value: "",
                });
            }
            let objField = recCurrentRecord.getField({
                fieldId: strAmountField
            });
            objField.isDisabled = bDisableField;
        }

        function getBodyFieldValues(objRecord, bIsDynamic, objFields) {
            let objValues = {};
            for (let strFieldLabel in objFields) {
                let objFieldValue = objRecord.getValue({
                    fieldId: objFields[strFieldLabel],
                });
                objFieldValue = Number(objFieldValue) ? Number(objFieldValue) : objFieldValue;
                objValues[strFieldLabel] = objFieldValue;
            }
            return objValues;
        }

        function emptyValueChecker(objToCheck) {
            let arrNullFields = [];
            for (let strKey in objToCheck) {
                if (!objToCheck[strKey] && objToCheck[strKey] !== 0) arrNullFields.push(strKey);
            }
            log.debug("emptyValueChecker", arrNullFields);
            return arrNullFields;
        }

        function getFieldLabels(arrFields) {
            let arrFieldLabels = [];
            for (let i = 0; i < arrFields.length; i++) {
                arrFieldLabels.push(objFieldLabels[arrFields[i]]);
            }
            return arrFieldLabels.toString().replaceAll(',',', ');
        }

        return {
            pageInit: pageInit,
            lineInit: lineInit,
            fieldChanged: fieldChanged,
            postSourcing: postSourcing,
            validateLine: validateLine,
            validateDelete: validateDelete,
            saveRecord: saveRecord,
        };

    });
