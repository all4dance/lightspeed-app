function money(value) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function formatLine(item) {
  return [
    `${item.description} — move ${item.qtyToTransfer} from ${item.fromStore} to ${item.toStore}`,
    `  System ID: ${item.systemId || '-'} | Custom SKU: ${item.customSku || '-'}`,
    `  ${item.fromStore} qty: ${item.fromStore === 'West' ? item.westQty : item.southQty} | ${item.toStore} qty: ${item.toStore === 'West' ? item.westQty : item.southQty}`,
    `  West sold 30: ${item.westSold30} | South sold 30: ${item.southSold30}`,
    `  Reason: ${item.reason}`,
    `  Est. value at cost: ${money(item.estimatedValueAtCost)}`,
  ].join('\n');
}

function groupByPriority(suggestions) {
  return {
    high: suggestions.filter((x) => x.priority === 'High'),
    medium: suggestions.filter((x) => x.priority === 'Medium'),
    low: suggestions.filter((x) => x.priority === 'Low'),
  };
}

function formatTransferEmail(report) {
  const { summary, suggestions, asOfDate } = report;
  const grouped = groupByPriority(suggestions);

  const lines = [];

  lines.push(`Transfer Suggestions as of ${new Date(asOfDate).toLocaleDateString('en-CA')}`);
  lines.push('');
  lines.push(`Summary`);
  lines.push(`- Total suggestions: ${summary.totalSuggestions}`);
  lines.push(`- Total units to move: ${summary.totalUnitsToTransfer}`);
  lines.push(`- Estimated value at cost: ${money(summary.totalEstimatedValueAtCost)}`);
  lines.push(`- West to South: ${summary.westToSouthCount}`);
  lines.push(`- South to West: ${summary.southToWestCount}`);
  lines.push('');

  if (grouped.high.length) {
    lines.push(`HIGH PRIORITY`);
    lines.push('');
    grouped.high.forEach((item) => {
      lines.push(formatLine(item));
      lines.push('');
    });
  }

  if (grouped.medium.length) {
    lines.push(`MEDIUM PRIORITY`);
    lines.push('');
    grouped.medium.forEach((item) => {
      lines.push(formatLine(item));
      lines.push('');
    });
  }

  if (grouped.low.length) {
    lines.push(`LOW PRIORITY`);
    lines.push('');
    grouped.low.forEach((item) => {
      lines.push(formatLine(item));
      lines.push('');
    });
  }

  if (!suggestions.length) {
    lines.push('No transfer suggestions today.');
  }

  return lines.join('\n').trim();
}

module.exports = {
  formatTransferEmail,
};