import {
  fetchAndPopulateCategories,
  fetchAndDisplayItems,
  currentItems,
} from "./items.js";
import { fetchAndDisplayRecipes, initializeRecipeModal } from "./recipe.js";

async function init() {
  await fetchAndPopulateCategories();
  await fetchAndDisplayItems();
  await fetchAndDisplayRecipes();
  initializeRecipeModal(currentItems, async () => {
    await fetchAndDisplayItems();
    await fetchAndDisplayRecipes();
  });
}

init();
