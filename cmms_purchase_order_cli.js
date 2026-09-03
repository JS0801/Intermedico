var serviceOrderData = null;

function cmmsPageInit(type) {
	serviceOrderData = nlapiGetFieldValue('custpage_serviceorderdata');
	serviceOrderData = serviceOrderData ? JSON.parse(serviceOrderData) : null;
	if (serviceOrderData) {
		if (serviceOrderData.departmentId) {
			nlapiSetFieldValue('department', serviceOrderData.departmentId, false, true);
		}
		if (serviceOrderData.classId) {
			nlapiSetFieldValue('class', serviceOrderData.classId, false, true);
		}
		if (serviceOrderData.locationId) {
			nlapiSetFieldValue('location', serviceOrderData.locationId, false, true);
		}
		if (serviceOrderData.serviceOrderId) {
			nlapiSetFieldValue('custbody_cmms_service_order', serviceOrderData.serviceOrderId, false, true);
		}
		if (serviceOrderData.serviceOrderTypeId) {
			nlapiSetFieldValue('custbody_cseg_cmms_so_type', serviceOrderData.serviceOrderTypeId, false, true);
		}
		if (serviceOrderData.zoneId) {
			nlapiSetFieldValue('custbody_cmms_servicezone', serviceOrderData.zoneId, true, true);
		}
		if (serviceOrderData.equipmentId) {
			nlapiSetFieldValue('custbody_cmms_equipment', serviceOrderData.equipmentId, false, true);
		}
	}
	if (type == 'create') {
		var cmmsPartsVendor = nlapiGetFieldValue('custpage_cmmspartsvendor');
		if (cmmsPartsVendor) {
			showProcessing('Initializing for PM Parts...');
			setTimeout(function () {
				try {
					const segmentConfig = getSegmentConfig();
					nlapiSetFieldValue('entity', cmmsPartsVendor, true, true);
					if (segmentConfig.subsidiariesEnabled) {
						var cmmsPartsSubsidiary = nlapiGetFieldValue('custpage_cmmspartssubsidiary');
						if (cmmsPartsSubsidiary) nlapiSetFieldValue('subsidiary', cmmsPartsSubsidiary, true, true);
					}
					var serviceOrderVals = clientGetFormBlob('serviceordervals');
					if (segmentConfig.deptEnabled && serviceOrderVals.custrecord_cmms_eqsrv_department) nlapiSetFieldValue('department', serviceOrderVals.custrecord_cmms_eqsrv_department);
					if (segmentConfig.classEnabled && serviceOrderVals.custrecord_cmms_eqsrv_class) nlapiSetFieldValue('class', serviceOrderVals.custrecord_cmms_eqsrv_class);
					if (segmentConfig.locEnabled && serviceOrderVals.custrecord_cmms_eqsrv_location) {
						nlapiSetFieldValue('location', serviceOrderVals.custrecord_cmms_eqsrv_location);
					}
					var poParts = clientGetFormBlob('poparts');
					var locationId = nlapiGetFieldValue('custpage_cmmspartslocation');
					poParts.forEach(function (part) {
						if (!part.quantity) return;
						nlapiSelectNewLineItem('item');
						if (locationId) {
							nlapiSetCurrentLineItemValue('item', 'location', locationId, true, true);
						}
						nlapiSetCurrentLineItemValue('item', 'item', part.partId, true, true);
						if (part.type == 'ADDLPART') {
							nlapiSetCurrentLineItemValue('item', 'description', part.lineDescr, true, true);
						}
						nlapiSetCurrentLineItemValue('item', 'quantity', part.quantity);
						var rate = part.type == 'ADDLPART' ? part.rate : part.poVendor.cost;
						if (rate) {
							nlapiSetCurrentLineItemValue('item', 'rate', rate, true, true);
							nlapiSetCurrentLineItemValue('item', 'amount', roundNumber(rate * part.quantity, 2), true, true);
						}
						if (locationId) {
							nlapiSetCurrentLineItemValue('item', 'location', locationId, true, true);
						}
						nlapiCommitLineItem('item');
					});
				} finally {
					hideProcessing();
				}
			}, 10);
		}
	}
}

function cmmsFieldChanged(type, name, _linenum) {
	if (!type && name == 'entity') {
		if (serviceOrderData) {
			if (serviceOrderData.subsidiaryId) {
				nlapiSetFieldValue('subsidiary', serviceOrderData.subsidiaryId, false, true);
			}
			if (serviceOrderData.departmentId) {
				nlapiSetFieldValue('department', serviceOrderData.departmentId, false, true);
			}
			if (serviceOrderData.classId) {
				nlapiSetFieldValue('class', serviceOrderData.classId, false, true);
			}
			if (serviceOrderData.locationId) {
				nlapiSetFieldValue('location', serviceOrderData.locationId, false, true);
			}
			if (serviceOrderData.serviceOrderId) {
				nlapiSetFieldValue('custbody_cmms_service_order', serviceOrderData.serviceOrderId, false, true);
			}
			if (serviceOrderData.serviceOrderTypeId) {
				nlapiSetFieldValue('custbody_cseg_cmms_so_type', serviceOrderData.serviceOrderTypeId, false, true);
			}
		}
	}
}

