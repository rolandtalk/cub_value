const sourceNote = document.getElementById("source-note");
const heroDayChange = document.getElementById("hero-day-change");
const totalMarketValue = document.getElementById("total-market-value");
const totalCostBasis = document.getElementById("total-cost-basis");
const totalGainValue = document.getElementById("total-gain-value");
const totalGainPercent = document.getElementById("total-gain-percent");
const holdingsCount = document.getElementById("holdings-count");
const holdingsBody = document.getElementById("holdings-body");
const refreshButton = document.getElementById("refresh-button");

refreshButton.addEventListener("click", () => {
  loadPortfolio();
});

loadPortfolio();

async function loadPortfolio() {
  setLoading(true);

  try {
    const response = await fetch("/api/portfolio", { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Unable to load portfolio");
    }

    renderPortfolio(payload);
  } catch (error) {
    renderError(error instanceof Error ? error.message : "Unknown error");
  } finally {
    setLoading(false);
  }
}

function renderPortfolio(payload) {
  const { summary, holdings, asOf } = payload;
  sourceNote.textContent = asOf
    ? `${payload.sourceNote} Updated ${formatTimestamp(asOf)}.`
    : payload.sourceNote;

  heroDayChange.textContent = `${formatSignedMoney(summary.dayChangeValue)} (${formatSignedPercent(summary.dayChangePercent)})`;
  heroDayChange.className = `hero-change ${tone(summary.dayChangeValue)}`;

  totalMarketValue.textContent = formatMoney(summary.totalMarketValue);
  totalCostBasis.textContent = formatMoney(summary.totalCostBasis);
  totalGainValue.textContent = formatSignedMoney(summary.totalGainValue);
  totalGainValue.className = `money accent ${tone(summary.totalGainValue)}`;
  totalGainPercent.textContent = formatSignedPercent(summary.totalGainPercent);
  totalGainPercent.className = `money small ${tone(summary.totalGainValue)}`;

  holdingsCount.textContent = `${holdings.length} positions`;
  holdingsBody.innerHTML = holdings.length
    ? holdings.map(renderRow).join("")
    : '<tr><td colspan="9" class="empty-state">No holdings found in the sheet.</td></tr>';
}

function renderRow(row) {
  return `
    <tr>
      <td>${escapeHtml(row.symbol)}</td>
      <td>${formatNumber(row.shares)}</td>
      <td>${formatMoney(row.cost, 2)}</td>
      <td>${formatMaybeMoney(row.price, 2)}</td>
      <td class="${tone(row.dayChangeValue)}">${formatMaybeSignedMoney(row.dayChangeValue)}</td>
      <td class="${tone(row.perf1d)}">${formatMaybeSignedPercent(row.perf1d)}</td>
      <td class="${tone(row.perf3d)}">${formatMaybeSignedPercent(row.perf3d)}</td>
      <td class="${tone(row.perf5d)}">${formatMaybeSignedPercent(row.perf5d)}</td>
      <td class="${tone(row.perf20d)}">${formatMaybeSignedPercent(row.perf20d)}</td>
    </tr>
  `;
}

function renderError(message) {
  sourceNote.textContent = message;
  holdingsBody.innerHTML = '<tr><td colspan="9" class="empty-state">Unable to load portfolio data.</td></tr>';
}

function setLoading(isLoading) {
  refreshButton.disabled = isLoading;
  refreshButton.textContent = isLoading ? "Refreshing..." : "Refresh";
}

function tone(value) {
  if (value == null || value === 0) {
    return "neutral";
  }
  return value > 0 ? "positive" : "negative";
}

function formatMoney(value, digits = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatMaybeMoney(value, digits = 2) {
  return value == null ? "--" : formatMoney(value, digits);
}

function formatSignedMoney(value) {
  const absolute = formatMoney(Math.abs(value), 0);
  return `${value >= 0 ? "+" : "-"}${absolute.replace("$", "$")}`;
}

function formatMaybeSignedMoney(value) {
  return value == null ? "--" : formatSignedMoney(value);
}

function formatSignedPercent(value) {
  if (value == null) {
    return "--";
  }
  const percentage = value * 100;
  return `${percentage >= 0 ? "+" : "-"}${Math.abs(percentage).toFixed(2)}%`;
}

function formatMaybeSignedPercent(value) {
  return value == null ? "--" : formatSignedPercent(value);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatTimestamp(value) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
