import { fetchAndPopulateCategories, fetchAndDisplayItems } from "./items.js";

// Load data when the page starts
async function init() {
  await fetchAndPopulateCategories();
  await fetchAndDisplayItems();
}

init();
