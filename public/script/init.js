import { fetchAndPopulateCategories, fetchAndDisplayItems } from "./items.js";
import { fetchAndDisplayGroceryList } from "./grocery_list.js";

// Load data when the page starts
async function init() {
  await fetchAndPopulateCategories();
  await fetchAndDisplayItems();
  await fetchAndDisplayGroceryList();
}

init();
