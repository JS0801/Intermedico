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
 * @NScriptType Suitelet
 * @NModuleScope Public
 * @changeLog:   1.0       26 November 2025       Manuel Teodoro       Initial version
 *               1.1       14 August 2026          Manuel Teodoro       Escape address text before adding PDF line breaks.
 *
 */
define( //using require instead for better module loading especially for the have dependencies.
	function (require) {

		//Native modules
		let http = require('N/http');
		let record = require('N/record');
		let runtime = require('N/runtime');
		let url = require('N/url');
		let file = require('N/file');
		let email = require('N/email');
		let search = require('N/search');
		let render 	= require('N/render');
		let ui = require('N/ui/serverWidget');
		let NSUtil  = require ('../library/NSUtilvSS2');

		//Script parameter definition
		//Usage: PARAM_DEF = {parameter1:{id:'custcript_etc', optional:true}}
		var PARAM_DEF = {
			searchpricerule: {
				id: 'prdb_srch_pricerulepdf',
				optional: false
			},
			pricerulepdftemplate: {
				id: 'prdb_template_id',
				optional: false
			},
			pricerulepdffolder: {
				id: 'prdb_template_folder',
				optional: false
			},
			priceruleemailtemplate: {
				id: 'prdb_email_template',
				optional: false
			}
		}

		var EntryPoint = (typeof EntryPoint === 'undefined') ? {} : EntryPoint;
		var Helper = {};

		/**
		 * Definition of the Suitelet script trigger point.
		 *
		 * @param {Object} context
		 * @param {ServerRequest} context.request - Encapsulation of the incoming request
		 * @param {ServerResponse} context.response - Encapsulation of the Suitelet response
		 * @Since 2015.2
		 */
		EntryPoint.onRequest = function (context)
		{
			let stLogTitle = 'onRequest';
			log.debug(stLogTitle, '**** START: Entry Point Invocation ****');

			try
			{
				let paramsHttp = context.request.parameters;
				let params = NSUtil.getParameters(PARAM_DEF, true);
				log.debug(stLogTitle, 'paramsHttp: ' + JSON.stringify(paramsHttp) + ' | params: ' + JSON.stringify(params));
				Helper.mergeParams(params, paramsHttp);

				if (context.request.method === http.Method.GET)
				{
					let stResponse = 'failed';
					let stRecordURL;
					// let objResponse = {};

					let objData = Helper.generatePriceRulePDFDocument(params);
					log.debug(stLogTitle, 'objData:'+objData)

					if (!objData.error)
					{
						stResponse = "success";

						if (objData.process === 'generate')
						{
							log.debug(stLogTitle, '***** generate *****')
							let strDomain = url.resolveDomain({
								hostType: url.HostType.APPLICATION
							});
							let objFile = file.load({id: objData.fileid});
							let fileUrl = objFile.url;
							stRecordURL = 'https://'+strDomain+fileUrl;
						} else {
							log.debug(stLogTitle, '***** email *****')
							stRecordURL = url.resolveRecord({
								recordType: 'customrecord_nts_price_rule_create',
								recordId: objData.id,
							});
						}
					}
					log.debug(stLogTitle, 'stRecordURL:'+stRecordURL)

					let objResponse = {
						status: stResponse,
						process: objData.process,
						id : objData.id,
						url: stRecordURL,
						error: objData.error
					}

					context.response.write({
						output : JSON.stringify(objResponse)
					});
				}
				log.audit(stLogTitle, 'Remaining Units: ' + runtime.getCurrentScript().getRemainingUsage());


			} catch (e) {
				log.error(stLogTitle, JSON.stringify(e));
				throw e.message;
			}
			log.debug(stLogTitle, '**** END: Entry Point Invocation ****');
		};

		Helper.generatePriceRulePDFDocument = function(params)
		{
			let stLogTitle = 'generatePriceRulePDFDocument';
			log.debug(stLogTitle, 'params:'+JSON.stringify(params));
			let strError = null;

			try
			{
				let intFileId;
				let stProcess = params.process;
				let objPriceRuleData = Helper.getPriceRuleData(params);
				let objCustomerList = Helper.getCustomerList(params);
				log.debug(stLogTitle, { objPriceRuleData,objCustomerList })

				let stTemplateID = params.pricerulepdftemplate;
				let objTemplateFile = file.load({id: stTemplateID});
				let objTemplateRenderer = render.create();

				objTemplateRenderer.templateContent = objTemplateFile.getContents();

				let objPDFData = {
					header	: objPriceRuleData.header,
					detail  : objPriceRuleData.lines,
					customer: objCustomerList.arrCustomerList,
					ruralcustomer: objCustomerList.arrRuralCustomerList
				}

				objTemplateRenderer.addCustomDataSource({
					format: render.DataSource.OBJECT,
					alias: 'cdata',
					data: objPDFData
				});

				let objPDFFile = objTemplateRenderer.renderAsPdf();
				let dtCurrentDate = new Date().toDateString();
				let dtFormattedDate = dtCurrentDate.slice(4);
				objPDFFile.name = (stProcess === 'generate') ? 'PriceRule.pdf' : 'Contract Pricing_'+objPriceRuleData.header.id+'_'+dtFormattedDate+'.pdf';

				if (stProcess === 'generate')
				{
					objPDFFile.folder = params.pricerulepdffolder;
					intFileId = objPDFFile.save();
				}
				else
				{
					if (!NSUtil.isEmpty(objPriceRuleData.header.recipient))
					{
						//Send report to Vendor
						let objEmailContent = Helper.getEmailContent(params.priceruleemailtemplate, objPriceRuleData.header);

						let objEmailOptions = {
							author:     runtime.getCurrentUser().id,
							recipients: objPriceRuleData.header.recipient,
							// bcc: [params.emailcc],
							subject:    objEmailContent.subject,
							body:       objEmailContent.body,
							attachments: [objPDFFile]
						};
						email.send(objEmailOptions);
						log.debug(stLogTitle, 'Email Sent!');
					}
					else
					{
						strError = 'Please provide value on Email Recipients field.'
					}
				}

				return {
					process: stProcess,
					fileid: intFileId,
					id: params.id,
					error: strError
				}
			}
			catch (e)
			{
				log.error(stLogTitle, JSON.stringify(e));
				return {
					id: params.id,
					error:  e.message
				};
			}
		}

		Helper.getPriceRuleData = function(params)
		{
			let stLogTitle = 'getPriceRuleData';
			log.debug(stLogTitle);

			let objData = { header:{},lines:[] };
			let arrSearchFilter = [];
			arrSearchFilter.push(
				search.createFilter(
					{
						name: 'internalid',
						join: 'custrecord_nts_pr_item_create_parent',
						operator: search.Operator.ANYOF,
						values: params.id
					})
			);
			let arrResults = NSUtil.search('', params.searchpricerule, arrSearchFilter);
			log.debug(stLogTitle, 'arrResults: ' + JSON.stringify(arrResults[0]));

			if (arrResults.length > 0)
			{
				//Build Header Fields
				let arrHeaderData = arrResults[0];
				let intFreight = arrHeaderData.getValue({ name: 'custrecord_nts_pr_create_freight', join: 'CUSTRECORD_NTS_PR_ITEM_CREATE_PARENT'});
				let intHandling = arrHeaderData.getValue({ name: 'custrecord_nts_pr_create_handling', join: 'CUSTRECORD_NTS_PR_ITEM_CREATE_PARENT'});
				let intDngrgoods = arrHeaderData.getValue({ name: 'custrecord_nts_pr_create_dangerous_goods', join: 'CUSTRECORD_NTS_PR_ITEM_CREATE_PARENT'});
				let intDryice = arrHeaderData.getValue({ name: 'custrecord_nts_pr_create_dry_ice', join: 'CUSTRECORD_NTS_PR_ITEM_CREATE_PARENT'});
				let intMinimumcharge = arrHeaderData.getValue({ name: 'custrecord_nts_pr_create_minord_charge', join: 'CUSTRECORD_NTS_PR_ITEM_CREATE_PARENT'});
				objData.header.id = arrHeaderData.getValue({ name: 'name', join: 'CUSTRECORD_NTS_PR_ITEM_CREATE_PARENT'});
				objData.header.customer = arrHeaderData.getValue({ name: 'custrecord_nts_pr_attention_to', join: 'CUSTRECORD_NTS_PR_ITEM_CREATE_PARENT'});
				// Escape the address text before adding allowed <br/> tags for the PDF template.
				objData.header.address = Helper.formatPdfMultilineText(arrHeaderData.getValue({ name: 'custrecord_nts_pr_address', join: 'CUSTRECORD_NTS_PR_ITEM_CREATE_PARENT'}));
				objData.header.salesrepid = arrHeaderData.getValue({ name: 'custrecord_nts_pr_salesrep', join: 'CUSTRECORD_NTS_PR_ITEM_CREATE_PARENT'});
				objData.header.salesrepname = arrHeaderData.getText({ name: 'custrecord_nts_pr_salesrep', join: 'CUSTRECORD_NTS_PR_ITEM_CREATE_PARENT'});
				objData.header.recipient = arrHeaderData.getValue({ name: 'custrecord_nts_pr_create_email_recipient', join: 'CUSTRECORD_NTS_PR_ITEM_CREATE_PARENT'});
				objData.header.instructions= arrHeaderData.getValue({ name: 'custrecord_nts_pr_special_instructions', join: 'CUSTRECORD_NTS_PR_ITEM_CREATE_PARENT'}).replaceAll('\r\n','<br/>');;
				objData.header.freightamount = (intFreight == 2) ? '$'+Number(arrHeaderData.getValue({ name: 'custrecord_nts_pr_create_freight_amount', join: 'CUSTRECORD_NTS_PR_ITEM_CREATE_PARENT'})).toFixed(2) : 'Base';
				objData.header.handlingamount = (intHandling == 2) ? '$'+Number(arrHeaderData.getValue({ name: 'custrecord_nts_pr_create_handling_amount', join: 'CUSTRECORD_NTS_PR_ITEM_CREATE_PARENT'})) .toFixed(2): 'Base';
				objData.header.dngrgoodsamount = (intDngrgoods == 2) ? '$'+Number(arrHeaderData.getValue({ name: 'custrecord_nts_pr_create_dnggoods_amt', join: 'CUSTRECORD_NTS_PR_ITEM_CREATE_PARENT'})).toFixed(2) : 'Base';
				objData.header.dryiceamount = (intDryice == 2) ? '$'+Number(arrHeaderData.getValue({ name: 'custrecord_nts_pr_create_dry_ice_amt', join: 'CUSTRECORD_NTS_PR_ITEM_CREATE_PARENT'})).toFixed(2) : 'Base';
				objData.header.mimimumchargeamount = (intMinimumcharge == 2) ? '$'+Number(arrHeaderData.getValue({ name: 'custrecord_nts_pr_create_minord_amt', join: 'CUSTRECORD_NTS_PR_ITEM_CREATE_PARENT'})).toFixed(2) : 'Base';
				objData.header.mimimumorder = (intMinimumcharge == 2) ? '$'+Number(arrHeaderData.getValue({ name: 'custrecord_nts_pr_minimum_order_value', join: 'CUSTRECORD_NTS_PR_ITEM_CREATE_PARENT'})).toFixed(2) : 'Base';
				objData.header.customerfacingnotes = arrHeaderData.getValue({ name: 'custrecord_nts_pr_customernotes', join: 'CUSTRECORD_NTS_PR_ITEM_CREATE_PARENT'});

				//Get Sales Rep Data
				let arrSalesRep = search.lookupFields({
					type: search.Type.EMPLOYEE,
					id: objData.header.salesrepid,
					columns: ['email', 'altphone', 'mobilephone']
				});
				log.debug(stLogTitle, 'arrSalesRep:'+JSON.stringify(arrSalesRep));
				objData.header.salesrepemail = arrSalesRep['email'];
				objData.header.salesrepmobile = arrSalesRep['mobilephone'];
				objData.header.salesrepphone = arrSalesRep['altphone'];

				//Build Line Items
				for (let i=0; i<arrResults.length; i++)
				{
					let stItem = arrResults[i].getText({ name: 'custrecord_nts_pr_item_id'});
					let stItemDescription = arrResults[i].getValue({ name: 'custrecord_nts_pr_item_name'});
					let stStartDate = arrResults[i].getValue({ name: 'custrecord_nts_pr_ic_start_date'});
					let stEndDate = arrResults[i].getValue({ name: 'custrecord_nts_pr_ic_end_date'});
					let flDiscountedPrice = arrResults[i].getValue({ name: 'custrecord_nts_pr_item_discountedprice'});

					objData.lines.push({
						item: stItem,
						description: stItemDescription,
						startdate: stStartDate,
						enddate: stEndDate,
						price: NSUtil.formatCurrency(flDiscountedPrice,"",2)
					});
				}
			}
			log.debug(stLogTitle, 'objData:'+JSON.stringify(objData));

			return objData;
		}

		/**
		 * Escapes XML-sensitive characters and retains line breaks as safe PDF markup.
		 *
		 * @param {string} stValue
		 * @returns {string}
		 */
		Helper.formatPdfMultilineText = function(stValue)
		{
			return String(stValue || '')
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&apos;')
				.replace(/\r\n|\r|\n/g, '<br/>');
		}

		Helper.getCustomerList = function(params) {
			let stLogTitle = 'getCustomerList';
			log.debug(stLogTitle);

			let arrCustomerList = [];
			let arrRuralCustomerList = [];
			let objSearchCustomerList = search.create({
				type: "customrecord_nts_pr_customer_create",
				filters:
					[
						["custrecord_nts_pr_customer_create_prm","anyof",params.id],
						"AND",
						["isinactive","is","F"]
					],
				columns:
					[
						search.createColumn({
							name: "entityid",
							join: "CUSTRECORD_NTS_PR_CUSTOMER_CREATE_CUST",
							label: "ID"
						}),
						search.createColumn({
							name: "companyname",
							join: "CUSTRECORD_NTS_PR_CUSTOMER_CREATE_CUST",
							label: "Company Name"
						}),
						search.createColumn({
							name: "custentity_rural",
							join: "CUSTRECORD_NTS_PR_CUSTOMER_CREATE_CUST",
							label: "Rural"
						})
					]
			});
			objSearchCustomerList.run().each(function(result){
				let intCustomerId = result.getValue({ name: 'entityid', join: 'CUSTRECORD_NTS_PR_CUSTOMER_CREATE_CUST' });
				let stCustomerName = result.getValue({ name: 'companyname', join: 'CUSTRECORD_NTS_PR_CUSTOMER_CREATE_CUST' });
				let blIsRural = result.getValue({ name: 'custentity_rural', join: 'CUSTRECORD_NTS_PR_CUSTOMER_CREATE_CUST' });
				let stCustomer = intCustomerId+' - '+stCustomerName;

				if (blIsRural === true) {
					arrRuralCustomerList.push(stCustomer);
				} else {
					arrCustomerList.push(stCustomer);
				}
				return true;
			});

			return {
				arrCustomerList,
				arrRuralCustomerList
			};
		}

		Helper.mergeParams = function (params, paramsHttp) {
			var stLogTitle = 'Helper.mergeParams';
			log.debug(stLogTitle);

			//Combine parameters
			for (var key in paramsHttp) {
				params[key] = paramsHttp[key];
			}
			return params;
		};

		Helper.getEmailContent = function (stEmailTpl, objData) {
			var stLogTitle = 'Helper.getEmailContent';
			log.debug(stLogTitle);

			var recEmailTemp = record.load({
				type: record.Type.EMAIL_TEMPLATE,
				id: stEmailTpl
			});
			var emailSubject = recEmailTemp.getValue({
				fieldId: 'subject'
			});
			var emailBody    = recEmailTemp.getValue({
				fieldId: 'content'
			});
			var rendererSubject = render.create();
			var rendererBody    = render.create();

			rendererSubject.templateContent = emailSubject;
			rendererBody.templateContent    = emailBody;

			var objHeader = {
				name : objData['id'],
				attention : objData['customer'],
			}

			rendererSubject.addCustomDataSource({
				format : render.DataSource.OBJECT,
				alias : 'entity',
				data : objHeader
			});

			rendererBody.addCustomDataSource({
				format : render.DataSource.OBJECT,
				alias : 'entity',
				data : objHeader
			});

			var htmlSubject = rendererSubject.renderAsString();
			var htmlBody = rendererBody.renderAsString();

			return {
				subject : htmlSubject,
				body    : htmlBody
			}
		};


		return EntryPoint;
	});
