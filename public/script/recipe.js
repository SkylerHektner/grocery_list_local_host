import { currentItems } from "./items.js";

// DOM Elements for Recipes
const newRecipeBtn = document.getElementById("new-recipe-btn");
const newRecipeModalBackdrop = document.getElementById("new-recipe-modal-backdrop");
const newRecipeCancelBtn = document.getElementById("new-recipe-cancel-btn");
const newRecipeSubmitBtn = document.getElementById("new-recipe-submit-btn");
const recipeNameInput = document.getElementById("recipe-name-input");
const recipeItemSelect = document.getElementById("recipe-item-select");
const recipeAddItemBtn = document.getElementById("recipe-add-item-btn");
const recipeNewItemBtn = document.getElementById("recipe-new-item-btn");
const recipeItemsList = document.getElementById("recipe-items-list");
const recipesList = document.getElementById("recipes-list");

// edit/delete recipe modals
const editRecipeModalBackdrop = document.getElementById("edit-recipe-modal-backdrop");
const editRecipeCancelBtn = document.getElementById("edit-recipe-cancel-btn");
const editRecipeSubmitBtn = document.getElementById("edit-recipe-submit-btn");
const editRecipeNameInput = document.getElementById("edit-recipe-name-input");
const editRecipeItemSelect = document.getElementById("edit-recipe-item-select");
const editRecipeAddItemBtn = document.getElementById("edit-recipe-add-item-btn");
const editRecipeItemsList = document.getElementById("edit-recipe-items-list");

const deleteRecipeModalBackdrop = document.getElementById("delete-recipe-modal-backdrop");
const deleteRecipeCancelBtn = document.getElementById("delete-recipe-cancel-btn");
const deleteRecipeSubmitBtn = document.getElementById("delete-recipe-submit-btn");
const deleteRecipeNameDisplay = document.getElementById("delete-recipe-name-display");

let recipeItems = [];
let editRecipeItems = [];
let editRecipeTargetName = "";
let deleteRecipeTargetName = "";

export async function fetchAndDisplayRecipes() {
  try {
    const response = await fetch("/api/recipes");
    if (response.ok) {
      const recipes = await response.json();
      recipesList.innerHTML = "";

      if (recipes.length === 0) {
        recipesList.innerHTML =
          '<li class="empty-message">No recipes added yet.</li>';
        return;
      }

      recipes.forEach((recipe) => {
        const li = document.createElement("li");
        li.style.display = "flex";
        li.style.justifyContent = "space-between";
        li.style.alignItems = "center";

        const nameSpan = document.createElement("span");
        nameSpan.textContent = recipe.name;
        nameSpan.classList.add("unselectable");

        const itemsSpan = document.createElement("span");
        itemsSpan.textContent = recipe.items.join(", ");
        itemsSpan.style.fontSize = "0.9em";
        itemsSpan.style.color = "#666";

        const infoDiv = document.createElement("div");
        infoDiv.style.display = "flex";
        infoDiv.style.flexDirection = "column";
        infoDiv.style.gap = "0.25rem";
        infoDiv.appendChild(nameSpan);
        infoDiv.appendChild(itemsSpan);

        const actionsDiv = document.createElement("div");
        actionsDiv.className = "item-actions";

        const editBtn = document.createElement("button");
        editBtn.className = "icon-btn";
        editBtn.textContent = "✏️";
        editBtn.title = "Edit Recipe";
        editBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          openEditRecipeModal(recipe);
        });

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "icon-btn";
        deleteBtn.textContent = "🗑️";
        deleteBtn.title = "Delete Recipe";
        deleteBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          deleteRecipeTargetName = recipe.name;
          deleteRecipeNameDisplay.textContent = recipe.name;
          deleteRecipeModalBackdrop.classList.remove("hidden");
        });

        actionsDiv.appendChild(editBtn);
        actionsDiv.appendChild(deleteBtn);

        li.appendChild(infoDiv);
        li.appendChild(actionsDiv);
        recipesList.appendChild(li);
      });
    } else {
      console.error("Failed to fetch recipes");
      recipesList.innerHTML =
        '<li class="empty-message">Failed to load recipes.</li>';
    }
  } catch (error) {
    console.error("Error fetching recipes:", error);
    recipesList.innerHTML =
      '<li class="empty-message">Error connecting to server.</li>';
  }
}

function openEditRecipeModal(recipe) {
  editRecipeTargetName = recipe.name;
  editRecipeNameInput.value = recipe.name;
  editRecipeItems = [...recipe.items];
  renderEditRecipeItems();
  editRecipeModalBackdrop.classList.remove("hidden");
  editRecipeNameInput.focus();
}

// New Recipe Handlers
newRecipeBtn.addEventListener("click", () => {
  recipeNameInput.value = "";
  recipeItems = [];
  recipeItemsList.innerHTML = "";
  populateRecipeItemSelect(currentItems);
  newRecipeModalBackdrop.classList.remove("hidden");
  recipeNameInput.focus();
});

// Close modal
newRecipeCancelBtn.addEventListener("click", () => {
  newRecipeModalBackdrop.classList.add("hidden");
});

// Add item to recipe
recipeAddItemBtn.addEventListener("click", () => {
  const selectedItemName = recipeItemSelect.value;
  if (!selectedItemName) {
    alert("Please select an item.");
    return;
  }

  if (recipeItems.includes(selectedItemName)) {
    alert("This item is already added to the recipe.");
    return;
  }

  recipeItems.push(selectedItemName);
  recipeItemSelect.value = "";
  renderRecipeItems();
});

// New item button
recipeNewItemBtn.addEventListener("click", async () => {
  const newItemName = prompt("Enter new item name:");
  if (!newItemName || !newItemName.trim()) {
    return;
  }

  const category = prompt("Enter item category:");
  if (!category || !category.trim()) {
    return;
  }

  try {
    const response = await fetch("/api/items", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: newItemName.trim(),
        category: category.trim(),
      }),
    });

    if (response.ok) {
      await fetchAndDisplayRecipes();
      recipeItems.push(newItemName.trim());
      populateRecipeItemSelect(currentItems);
      renderRecipeItems();
    } else if (response.status === 409) {
      alert("This item already exists.");
    } else {
      alert("Failed to create item.");
    }
  } catch (error) {
    console.error("Error:", error);
    alert("An error occurred.");
  }
});

// Submit recipe
newRecipeSubmitBtn.addEventListener("click", async () => {
  const name = recipeNameInput.value.trim();

  if (!name) {
    alert("Please enter a recipe name.");
    return;
  }

  if (recipeItems.length === 0) {
    alert("Please add at least one item to the recipe.");
    return;
  }

  try {
    const response = await fetch("/api/recipes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: name,
        items: recipeItems,
      }),
    });

    if (response.ok) {
      recipeNameInput.value = "";
      recipeItems = [];
      recipeItemsList.innerHTML = "";
      newRecipeModalBackdrop.classList.add("hidden");
      await fetchAndDisplayRecipes();
      alert("Recipe created successfully!");
    } else {
      alert("Failed to create recipe.");
    }
  } catch (error) {
    console.error("Error:", error);
    alert("An error occurred.");
  }
});

// Edit Recipe Handlers
editRecipeCancelBtn.addEventListener("click", () => {
  editRecipeModalBackdrop.classList.add("hidden");
});

editRecipeAddItemBtn.addEventListener("click", () => {
  const selectedItemName = editRecipeItemSelect.value;
  if (!selectedItemName) {
    alert("Please select an item.");
    return;
  }

  if (editRecipeItems.includes(selectedItemName)) {
    alert("This item is already added to the recipe.");
    return;
  }

  editRecipeItems.push(selectedItemName);
  editRecipeItemSelect.value = "";
  renderEditRecipeItems();
});

editRecipeSubmitBtn.addEventListener("click", async () => {
  const name = editRecipeNameInput.value.trim();

  if (!name) {
    alert("Please enter a recipe name.");
    return;
  }

  if (editRecipeItems.length === 0) {
    alert("Please add at least one item to the recipe.");
    return;
  }

  try {
    const response = await fetch("/api/recipes/edit", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        old_name: editRecipeTargetName,
        new_name: name,
        items: editRecipeItems,
      }),
    });

    if (response.ok) {
      editRecipeModalBackdrop.classList.add("hidden");
      await fetchAndDisplayRecipes();
      alert("Recipe updated successfully!");
    } else {
      alert(await response.text() || "Failed to update recipe.");
    }
  } catch (error) {
    console.error("Error:", error);
    alert("An error occurred.");
  }
});

// Delete Recipe Handlers
deleteRecipeCancelBtn.addEventListener("click", () => {
  deleteRecipeModalBackdrop.classList.add("hidden");
});

deleteRecipeSubmitBtn.addEventListener("click", async () => {
  try {
    const response = await fetch("/api/recipes/delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: deleteRecipeTargetName }),
    });

    if (response.ok) {
      deleteRecipeModalBackdrop.classList.add("hidden");
      await fetchAndDisplayRecipes();
    } else {
      alert(await response.text() || "Failed to delete recipe.");
    }
  } catch (error) {
    console.error("Error:", error);
    alert("An error occurred.");
  }
});

function populateRecipeItemSelect(currentItems) {
  recipeItemSelect.innerHTML =
    '<option value="" disabled selected>Select an item...</option>';
  currentItems.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.name;
    option.textContent = item.name;
    recipeItemSelect.appendChild(option);
  });
}

function renderRecipeItems() {
  recipeItemsList.innerHTML = "";
  recipeItems.forEach((itemName) => {
    const li = document.createElement("li");
    li.style.display = "flex";
    li.style.justifyContent = "space-between";
    li.style.alignItems = "center";

    const span = document.createElement("span");
    span.textContent = itemName;

    const removeBtn = document.createElement("button");
    removeBtn.className = "icon-btn";
    removeBtn.textContent = "✕";
    removeBtn.title = "Remove Item";
    removeBtn.addEventListener("click", () => {
      recipeItems = recipeItems.filter((item) => item !== itemName);
      renderRecipeItems();
    });

    li.appendChild(span);
    li.appendChild(removeBtn);
    recipeItemsList.appendChild(li);
  });
}

function renderEditRecipeItems() {
  editRecipeItemsList.innerHTML = "";
  editRecipeItems.forEach((itemName) => {
    const li = document.createElement("li");
    li.style.display = "flex";
    li.style.justifyContent = "space-between";
    li.style.alignItems = "center";

    const span = document.createElement("span");
    span.textContent = itemName;

    const removeBtn = document.createElement("button");
    removeBtn.className = "icon-btn";
    removeBtn.textContent = "✕";
    removeBtn.title = "Remove Item";
    removeBtn.addEventListener("click", () => {
      editRecipeItems = editRecipeItems.filter((item) => item !== itemName);
      renderEditRecipeItems();
    });

    li.appendChild(span);
    li.appendChild(removeBtn);
    editRecipeItemsList.appendChild(li);
  });
}