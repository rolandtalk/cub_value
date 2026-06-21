const sourceNote = document.getElementById("source-note");
const heroDayChange = document.getElementById("hero-day-change");
const totalMarketValue = document.getElementById("total-market-value");
const totalCostBasis = document.getElementById("total-cost-basis");
const totalGainValue = document.getElementById("total-gain-value");
const totalGainPercent = document.getElementById("total-gain-percent");
const holdingsCount = document.getElementById("holdings-count");
const holdingsBody = document.getElementById("holdings-body");
const holdingsTable = document.getElementById("holdings-table");
const refreshButton = document.getElementById("refresh-button");
const sortButtons = Array.from(document.querySelectorAll(".sort-button"));
const costToggle = document.getElementById("toggle-cost");
const priceToggle = document.getElementById("toggle-price");
let sortState = { key: "symbol", direction: "asc" };
let currentHoldings = [];
const mobileMediaQuery = window.matchMedia("(max-width: 640px)");
let columnVisibility = {
  cost: !mobileMediaQuery.matches,
  price: !mobileMediaQuery.matches,
};

refreshButton.addEventListener("click", () => {
  loadPortfolio();
});

costToggle.addEventListener("click", () => {
  columnVisibility.cost = !columnVisibility.cost;
  applyColumnVisibility();
});

priceToggle.addEventListener("click", () => {
  columnVisibility.price = !columnVisibility.price;
  applyColumnVisibility();
});

mobileMediaQuery.addEventListener("change", (event) => {
  if (event.matches) {
    columnVisibility.cost = false;
    columnVisibility.price = false;
  } else {
    columnVisibility.cost = true;
    columnVisibility.price = true;
  }

  applyColumnVisibility();
});

sortButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const nextKey = button.dataset.sortKey;
    if (!nextKey) {
      return;
    }

    sortState = {
      key: nextKey,
      direction: sortState.key === nextKey && sortState.direction === "asc" ? "desc" : "asc",
    };

    updateSortButtons();
    renderHoldings();
  });
});

applyColumnVisibility();
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

  currentHoldings = holdings;
  holdingsCount.textContent = `${holdings.length} positions`;
  updateSortButtons();
  renderHoldings();
}

function renderRow(row) {
  return `
    <tr>
      <td>${escapeHtml(row.symbol)}</td>
      <td>${formatNumber(row.shares)}</td>
      <td data-column="cost">${formatMoney(row.cost, 2)}</td>
      <td data-column="price">${formatMaybeMoney(row.price, 2)}</td>
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
  currentHoldings = [];
  holdingsBody.innerHTML = '<tr><td colspan="9" class="empty-state">Unable to load portfolio data.</td></tr>';
}

function setLoading(isLoading) {
  refreshButton.disabled = isLoading;
  refreshButton.textContent = isLoading ? "Refreshing..." : "Refresh";
}

function renderHoldings() {
  const sortedHoldings = [...currentHoldings].sort(compareHoldings);
  holdingsBody.innerHTML = sortedHoldings.length
    ? sortedHoldings.map(renderRow).join("")
    : '<tr><td colspan="9" class="empty-state">No holdings found in the sheet.</td></tr>';
  applyColumnVisibility();
}

function compareHoldings(left, right) {
  const direction = sortState.direction === "asc" ? 1 : -1;

  if (sortState.key === "symbol") {
    return left.symbol.localeCompare(right.symbol) * direction;
  }

  const leftValue = left[sortState.key];
  const rightValue = right[sortState.key];

  if (leftValue == null && rightValue == null) {
    return 0;
  }
  if (leftValue == null) {
    return 1;
  }
  if (rightValue == null) {
    return -1;
  }

  return (leftValue - rightValue) * direction;
}

function updateSortButtons() {
  sortButtons.forEach((button) => {
    const isActive = button.dataset.sortKey === sortState.key;
    const indicator = button.querySelector(".sort-indicator");
    button.classList.toggle("active", isActive);
    button.dataset.sortDirection = isActive ? sortState.direction : "none";
    if (indicator) {
      indicator.textContent = isActive ? (sortState.direction === "asc" ? "▲" : "▼") : "↕";
    }
  });
}

function applyColumnVisibility() {
  holdingsTable.classList.toggle("hide-cost", !columnVisibility.cost);
  holdingsTable.classList.toggle("hide-price", !columnVisibility.price);
  costToggle.classList.toggle("active", columnVisibility.cost);
  priceToggle.classList.toggle("active", columnVisibility.price);
  costToggle.setAttribute("aria-pressed", String(columnVisibility.cost));
  priceToggle.setAttribute("aria-pressed", String(columnVisibility.price));
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
