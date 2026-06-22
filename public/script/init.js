import {
  fetchAndPopulateCategories,
  fetchAndDisplayItems,
  currentItems,
} from "./items.js";
import { fetchAndDisplayRecipes } from "./recipe.js";

async function init() {
  await fetchAndPopulateCategories();
  await fetchAndDisplayItems();
  await fetchAndDisplayRecipes();
}

init();
