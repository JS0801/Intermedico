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
 * @NScriptType UserEventScript
 * @NModuleScope Public
 * @changeLog:   1.0       26 November 2025       Manuel Teodoro       Initial version
 *               1.1       29 May 2026            Manuel Teodoro       Voiding Approved Price Rule (Price Rule Management Line Void) - Added separate button for line-level void.
 *               1.2       10 Jun 2026            Manuel Teodoro       Removing Customer in the Customer List - Added customer removal button.
 *               1.3       10 Jun 2026            Manuel Teodoro       Adding a New Customer and/or Updating values on Other Charge Items (Update Price Rule) - Added update button.
 *               1.4       10 Jun 2026            Manuel Teodoro       Adding a New Customer and/or Updating values on Other Charge Items (Update Price Rule) - Display button from pending change conditions.
 *               1.5       10 Jun 2026            Manuel Teodoro       Adding a New Customer and/or Updating values on Other Charge Items (Update Price Rule) - Check missing customer Price Rules for Approved item lines only.
 *               1.6       14 Aug 2026            Manuel Teodoro       Use one bulk Price Rule search when evaluating Update Price Rule button visibility.
 *               1.7       25 Aug 2026            Manuel Teodoro       Hide Update Price Rule button while background update processing is in progress.
 *               1.8       25 Aug 2026            Manuel Teodoro       Page large customer Price Rule searches during Update Price Rule button visibility checks.
 *               1.9       02 Sep 2026            Manuel Teodoro       Add popup action to manage Price Rule item Print selections.
 *
 */
define(function(require)
{
        let runtime = require("N/runtime");
        let search = require("N/search");
        let record = require("N/record");
        let serverWidget = require("N/ui/serverWidget");
        let NSUtil  = require ('../library/NSUtilvSS2');
        let Lib  = require ('../library/NSTS_MD_CommonLibrary.js');


        let UE = {};
        let Helper = {};
        const DEFAULT_UPDATE_PR_SCRIPT_ID = 'customscript_ns_sl_update_pricerule';
        const DEFAULT_UPDATE_PR_DEPLOY_ID = 'customdeploy_ns_sl_update_pricerule';
        const DEFAULT_MANAGE_PRINT_ITEMS_SCRIPT_ID = 'customscript_ns_sl_manage_pr_print_items';
        const DEFAULT_MANAGE_PRINT_ITEMS_DEPLOY_ID = 'customdeploy_ns_sl_manage_pr_print_items';
        const APPROVED_STATUS_PREFERENCE = 'custscript_prdb_sl_status_approved';

        var PARAM_DEF = {
                approvalslscriptid: {
                        id: 'prdb_sl_review_script',
                        optional: false
                },
                approvalsldeployid: {
                        id: 'prdb_sl_deployment_review',
                        optional: false
                },
                duplicatescriptid: {
                        id: 'prdb_sl_duplicate_script',
                        optional: false
                },
                duplicatedeployid: {
                        id: 'prdb_sl_deployment_duplicate',
                        optional: false
                },
                generatepdfscriptid: {
                        id: 'prdb_sl_genereatepdf_script',
                        optional: false
                },
                generatepdfdeployid: {
                        id: 'prdb_sl_deployment_gneratepdf',
                        optional: false
                },
                clientscript: {
                        id: 'prdb_sl_clien_prapproval',
                        optional: false
                },
                approvedstatus: {
                        id: 'prdb_sl_status_approved',
                        optional: false
                },
                duplicatestatus: {
                        id: 'prdb_sl_status_duplicate',
                        optional: false
                },
                // Voiding Price Rule Management Record - Added parameters for void feature
                voidscriptid: {
                        id: 'prdb_sl_void_script',
                        optional: true
                },
                voiddeployid: {
                        id: 'prdb_sl_deployment_void',
                        optional: true
                },
                // Voiding Approved Price Rule (Price Rule Management Line Void) - New suitelet config for line-level void popup.
                voiditemscriptid: {
                        id: 'prdb_sl_void_item_script',
                        optional: true
                },
                voiditemdeployid: {
                        id: 'prdb_sl_deployment_void_item',
                        optional: true
                },
                // Removing Customer in the Customer List - Suitelet config for customer removal popup.
                removecustomerscriptid: {
                        id: 'prdb_sl_rmc_script',
                        optional: true
                },
                removecustomerdeployid: {
                        id: 'prdb_sl_rmc_deploy',
                        optional: true
                },
                // Adding a New Customer and/or Updating values on Other Charge Items (Update Price Rule) - Suitelet config.
                updateprscriptid: {
                        id: 'prdb_sl_update_pr_script',
                        optional: true
                },
                updateprdeployid: {
                        id: 'prdb_sl_update_pr_deploy',
                        optional: true
                },
                manageprintitemsscriptid: {
                        id: 'prdb_sl_mngprnt_scr',
                        optional: true
                },
                manageprintitemsdeployid: {
                        id: 'prdb_sl_mngprnt_dep',
                        optional: true
                },
                voidroles: {
                        id: 'prdb_sl_void_roles',
                        optional: true
                }
        }

        UE.beforeLoad = function(context)
        {
                let stLogTitle = "UE.beforeLoad";
                log.debug(stLogTitle);

                let type = context.type;
                let execContext = runtime.executionContext;
                log.debug(stLogTitle, "type=" + type + " || " + "execContext=" + execContext);

                try {
                        if (type === context.UserEventType.VIEW)
                        {
                                let params = NSUtil.getParameters(PARAM_DEF,true);
                                Helper.applyUpdatePriceRuleDefaults(params);
                                log.debug(stLogTitle, 'params:'+JSON.stringify(params))
                                let recTransaction = context.newRecord;
                                let objRecord = {};

                                objRecord.currentuser = runtime.getCurrentUser();
                                objRecord.currentuserid = objRecord.currentuser.id;
                                objRecord.recordid = recTransaction.id;
                                objRecord.transactionnumber = recTransaction.getValue({ fieldId: 'name'});
                                objRecord.createdby = recTransaction.getValue({ fieldId: 'custrecord_nts_pr_create_createdby'});
                                objRecord.status = recTransaction.getValue({ fieldId: 'custrecord_nts_pr_create_status'});
                                objRecord.isinactive = recTransaction.getValue({ fieldId: 'isinactive'});
                                objRecord.currentrole = objRecord.currentuser.role;
                                objRecord.updaterequired = recTransaction.getValue({ fieldId: 'custrecord_nts_pr_update_required'});
                                objRecord.updatehash = recTransaction.getValue({ fieldId: 'custrecord_nts_pr_last_applied_hash'});
                                objRecord.updatestatus = recTransaction.getValue({ fieldId: 'custrecord_nts_pr_update_status'});
                                objRecord.updatemessage = recTransaction.getValue({ fieldId: 'custrecord_nts_pr_update_message'});

                                // //TODO: Used in testing. to be deleted.
                                // objRecord.createdby = 29;
                                // objRecord.currentuserid = 29;

                                context.form.clientScriptModulePath = params.clientscript;

                                log.debug(stLogTitle, 'objRecord: ' + JSON.stringify(objRecord));

                                // Voiding Price Rule Management Record - Hide all custom action buttons for inactive records
                                if (objRecord.isinactive === true || objRecord.isinactive === 'T')
                                        return;

                                // Adding a New Customer and/or Updating values on Other Charge Items (Update Price Rule)
                                Helper.displayPriceRuleUpdateMessage(context,objRecord);

                                //Review Process
                                let objReviewLines = Lib.validatePriceRuleItemLines({
                                        record: objRecord,
                                        params: params,
                                        currentuser: objRecord.currentuserid,
                                });
                                log.debug(stLogTitle, 'objReviewLines:'+JSON.stringify(objReviewLines));

                                if (!NSUtil.isEmpty(objReviewLines.reviewlines) && objReviewLines.reviewlines.length > 0)
                                {
                                        Helper.displayReviewButton(context,objRecord,params);
                                }
                                else if (NSUtil.isEmpty(objReviewLines.approvallines))
                                {
                                        Helper.displayApprovedButtons(context,objRecord,params);
                                }

                                // Voiding Price Rule Management Record
                                if (objRecord.isinactive !== true && objRecord.isinactive !== 'T' && Helper.canDisplayVoidRecordButton(objRecord, params))
                                {
                                        Helper.displayVoidRecordButton(context,objRecord,params);
                                }

                                // Voiding Approved Price Rule (Price Rule Management Line Void)
                                if (objRecord.isinactive !== true && objRecord.isinactive !== 'T' && Helper.canDisplayVoidItemButton(objRecord, params))
                                {
                                        Helper.displayVoidItemButton(context,objRecord,params);
                                }

                                // Removing Customer in the Customer List
                                if (objRecord.isinactive !== true && objRecord.isinactive !== 'T' && Helper.canDisplayRemoveCustomerButton(objRecord, params))
                                {
                                        Helper.displayRemoveCustomerButton(context,objRecord,params);
                                }

                                // Adding a New Customer and/or Updating values on Other Charge Items (Update Price Rule)
                                if (objRecord.isinactive !== true && objRecord.isinactive !== 'T' && Helper.canDisplayUpdatePriceRuleButton(recTransaction, objRecord, params))
                                {
                                        Helper.displayUpdatePriceRuleButton(context,objRecord,params);
                                }
                        }
                } catch (ex) {
                        log.error('UE.afterSubmit | Error ', ex.name + ' : ' + ex.message);
                        throw ex;
                }
        };

        Helper.displayReviewButton = function(context,objRecord,params)
        {
                let stLogTitle = "Helper.displayReviewButton";
                log.debug(stLogTitle, objRecord);

                context.form.addButton({
                        id: 'custpage_review_btn',
                        label: "Submit For Review",
                        functionName: 'submitForReview("' + params.approvalslscriptid + '", "' + params.approvalsldeployid + '","review")'
                });
        }

        Helper.displayApprovedButtons = function(context,objRecord,params)
        {
                let stLogTitle = "Helper.displayReviewButton";
                log.debug(stLogTitle, objRecord);

                context.form.addButton({
                        id: 'custpage_generate_pdf',
                        label: "Generate Price Rule PDF Document",
                        functionName: 'generatePriceRulePDF("' + params.generatepdfscriptid + '", "' + params.generatepdfdeployid + '","generate")'
                });
                context.form.addButton({
                        id: 'custpage_email_pdf',
                        label: "Email PDF Price Rule Document",
                        functionName: 'generatePriceRulePDF("' + params.generatepdfscriptid + '", "' + params.generatepdfdeployid + '","email")'
                });
                context.form.addButton({
                        id: 'custpage_duplicate',
                        label: "Duplicate Price Rule",
                        functionName: 'duplicatePriceRule("' + params.duplicatescriptid + '", "' + params.duplicatedeployid + '","' + objRecord.recordid + '")'
                });
                context.form.addButton({
                        id: 'custpage_manage_print_items',
                        label: 'Manage Print Items',
                        functionName: 'managePriceRulePrintItems("' + Helper.getManagePrintItemsScriptId(params.manageprintitemsscriptid) + '", "' + Helper.getManagePrintItemsDeploymentId(params.manageprintitemsdeployid) + '","' + objRecord.recordid + '")'
                });
        }

        Helper.getManagePrintItemsScriptId = function(scriptId)
        {
                return (!NSUtil.isEmpty(scriptId) && (scriptId + '').indexOf('customscript_') === 0)
                        ? scriptId
                        : DEFAULT_MANAGE_PRINT_ITEMS_SCRIPT_ID;
        }

        Helper.getManagePrintItemsDeploymentId = function(deploymentId)
        {
                return (!NSUtil.isEmpty(deploymentId) && (deploymentId + '').indexOf('customdeploy_') === 0)
                        ? deploymentId
                        : DEFAULT_MANAGE_PRINT_ITEMS_DEPLOY_ID;
        }

        // Voiding Price Rule Management Record - START
        Helper.isAllowedVoidRole = function(objRecord, params)
        {
                let stLogTitle = "Helper.isAllowedVoidRole";
                log.debug(stLogTitle, 'objRecord:' + JSON.stringify(objRecord));

                if (NSUtil.isEmpty(params.voidroles))
                        return false;

                let arrVoidRoles = (params.voidroles + '').split(',');
                let stCurrentRole = (objRecord.currentrole + '').trim();

                for (let i = 0; i < arrVoidRoles.length; i++)
                {
                        let stRole = (arrVoidRoles[i] + '').trim();
                        if (!NSUtil.isEmpty(stRole) && stRole === stCurrentRole)
                                return true;
                }

                return false;
        }

        Helper.canDisplayVoidRecordButton = function(objRecord, params)
        {
                if (NSUtil.isEmpty(params.voidscriptid) || NSUtil.isEmpty(params.voiddeployid))
                        return false;
                return Helper.isAllowedVoidRole(objRecord, params);
        }

        // Voiding Approved Price Rule (Price Rule Management Line Void) - Separate validation for line-level void button visibility.
        Helper.canDisplayVoidItemButton = function(objRecord, params)
        {
                if (NSUtil.isEmpty(params.voiditemscriptid) || NSUtil.isEmpty(params.voiditemdeployid))
                        return false;
                if (!Helper.isAllowedVoidRole(objRecord, params))
                        return false;
                return Helper.hasVoidableItemLines(objRecord, params);
        }

        Helper.hasVoidableItemLines = function(objRecord, params)
        {
                let stLogTitle = "Helper.hasVoidableItemLines";

                if (NSUtil.isEmpty(objRecord.recordid) || NSUtil.isEmpty(params.approvedstatus))
                        return false;

                let arrResults = search.create({
                        type: 'customrecord_nts_price_rule_item_create',
                        filters: [
                                ['custrecord_nts_pr_item_create_parent', 'anyof', objRecord.recordid],
                                'AND',
                                ['custrecord_nts_pr_item_status', 'anyof', params.approvedstatus]
                        ],
                        columns: [
                                search.createColumn({name: 'internalid'})
                        ]
                }).run().getRange({
                        start: 0,
                        end: 1
                }) || [];

                log.debug(stLogTitle, 'recordid:' + objRecord.recordid + ' | hasVoidableItemLines:' + (arrResults.length > 0));
                return arrResults.length > 0;
        }

        // Removing Customer in the Customer List - Display only when the popup is configured and active customer lines exist.
        Helper.canDisplayRemoveCustomerButton = function(objRecord, params)
        {
                if (NSUtil.isEmpty(params.removecustomerscriptid) || NSUtil.isEmpty(params.removecustomerdeployid))
                        return false;
                return Helper.hasRemovableCustomerLines(objRecord);
        }

        Helper.hasRemovableCustomerLines = function(objRecord)
        {
                let stLogTitle = "Helper.hasRemovableCustomerLines";

                if (NSUtil.isEmpty(objRecord.recordid))
                        return false;

                let arrResults = search.create({
                        type: 'customrecord_nts_pr_customer_create',
                        filters: [
                                ['custrecord_nts_pr_customer_create_prm', 'anyof', objRecord.recordid],
                                'AND',
                                ['isinactive', 'is', 'F']
                        ],
                        columns: [
                                search.createColumn({name: 'internalid'})
                        ]
                }).run().getRange({
                        start: 0,
                        end: 1
                }) || [];

                log.debug(stLogTitle, 'recordid:' + objRecord.recordid + ' | hasRemovableCustomerLines:' + (arrResults.length > 0));
                return arrResults.length > 0;
        }

        // Adding a New Customer and/or Updating values on Other Charge Items (Update Price Rule) - Button visibility.
        Helper.canDisplayUpdatePriceRuleButton = function(recTransaction, objRecord, params)
        {
                // Adding a New Customer and/or Updating values on Other Charge Items (Update Price Rule) - default Suitelet config prevents a blank company preference from suppressing the button.
                Helper.applyUpdatePriceRuleDefaults(params);
                if (NSUtil.isEmpty(params.updateprscriptid) || NSUtil.isEmpty(params.updateprdeployid))
                        return false;

                // CHANGE 1.7: The Suitelet is the server-side source of truth for the active update.
                // Do not display another submission button while its Map/Reduce task is processing.
                if ((objRecord.updatestatus || '').toString().toLowerCase() === 'processing')
                        return false;

                let bUpdateRequired = Helper.isTrueValue(objRecord.updaterequired);
                let bChargeFieldsChanged = Helper.getChargeHashFromRecord(recTransaction) !== (objRecord.updatehash || '');
                // Avoid unnecessary governance usage when the button is already required by a pending update or charge change.
                let bMissingCustomerPriceRules = false;
                if (!bUpdateRequired && !bChargeFieldsChanged)
                        bMissingCustomerPriceRules = Helper.hasMissingCustomerPriceRules(objRecord.recordid, Helper.getApprovedStatusForUpdate(params));

                log.debug('Adding a New Customer and/or Updating values on Other Charge Items (Update Price Rule) | Button Visibility', {
                        updateRequired: bUpdateRequired,
                        chargeFieldsChanged: bChargeFieldsChanged,
                        missingCustomerPriceRules: bMissingCustomerPriceRules,
                        updateStatus: objRecord.updatestatus,
                        updateScript: params.updateprscriptid,
                        updateDeploy: params.updateprdeployid
                });

                return bUpdateRequired || bChargeFieldsChanged || bMissingCustomerPriceRules;
        }

        Helper.applyUpdatePriceRuleDefaults = function(params)
        {
                if (NSUtil.isEmpty(params.updateprscriptid))
                        params.updateprscriptid = DEFAULT_UPDATE_PR_SCRIPT_ID;
                if (NSUtil.isEmpty(params.updateprdeployid))
                        params.updateprdeployid = DEFAULT_UPDATE_PR_DEPLOY_ID;
        }

        Helper.isTrueValue = function(value)
        {
                return value === true || value === 'T' || value === 'true';
        }

        Helper.getChargeHashFromRecord = function(recTransaction)
        {
                let objHash = {
                        freightType: Helper.safeGetValue(recTransaction, 'custrecord_nts_pr_create_freight'),
                        freightAmount: Helper.safeGetValue(recTransaction, 'custrecord_nts_pr_create_freight_amount'),
                        handlingType: Helper.safeGetValue(recTransaction, 'custrecord_nts_pr_create_handling'),
                        handlingAmount: Helper.safeGetValue(recTransaction, 'custrecord_nts_pr_create_handling_amount'),
                        dangerousGoodsType: Helper.safeGetValue(recTransaction, 'custrecord_nts_pr_create_dangerous_goods'),
                        dangerousGoodsAmount: Helper.safeGetValue(recTransaction, 'custrecord_nts_pr_create_dnggoods_amt'),
                        dryIceType: Helper.safeGetValue(recTransaction, 'custrecord_nts_pr_create_dry_ice'),
                        dryIceAmount: Helper.safeGetValue(recTransaction, 'custrecord_nts_pr_create_dry_ice_amt'),
                        minimumOrderType: Helper.safeGetValue(recTransaction, 'custrecord_nts_pr_create_minord_charge'),
                        minimumOrderCharge: Helper.safeGetValue(recTransaction, 'custrecord_nts_pr_create_minord_amt'),
                        minimumOrderValue: Helper.safeGetValue(recTransaction, 'custrecord_nts_pr_minimum_order_value')
                };

                for (let key in objHash) {
                        objHash[key] = Helper.normalizeValue(objHash[key]);
                }
                return JSON.stringify(objHash);
        }

        Helper.hasMissingCustomerPriceRules = function(intPriceRuleId, stApprovedStatus)
        {
                let arrItemLines = Helper.getUpdateItemLines(intPriceRuleId, stApprovedStatus);
                let arrCustomers = Helper.getUpdateCustomers(intPriceRuleId);

                if (arrItemLines.length === 0 || arrCustomers.length === 0)
                        return false;

                // Load active customer-level Price Rules once. Do not run one or two searches for every customer/item pair.
                let objExistingPriceRules = Helper.getExistingCustomerPriceRuleIndex(intPriceRuleId);
                for (let c = 0; c < arrCustomers.length; c++) {
                        for (let i = 0; i < arrItemLines.length; i++) {
                                if (!Helper.hasExistingCustomerPriceRule(objExistingPriceRules, arrCustomers[c], arrItemLines[i]))
                                        return true;
                        }
                }
                return false;
        }

        Helper.getExistingCustomerPriceRuleIndex = function(intPriceRuleId)
        {
                let objExistingPriceRules = {
                        bySourceLine: {},
                        byCustomerItemDates: {}
                };

                const objExistingPriceRuleSearch = search.create({
                        type: 'customrecord_nts_price_rule',
                        filters: [
                                ['custrecord_nts_pr_pricerule', 'anyof', intPriceRuleId],
                                'AND',
                                ['isinactive', 'is', 'F']
                        ],
                        columns: [
                                search.createColumn({name: 'custrecord_nts_pr_customer'}),
                                search.createColumn({name: 'custrecord_nts_pr_item'}),
                                search.createColumn({name: 'custrecord_nts_pr_source_item_line'}),
                                search.createColumn({name: 'custrecord_nts_pr_start_date'}),
                                search.createColumn({name: 'custrecord_nts_pr_end_date'})
                        ]
                });

                // CHANGE 1.8: run().each() stops at 4,000 results. Large Price Rules can have
                // more customer-level Price Rules, so build the same index from paged result sets.
                const objPagedExistingPriceRules = objExistingPriceRuleSearch.runPaged({pageSize: 1000});
                for (let intPage = 0; intPage < objPagedExistingPriceRules.pageRanges.length; intPage++) {
                        const objPage = objPagedExistingPriceRules.fetch({index: objPagedExistingPriceRules.pageRanges[intPage].index});
                        objPage.data.forEach(function(result) {
                                const stCustomer = result.getValue({name: 'custrecord_nts_pr_customer'});
                                const stItem = result.getValue({name: 'custrecord_nts_pr_item'});
                                const stSourceLine = result.getValue({name: 'custrecord_nts_pr_source_item_line'});
                                const stStartDate = result.getValue({name: 'custrecord_nts_pr_start_date'});
                                const stEndDate = result.getValue({name: 'custrecord_nts_pr_end_date'});

                                if (!NSUtil.isEmpty(stCustomer) && !NSUtil.isEmpty(stSourceLine))
                                        objExistingPriceRules.bySourceLine[Helper.getSourceLineKey(stCustomer, stSourceLine)] = true;
                                if (!NSUtil.isEmpty(stCustomer) && !NSUtil.isEmpty(stItem))
                                        objExistingPriceRules.byCustomerItemDates[Helper.getCustomerItemDateKey(stCustomer, stItem, stStartDate, stEndDate)] = true;
                        });
                }

                return objExistingPriceRules;
        }

        Helper.hasExistingCustomerPriceRule = function(objExistingPriceRules, objCustomer, objLine)
        {
                let stSourceLineKey = Helper.getSourceLineKey(objCustomer.customer, objLine.lineid);
                if (objExistingPriceRules.bySourceLine[stSourceLineKey] === true)
                        return true;

                let stCustomerItemDateKey = Helper.getCustomerItemDateKey(objCustomer.customer, objLine.item, objLine.startdate, objLine.enddate);
                return objExistingPriceRules.byCustomerItemDates[stCustomerItemDateKey] === true;
        }

        Helper.getSourceLineKey = function(stCustomer, stSourceLine)
        {
                return Helper.normalizeValue(stCustomer) + '|' + Helper.normalizeValue(stSourceLine);
        }

        Helper.getCustomerItemDateKey = function(stCustomer, stItem, stStartDate, stEndDate)
        {
                return Helper.normalizeValue(stCustomer) + '|'
                        + Helper.normalizeValue(stItem) + '|'
                        + Helper.normalizeValue(stStartDate) + '|'
                        + Helper.normalizeValue(stEndDate);
        }

        Helper.getUpdateItemLines = function(intPriceRuleId, stApprovedStatus)
        {
                let arrLines = [];
                let arrFilters = [
                        ['custrecord_nts_pr_item_create_parent', 'anyof', intPriceRuleId],
                        'AND',
                        ['isinactive', 'is', 'F']
                ];

                // Adding a New Customer and/or Updating values on Other Charge Items (Update Price Rule) - create checks should only consider Approved item lines.
                if (!NSUtil.isEmpty(stApprovedStatus)) {
                        arrFilters.push('AND');
                        arrFilters.push(['custrecord_nts_pr_item_status', 'anyof', stApprovedStatus]);
                }

                search.create({
                        type: 'customrecord_nts_price_rule_item_create',
                        filters: arrFilters,
                        columns: [
                                search.createColumn({name: 'internalid'}),
                                search.createColumn({name: 'custrecord_nts_pr_item_id'}),
                                search.createColumn({name: 'custrecord_nts_pr_ic_start_date'}),
                                search.createColumn({name: 'custrecord_nts_pr_ic_end_date'})
                        ]
                }).run().each(function(result) {
                        let stItem = result.getValue({name: 'custrecord_nts_pr_item_id'});
                        if (NSUtil.isEmpty(stItem))
                                return true;

                        arrLines.push({
                                lineid: result.id,
                                item: stItem,
                                startdate: result.getValue({name: 'custrecord_nts_pr_ic_start_date'}),
                                enddate: result.getValue({name: 'custrecord_nts_pr_ic_end_date'})
                        });
                        return true;
                });
                return arrLines;
        }

        Helper.getApprovedStatusForUpdate = function(params)
        {
                if (!NSUtil.isEmpty(params.approvedstatus))
                        return params.approvedstatus;

                try {
                        return runtime.getCurrentUser().getPreference({
                                name: APPROVED_STATUS_PREFERENCE
                        }) || '';
                } catch (e) {
                        log.error('Helper.getApprovedStatusForUpdate', e.name + ' : ' + e.message);
                        return '';
                }
        }

        Helper.getUpdateCustomers = function(intPriceRuleId)
        {
                let arrCustomers = [];
                search.create({
                        type: 'customrecord_nts_pr_customer_create',
                        filters: [
                                ['custrecord_nts_pr_customer_create_prm', 'anyof', intPriceRuleId],
                                'AND',
                                ['isinactive', 'is', 'F']
                        ],
                        columns: [
                                search.createColumn({name: 'custrecord_nts_pr_customer_create_cust'})
                        ]
                }).run().each(function(result) {
                        let stCustomer = result.getValue({name: 'custrecord_nts_pr_customer_create_cust'});
                        if (NSUtil.isEmpty(stCustomer))
                                return true;

                        arrCustomers.push({
                                customer: stCustomer
                        });
                        return true;
                });
                return arrCustomers;
        }

        Helper.findExistingCustomerPriceRule = function(intPriceRuleId, objCustomer, objLine)
        {
                let stRecordId = '';
                try {
                        stRecordId = Helper.findCustomerPriceRuleByFilters([
                                ['custrecord_nts_pr_pricerule', 'anyof', intPriceRuleId],
                                'AND',
                                ['custrecord_nts_pr_customer', 'anyof', objCustomer.customer],
                                'AND',
                                ['custrecord_nts_pr_source_item_line', 'anyof', objLine.lineid],
                                'AND',
                                ['isinactive', 'is', 'F']
                        ]);
                        if (!NSUtil.isEmpty(stRecordId))
                                return stRecordId;
                } catch (e) {
                        log.error('Helper.findExistingCustomerPriceRule.sourceLine', e.name + ': ' + e.message);
                }

                let arrFilters = [
                        ['custrecord_nts_pr_pricerule', 'anyof', intPriceRuleId],
                        'AND',
                        ['custrecord_nts_pr_customer', 'anyof', objCustomer.customer],
                        'AND',
                        ['custrecord_nts_pr_item', 'anyof', objLine.item],
                        'AND',
                        ['isinactive', 'is', 'F']
                ];
                if (!NSUtil.isEmpty(objLine.startdate)) {
                        arrFilters.push('AND');
                        arrFilters.push(['custrecord_nts_pr_start_date', 'on', objLine.startdate]);
                }
                if (!NSUtil.isEmpty(objLine.enddate)) {
                        arrFilters.push('AND');
                        arrFilters.push(['custrecord_nts_pr_end_date', 'on', objLine.enddate]);
                }

                return Helper.findCustomerPriceRuleByFilters(arrFilters);
        }

        Helper.findCustomerPriceRuleByFilters = function(arrFilters)
        {
                let stRecordId = '';
                search.create({
                        type: 'customrecord_nts_price_rule',
                        filters: arrFilters,
                        columns: [
                                search.createColumn({name: 'internalid'})
                        ]
                }).run().each(function(result) {
                        stRecordId = result.id;
                        return false;
                });
                return stRecordId;
        }

        Helper.safeGetValue = function(recRecord, stFieldId)
        {
                try {
                        return recRecord.getValue({
                                fieldId: stFieldId
                        });
                } catch (e) {
                        return '';
                }
        }

        Helper.normalizeValue = function(value)
        {
                if (value === null || value === undefined)
                        return '';
                if (value instanceof Date)
                        return value.getTime().toString();
                if (Array.isArray(value))
                        return value.map(Helper.normalizeValue).join('|');
                return value.toString();
        }

        Helper.displayPriceRuleUpdateMessage = function(context,objRecord)
        {
                if (NSUtil.isEmpty(objRecord.updatestatus) || NSUtil.isEmpty(objRecord.updatemessage))
                        return;

                let stColor = (objRecord.updatestatus === 'Error') ? '#8b0000' : '#0f5132';
                let stBgColor = (objRecord.updatestatus === 'Error') ? '#f8d7da' : '#d1e7dd';
                let objMessage = context.form.addField({
                        id: 'custpage_update_pr_message',
                        type: serverWidget.FieldType.INLINEHTML,
                        label: 'Update Price Rule Message'
                });
                objMessage.defaultValue = '<div style="margin:10px 0;padding:10px 12px;border:1px solid ' + stColor + ';background:' + stBgColor + ';color:' + stColor + ';">'
                        + '<b>Update Price Rule:</b> ' + Helper.escapeHtml(objRecord.updatemessage)
                        + '</div>';
        }

        Helper.escapeHtml = function(stValue)
        {
                return ((stValue === null || stValue === undefined) ? '' : (stValue + ''))
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;')
                        .replace(/'/g, '&#39;');
        }

        Helper.displayVoidRecordButton = function(context,objRecord,params)
        {
                let stLogTitle = "Helper.displayVoidRecordButton";
                log.debug(stLogTitle, objRecord);

                context.form.addButton({
                        id: 'custpage_void_pricerule',
                        label: "Void Price Rule Record",
                        functionName: 'voidPriceRuleRecord("' + params.voidscriptid + '", "' + params.voiddeployid + '","' + objRecord.recordid + '")'
                });
        }

        // Voiding Approved Price Rule (Price Rule Management Line Void) - Added line-level void button.
        Helper.displayVoidItemButton = function(context,objRecord,params)
        {
                let stLogTitle = "Helper.displayVoidItemButton";
                log.debug(stLogTitle, objRecord);

                context.form.addButton({
                        id: 'custpage_void_pricerule_item',
                        label: "Void Price Rule Item",
                        functionName: 'voidPriceRuleItem("' + params.voiditemscriptid + '", "' + params.voiditemdeployid + '","' + objRecord.recordid + '")'
                });
        }

        // Removing Customer in the Customer List - Added customer removal popup button.
        Helper.displayRemoveCustomerButton = function(context,objRecord,params)
        {
                let stLogTitle = "Helper.displayRemoveCustomerButton";
                log.debug(stLogTitle, objRecord);

                context.form.addButton({
                        id: 'custpage_remove_customer',
                        label: "Remove Customer",
                        functionName: 'removePriceRuleCustomer("' + params.removecustomerscriptid + '", "' + params.removecustomerdeployid + '","' + objRecord.recordid + '")'
                });
        }

        // Adding a New Customer and/or Updating values on Other Charge Items (Update Price Rule) - Added update button.
        Helper.displayUpdatePriceRuleButton = function(context,objRecord,params)
        {
                let stLogTitle = "Helper.displayUpdatePriceRuleButton";
                log.debug(stLogTitle, objRecord);

                context.form.addButton({
                        id: 'custpage_update_pricerule',
                        label: "Update Price Rule",
                        functionName: 'updatePriceRule("' + params.updateprscriptid + '", "' + params.updateprdeployid + '","' + objRecord.recordid + '")'
                });
        }
        // Voiding Price Rule Management Record - END

        return UE;
});
