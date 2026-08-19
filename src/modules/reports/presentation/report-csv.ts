/**
 * Per-report CSV row builders for the export endpoints (task 25.3).
 *
 * JSON export returns the full structured report payload. CSV export flattens
 * the report's **row-level tabular section** into an RFC 4180 document (via
 * {@link ./csv.ts}); a report shaped as "summary + rows" exports the rows (the
 * scalar summary is only present in the JSON payload). Each builder emits a
 * header record followed by one record per row, and pairs it with a download
 * filename of the form `<report>-<YYYY-MM-DD>.csv`.
 *
 * CSV contents per report:
 * - **sales** → the per-day breakdown: `date,count,subtotal,tax,total`
 *   (the window totals live in the JSON `totals` object only).
 * - **stock** → every stock level:
 *   `productId,productName,sku,branchId,quantity,minStock,isLowStock`
 *   (the low-stock subset + counts live in the JSON payload only).
 * - **cash-flow** → the type/category buckets: `type,category,total,count`
 *   (income/expense/net totals live in the JSON payload only).
 * - **customers** → the ranked customers:
 *   `customerId,customerName,salesCount,totalPurchased`.
 * - **products** → the ranked products:
 *   `productId,productName,sku,quantitySold,revenue`.
 */

import type {
  CashFlowReportOutput,
  CustomerReportOutput,
  ProductPerformanceReportOutput,
  SalesReportOutput,
  StockReportOutput,
} from '../application/dto/report-dtos.js';
import { toCsv, type CsvRow } from './csv.js';

/** A serialised CSV document plus the download filename to attach to it. */
export interface CsvExport {
  filename: string;
  content: string;
}

/** Builds the `<report>-<YYYY-MM-DD>.csv` download filename. */
function csvFilename(report: string, now: Date): string {
  const date = now.toISOString().slice(0, 10);
  return `${report}-${date}.csv`;
}

/** Sales report CSV: the per-day breakdown (`date,count,subtotal,tax,total`). */
export function salesReportToCsv(report: SalesReportOutput, now: Date = new Date()): CsvExport {
  const rows: CsvRow[] = [
    ['date', 'count', 'subtotal', 'tax', 'total'],
    ...report.daily.map(
      (day): CsvRow => [day.date, day.count, day.subtotal, day.tax, day.total],
    ),
  ];
  return { filename: csvFilename('sales', now), content: toCsv(rows) };
}

/** Stock report CSV: every stock level with its low-stock flag. */
export function stockReportToCsv(report: StockReportOutput, now: Date = new Date()): CsvExport {
  const rows: CsvRow[] = [
    ['productId', 'productName', 'sku', 'branchId', 'quantity', 'minStock', 'isLowStock'],
    ...report.items.map(
      (item): CsvRow => [
        item.productId,
        item.productName,
        item.sku,
        item.branchId ?? '',
        item.quantity,
        item.minStock,
        String(item.isLowStock),
      ],
    ),
  ];
  return { filename: csvFilename('stock', now), content: toCsv(rows) };
}

/** Cash-flow report CSV: the type/category buckets (`type,category,total,count`). */
export function cashFlowReportToCsv(
  report: CashFlowReportOutput,
  now: Date = new Date(),
): CsvExport {
  const rows: CsvRow[] = [
    ['type', 'category', 'total', 'count'],
    ...report.byCategory.map(
      (bucket): CsvRow => [bucket.type, bucket.category, bucket.total, bucket.count],
    ),
  ];
  return { filename: csvFilename('cash-flow', now), content: toCsv(rows) };
}

/** Customer report CSV: the ranked top customers. */
export function customerReportToCsv(
  report: CustomerReportOutput,
  now: Date = new Date(),
): CsvExport {
  const rows: CsvRow[] = [
    ['customerId', 'customerName', 'salesCount', 'totalPurchased'],
    ...report.customers.map(
      (customer): CsvRow => [
        customer.customerId,
        customer.customerName,
        customer.salesCount,
        customer.totalPurchased,
      ],
    ),
  ];
  return { filename: csvFilename('customers', now), content: toCsv(rows) };
}

/** Product-performance report CSV: the ranked best-selling products. */
export function productPerformanceReportToCsv(
  report: ProductPerformanceReportOutput,
  now: Date = new Date(),
): CsvExport {
  const rows: CsvRow[] = [
    ['productId', 'productName', 'sku', 'quantitySold', 'revenue'],
    ...report.products.map(
      (product): CsvRow => [
        product.productId,
        product.productName,
        product.sku,
        product.quantitySold,
        product.revenue,
      ],
    ),
  ];
  return { filename: csvFilename('products', now), content: toCsv(rows) };
}
