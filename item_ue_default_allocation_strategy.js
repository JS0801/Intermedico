/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/record'], (record) => {
    const STRATEGY_ID = 2;
    const FIELD_ID = 'defaultallocationstrategy';

    const afterSubmit = (context) => {
        if (context.type === context.UserEventType.DELETE) return;

        const itemRecord = context.newRecord;
        if (!itemRecord.id) return;

        // Avoid an unnecessary write when the field is already set.
        if (String(itemRecord.getValue({ fieldId: FIELD_ID })) === String(STRATEGY_ID)) {
            return;
        }

        record.submitFields({
            type: itemRecord.type,
            id: itemRecord.id,
            values: {
                [FIELD_ID]: STRATEGY_ID
            },
            options: {
                enableSourcing: false,
                ignoreMandatoryFields: false
            }
        });
    };

    return { afterSubmit };
});
