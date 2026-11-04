/**
 * Copyright (c) 2026, Oracle and/or its affiliates. All rights reserved.
 *
 * Version    Date          Author           Remarks
 * 1.0        17-Jul-2026   Manuel Teodoro   Blanket Schedule helpers.
 * 1.1        10-Aug-2026   Manuel Teodoro   Add Sales Channel to generated Sales Order mapping.
 * 1.2        01-Oct-2026   Manuel Teodoro   Add shared processing status constants for controlled Sales Order synchronization.
 */
/**
 * @NApiVersion 2.1
 */
define([], function () {
    const CONSTANTS = {
        mode: { recurring: 'Recurring', specific: 'Specific Date' },
        frequency: { day: 'Day', week: 'Week', month: 'Month' },
        status: { ready: 'Ready for Processing', active: 'Active', error: 'Error' },
        field: {
            startDate: 'custrecord_ns_bs_start_date', endDate: 'custrecord_ns_bs_end_date', mode: 'custrecord_ns_bs_schedule_mode',
            frequencyUnit: 'custrecord_ns_bs_frequency_unit', frequencyInterval: 'custrecord_ns_bs_frequency_interval', defaultQuantity: 'custrecord_ns_bs_default_qty',
            defaultLocation: 'custrecord_ns_bs_default_location', defaultShipTo: 'custrecord_ns_bs_ship_to_ref', orderType: 'custrecord_ns_bs_order_type', salesChannel: 'custrecord_ns_bs_sales_channel',
            priceRefresh: 'custrecord_ns_bs_price_refresh', parent: 'custrecord_ns_bsi_parent', item: 'custrecord_ns_bsi_item', quantity: 'custrecord_ns_bsi_qty',
            startOverride: 'custrecord_ns_bsi_start_override', endOverride: 'custrecord_ns_bsi_end_override', modeOverride: 'custrecord_ns_bsi_mode_override',
            frequencyUnitOverride: 'custrecord_ns_bsi_freq_unit_override', frequencyIntervalOverride: 'custrecord_ns_bsi_freq_int_override',
            deliveryDate: 'custrecord_ns_bsi_delivery_date', locationOverride: 'custrecord_ns_bsi_location_override', shipToOverride: 'custrecord_ns_bsi_ship_to_override'
        }
    };

    function getDateKey(value) {
        if (!value) return '';
        const date = value instanceof Date ? value : new Date(value);
        return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    }

    function addMonths(date, months) {
        const result = new Date(date.getFullYear(), date.getMonth() + months, 1);
        result.setDate(Math.min(date.getDate(), new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()));
        return result;
    }

    function getEffectiveValues(header, itemSchedule) {
        return {
            itemId: itemSchedule.itemId,
            quantity: itemSchedule.quantity || header.defaultQuantity,
            startDate: itemSchedule.startDate || header.startDate,
            endDate: itemSchedule.endDate || header.endDate,
            mode: itemSchedule.mode || header.mode,
            frequencyUnit: itemSchedule.frequencyUnit || header.frequencyUnit,
            frequencyInterval: Number(itemSchedule.frequencyInterval || header.frequencyInterval || 0),
            deliveryDate: itemSchedule.deliveryDate,
            location: itemSchedule.location || header.defaultLocation,
            shipTo: itemSchedule.shipTo || header.defaultShipTo
        };
    }

    function validateValues(values) {
        const errors = [];
        if (!values.itemId) errors.push('Item is required.');
        if (!Number(values.quantity) || Number(values.quantity) <= 0) errors.push('Quantity per Shipment must be greater than zero.');
        if (values.mode === CONSTANTS.mode.specific) {
            if (!values.deliveryDate) errors.push('Specific Delivery Date is required for Specific Date schedules.');
            return errors;
        }
        if (!values.startDate || !values.endDate) errors.push('Start Date and End Date are required for recurring schedules.');
        if (values.startDate && values.endDate && values.startDate > values.endDate) errors.push('End Date cannot be earlier than Start Date.');
        if (!values.frequencyUnit) errors.push('Frequency Unit is required for recurring schedules.');
        if (!Number(values.frequencyInterval) || Number(values.frequencyInterval) <= 0) errors.push('Frequency Interval must be greater than zero.');
        return errors;
    }

    function validateHeaderValues(values) {
        const errors = [];
        if (values.mode === CONSTANTS.mode.specific) return errors;
        if (!values.startDate || !values.endDate) errors.push('Start Date and End Date are required for recurring schedules.');
        if (values.startDate && values.endDate && values.startDate > values.endDate) errors.push('End Date cannot be earlier than Start Date.');
        if (!values.frequencyUnit) errors.push('Frequency Unit is required for recurring schedules.');
        if (!Number(values.frequencyInterval) || Number(values.frequencyInterval) <= 0) errors.push('Frequency Interval must be greater than zero.');
        return errors;
    }

    function validateItemOverrideValues(values) {
        const errors = [];
        if (!values.itemId) errors.push('Item is required.');
        if (values.quantity !== null && values.quantity !== '' && values.quantity !== undefined && Number(values.quantity) <= 0) errors.push('Quantity per Shipment must be greater than zero.');
        if (values.startDate && values.endDate && values.startDate > values.endDate) errors.push('End Date Override cannot be earlier than Start Date Override.');
        if (values.frequencyInterval !== null && values.frequencyInterval !== '' && values.frequencyInterval !== undefined && Number(values.frequencyInterval) <= 0) errors.push('Frequency Interval Override must be greater than zero.');
        return errors;
    }

    function getOccurrenceDates(values) {
        if (values.mode === CONSTANTS.mode.specific) return values.deliveryDate ? [values.deliveryDate] : [];
        const dates = [];
        let current = new Date(values.startDate.getFullYear(), values.startDate.getMonth(), values.startDate.getDate());
        const end = new Date(values.endDate.getFullYear(), values.endDate.getMonth(), values.endDate.getDate());
        while (current <= end) {
            dates.push(new Date(current));
            if (values.frequencyUnit === CONSTANTS.frequency.day) current.setDate(current.getDate() + values.frequencyInterval);
            else if (values.frequencyUnit === CONSTANTS.frequency.week) current.setDate(current.getDate() + (values.frequencyInterval * 7));
            else current = addMonths(current, values.frequencyInterval);
        }
        return dates;
    }

    function buildOccurrenceKey(itemScheduleId, sequence) {
        return `BSI-${itemScheduleId}-${String(sequence).padStart(3, '0')}`;
    }

    function buildDesiredLines(header, itemSchedules) {
        const lines = [];
        itemSchedules.forEach(function (itemSchedule) {
            const values = getEffectiveValues(header, itemSchedule);
            const errors = validateValues(values);
            if (errors.length) throw new Error(`Blanket Item Schedule ${itemSchedule.id}: ${errors.join(' ')}`);
            getOccurrenceDates(values).forEach(function (date, index) {
                lines.push({ itemScheduleId: itemSchedule.id, occurrenceKey: buildOccurrenceKey(itemSchedule.id, index + 1), itemId: values.itemId, quantity: Number(values.quantity), location: values.location, shipTo: values.shipTo, deliveryDate: date });
            });
        });
        return lines;
    }

    function isEligibleGeneratedLine(line) {
        // CHANGE 1.2: A generated line becomes protected as soon as NetSuite has created an
        // Item Fulfillment for the exact Sales Order line, or it is picked, packed, fulfilled,
        // or billed. It cannot be changed afterward.
        return line.generated === true
            && !line.closed
            && !isTrue(line.hasItemFulfillment)
            && !isTrue(line.fulfillmentStatusLine)
            && Number(line.quantityPicked || 0) === 0
            && Number(line.quantityPacked || 0) === 0
            && Number(line.quantityFulfilled || 0) === 0
            && Number(line.quantityBilled || 0) === 0;
    }

    function isTrue(value) {
        return value === true || ['t', 'true', 'y', 'yes', '1'].includes(String(value || '').toLowerCase());
    }

    function isGenerationRelevantChange(newRecord, oldRecord, fieldIds) {
        if (!oldRecord) return true;
        return fieldIds.some(function (fieldId) { return String(newRecord.getValue({ fieldId: fieldId }) || '') !== String(oldRecord.getValue({ fieldId: fieldId }) || ''); });
    }

    return { CONSTANTS: CONSTANTS, getDateKey: getDateKey, getEffectiveValues: getEffectiveValues, validateValues: validateValues, validateHeaderValues: validateHeaderValues, validateItemOverrideValues: validateItemOverrideValues, getOccurrenceDates: getOccurrenceDates, buildOccurrenceKey: buildOccurrenceKey, buildDesiredLines: buildDesiredLines, isEligibleGeneratedLine: isEligibleGeneratedLine, isGenerationRelevantChange: isGenerationRelevantChange };
});
