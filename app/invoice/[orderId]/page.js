"use client";

import { useEffect, useRef } from 'react';
import OrderDocument from '@/components/OrderDocument';

const CUSTOMER_COLUMNS = [
  'SL. NO.',
  'ARTWORK DESCRIPTION & ARTIST',
  'HSN/SAC',
  'QTY',
  'UNIT RATE (₹)',
  'AMOUNT (₹)',
];

const CUSTOMER_TOTAL_LABELS = [
  'Artwork Subtotal',
  'Shipping & Handling Charges (₹)',
  'Tax / GST (₹0.00 — Non-GST)',
  'Grand Total Paid (₹)',
];

function cleanCustomerInvoice(root) {
  if (!root) return;

  const invoiceTable = Array.from(root.querySelectorAll('table')).find(
    (table) => Array.from(table.querySelectorAll('thead th')).some(
      (cell) => /artwork description\s*&\s*artist/i.test(cell.textContent || '')
    )
  );

  if (invoiceTable) {
    invoiceTable.querySelectorAll('thead tr, tbody tr').forEach((row) => {
      Array.from(row.children).slice(6).forEach((cell) => cell.remove());
    });

    const firstHeaderRow = invoiceTable.querySelector('thead tr');
    if (firstHeaderRow) {
      Array.from(firstHeaderRow.children).forEach((cell, index) => {
        const label = CUSTOMER_COLUMNS[index];
        if (label && cell.textContent.trim() !== label) {
          cell.textContent = label;
        }
      });
    }

    Array.from(invoiceTable.querySelectorAll('tfoot tr')).forEach((row, index) => {
      const labelCell = row.querySelector('td:first-child');
      if (!labelCell) return;

      if (labelCell.colSpan !== 5) labelCell.colSpan = 5;
      const label = CUSTOMER_TOTAL_LABELS[index];
      if (label && labelCell.textContent.trim() !== label) {
        labelCell.textContent = label;
      }
    });

    if (invoiceTable.style.minWidth !== '0px') {
      invoiceTable.style.minWidth = '0';
    }
    if (invoiceTable.style.tableLayout !== 'auto') {
      invoiceTable.style.tableLayout = 'auto';
    }
  }

  Array.from(root.querySelectorAll('p')).forEach((paragraph) => {
    const text = paragraph.textContent || '';
    if (
      /creator settlement figures/i.test(text) ||
      /85%\s*\(/i.test(text) ||
      /90%\s*\(/i.test(text)
    ) {
      paragraph.remove();
    }
  });
}

export default function InvoicePage() {
  const invoiceRoot = useRef(null);

  useEffect(() => {
    const root = invoiceRoot.current;
    if (!root) return undefined;

    cleanCustomerInvoice(root);

    const observer = new MutationObserver(() => {
      cleanCustomerInvoice(root);
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={invoiceRoot}>
      <OrderDocument mode="invoice" />
    </div>
  );
}
