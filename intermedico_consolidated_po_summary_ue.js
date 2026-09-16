/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 *
 * Shows a PO total summary box on the Consolidated PO custom record.
 */
define([
    'N/log',
    'N/query',
    'N/ui/serverWidget'
], function (
    log,
    query,
    serverWidget
) {
    const CONFIG = {
        sourcePoLinkField: 'custbody_master_purchase_order',
        summaryFieldId: 'custrecord_cpo_summary_box'
    };

    function beforeLoad(context) {
        const recordId = context.newRecord && context.newRecord.id;

        if (!recordId || !shouldShowSummary(context)) {
            return;
        }

        try {
            const summary = getPurchaseOrderSummary(recordId);
            addSummaryBox(context.form, summary);

            log.audit({
                title: 'Consolidated PO summary loaded',
                details: {
                    consolidatedPoId: recordId,
                    subtotal: summary.subtotal,
                    tax: summary.tax,
                    total: summary.total
                }
            });
        } catch (ex) {
            log.error({
                title: 'Failed to load Consolidated PO summary',
                details: ex
            });
        }
    }

    function shouldShowSummary(context) {
        return context.type === context.UserEventType.VIEW ||
            context.type === context.UserEventType.EDIT;
    }

    function getPurchaseOrderSummary(consolidatedPoId) {
        let subtotal = 0;
        let tax = 0;
        let total = 0;
        const results = query.runSuiteQL({
            query: [
                'SELECT',
                't.id,',
                't.tranid,',
                'SUM(CASE WHEN tl.mainline = \'F\' AND NVL(tl.taxline, \'F\') = \'F\' THEN ABS(NVL(tl.foreignamount, 0)) ELSE 0 END) AS fxsubtotal,',
                'SUM(CASE WHEN NVL(tl.taxline, \'F\') = \'T\' THEN ABS(NVL(tl.foreignamount, 0)) ELSE 0 END) AS fxtaxtotal,',
                'ABS(NVL(t.foreigntotal, 0)) AS fxtotal',
                'FROM transaction t',
                'INNER JOIN transactionline tl ON tl.transaction = t.id',
                'WHERE t.type = \'PurchOrd\'',
                'AND t.' + CONFIG.sourcePoLinkField + ' = ?',
                'GROUP BY t.id, t.tranid, t.foreigntotal'
            ].join(' '),
            params: [consolidatedPoId]
        }).asMappedResults();

        results.forEach(function (row) {
            subtotal += toNumber(row.fxsubtotal);
            tax += toNumber(row.fxtaxtotal);
            total += toNumber(row.fxtotal);
        });

        return {
            subtotal: subtotal,
            tax: tax,
            total: total
        };
    }

    function addSummaryBox(form, summary) {
        let field = form.getField({
            id: CONFIG.summaryFieldId
        });

        if (!field) {
            field = form.addField({
                id: 'custpage_cpo_po_summary',
                type: serverWidget.FieldType.INLINEHTML,
                label: 'PO Summary'
            });
        }

        field.defaultValue = buildSummaryHtml(summary);
    }

    function buildSummaryHtml(summary) {
        return [
            '<style>',
            '.cpo-summary-wrap{display:flex;justify-content:flex-start;margin:12px 0 14px;font-family:Arial,Helvetica,sans-serif}',
            '.cpo-summary-box{width:240px;background:#efefef;color:#333;box-shadow:none}',
            '.cpo-summary-title{background:#607498;color:#fff;font-size:14px;font-weight:700;padding:8px 9px}',
            '.cpo-summary-row{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;font-size:13px}',
            '.cpo-summary-label{font-weight:400;text-transform:uppercase}',
            '.cpo-summary-value{font-weight:700;text-align:right}',
            '.cpo-summary-total{border-top:1px solid #8f8f8f;margin:0 8px;padding:9px 2px 8px;font-size:14px}',
            '</style>',
            '<div class="cpo-summary-wrap">',
            '<div class="cpo-summary-box">',
            '<div class="cpo-summary-title">Summary</div>',
            buildSummaryRow('SUBTOTAL', summary.subtotal, false),
            buildSummaryRow('TAX', summary.tax, false),
            buildSummaryRow('TOTAL', summary.total, true),
            '</div>',
            '</div>'
        ].join('');
    }

    function buildSummaryRow(label, amount, isTotal) {
        const className = isTotal ? 'cpo-summary-row cpo-summary-total' : 'cpo-summary-row';

        return '<div class="' + className + '">' +
            '<div class="cpo-summary-label">' + escapeHtml(label) + '</div>' +
            '<div class="cpo-summary-value">' + formatCurrency(amount) + '</div>' +
            '</div>';
    }

    function toNumber(value) {
        const parsed = parseFloat(String(value || '').replace(/,/g, ''));
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function formatCurrency(value) {
        return toNumber(value).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
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

    return {
        beforeLoad: beforeLoad
    };
});
